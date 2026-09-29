import type { GiteaIssueComment } from "@t3tools/client-runtime/zerops";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";
import {
  forgetChangeComments,
  useZeropsChangeComments,
  type ZeropsChangeComments,
} from "./useZeropsChangeComments";

/** What Gitea answers each read of the conversation, in order — the last answer repeats. */
const gitea = vi.hoisted(() => ({
  answers: [] as Array<ReadonlyArray<string> | "failed" | "never">,
  reads: 0,
}));

function said(body: string, index: number): GiteaIssueComment {
  return { id: index + 1, author: "ales", avatarUrl: undefined, body, at: undefined };
}

vi.mock("./accountGiteaSessions", () => ({
  useGiteaReadable: () => true,
  giteaClientFor: () => ({
    listIssueComments: async () => {
      const answer = gitea.answers[Math.min(gitea.reads, gitea.answers.length - 1)];
      gitea.reads += 1;
      if (answer === "failed") throw new Error("Gitea did not answer within 15 s.");
      if (answer === "never" || answer === undefined) return new Promise(() => {});
      return answer.map(said);
    },
  }),
}));

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

const REQUEST = {
  giteaOrigin: "https://gitea.example.test",
  owner: "snap",
  repo: "appdev",
  number: 2,
} as const;

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
    gitea.answers = [];
    gitea.reads = 0;
    forgetChangeComments();
    vi.unstubAllGlobals();
  });

  it("shows what was said at once when the change opens again, while it is read again", async () => {
    gitea.answers = [["Looks good."], "never"];
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
    gitea.answers = ["failed", ["Looks good."]];
    const probe = await mount();
    expect(probe.latest().state).toMatchObject({ kind: "failed" });
    await act(async () => {
      probe.latest().retry();
    });
    expect(probe.latest().state).toEqual({ kind: "read", comments: [said("Looks good.", 0)] });
    await probe.unmount();
  });
});
