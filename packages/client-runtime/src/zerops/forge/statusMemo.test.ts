import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { GiteaCommitStatus } from "../giteaClient.ts";
import { createCommitStatusMemo, STATUS_RECHECK_LADDER_MS, statusesSettled } from "./statusMemo.ts";

const status = (state: GiteaCommitStatus["state"]): GiteaCommitStatus => ({
  context: "ci",
  state,
});
const commit = { owner: "acme", repo: "group", sha: "a".repeat(40) };

/** Seconds since the start at which `load` ran, over `minutes` of a read asked for every second. */
async function readsOver(
  answers: (call: number) => ReadonlyArray<GiteaCommitStatus>,
  minutes: number,
): Promise<ReadonlyArray<number>> {
  const memo = createCommitStatusMemo();
  const at: Array<number> = [];
  for (let second = 0; second <= minutes * 60; second += 1) {
    await memo.read(commit, async () => {
      at.push(second);
      return answers(at.length - 1);
    });
    await vi.advanceTimersByTimeAsync(1_000);
  }
  return at;
}

describe("commit status memo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    { name: "success", statuses: [status("success")], settled: true },
    {
      name: "a failure beside a success",
      statuses: [status("success"), status("failure")],
      settled: true,
    },
    { name: "one still pending", statuses: [status("success"), status("pending")], settled: false },
    { name: "nothing posted yet", statuses: [], settled: false },
  ])("$name is settled: $settled", ({ statuses, settled }) => {
    expect(statusesSettled(statuses)).toBe(settled);
  });

  it("reads settled statuses once, however often they are asked for", async () => {
    expect(await readsOver(() => [status("success")], 60)).toEqual([0]);
  });

  it("re-reads pending statuses on the back-off ladder, then never once they settle", async () => {
    const ladder = STATUS_RECHECK_LADDER_MS.map((ms) => ms / 1_000);
    expect(ladder).toEqual([15, 30, 60, 120, 300, 600]);
    // Pending for six reads, then settled.
    const at = await readsOver(
      (call) => (call < 6 ? [status("pending")] : [status("success")]),
      60,
    );
    expect(at).toEqual([0, 15, 45, 105, 225, 525, 1125]);
  });

  it("holds the ladder at its last rung for a commit CI never posts to", async () => {
    const at = await readsOver(() => [], 60);
    expect(at).toEqual([0, 15, 45, 105, 225, 525, 1125, 1725, 2325, 2925, 3525]);
  });

  it("starts the ladder again when what a read answers changed", async () => {
    const answers = [[], [], [status("pending")], [status("pending")], [status("success")]];
    const at = await readsOver((call) => answers[call] ?? [status("success")], 10);
    // Empty, empty (rung 2 next), pending — a change, so 15 s — pending, success.
    expect(at).toEqual([0, 15, 45, 60, 90]);
  });

  it("asks once for the same commit wanted twice at the same time", async () => {
    const memo = createCommitStatusMemo();
    let loads = 0;
    const load = async () => {
      loads += 1;
      return [status("success")];
    };
    const [first, second] = await Promise.all([memo.read(commit, load), memo.read(commit, load)]);
    expect(loads).toBe(1);
    expect(first).toEqual(second);
  });

  it("keeps no answer from a read that failed", async () => {
    const memo = createCommitStatusMemo();
    await expect(memo.read(commit, () => Promise.reject(new Error("offline")))).rejects.toThrow(
      "offline",
    );
    let loads = 0;
    await memo.read(commit, async () => {
      loads += 1;
      return [status("success")];
    });
    expect(loads).toBe(1);
  });

  it("forgets an owner's unsettled statuses, so a verb's re-read asks again at once", async () => {
    const memo = createCommitStatusMemo();
    let loads = 0;
    const pending = async () => {
      loads += 1;
      return [status("pending")];
    };
    const settled = { ...commit, sha: "b".repeat(40) };
    await memo.read(commit, pending);
    await memo.read(settled, async () => [status("success")]);
    memo.forget("acme");
    await memo.read(commit, pending);
    expect(loads).toBe(2);
    let settledLoads = 0;
    await memo.read(settled, async () => {
      settledLoads += 1;
      return [];
    });
    expect(settledLoads).toBe(0);
  });
});
