import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { GiteaCommitStatus } from "../giteaClient.ts";
import {
  createCommitStatusMemo,
  newestStatusesSettled,
  STATUS_RECHECK_LADDER_MS,
  type CommitStatusMemo,
} from "./statusMemo.ts";

const status = (state: GiteaCommitStatus["state"], context = "ci"): GiteaCommitStatus => ({
  context,
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
