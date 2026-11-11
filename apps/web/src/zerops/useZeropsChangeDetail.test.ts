import type {
  ChangeDetailResponse,
  ChangeLink,
  ChangeMetadataResponse,
  ChangeReview,
} from "@t3tools/shared/hqChanges";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { RegistryContext } from "@effect/atom-react";
import { AccountDataContext, AccountStoreContext } from "./accountData";
import { reviewAccount } from "./__fixtures__/reviewAccount";
import { TestNode } from "./__fixtures__/testDom";
import {
  mergedMain,
  useZeropsChangeDetail,
  type ZeropsChangeDetail,
  type ZeropsChangeDetailRequest,
} from "./useZeropsChangeDetail";

const HEAD = "c".repeat(40);
const MAIN = "a".repeat(40);

/** What HQ answers each read of the change's record, in order — the last answer repeats. */
const hq = vi.hoisted(() => ({
  answers: [] as Array<"record" | "unrecorded" | "failed">,
  reads: [] as Array<string>,
  /** What the person asked the repository to compare. */
  compares: [] as Array<unknown>,
  /** Whether it merges, as the record keeps it; none where a scenario does not say. */
  recorded: undefined as string | undefined,
  /** What HQ judges of the change now, or that it does not answer. */
  judged: "failed" as { readonly kind: string } | "failed",
  /** Each read of HQ's judgement now, by the head and main it asked at. */
  judgements: [] as Array<unknown>,
}));

const REVIEW: ChangeReview = {
  mergeBase: MAIN,
  files: [{ path: "src/a.ts", added: 3, deleted: 1, binary: false }],
  filesTruncated: false,
  conflictPaths: [],
  commits: [
    {
      sha: HEAD,
      subject: "Add a /status page",
      authorName: "Nova",
      at: "2026-10-02T09:00:00.000Z",
    },
  ],
  commitsTruncated: false,
};
let review: ChangeReview = REVIEW;

