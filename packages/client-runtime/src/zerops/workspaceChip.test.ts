import type { OrchestrationLatestTurn, ZeropsLease, ZeropsLifecycle } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import type { Known } from "./knowledge/index.ts";
import { boundLeaseRead, workspaceChip, workspaceChipOf } from "./workspaceChip.ts";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const ago = (minutes: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW - minutes * 60_000));
const hours = (count: number) => ago(count * 60);

type LeaseRead = Pick<ZeropsLease, "acquiredAt" | "activity" | "unsaved">;
type Turn = Pick<OrchestrationLatestTurn, "state" | "requestedAt" | "startedAt" | "completedAt">;

/** A lease zcp read: its checkout's activity, and its unsaved work (`null`: not read; default clean). */
const readLease = (
  activity: NonNullable<ZeropsLease["activity"]>,
  unsaved: NonNullable<ZeropsLease["unsaved"]> | null = { fileCount: 0, unpushedCommits: 0 },
): LeaseRead => ({
  acquiredAt: activity.acquiredAt ?? hours(72),
  activity,
  ...(unsaved === null ? {} : { unsaved }),
});
const completedTurn = (at: string): Turn => ({
  state: "completed",
  requestedAt: at,
  startedAt: at,
  completedAt: at,
});
const words = (lease: LeaseRead | undefined, lastTurn: Turn | null = null) =>
  workspaceChip({ lease, lastTurn, now: NOW })?.words;

describe("a bound conversation's workspace chip", () => {
  it("says when the workspace was last active and what a release would lose there", () => {
    const chip = workspaceChip({
      lease: readLease(
        { lastChangeAt: hours(3), previewOpenConns: 0, acquiredAt: hours(30), readAt: hours(2) },
        { files: [" M src/App.tsx", "?? notes.txt"], fileCount: 2, unpushedCommits: 2 },
      ),
      lastTurn: completedTurn(hours(5)),
      now: NOW,
    });
    expect(chip).toEqual({
      words: "workspace · last active 3 h ago · 2 unpushed · 2 uncommitted",
      idle: false,
    });
  });

  it("labels a workspace idle once nothing happened in it for 24 h and every fact was read", () => {
    const chip = workspaceChip({
      lease: readLease(
        {
          lastChangeAt: hours(26),
          previewLastConnAt: hours(27),
          previewOpenConns: 0,
          acquiredAt: hours(72),
          readAt: hours(25),
        },
        { fileCount: 0, unpushedCommits: 2 },
      ),
      lastTurn: completedTurn(hours(48)),
      now: NOW,
    });
    expect(chip).toEqual({
      words: "workspace · idle · last active 26 h ago · 2 unpushed",
      idle: true,
    });
  });

  it.each([
    ["24 h ago", 24 * 60, true],
    ["23 h 59 min ago", 24 * 60 - 1, false],
  ])("a workspace last active %s is idle: %s", (_when, minutes, idle) => {
    const chip = workspaceChip({
      lease: readLease({
        lastChangeAt: ago(minutes),
        previewOpenConns: 0,
        acquiredAt: hours(72),
        readAt: hours(1),
      }),
      lastTurn: null,
      now: NOW,
    });
    expect(chip?.idle).toBe(idle);
  });

  it("says a checkout with nothing uncommitted and nothing unpushed is all pushed", () => {
    expect(
      words(
        readLease({
          lastChangeAt: hours(72),
          previewOpenConns: 0,
          acquiredAt: hours(80),
          readAt: hours(1),
        }),
      ),
    ).toBe("workspace · idle · last active 3 d ago · all pushed");
  });

  it("never labels idle a workspace whose preview had a connection open when zcp read it", () => {
    const chip = workspaceChip({
      lease: readLease({
        lastChangeAt: hours(72),
        previewLastConnAt: hours(60),
        previewOpenConns: 1,
        acquiredAt: hours(80),
        readAt: hours(30),
      }),
      lastTurn: null,
      now: NOW,
    });
    expect(chip, "the read saw it in use").toEqual({
      words: "workspace · last active 30 h ago · all pushed",
      idle: false,
    });
  });

  it.each([
    [
      "its preview was not observed",
      readLease({
        lastChangeAt: hours(72),
        acquiredAt: hours(80),
        readAt: hours(1),
        note: "preview not observed: zcp-devsup is not installed in the container",
      }),
    ],
    [
      "its unsaved work was not read",
      readLease(
        { lastChangeAt: hours(72), previewOpenConns: 0, acquiredAt: hours(80), readAt: hours(1) },
        null,
      ),
    ],
    [
      "its checkout's last change was not read",
      readLease({
        previewOpenConns: 0,
        acquiredAt: hours(80),
        readAt: hours(1),
        note: "the container did not answer within 5 s",
      }),
    ],
    [
      "zcp did not read it at all",
      readLease({ acquiredAt: hours(80), note: "not read: the orchestrator did not answer" }),
    ],
    ["no call read it", { acquiredAt: hours(80) }],
  ])("never labels idle a workspace while a fact was not read: %s", (_what, lease) => {
    expect(workspaceChip({ lease, lastTurn: null, now: NOW })?.idle).toBe(false);
  });

  it("dates a workspace whose checkout was not read from its acquire", () => {
    expect(
      words({ acquiredAt: hours(80), activity: { acquiredAt: hours(80), note: "not read" } }),
    ).toBe("workspace · last active 3 d ago");
  });

  it("counts the conversation's own last turn as the workspace's activity, whichever is newer", () => {
    const idleByZcp = readLease({
      lastChangeAt: hours(26),
      previewOpenConns: 0,
      acquiredAt: hours(72),
      readAt: hours(25),
    });
    expect(
      workspaceChip({ lease: idleByZcp, lastTurn: completedTurn(hours(2)), now: NOW }),
    ).toEqual({ words: "workspace · last active 2 h ago · all pushed", idle: false });
    expect(
      workspaceChip({
        lease: idleByZcp,
        lastTurn: {
          state: "running",
          requestedAt: hours(30),
          startedAt: hours(30),
          completedAt: null,
        },
        now: NOW,
      }),
      "a turn running now is activity now",
    ).toEqual({ words: "workspace · last active just now · all pushed", idle: false });
  });

  it("shows the conversation's last turn alone before zcp read the workspace, and nothing with neither", () => {
    expect(words(undefined, completedTurn(ago(5)))).toBe("workspace · last active 5 min ago");
    expect(words(undefined, null)).toBeUndefined();
  });

  it("says just now for a read whose clock is ahead of the reader's", () => {
    expect(
      words(
        readLease({
          lastChangeAt: ago(-3),
          previewOpenConns: 0,
          acquiredAt: hours(2),
          readAt: ago(-2),
        }),
      ),
    ).toBe("workspace · last active just now · all pushed");
  });
});

