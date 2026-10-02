import { describe, expect, it } from "vite-plus/test";

import type {
  ZeropsGroupReachGroup,
  ZeropsGroupReachWrite,
  ZeropsIntegrationToken,
  ZeropsProjectGrant,
} from "@t3tools/client-runtime/zerops";

import {
  GROUP_REACH_BACKOFF_MS,
  groupsKey,
  listingKey,
  makeGroupReachDriver,
  type GroupReachFailure,
  type GroupReachObservation,
} from "./useZeropsGroupReach.logic";

const GROUP: ZeropsGroupReachGroup = {
  projectIds: ["project-a", "project-b"],
  mateProjectIds: ["project-a"],
};
const TWO_MATES: ZeropsGroupReachGroup = {
  projectIds: ["project-a", "project-b", "project-c"],
  mateProjectIds: ["project-a", "project-c"],
};

const token = (
  id: string,
  self: string,
  grants: ReadonlyArray<ZeropsProjectGrant>,
): ZeropsIntegrationToken => ({ id, name: `zcp-${self}`, projects: grants });

/** As the platform minted it: ADMIN on its own project and nothing else. */
const MINTED_A = token("token-a", "a", [{ projectId: "project-a", roleCode: "ADMIN" }]);
const MINTED_C = token("token-c", "c", [{ projectId: "project-c", roleCode: "ADMIN" }]);
/** What the reach writes for `GROUP`. */
const REACHING_A = token("token-a", "a", [
  { projectId: "project-a", roleCode: "BASIC_USER" },
  { projectId: "project-b", roleCode: "READ_ONLY" },
]);

const seen = (
  groups: ReadonlyArray<ZeropsGroupReachGroup>,
  listing: ReadonlyArray<ZeropsIntegrationToken>,
  complete = true,
  /** Which read of the token list it is: a later read is a larger number. */
  read = 1,
): GroupReachObservation => ({ groups, listing, complete, read });

/** A copy with new arrays everywhere and the same content: what a re-render hands over. */
const cloned = (observation: GroupReachObservation): GroupReachObservation =>
  structuredClone(observation);

interface Rig {
  readonly writes: Array<ZeropsGroupReachWrite>;
  readonly failures: Array<GroupReachFailure>;
  readonly observe: (observation: GroupReachObservation) => Promise<void>;
  readonly advance: (ms: number) => Promise<void>;
  /** Wakes still scheduled. */
  readonly pending: () => number;
  readonly detach: () => void;
  /** Writes wait for `release()` while held. */
  readonly holdWrites: () => () => Promise<void>;
}

