import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { GiteaCommitStatus } from "../giteaClient.ts";
import {
  createCommitStatusMemo,
  newestStatusesSettled,
  SETTLED_RECHECK_LADDER_MS,
  VERDICT_RECHECK_LADDER_MS,
  STATUS_RECHECK_LADDER_MS,
  type CommitStatusMemo,
  type StatusReadOptions,
} from "./statusMemo.ts";

const status = (state: GiteaCommitStatus["state"], context = "ci"): GiteaCommitStatus => ({
  context,
  state,
});
const commit = { owner: "acme", repo: "group", sha: "a".repeat(40) };

/**
 * Seconds since the start at which `load` ran, over `minutes` of a read asked for every second,
 * with what the reader asks of the commit.
 */
async function readsOver(
  answers: (call: number) => ReadonlyArray<GiteaCommitStatus>,
  minutes: number,
  options?: StatusReadOptions,
): Promise<ReadonlyArray<number>> {
  const memo = createCommitStatusMemo();
  const at: Array<number> = [];
  for (let second = 0; second <= minutes * 60; second += 1) {
    await memo.read(
      commit,
      async () => {
        at.push(second);
        return answers(at.length - 1);
      },
      options,
    );
    await vi.advanceTimersByTimeAsync(1_000);
  }
  return at;
}

/** A load that answers only when told to. */
function deferredLoad(statuses: ReadonlyArray<GiteaCommitStatus>) {
  let answer: () => void = () => undefined;
  const load = () =>
    new Promise<ReadonlyArray<GiteaCommitStatus>>((resolve) => {
      answer = () => resolve(statuses);
    });
  return { load, answer: () => answer() };
}

