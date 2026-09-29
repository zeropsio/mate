import type { GiteaChangedFile, GiteaCommit } from "@t3tools/client-runtime/zerops";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";
import {
  forgetChangeReadouts,
  useZeropsChangeReadout,
  type ZeropsChangeReadout,
} from "./useZeropsChangeReadout";

/** What Gitea answers each read of the change's files, in order — the last answer repeats. */
const gitea = vi.hoisted(() => ({
  files: [] as Array<"files" | "failed">,
  fileReads: 0,
  commits: [] as ReadonlyArray<GiteaCommit>,
}));

const FILES: ReadonlyArray<GiteaChangedFile> = [
  {
    filename: "src/server/index.ts",
    previousFilename: undefined,
    status: "modified",
    additions: 3,
    deletions: 2,
  },
];

vi.mock("./accountGiteaSessions", () => ({
  useGiteaReadable: () => true,
  giteaClientFor: () => ({
    pullRequestFiles: async () => {
      const answer = gitea.files[Math.min(gitea.fileReads, gitea.files.length - 1)];
      gitea.fileReads += 1;
      if (answer === "failed") throw new Error("Gitea did not answer within 15 s.");
      return FILES;
    },
    compareCommits: async () => gitea.commits,
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
  repository: "appdev",
  number: 2,
  headSha: "b21d904cb21d904cb21d904cb21d904cb21d904c",
  baseBranch: "main",
  mergeBase: "m1",
  baseSha: "m1",
  diff: false,
} as const;

async function mount(): Promise<{
  readonly latest: () => ZeropsChangeReadout;
  readonly unmount: () => Promise<void>;
}> {
  installTestDom();
  const { createRoot } = await import("react-dom/client");
  let latest: ZeropsChangeReadout | undefined;
  function Probe() {
    latest = useZeropsChangeReadout(REQUEST);
    return null;
  }
  const root = createRoot(document.createElement("div") as unknown as Element);
  await act(async () => {
    root.render(createElement(Probe));
  });
  return {
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

describe("useZeropsChangeReadout", () => {
  afterEach(() => {
    gitea.files = [];
    gitea.fileReads = 0;
    gitea.commits = [];
    forgetChangeReadouts();
    vi.unstubAllGlobals();
  });

  it("reads the commits it squashes newest first, as a history reads", async () => {
    gitea.files = ["files"];
    gitea.commits = [
      { sha: "c1", subject: "Cache the link previews" },
      { sha: "c2", subject: "Key the preview cache on locale" },
    ];
    const probe = await mount();
    expect(probe.latest().commits).toEqual({
      kind: "read",
      value: [
        { sha: "c2", subject: "Key the preview cache on locale" },
        { sha: "c1", subject: "Cache the link previews" },
      ],
    });
    await probe.unmount();
  });

  it("reads a part that failed again on Try again", async () => {
    gitea.files = ["failed", "files"];
    const probe = await mount();
    expect(probe.latest().files).toMatchObject({ kind: "failed" });
    await act(async () => {
      probe.latest().retry();
    });
    expect(probe.latest().files).toEqual({ kind: "read", value: FILES });
    expect(gitea.fileReads).toBe(2);
    await probe.unmount();
  });

  it("asks nothing again of a part that answered", async () => {
    gitea.files = ["files"];
    const probe = await mount();
    await act(async () => {
      probe.latest().retry();
    });
    expect(probe.latest().files).toEqual({ kind: "read", value: FILES });
    expect(gitea.fileReads).toBe(1);
    await probe.unmount();
  });
});
