import { describe, expect, it } from "vite-plus/test";

import { environmentAttention, PROJECT_ALL_CLEAR, projectAttention } from "./projectAttention.ts";
import type { FlowPullRequest } from "./projectFlow.ts";

function pull(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "appdev",
    number: 4,
    title: "Cache the link previews",
    kind: "code",
    mateProjectId: "p-theo",
    author: "mate-p-theo",
    url: undefined,
    checks: "passing",
    checkWord: "Passing",
    mergeable: true,
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
      pullRequests: [pull({ mergeable: false })],
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

  it("names the Mate on the verb, so the hand-over says who takes it", () => {
    const [item] = projectAttention({ ...EMPTY, pullRequests: [pull({ mergeable: false })] });
    expect(item?.verb).toBe("Ask Theo");
    expect(item?.text).toBe("#4 needs a rebase");
  });

  it("falls back to a nameless Mate rather than a blank verb", () => {
    const [item] = projectAttention({
      ...EMPTY,
      mateNames: new Map(),
      pullRequests: [pull({ mergeable: false })],
    });
    expect(item?.verb).toBe("Ask the Mate");
  });

  it("leaves checks that are merely running alone: waiting is the correct move", () => {
    const items = projectAttention({
      ...EMPTY,
      pullRequests: [pull({ mergeable: false, checks: "pending" })],
    });
    expect(items).toEqual([]);
  });

  it("never asks for a release the account cannot make", () => {
    const items = projectAttention({ ...EMPTY, notLive: 3, canRelease: false });
    expect(items).toEqual([]);
  });

  it.each([
    [1, "1 change is merged and not live"],
    [4, "4 changes are merged and not live"],
  ])("counts %i as %s", (notLive, text) => {
    const [item] = projectAttention({ ...EMPTY, notLive, canRelease: true });
    expect(item?.text).toBe(text);
  });

  it("points every item at where it is dealt with", () => {
    const items = projectAttention({
      ...EMPTY,
      waitingMates: [{ projectId: "p-theo", name: "Theo" }],
      failedStops: [{ projectId: "shop-stage", name: "stage" }],
      pullRequests: [pull({ mergeable: false })],
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

const STOP = {
  failed: false,
  deployed: true,
  production: true,
  notLive: 0,
  canRelease: true,
};

describe("environmentAttention", () => {
  it("says nothing where a stop is healthy and current", () => {
    expect(environmentAttention(STOP)).toEqual([]);
  });

  it("leads with a deploy that failed, and offers no verb for a build already on the page", () => {
    const [item] = environmentAttention({ ...STOP, failed: true });
    expect(item?.kind).toBe("deploy-failed");
    // No terminal stop: these are fragments in a list, like the rest.
    expect(item?.text).toBe("The last deploy here failed");
    // The run is drawn further down this very page: a button that scrolls is
    // furniture, and a button that navigates here goes nowhere.
    expect(item?.verb).toBeUndefined();
    expect(item?.target).toBeUndefined();
  });

  it("counts what is merged and not live here, and carries the verb that ships it", () => {
    const [item] = environmentAttention({ ...STOP, notLive: 3 });
    expect(item?.kind).toBe("not-live");
    expect(item?.text).toBe("3 changes are merged and not live here");
    expect(item?.verb).toBe("Release");
    expect(environmentAttention({ ...STOP, notLive: 1 })[0]?.text).toBe(
      "1 change is merged and not live here",
    );
  });

  it("never asks a stage to release, and never asks for a release the account cannot make", () => {
    expect(environmentAttention({ ...STOP, production: false, notLive: 4 })).toEqual([]);
    expect(environmentAttention({ ...STOP, canRelease: false, notLive: 4 })).toEqual([]);
  });

  it("says an environment nothing has ever reached, which a dot cannot", () => {
    const [item] = environmentAttention({ ...STOP, deployed: false });
    expect(item?.kind).toBe("never-deployed");
    expect(item?.text).toBe("Nothing has been deployed here yet");
    expect(item?.verb).toBeUndefined();
  });

  it("orders a failure above work waiting to go out", () => {
    const items = environmentAttention({ ...STOP, failed: true, notLive: 2 });
    expect(items.map((item) => item.kind)).toEqual(["deploy-failed", "not-live"]);
  });
});
