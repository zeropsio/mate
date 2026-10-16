import { afterEach, describe, expect, it } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { putLiveRunsIn, usePutLive } from "./putLive";

const change = {
  repository: "app",
  number: 1,
  title: "Shop front",
  head: "a".repeat(40),
  merged: false,
};

afterEach(async () => {
  await closeAccountLifetime();
});

describe("Put it live's runs belong to the account and organization that pressed it", () => {
  it("a new account on the tab never sends a previous account's merge or production", async () => {
    openAccountLifetime("u-first");
    usePutLive.getState().ask({ groupId: "g-1", change });
    usePutLive.getState().start({ orgId: "o-1", groupId: "g-1", project: "Tea Shop", change });
    expect(usePutLive.getState().runs.size).toBe(1);

    await closeAccountLifetime();
    openAccountLifetime("u-second");
    expect(usePutLive.getState().runs.size).toBe(0);
    expect(usePutLive.getState().asked).toBeNull();
  });

  it("drives only the runs of the organization shown", () => {
    openAccountLifetime("u-first");
    const { start } = usePutLive.getState();
    start({ orgId: "o-1", groupId: "g-1", project: "Tea Shop", change });
    start({ orgId: "o-2", groupId: "g-2", project: "Bakery", change });
    const runs = usePutLive.getState().runs;
    expect(putLiveRunsIn(runs, "o-2").map((run) => run.groupId)).toEqual(["g-2"]);
    expect(putLiveRunsIn(runs, undefined)).toEqual([]);
  });
});
