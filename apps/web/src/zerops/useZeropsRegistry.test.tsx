import type { ZeropsRegistry } from "@t3tools/client-runtime/zerops";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";

const session = vi.hoisted(() => {
  const readGroupRegistry =
    vi.fn<(projectId: string, signal: AbortSignal) => Promise<ZeropsRegistry>>();
  return { readGroupRegistry, value: { client: { readGroupRegistry } } };
});

vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => session.value,
}));

const KNOWN: ZeropsRegistry = {
  groups: [{ groupId: "g1", slug: "shop", projects: [] }],
  leaving: [],
  other: ["mate:tool:gitea"],
} as unknown as ZeropsRegistry;

function installTestDom(): TestNode {
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: TestNode,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("HTMLIFrameElement", TestNode);
  return document;
}

afterEach(() => {
  session.readGroupRegistry.mockReset();
  vi.unstubAllGlobals();
});

describe("useZeropsRegistry", () => {
  it.each([
    {
      name: "a failed re-read keeps the registry last read",
      reads: [
        { project: "gitea-a", read: KNOWN },
        { project: "gitea-a", read: "fail" },
      ] as const,
      expected: { registry: KNOWN, loading: false },
    },
    {
      name: "a failed first read reports loading, never a settled empty registry",
      reads: [{ project: "gitea-a", read: "fail" }] as const,
      expected: { loading: true },
    },
    {
      name: "a failed first read of another project never shows the previous project's registry",
      reads: [
        { project: "gitea-a", read: KNOWN },
        { project: "gitea-b", read: "fail" },
      ] as const,
      expected: { registry: { groups: [], leaving: [], other: [] }, loading: true },
    },
  ])("$name", async ({ reads, expected }) => {
    const document = installTestDom();
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useZeropsRegistry } = await import("./useZeropsRegistry");
    for (const { read } of reads) {
      if (read === "fail") session.readGroupRegistry.mockRejectedValueOnce(new Error("503"));
      else session.readGroupRegistry.mockResolvedValueOnce(read);
    }
    /** Every state the probe rendered, the latest last. */
    const rendered: Array<ReturnType<typeof useZeropsRegistry>> = [];

    function Probe(props: { readonly giteaProjectId: string }) {
      rendered.push(useZeropsRegistry({ giteaProjectId: props.giteaProjectId, enabled: true }));
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(async () => root.render(<Probe giteaProjectId={reads[0].project} />));
      for (let read = 1; read < reads.length; read += 1) {
        const { project } = reads[read]!;
        if (project === reads[read - 1]!.project) {
          await act(async () => rendered.at(-1)!.refresh());
        } else {
          await act(async () => root.render(<Probe giteaProjectId={project} />));
        }
      }
      expect(session.readGroupRegistry).toHaveBeenCalledTimes(reads.length);
      expect(rendered.at(-1)).toMatchObject(expected);
    } finally {
      await act(async () => root.unmount());
    }
  });
});

/**
 * A conversation links a change on a Gitea org the registry read at page load does not name — the
 * project was made since, or that read failed. The link asks for the org; the registry is read
 * again, a bounded number of times, and never once per asking link.
 */
describe("useZeropsRegistry — an owner a link names", () => {
  const WITH_FRESH = {
    ...KNOWN,
    groups: [...KNOWN.groups, { groupId: "g2", slug: "fresh", projects: [] }],
  } as unknown as ZeropsRegistry;

  it.each([
    {
      name: "an unknown owner re-reads the registry once",
      asks: [{ atMs: 0, owner: "fresh" }],
      answers: [KNOWN, WITH_FRESH],
      untilMs: 120_000,
      reads: 2,
    },
    {
      name: "an owner the registry names reads nothing more",
      asks: [{ atMs: 0, owner: "shop" }],
      answers: [KNOWN],
      untilMs: 120_000,
      reads: 1,
    },
    {
      name: "the same owner asked by many links re-reads once",
      asks: [
        { atMs: 0, owner: "fresh" },
        { atMs: 0, owner: "fresh" },
        { atMs: 100, owner: "fresh" },
        { atMs: 5_000, owner: "fresh" },
      ],
      answers: [KNOWN, WITH_FRESH],
      untilMs: 120_000,
      reads: 2,
    },
    {
      name: "an owner that stays unknown is read again no sooner than 30 s later",
      asks: [{ atMs: 0, owner: "gone" }],
      answers: [KNOWN],
      untilMs: 29_999,
      reads: 2,
    },
    {
      name: "an owner that stays unknown is given up after three re-reads",
      asks: [
        { atMs: 0, owner: "gone" },
        { atMs: 200_000, owner: "gone" },
      ],
      answers: [KNOWN],
      untilMs: 400_000,
      reads: 4,
    },
    {
      name: "two unknown owners share the re-reads",
      asks: [
        { atMs: 0, owner: "fresh" },
        { atMs: 1_000, owner: "other" },
      ],
      answers: [KNOWN],
      untilMs: 29_999,
      reads: 2,
    },
    {
      name: "an owner asked while the first read is out waits for its answer",
      asks: [{ atMs: 0, owner: "fresh" }],
      firstAnswerAtMs: 3_000,
      answers: [WITH_FRESH],
      untilMs: 120_000,
      reads: 1,
    },
  ] as ReadonlyArray<{
    readonly name: string;
    readonly asks: ReadonlyArray<{ readonly atMs: number; readonly owner: string }>;
    /** When the page-load read answers; at once when absent. */
    readonly firstAnswerAtMs?: number;
    readonly answers: ReadonlyArray<ZeropsRegistry>;
    readonly untilMs: number;
    readonly reads: number;
  }>)("$name", async ({ asks, firstAnswerAtMs, answers, untilMs, reads }) => {
    vi.useFakeTimers();
    const document = installTestDom();
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useZeropsRegistry } = await import("./useZeropsRegistry");
    let answered = 0;
    session.readGroupRegistry.mockImplementation(async () => {
      const answer = answers[Math.min(answered, answers.length - 1)]!;
      answered += 1;
      if (answered === 1 && firstAnswerAtMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, firstAnswerAtMs));
      }
      return answer;
    });
    const rendered: Array<ReturnType<typeof useZeropsRegistry>> = [];
    function Probe() {
      rendered.push(useZeropsRegistry({ giteaProjectId: "gitea-a", enabled: true }));
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(async () => root.render(<Probe />));
      let now = 0;
      // A second at a time, each inside `act`: a re-read renders before the clock moves on.
      const advanceTo = async (atMs: number) => {
        while (now < atMs) {
          const stepMs = Math.min(1_000, atMs - now);
          await act(async () => {
            await vi.advanceTimersByTimeAsync(stepMs);
          });
          now += stepMs;
        }
      };
      for (const ask of asks) {
        await advanceTo(ask.atMs);
        await act(async () => rendered.at(-1)!.askForOwner(ask.owner));
      }
      await advanceTo(untilMs);
      expect(session.readGroupRegistry).toHaveBeenCalledTimes(reads);
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
    }
  });
});
