import type { HqChangeComment } from "@t3tools/shared/hqChanges";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";
import {
  forgetChangeComments,
  useZeropsChangeComments,
  type ZeropsChangeComments,
} from "./useZeropsChangeComments";

/** What HQ answers each read of the conversation, in order — the last answer repeats. */
const hq = vi.hoisted(() => ({
  answers: [] as Array<ReadonlyArray<string> | "failed" | "never">,
  reads: 0,
  posted: [] as Array<string>,
}));

function said(body: string, index: number): HqChangeComment {
  return {
    id: `c${String(index + 1)}`,
    authorUserId: "u-ales",
    body,
    createdAt: "2026-10-02T09:00:00.000Z",
  };
}

/** The organization's official HQ, the same one on every render, as `useOfficialHq` keeps it. */
const official = vi.hoisted(() => ({
  address: "https://hq.example.test",
  api: {
    changeComments: async () => {
      const answer = hq.answers[Math.min(hq.reads, hq.answers.length - 1)];
      hq.reads += 1;
      if (answer === "failed") throw new Error("HQ is not answering right now.");
      if (answer === "never" || answer === undefined) return new Promise(() => {});
      return answer.map(said);
    },
    commentOnChange: async (_link: unknown, body: string) => {
      hq.posted.push(body);
      return said(body, 99);
    },
  },
}));
vi.mock("./accountHq", () => ({ useOfficialHq: () => official }));

function installTestDom(): void {
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
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}

const REQUEST = { appId: "g1", repo: "appdev", number: 2 } as const;

async function mount(): Promise<{
  readonly seen: ReadonlyArray<ZeropsChangeComments["state"]>;
  readonly latest: () => ZeropsChangeComments;
  readonly unmount: () => Promise<void>;
}> {
  installTestDom();
  const { createRoot } = await import("react-dom/client");
  const seen: Array<ZeropsChangeComments["state"]> = [];
  let latest: ZeropsChangeComments | undefined;
  function Probe() {
    latest = useZeropsChangeComments(REQUEST);
    seen.push(latest.state);
    return null;
  }
  const root = createRoot(document.createElement("div") as unknown as Element);
  await act(async () => {
    root.render(createElement(Probe));
  });
  return {
    seen,
    latest: () => {
      if (latest === undefined) throw new Error("never rendered");
      return latest;
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

describe("useZeropsChangeComments", () => {
  afterEach(() => {
    hq.answers = [];
    hq.reads = 0;
    hq.posted = [];
    forgetChangeComments();
    vi.unstubAllGlobals();
  });

  it("shows what was said at once when the change opens again, while it is read again", async () => {
    hq.answers = [["Looks good."], "never"];
    const first = await mount();
    expect(first.latest().state).toEqual({ kind: "read", comments: [said("Looks good.", 0)] });
    await first.unmount();

    const again = await mount();
    // Never "reading" in between: what was said stands from its first frame.
    expect(again.seen.every((state) => state.kind === "read")).toBe(true);
    expect(again.latest().state).toEqual({ kind: "read", comments: [said("Looks good.", 0)] });
    await again.unmount();
  });

  it("reads the conversation again on Try again after it could not be read", async () => {
    hq.answers = ["failed", ["Looks good."]];
    const probe = await mount();
    expect(probe.latest().state).toMatchObject({ kind: "failed" });
    await act(async () => {
      probe.latest().retry();
    });
    expect(probe.latest().state).toEqual({ kind: "read", comments: [said("Looks good.", 0)] });
    await probe.unmount();
  });

  it("says it on the change as the person, and shows it at once", async () => {
    hq.answers = [["Looks good."]];
    const probe = await mount();
    let refusal: string | null = "unsaid";
    await act(async () => {
      refusal = await probe.latest().say("Ship it.");
    });
    expect(refusal).toBeNull();
    expect(hq.posted).toEqual(["Ship it."]);
    expect(probe.latest().state).toEqual({
      kind: "read",
      comments: [said("Looks good.", 0), said("Ship it.", 99)],
    });
    expect(hq.reads).toBe(1);
    await probe.unmount();
  });
});