describe("the lease a bound conversation's chip reads", () => {
  const binding = { alias: "webpool-3", pool: "webpool", branch: "feat-x" };
  const lease = (extra: Partial<ZeropsLease> = {}): ZeropsLease => ({
    alias: "webpool-3" as ZeropsLease["alias"],
    pool: "webpool",
    branch: "feat-x",
    state: "held",
    acquiredAt: hours(3),
    ...extra,
  });

  it("is zcp's last read of the lease the conversation is bound to, while zcp holds it", () => {
    const other = lease({ alias: "apipool-1" as ZeropsLease["alias"], pool: "apipool" });
    expect(boundLeaseRead(binding, [other, lease()])).toEqual(lease());
    expect(boundLeaseRead(binding, [lease({ state: "parked" })])?.state).toBe("parked");
  });

  it("is none for another branch's lease under the alias, an ended one, or no read", () => {
    expect(boundLeaseRead(binding, [lease({ branch: "feat-y" })])).toBeUndefined();
    expect(boundLeaseRead(binding, [lease({ state: "released" })])).toBeUndefined();
    expect(boundLeaseRead(binding, undefined)).toBeUndefined();
    expect(boundLeaseRead(null, [lease()])).toBeUndefined();
    const { branch: _branch, ...noBranch } = lease();
    expect(
      boundLeaseRead({ ...binding, branch: null }, [noBranch]),
      "a lease of no branch is the one bound for none",
    ).toEqual(noBranch);
  });
});

describe("the workspace chip a conversation's lifecycle draws", () => {
  const binding = { alias: "webpool-3", pool: "webpool", branch: "feat-x" };
  const leases = [
    {
      alias: "webpool-3",
      pool: "webpool",
      branch: "feat-x",
      state: "held",
      acquiredAt: hours(72),
      activity: {
        lastChangeAt: hours(30),
        previewOpenConns: 0,
        acquiredAt: hours(72),
        readAt: hours(25),
      },
      unsaved: { fileCount: 1, unpushedCommits: 0 },
    },
  ];
  const known = {
    state: "known",
    value: { threadId: "thread-1", recentTools: [], envelope: { leases } },
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "live" },
  } as unknown as Known<ZeropsLifecycle>;
  const reading = { state: "reading", sinceMs: 0, attempt: 1 } as Known<ZeropsLifecycle>;

  it("reads zcp's last read of the bound lease while the lifecycle is known, the turn alone while not", () => {
    const lastTurn = completedTurn(hours(40));
    expect(workspaceChipOf({ binding, lifecycle: known, lastTurn, now: NOW })).toEqual({
      words: "workspace · idle · last active 30 h ago · 1 uncommitted",
      idle: true,
    });
    expect(workspaceChipOf({ binding, lifecycle: reading, lastTurn, now: NOW })).toEqual({
      words: "workspace · last active 40 h ago",
      idle: false,
    });
    expect(
      workspaceChipOf({ binding: null, lifecycle: known, lastTurn: null, now: NOW }),
    ).toBeUndefined();
  });
});
