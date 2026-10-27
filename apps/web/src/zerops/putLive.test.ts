import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { putLiveRunsIn, usePutLive } from "./putLive";
import { keptPutLiveProductions } from "./putLiveMemory";

const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  });
});

afterEach(async () => {
  await closeAccountLifetime();
  vi.unstubAllGlobals();
});

describe("Put it live's runs belong to the account and organization that pressed it", () => {
  it("a new account on the tab never sends a previous account's merge or production", async () => {
    openAccountLifetime("u-first");
    usePutLive.getState().ask({ groupId: "g-1" });
    usePutLive.getState().start({ orgId: "o-1", groupId: "g-1", project: "Tea Shop" });
    expect(usePutLive.getState().runs.size).toBe(1);

    await closeAccountLifetime();
    openAccountLifetime("u-second");
    expect(usePutLive.getState().runs.size).toBe(0);
    expect(usePutLive.getState().asked).toBeNull();
  });

  it("drives only the runs of the organization shown", () => {
    openAccountLifetime("u-first");
    const { start } = usePutLive.getState();
    start({ orgId: "o-1", groupId: "g-1", project: "Tea Shop" });
    start({ orgId: "o-2", groupId: "g-2", project: "Bakery" });
    const runs = usePutLive.getState().runs;
    expect(putLiveRunsIn(runs, "o-2").map((run) => run.groupId)).toEqual(["g-2"]);
    expect(putLiveRunsIn(runs, undefined)).toEqual([]);
  });
});

describe("a reload knows the attempt was this person's", () => {
  it("keeps only the production the person's own Put it live made, for their account, until it goes live", async () => {
    openAccountLifetime("u-first");
    const { start, step } = usePutLive.getState();
    start({ orgId: "o-1", groupId: "g-1", project: "Tea Shop" });
    expect(keptPutLiveProductions()).toEqual({});
    step("g-1", { kind: "accepted", productionId: "p-prod" });
    expect(keptPutLiveProductions()).toEqual({ "g-1": "p-prod" });

    // The tab reloads: the run is gone, the production it made is the person's still.
    await closeAccountLifetime();
    openAccountLifetime("u-first");
    expect(usePutLive.getState().runs.size).toBe(0);
    expect(usePutLive.getState().kept).toEqual(new Map([["g-1", "p-prod"]]));

    // Another account on the tab knows nothing of it.
    await closeAccountLifetime();
    openAccountLifetime("u-second");
    expect(usePutLive.getState().kept.size).toBe(0);

    await closeAccountLifetime();
    openAccountLifetime("u-first");
    usePutLive.getState().restore({
      orgId: "o-1",
      groupId: "g-1",
      project: "Tea Shop",
      productionId: "p-prod",
      phase: "live",
      tag: "v0.1.0",
    });
    expect(keptPutLiveProductions()).toEqual({});
    expect(usePutLive.getState().kept.size).toBe(0);
  });

  it("forgets the attempt once its card is put away", () => {
    openAccountLifetime("u-first");
    const { start, step, forget } = usePutLive.getState();
    start({ orgId: "o-1", groupId: "g-1", project: "Tea Shop" });
    step("g-1", { kind: "created", productionId: "p-prod" });
    step("g-1", { kind: "failed", words: "No answer came back." });
    forget("g-1");
    expect(keptPutLiveProductions()).toEqual({});
    expect(usePutLive.getState().kept.size).toBe(0);
  });
});
