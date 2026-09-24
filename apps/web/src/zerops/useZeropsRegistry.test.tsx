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