describe("commit status memo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Gitea lists a commit's statuses newest first and keeps every one it was ever given.
  it.each([
    { name: "success", statuses: [status("success")], settled: true },
    {
      name: "a failure beside a success",
      statuses: [status("success"), status("failure", "deploy")],
      settled: true,
    },
    {
      name: "a context that went pending, then passed",
      statuses: [status("success"), status("pending")],
      settled: true,
    },
    {
      name: "a context rerun and pending again",
      statuses: [status("pending"), status("success")],
      settled: false,
    },
    {
      name: "one context still pending beside another done",
      statuses: [status("success"), status("pending", "deploy")],
      settled: false,
    },
    { name: "nothing posted yet", statuses: [], settled: false },
  ])("$name is settled: $settled", ({ statuses, settled }) => {
    expect(newestStatusesSettled(statuses)).toBe(settled);
  });

  it("never reads settled statuses again until they are forgotten", async () => {
    expect(await readsOver(() => [status("success")], 60)).toEqual([0]);
  });

  it("reads a commit that still takes contexts again on a back-off up to five minutes", async () => {
    expect(SETTLED_RECHECK_LADDER_MS).toEqual([60_000, 120_000, 300_000]);
    expect(await readsOver(() => [status("success")], 15, { live: true })).toEqual([
      0, 60, 180, 480, 780,
    ]);
  });

  it("sees a context that lands late on a commit still taking them", async () => {
    // A deploy fails on a commit whose checks had all passed.
    const answers = [[status("success")], [status("failure", "deploy"), status("success")]];
    const at = await readsOver((call) => answers[call] ?? answers[1]!, 4, { live: true });
    // Read at 0, the late failure at 60 — a change, so from the bottom again: 120, 240.
    expect(at).toEqual([0, 60, 120, 240]);
  });

  it("waits on a ladder of the reader's own for what it waits for", async () => {
    // A verdict that never comes: read at 0, 15, 45, 105, 225, then every five minutes.
    const waitsFor = () => false;
    const at = await readsOver(() => [status("success")], 16, {
      settled: waitsFor,
      waiting: VERDICT_RECHECK_LADDER_MS,
    });
    expect(VERDICT_RECHECK_LADDER_MS).toEqual([15_000, 30_000, 60_000, 120_000, 300_000]);
    expect(at).toEqual([0, 15, 45, 105, 225, 525, 825]);
  });

  it("keeps reading a commit on the pending back-off until the context its reader waits for is done", async () => {
    // The newest release's commit carries an older release's success; the broker answers later.
    const old = status("success", "mate/release/v1.0.0");
    const answers = [[old], [old], [status("failure", "mate/release/v1.0.1"), old]];
    const waitsFor = (statuses: ReadonlyArray<GiteaCommitStatus>) =>
      statuses.some(
        (entry) => entry.context === "mate/release/v1.0.1" && entry.state !== "pending",
      );
    const at = await readsOver((call) => answers[call] ?? answers[2]!, 2, { settled: waitsFor });
    // Pending to this reader at 0 and 15; its verdict lands at 45 and is kept.
    expect(at).toEqual([0, 15, 45]);
  });

  it("re-reads pending statuses on a back-off no longer than a minute", async () => {
    expect(STATUS_RECHECK_LADDER_MS).toEqual([15_000, 30_000, 60_000]);
    const at = await readsOver((call) => (call < 5 ? [status("pending")] : [status("success")]), 6);
    // Pending five times — 15 s, 30 s, then a minute each — then settled and kept.
    expect(at).toEqual([0, 15, 45, 105, 165, 225]);
  });

  it("holds the back-off at a minute for a commit CI never posts to", async () => {
    expect(await readsOver(() => [], 5)).toEqual([0, 15, 45, 105, 165, 225, 285]);
  });

  it("starts the back-off again when what a read answers changed", async () => {
    const answers = [[], [], [status("pending")], [status("pending")], [status("success")]];
    const at = await readsOver((call) => answers[call] ?? [status("success")], 3);
    // Empty, empty (30 s next), pending — a change, so 15 s — pending, success.
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

  describe("forget — a verb changed the owner's commits", () => {
    const loadsAfterForget = async (first: ReadonlyArray<GiteaCommitStatus>) => {
      const memo: CommitStatusMemo = createCommitStatusMemo();
      await memo.read(commit, async () => first);
      memo.forget("acme");
      let loads = 0;
      await memo.read(commit, async () => {
        loads += 1;
        return [status("success")];
      });
      return loads;
    };

    it.each([
      { name: "pending", first: [status("pending")] },
      { name: "settled", first: [status("success")] },
    ])("reads $name statuses again at once", async ({ first }) => {
      expect(await loadsAfterForget(first)).toBe(1);
    });

    it("forgets only the repository it is told, where it is told one", async () => {
      const memo = createCommitStatusMemo();
      const head = { ...commit, repo: "appdev" };
      await memo.read(commit, async () => [status("success")]);
      await memo.read(head, async () => [status("success")]);
      memo.forget("acme", "group");
      const loads: string[] = [];
      for (const ref of [commit, head]) {
        await memo.read(ref, async () => {
          loads.push(ref.repo);
          return [status("success")];
        });
      }
      expect(loads).toEqual(["group"]);
    });

    it("leaves another owner's statuses kept", async () => {
      const memo = createCommitStatusMemo();
      const other = { ...commit, owner: "harbor" };
      await memo.read(other, async () => [status("success")]);
      memo.forget("acme");
      let loads = 0;
      await memo.read(other, async () => {
        loads += 1;
        return [];
      });
      expect(loads).toBe(0);
    });

    it("does not join a read that started before it, nor keep that read's answer", async () => {
      const memo = createCommitStatusMemo();
      const before = deferredLoad([status("pending")]);
      const early = memo.read(commit, before.load);
      memo.forget("acme");
      const after = deferredLoad([status("success")]);
      const fresh = memo.read(commit, after.load);
      after.answer();
      expect(await fresh).toEqual([status("success")]);
      before.answer();
      expect(await early).toEqual([status("pending")]);
      // What is kept is the read made after the verb.
      expect(await memo.read(commit, async () => [])).toEqual([status("success")]);
    });
  });
});