function rig(options: { readonly refuse?: (write: ZeropsGroupReachWrite) => boolean } = {}): Rig {
  let nowMs = 0;
  const timers: Array<{ at: number; run: () => void; live: boolean }> = [];
  const writes: Array<ZeropsGroupReachWrite> = [];
  const failures: Array<GroupReachFailure> = [];
  let gate: Promise<void> | null = null;
  const driver = makeGroupReachDriver({
    hold: (_tokenId, run) => run(),
    now: () => nowMs,
    schedule: (run, delayMs) => {
      const timer = { at: nowMs + delayMs, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  });
  // A macrotask turn drains every write that is not held.
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const detach = driver.attach({
    write: async (write) => {
      writes.push(write);
      if (gate !== null) await gate;
      if (options.refuse?.(write) === true) throw new Error("refused");
    },
    report: (failure) => failures.push(failure),
  });
  return {
    writes,
    failures,
    observe: async (observation) => {
      driver.observe(observation);
      await settle();
    },
    advance: async (ms) => {
      nowMs += ms;
      for (const timer of timers.filter((each) => each.live && each.at <= nowMs)) {
        timer.live = false;
        timer.run();
      }
      await settle();
    },
    pending: () => timers.filter((timer) => timer.live).length,
    detach,
    holdWrites: () => {
      let open!: () => void;
      gate = new Promise((resolve) => {
        open = resolve;
      });
      return async () => {
        gate = null;
        open();
        await settle();
      };
    },
  };
}

describe("groupsKey and listingKey", () => {
  it.each([
    ["groups in another order", [GROUP, TWO_MATES], [TWO_MATES, GROUP]],
    [
      "projects in another order",
      [GROUP],
      [{ projectIds: ["project-b", "project-a"], mateProjectIds: ["project-a"] }],
    ],
  ])("is the same for %s", (_name, left, right) => {
    expect(groupsKey(left)).toBe(groupsKey(right));
  });

  it("moves when a project joins a group", () => {
    expect(groupsKey([GROUP])).not.toBe(groupsKey([TWO_MATES]));
  });

  it.each([
    [
      "grants in another order",
      [REACHING_A],
      [token("token-a", "a", REACHING_A.projects!.toReversed())],
    ],
    ["tokens in another order", [MINTED_A, MINTED_C], [MINTED_C, MINTED_A]],
  ])("is the same listing for %s", (_name, left, right) => {
    expect(listingKey(left)).toBe(listingKey(right));
  });

  it("moves when a token's grants change", () => {
    expect(listingKey([MINTED_A])).not.toBe(listingKey([REACHING_A]));
  });
});

describe("makeGroupReachDriver", () => {
  it("writes what a group owes, once, and nothing for one that already reaches", async () => {
    const owed = rig();
    await owed.observe(seen([GROUP], [MINTED_A]));
    expect(owed.writes).toEqual([
      { tokenId: "token-a", name: "zcp-a", projects: REACHING_A.projects },
    ]);

    const settled = rig();
    await settled.observe(seen([GROUP], [REACHING_A]));
    expect(settled.writes).toEqual([]);
  });

  it("a group change costs exactly the writes it owes", async () => {
    const reach = rig();
    await reach.observe(seen([TWO_MATES], [MINTED_A, MINTED_C]));
    expect(reach.writes.map(({ tokenId }) => tokenId).sort()).toEqual(["token-a", "token-c"]);
  });

  it.each<{
    readonly name: string;
    readonly next: (first: GroupReachObservation) => GroupReachObservation;
  }>([
    { name: "new arrays with the same keys", next: cloned },
    {
      name: "a lagging listing, read before our write settled, still showing the old grants",
      next: (first) => seen(first.groups, [MINTED_A], true, 1),
    },
    {
      name: "the list read again after our own write, showing what was written",
      next: (first) => seen(first.groups, [REACHING_A], true, 2),
    },
  ])("does not write again for $name", async ({ next }) => {
    const reach = rig();
    const first = seen([GROUP], [MINTED_A]);
    await reach.observe(first);
    await reach.observe(next(first));
    expect(reach.writes).toHaveLength(1);
  });

  it("repairs once when a list read after our write still shows the old grants", async () => {
    const reach = rig();
    await reach.observe(seen([GROUP], [MINTED_A], true, 1));
    const after = seen([GROUP], [MINTED_A], true, 2);
    await reach.observe(after);
    expect(reach.writes).toHaveLength(2);
    // The same read, handed over again: the repair is not repeated for it.
    for (let render = 0; render < 10; render += 1) await reach.observe(cloned(after));
    expect(reach.writes).toHaveLength(2);
  });

  it("repairs a token reverted to exactly its old grants after our write was confirmed", async () => {
    const reach = rig();
    await reach.observe(seen([GROUP], [MINTED_A], true, 1));
    await reach.observe(seen([GROUP], [REACHING_A], true, 2));
    await reach.observe(seen([GROUP], [MINTED_A], true, 3));
    expect(reach.writes).toHaveLength(2);
  });

  it("a write the platform answers but never shows backs off after one repair, reported once", async () => {
    const reach = rig();
    await reach.observe(seen([GROUP], [MINTED_A], true, 1));
    await reach.observe(seen([GROUP], [MINTED_A], true, 2));
    expect(reach.writes).toHaveLength(2);
    await reach.observe(seen([GROUP], [MINTED_A], true, 3));
    expect(reach.writes).toHaveLength(2);
    expect(reach.failures).toMatchObject([
      { tokenId: "token-a", retryInMs: GROUP_REACH_BACKOFF_MS[0] },
    ]);

    await reach.advance(GROUP_REACH_BACKOFF_MS[0]!);
    expect(reach.writes).toHaveLength(3);
    await reach.observe(seen([GROUP], [MINTED_A], true, 4));
    await reach.advance(GROUP_REACH_BACKOFF_MS[1]! - 1);
    expect(reach.writes).toHaveLength(3);
    await reach.advance(1);
    expect(reach.writes).toHaveLength(4);
    expect(reach.failures).toHaveLength(1);
  });

  it("observations during a write never start a second run or a second write", async () => {
    const reach = rig();
    const release = reach.holdWrites();
    const first = seen([GROUP], [MINTED_A]);
    await reach.observe(first);
    for (let render = 0; render < 50; render += 1) await reach.observe(cloned(first));
    await release();
    await reach.observe(seen([GROUP], [REACHING_A], true, 2));
    expect(reach.writes).toHaveLength(1);
  });

  it("a group that moves during a write is written once more, after it, for the new group", async () => {
    const reach = rig();
    const release = reach.holdWrites();
    await reach.observe(seen([GROUP], [MINTED_A]));
    const widened: ZeropsGroupReachGroup = {
      projectIds: ["project-a", "project-b", "project-d"],
      mateProjectIds: ["project-a"],
    };
    await reach.observe(seen([widened], [MINTED_A]));
    expect(reach.writes).toHaveLength(1);
    await release();
    expect(reach.writes).toHaveLength(2);
    expect(reach.writes[1]!.projects.map(({ projectId }) => projectId)).toEqual([
      "project-a",
      "project-b",
      "project-d",
    ]);
  });

  it("writes again when someone else changed the token after our write", async () => {
    const reach = rig();
    await reach.observe(seen([GROUP], [MINTED_A]));
    // Neither what it held before nor what was written: a later edit, not a stale read.
    await reach.observe(
      seen(
        [GROUP],
        [token("token-a", "a", [{ projectId: "project-a", roleCode: "BASIC_USER" }])],
        true,
        2,
      ),
    );
    expect(reach.writes).toHaveLength(2);
  });

  it.each([
    ["the token listing", seen([GROUP], [MINTED_A], false)],
    ["no group known yet", seen([], [MINTED_A])],
  ])("plans nothing from an incomplete read: %s", async (_name, observation) => {
    const reach = rig();
    await reach.observe(observation);
    expect(reach.writes).toEqual([]);
  });

  it("plans once the incomplete read completes", async () => {
    const reach = rig();
    await reach.observe(seen([GROUP], [MINTED_A], false));
    await reach.observe(seen([GROUP], [MINTED_A], true));
    expect(reach.writes).toHaveLength(1);
  });

  it("backs off a refused write, reports it once, and never retries it in a loop", async () => {
    const reach = rig({ refuse: () => true });
    const first = seen([GROUP], [MINTED_A]);
    await reach.observe(first);
    expect(reach.writes).toHaveLength(1);
    expect(reach.failures).toHaveLength(1);
    expect(reach.failures[0]).toMatchObject({
      tokenId: "token-a",
      retryInMs: GROUP_REACH_BACKOFF_MS[0],
    });

    // The failed write's own refresh of the list, and every render after it: nothing.
    for (let render = 0; render < 20; render += 1) await reach.observe(cloned(first));
    await reach.advance(GROUP_REACH_BACKOFF_MS[0]! - 1);
    expect(reach.writes).toHaveLength(1);

    await reach.advance(1);
    expect(reach.writes).toHaveLength(2);
    await reach.advance(GROUP_REACH_BACKOFF_MS[1]! - 1);
    expect(reach.writes).toHaveLength(2);
    await reach.advance(1);
    expect(reach.writes).toHaveLength(3);
    expect(reach.failures).toHaveLength(1);
  });

  it("a back-off that ends over an incomplete read wakes once and schedules nothing more", async () => {
    const reach = rig({ refuse: () => true });
    await reach.observe(seen([GROUP], [MINTED_A]));
    await reach.observe(seen([GROUP], [MINTED_A], false));
    expect(reach.pending()).toBe(1);
    await reach.advance(GROUP_REACH_BACKOFF_MS[0]!);
    expect(reach.writes).toHaveLength(1);
    expect(reach.pending()).toBe(0);
  });

  it("a refused token does not hold back the others", async () => {
    const reach = rig({ refuse: (write) => write.tokenId === "token-a" });
    await reach.observe(seen([TWO_MATES], [MINTED_A, MINTED_C]));
    expect(reach.writes.map(({ tokenId }) => tokenId).sort()).toEqual(["token-a", "token-c"]);
    expect(reach.failures.map(({ tokenId }) => tokenId)).toEqual(["token-a"]);
  });

  it("a group change ends a token's back-off: the new reach is written at once", async () => {
    let refusing = true;
    const reach = rig({ refuse: () => refusing });
    await reach.observe(seen([GROUP], [MINTED_A]));
    refusing = false;
    await reach.observe(seen([TWO_MATES], [MINTED_A, MINTED_C]));
    expect(reach.writes.filter(({ tokenId }) => tokenId === "token-a")).toHaveLength(2);
  });

  it("stops after the write in flight once detached, and writes nothing more", async () => {
    const reach = rig();
    const release = reach.holdWrites();
    await reach.observe(seen([TWO_MATES], [MINTED_A, MINTED_C]));
    expect(reach.writes).toHaveLength(1);
    reach.detach();
    await release();
    await reach.observe(seen([TWO_MATES], [MINTED_C]));
    expect(reach.writes).toHaveLength(1);
  });
});
