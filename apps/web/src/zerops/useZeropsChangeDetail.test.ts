import type { ChangeDetailResponse, ChangeLink } from "@t3tools/shared/hqChanges";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { RegistryContext } from "@effect/atom-react";
import { AccountDataContext } from "./ZeropsAccountData";
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

/** What HQ answers each read of the change's detail, in order — the last answer repeats. */
const hq = vi.hoisted(() => ({
  answers: [] as Array<"detail" | "failed">,
  reads: [] as Array<string>,
  snapshots: [] as Array<unknown>,
}));

const DETAIL = {
  change: { appId: "g1", repo: "appdev", number: 2 },
  mainHead: MAIN,
  mergeBase: MAIN,
  mergeability: { kind: "clean" },
  files: [],
  filesTruncated: false,
  commits: [
    {
      sha: HEAD,
      subject: "Add a /status page",
      authorName: "Nova",
      at: "2026-10-02T09:00:00.000Z",
    },
  ],
  commitsTruncated: false,
} as unknown as ChangeDetailResponse;

/** The organization's official HQ, the same one on every render, as `useOfficialHq` keeps it. */
const official = vi.hoisted(() => ({
  address: "https://hq.example.test",
  api: {
    change: async (
      link: { appId: string; repo: string; number: number },
      _signal?: AbortSignal,
      snapshot?: unknown,
    ) => {
      hq.snapshots.push(snapshot);
      hq.reads.push(`${link.appId}/${link.repo}#${String(link.number)}`);
      const answer = hq.answers[Math.min(hq.reads.length - 1, hq.answers.length - 1)];
      if (answer === "failed") throw new Error("HQ is not answering right now.");
      return DETAIL;
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
  const account = reviewAccount(({ link, snapshot }) =>
    official.api.change(link, undefined, snapshot),
  );
  const root = createRoot(document.createElement("div") as unknown as Element);
  for (const request of requests) {
    await act(async () => {
      root.render(
        createElement(
          RegistryContext.Provider,
          { value: account.registry },
          createElement(
            AccountDataContext.Provider,
            { value: account.data },
            createElement(Probe, { request }),
          ),
        ),
      );
    });
  }
  return {
    latest: () => seen.at(-1)!,
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
    hq.snapshots = [];
    vi.unstubAllGlobals();
  });

  it("reads the change from HQ once, as its review reads it", async () => {
    hq.answers = ["detail"];
    const request = { link: LINK, head: HEAD, main: MAIN };
    const probe = await mount([request, request]);
    expect(probe.latest().readout).toMatchObject({
      kind: "read",
      value: { mergeability: "mergeable", commits: [{ sha: HEAD, subject: "Add a /status page" }] },
    });
    expect(hq.reads).toEqual(["g1/appdev#2"]);
    expect(hq.snapshots).toEqual([{ expectedHead: HEAD, expectedMain: MAIN }]);
    await probe.unmount();
  });

  it.each([
    ["a push moved its head", { link: LINK, head: "d".repeat(40), main: MAIN }],
    ["a merge moved main", { link: LINK, head: HEAD, main: "e".repeat(40) }],
  ])("reads it again once %s", async (_name, moved) => {
    hq.answers = ["detail"];
    const probe = await mount([{ link: LINK, head: HEAD, main: MAIN }, moved]);
    expect(hq.reads).toHaveLength(2);
    await probe.unmount();
  });

  it("reads one that failed again on Try again, and nothing that answered", async () => {
    hq.answers = ["failed", "detail"];
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

  it("reads nothing of a change no push reached", async () => {
    const probe = await mount([{ link: LINK, head: undefined, main: MAIN }, null]);
    expect(probe.latest().readout).toEqual({ kind: "none" });
    expect(hq.reads).toEqual([]);
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