/** The organization's official HQ, the same one on every render, as `useOfficialHq` keeps it. */
const official = vi.hoisted(() => ({
  address: "https://hq.example.test",
  api: {
    gitBrowse: async (read: string, appId: string, repo: string, params: unknown) => {
      hq.compares.push({ read, appId, repo, params });
      return {
        base: { sha: "a".repeat(40), ref: { name: "main", kind: "branch" } },
        head: { sha: "c".repeat(40), ref: { name: "c".repeat(40), kind: "commit" } },
        mergeBase: "b".repeat(40),
        commits: [],
        totalCommits: 1,
        files: [
          {
            path: "src/b.ts",
            status: "modified",
            additions: 2,
            deletions: 2,
            binary: false,
            hunks: null,
            loadable: true,
          },
        ],
        totalFiles: 1,
        filesTruncated: false,
      };
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

const LINK: ChangeLink = { appId: "g1", repo: "appdev", number: 2 };

/** The detail as the review holds it, request by request, one render each. */
async function mount(requests: ReadonlyArray<ZeropsChangeDetailRequest | null>) {
  installTestDom();
  const { createRoot } = await import("react-dom/client");
  const seen: Array<ZeropsChangeDetail> = [];
  function Probe({ request }: { readonly request: ZeropsChangeDetailRequest | null }) {
    seen.push(useZeropsChangeDetail(request));
    return null;
  }
  const account = reviewAccount(
    async ({ link }) => {
      hq.reads.push(`${link.appId}/${link.repo}#${String(link.number)}`);
      const answer = hq.answers[Math.min(hq.reads.length - 1, hq.answers.length - 1)];
      if (answer === "failed") throw new Error("HQ is not answering right now.");
      // HQ still working the change out: its files are not recorded yet.
      const change = {
        ...link,
        body: "",
        ...(hq.recorded === undefined ? {} : { mergeability: hq.recorded }),
      };
      if (answer === "unrecorded")
        return {
          change,
          review: { ...review, mergeBase: null, files: null, commits: null },
        } as unknown as ChangeMetadataResponse;
      return { change, review } as unknown as ChangeMetadataResponse;
    },
    undefined,
    async ({ link, snapshot }) => {
      hq.judgements.push({ link, snapshot });
      if (hq.judged === "failed") throw new Error("HQ is not answering right now.");
      return {
        change: { ...link, body: "" },
        mainHead: MAIN,
        mergeBase: MAIN,
        mergeability: hq.judged,
      } as unknown as ChangeDetailResponse;
    },
  );
  const root = createRoot(document.createElement("div") as unknown as Element);
  for (const request of requests) {
    await act(async () => {
      root.render(
        createElement(
          RegistryContext.Provider,
          { value: account.registry },
          createElement(
            AccountStoreContext,
            { value: account.store },
            createElement(
              AccountDataContext.Provider,
              { value: account.data },
              createElement(Probe, { request }),
            ),
          ),
        ),
      );
    });
  }
  return {
    latest: () => seen.at(-1)!,
    seen: () => seen,
    unmount: () =>
      act(async () => {
        root.unmount();
      }),
  };
}

describe("useZeropsChangeDetail", () => {
  afterEach(() => {
    hq.answers = [];
    hq.reads = [];
    hq.compares = [];
    hq.recorded = undefined;
    hq.judged = "failed";
    hq.judgements = [];
    review = REVIEW;
    vi.unstubAllGlobals();
  });

  it("reads the change from HQ once, as its review reads it", async () => {
    hq.answers = ["record"];
    const request = { link: LINK, head: HEAD, main: MAIN };
    const probe = await mount([request, request]);
    expect(probe.latest().readout).toMatchObject({
      kind: "read",
      value: { commits: [{ sha: HEAD, subject: "Add a /status page" }] },
    });
    expect(hq.reads).toEqual(["g1/appdev#2"]);
    await probe.unmount();
  });

  it.each([
    ["a push moved its head", { link: LINK, head: "d".repeat(40), main: MAIN }],
    ["a merge moved main", { link: LINK, head: HEAD, main: "e".repeat(40) }],
    [
      "HQ judged whether it merges",
      { link: LINK, head: HEAD, main: MAIN, mergeability: "mergeable" as const },
    ],
  ])("reads it again once %s", async (_name, moved) => {
    hq.answers = ["record"];
    const probe = await mount([
      { link: LINK, head: HEAD, main: MAIN, mergeability: "checking" },
      moved,
    ]);
    expect(hq.reads).toHaveLength(2);
    await probe.unmount();
  });

  // A reload can read HQ's record while HQ is still checking the change: without a second read, the
  // review held "Checking whether it merges cleanly" and files "Not known yet" for good.
  it("a record read while HQ checked the change gives way to the one HQ judged, with nothing taken back meanwhile", async () => {
    hq.answers = ["unrecorded", "record"];
    const probe = await mount([
      { link: LINK, head: HEAD, main: MAIN, mergeability: "checking" },
      { link: LINK, head: HEAD, main: MAIN, mergeability: "mergeable" },
    ]);
    expect(probe.latest().readout).toMatchObject({
      kind: "read",
      value: { filesKnown: true, files: [{ path: "src/a.ts" }] },
    });
    const kinds = probe.seen().map(({ readout }) => readout.kind);
    expect(kinds.slice(kinds.indexOf("read"))).not.toContain("reading");
    expect(hq.reads).toHaveLength(2);
    await probe.unmount();
  });

  // HQ once kept "unknown" for a change after a failure and never judged it again: the review said
  // "Checking whether it merges cleanly" for an hour with Merge held, while HQ's judgement said clean.
  it.each([
    ["unrecorded and judged clean, it merges", "unknown", { kind: "clean" }, "mergeable", 1],
    [
      "unrecorded and judged conflicting, it names the files",
      "unknown",
      { kind: "conflict", paths: ["src/a.ts"] },
      "conflicting",
      1,
    ],
    ["unrecorded and HQ not answering, it is still checked", "unknown", "failed", "checking", 1],
    [
      "recorded clean, nothing more is asked",
      "clean",
      { kind: "conflict", paths: ["src/a.ts"] },
      "mergeable",
      0,
    ],
  ] as const)(
    "A change's review asks HQ's judgement of the shown head and main only while its record has none: %s",
    async (_case, recorded, judged, mergeability, asked) => {
      hq.answers = ["record"];
      hq.recorded = recorded;
      hq.judged = judged;
      const probe = await mount([{ link: LINK, head: HEAD, main: MAIN }]);
      expect(probe.latest().readout).toMatchObject({
        kind: "read",
        value: {
          mergeability,
          conflict: typeof judged === "object" && "paths" in judged && asked ? judged.paths : [],
        },
      });
      expect(hq.judgements).toEqual(
        Array.from({ length: asked }, () => ({
          link: LINK,
          snapshot: { expectedHead: HEAD, expectedMain: MAIN },
        })),
      );
      await probe.unmount();
    },
  );

  it("reads one that failed again on Try again, and nothing that answered", async () => {
    hq.answers = ["failed", "record"];
    const probe = await mount([{ link: LINK, head: HEAD, main: MAIN }]);
    expect(probe.latest().readout).toEqual({
      kind: "failed",
      reason: "HQ is not answering right now.",
    });
    await act(async () => {
      probe.latest().retry();
    });
    expect(probe.latest().readout.kind).toBe("read");
    await act(async () => {
      probe.latest().retry();
    });
    expect(hq.reads).toHaveLength(2);
    await probe.unmount();
  });

  it("The change review opens without waiting for HQ's detail", async () => {
    const probe = await mount([{ link: LINK, head: HEAD, main: MAIN }]);
    expect(probe.latest().readout).toMatchObject({
      kind: "read",
      value: { files: [{ path: "src/a.ts", additions: 3, deletions: 1 }], diffBase: MAIN },
    });
    expect(probe.latest().showFiles).toBeUndefined();
    expect(hq.compares).toEqual([]);
    await probe.unmount();
  });

  it("Files not recorded yet read not known yet, and a press reads them once", async () => {
    review = { ...REVIEW, mergeBase: null, files: null, commits: null };
    const probe = await mount([{ link: LINK, head: HEAD, main: MAIN }]);
    expect(probe.latest().readout).toMatchObject({ kind: "read", value: { filesKnown: false } });
    expect(hq.compares).toEqual([]);
    await act(async () => {
      probe.latest().showFiles?.();
    });
    expect(probe.latest().readout).toMatchObject({
      kind: "read",
      value: { filesKnown: true, files: [{ path: "src/b.ts" }], diffBase: "b".repeat(40) },
    });
    expect(probe.latest().showFiles).toBeUndefined();
    expect(hq.compares).toEqual([
      { read: "compare", appId: "g1", repo: "appdev", params: { base: MAIN, head: HEAD } },
    ]);
    await probe.unmount();
  });

  it("reads nothing of a change no push reached", async () => {
    const probe = await mount([{ link: LINK, head: undefined, main: MAIN }, null]);
    expect(probe.latest().readout).toEqual({ kind: "none" });
    expect(hq.reads).toEqual([]);
    expect(hq.compares).toEqual([]);
    await probe.unmount();
  });
});

it("uses only this repository's latest merge for its main, even when another repo merged later", () => {
  const changes = [
    { repository: "webdev", mergeCommitSha: "b".repeat(40) },
    { repository: "apidev", mergeCommitSha: MAIN },
    { repository: "apidev", mergeCommitSha: "d".repeat(40) },
  ];
  expect(mergedMain("apidev", changes)).toBe(MAIN);
  expect(mergedMain("missing", changes)).toBeUndefined();
  expect(mergedMain("apidev", undefined)).toBeUndefined();
});
