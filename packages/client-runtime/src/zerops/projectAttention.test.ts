import { describe, expect, it } from "vite-plus/test";

import { PROJECT_ALL_CLEAR, projectAttention } from "./projectAttention.ts";
import type { FlowPullRequest } from "./projectFlow.ts";

function pull(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "appdev",
    number: 4,
    title: "Cache the link previews",
    kind: "code",
    mateProjectId: "p-theo",
    url: undefined,
    mergeability: "mergeable",
    behind: false,
    merged: false,
    mergedAt: undefined,
    headSha: "abc",
    baseBranch: "main",
    line: "appdev #4",
    updatedAt: undefined,
    ...over,
  };
}

const EMPTY = {
  waitingMates: [],
  failedStops: [],
  pullRequests: [],
  notLive: 0,
  canRelease: false,
  mateNames: new Map([["p-theo", "Theo"]]),
};

describe("projectAttention", () => {
  it("says nothing is waiting by saying nothing, so the page can say so out loud", () => {
    expect(projectAttention(EMPTY)).toEqual([]);
    expect(PROJECT_ALL_CLEAR).toBe("Nothing needs you here.");
  });

  it("puts a stopped Mate first: it is the only item where work has halted", () => {
    const items = projectAttention({
      ...EMPTY,
      waitingMates: [{ projectId: "p-theo", name: "Theo" }],
      failedStops: [{ projectId: "shop-stage", name: "stage" }],
      pullRequests: [pull({ mergeability: "conflicting" })],
      notLive: 2,
      canRelease: true,
    });
    expect(items.map((item) => item.kind)).toEqual([
      "mate-waiting",
      "deploy-failed",
      "change-blocked",
      "not-live",
    ]);
  });

  // A Mate whose run ended on an error wears the same waiting face as one that
  // asked something, but it asks nothing: it says so, and it stands with the
  // broken things, after a question and before a failed deploy (the approved
  // menu: a failed Mate's dot is the failure red, never amber).
  it("says a Mate stopped on an error, after one waiting on an answer", () => {
    const items = projectAttention({
      ...EMPTY,
      waitingMates: [{ projectId: "p-theo", name: "Theo" }],
      failedMates: [{ projectId: "p-wren", name: "Wren" }],
      failedStops: [{ projectId: "shop-stage", name: "stage" }],
    });
    expect(items.map((item) => item.kind)).toEqual([
      "mate-waiting",
      "mate-failed",
      "deploy-failed",
    ]);
    expect(items[1]).toEqual({
      kind: "mate-failed",
      text: "Wren stopped on an error",
      verb: "Open",
      target: { kind: "mate", projectId: "p-wren" },
    });
  });

  it("names the Mate on the verb, so the hand-over says who takes it", () => {
    const [item] = projectAttention({
      ...EMPTY,
      pullRequests: [pull({ mergeability: "conflicting" })],
    });
    expect(item?.verb).toBe("Ask Theo");
    expect(item?.text).toBe("#4 needs a rebase");
  });

  it("falls back to a nameless Mate rather than a blank verb", () => {
    const [item] = projectAttention({
      ...EMPTY,
      mateNames: new Map(),
      pullRequests: [pull({ mergeability: "conflicting" })],
    });
    expect(item?.verb).toBe("Ask the Mate");
  });

  it("leaves a change Gitea is still checking alone: waiting is the correct move", () => {
    const items = projectAttention({
      ...EMPTY,
      pullRequests: [pull({ mergeability: "checking" })],
    });
    expect(items).toEqual([]);
  });

  it("never asks for a release the account cannot make", () => {
    const items = projectAttention({ ...EMPTY, notLive: 3, canRelease: false });
    expect(items).toEqual([]);
  });

  it.each([
    [1, "1 change not live"],
    [4, "4 changes not live"],
  ])("counts %i as %s", (notLive, text) => {
    const [item] = projectAttention({ ...EMPTY, notLive, canRelease: true });
    expect(item?.text).toBe(text);
  });

  it("points every item at where it is dealt with", () => {
    const items = projectAttention({
      ...EMPTY,
      waitingMates: [{ projectId: "p-theo", name: "Theo" }],
      failedStops: [{ projectId: "shop-stage", name: "stage" }],
      pullRequests: [pull({ mergeability: "conflicting" })],
      notLive: 1,
      canRelease: true,
    });
    expect(items.map((item) => item.target?.kind)).toEqual([
      "mate",
      "stop",
      "change",
      // A release is the project's own verb and needs no target.
      undefined,
    ]);
  });
});
