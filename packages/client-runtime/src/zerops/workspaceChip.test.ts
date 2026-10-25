import {
  CommandId,
  MessageId,
  type OrchestrationLatestTurn,
  ProviderInstanceId,
  ThreadId,
  type ZeropsLease,
  type ZeropsLifecycle,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it, vi } from "vite-plus/test";

import type { AtomCommandResult } from "../state/runtime.ts";
import type { Known } from "./knowledge/index.ts";
import {
  boundLeaseRead,
  sendZeropsReleaseRequest,
  workspaceChip,
  mateWorkspaceList,
  workspaceChipOf,
  workspaceName,
  ZEROPS_RELEASE_QUESTION,
  ZEROPS_RELEASE_REQUEST,
  zeropsReleaseAsk,
  zeropsReleaseTurn,
} from "./workspaceChip.ts";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const ago = (minutes: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW - minutes * 60_000));
const hours = (count: number) => ago(count * 60);
/** What the chip of a conversation bound to `webpool-3` on `feat-x` calls its workspace. */
const NAME = "webpool · feat-x";

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
  workspaceChip({ name: NAME, lease, lastTurn, now: NOW })?.words;

describe("a bound conversation's workspace chip", () => {
  it("says when the workspace was last active and what a release would lose there", () => {
    const chip = workspaceChip({
      name: NAME,
      lease: readLease(
        { lastChangeAt: hours(3), previewOpenConns: 0, acquiredAt: hours(30), readAt: hours(2) },
        { files: [" M src/App.tsx", "?? notes.txt"], fileCount: 2, unpushedCommits: 2 },
      ),
      lastTurn: completedTurn(hours(5)),
      now: NOW,
    });
    expect(chip).toEqual({
      words: "webpool · feat-x · last active 3 h ago · 2 unpushed · 2 uncommitted",
      idle: false,
    });
  });

  it("labels a workspace idle once nothing happened in it for 24 h and every fact was read", () => {
    const chip = workspaceChip({
      name: NAME,
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
      words: "webpool · feat-x · idle · last active 26 h ago · 2 unpushed",
      idle: true,
    });
  });

  it.each([
    ["24 h ago", 24 * 60, true],
    ["23 h 59 min ago", 24 * 60 - 1, false],
  ])("a workspace last active %s is idle: %s", (_when, minutes, idle) => {
    const chip = workspaceChip({
      name: NAME,
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
    ).toBe("webpool · feat-x · idle · last active 3 d ago · all pushed");
  });

  it("never labels idle a workspace whose preview had a connection open when zcp read it", () => {
    const chip = workspaceChip({
      name: NAME,
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
      words: "webpool · feat-x · last active 30 h ago · all pushed",
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
    expect(workspaceChip({ name: NAME, lease, lastTurn: null, now: NOW })?.idle).toBe(false);
  });

  it("dates a workspace whose checkout was not read from its acquire", () => {
    expect(
      words({ acquiredAt: hours(80), activity: { acquiredAt: hours(80), note: "not read" } }),
    ).toBe("webpool · feat-x · last active 3 d ago");
  });

  it("counts the conversation's own last turn as the workspace's activity, whichever is newer", () => {
    const idleByZcp = readLease({
      lastChangeAt: hours(26),
      previewOpenConns: 0,
      acquiredAt: hours(72),
      readAt: hours(25),
    });
    expect(
      workspaceChip({ name: NAME, lease: idleByZcp, lastTurn: completedTurn(hours(2)), now: NOW }),
    ).toEqual({ words: "webpool · feat-x · last active 2 h ago · all pushed", idle: false });
    expect(
      workspaceChip({
        name: NAME,
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
    ).toEqual({ words: "webpool · feat-x · last active just now · all pushed", idle: false });
  });

  it("shows the conversation's last turn alone before zcp read the workspace, and nothing with neither", () => {
    expect(words(undefined, completedTurn(ago(5)))).toBe(
      "webpool · feat-x · last active 5 min ago",
    );
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
    ).toBe("webpool · feat-x · last active just now · all pushed");
  });

  it.each([
    ["a lease of a branch by its pool and branch", "feat-x", "webpool · feat-x"],
    ["a lease of no branch by its alias", null, "webpool-3"],
    ["a lease zcp names no branch for by its alias", undefined, "webpool-3"],
  ])("names its workspace: %s", (_what, branch, name) => {
    expect(workspaceName({ alias: "webpool-3", pool: "webpool", branch })).toBe(name);
  });

  it("counts the Mate's other workspaces after what it says of its own", () => {
    const lease = readLease(
      { lastChangeAt: hours(3), previewOpenConns: 0, acquiredAt: hours(30), readAt: hours(2) },
      { fileCount: 2, unpushedCommits: 0 },
    );
    expect(workspaceChip({ name: NAME, lease, lastTurn: null, now: NOW, more: 2 })?.words).toBe(
      "webpool · feat-x · last active 3 h ago · 2 uncommitted · 2 more",
    );
    expect(
      workspaceChip({ name: NAME, lease, lastTurn: null, now: NOW, more: 0 })?.words,
      "none more says nothing",
    ).toBe("webpool · feat-x · last active 3 h ago · 2 uncommitted");
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

  it("is none for another repository's lease of the branch under the alias", () => {
    const web = "https://hq.example/git/g1/appdev";
    const api = "https://hq.example/git/g1/apidev";
    expect(boundLeaseRead({ ...binding, repo: web }, [lease({ repo: api })])).toBeUndefined();
    expect(boundLeaseRead({ ...binding, repo: web }, [lease({ repo: web })])).toEqual(
      lease({ repo: web }),
    );
    expect(
      boundLeaseRead(binding, [lease({ repo: api })]),
      "a binding that names no repository reads the lease of its alias and branch",
    ).toEqual(lease({ repo: api }));
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
      words: "webpool · feat-x · idle · last active 30 h ago · 1 uncommitted",
      idle: true,
    });
    expect(workspaceChipOf({ binding, lifecycle: reading, lastTurn, now: NOW })).toEqual({
      words: "webpool · feat-x · last active 40 h ago",
      idle: false,
    });
    expect(
      workspaceChipOf({ binding: null, lifecycle: known, lastTurn: null, now: NOW }),
    ).toBeUndefined();
  });

  it("counts every other workspace the Mate holds, its branch's on another pool included, never an ended one", () => {
    const others = [
      // The bound branch's other part: another container, released on its own.
      { alias: "hqpool-1", pool: "hqpool", branch: "feat-x", state: "held", acquiredAt: hours(70) },
      // A helper's, on another branch, parked.
      {
        alias: "webpool-5",
        pool: "webpool",
        branch: "b-red",
        state: "parked",
        acquiredAt: hours(9),
      },
      // A helper's whose container did not answer: still held.
      {
        alias: "apipool-2",
        pool: "apipool",
        branch: "c-green",
        state: "held",
        acquiredAt: hours(2),
        notAnswering: "at its process limit",
      },
      { alias: "webpool-7", pool: "webpool", branch: "d-gone", state: "released" },
      { alias: "webpool-8", pool: "webpool", branch: "e-lost", state: "lost" },
    ];
    const lifecycle = {
      ...known,
      value: {
        threadId: "thread-1",
        recentTools: [],
        envelope: { leases: [...leases, ...others] },
      },
    } as unknown as Known<ZeropsLifecycle>;
    expect(
      workspaceChipOf({ binding, lifecycle, lastTurn: completedTurn(hours(40)), now: NOW })?.words,
    ).toBe("webpool · feat-x · idle · last active 30 h ago · 1 uncommitted · 3 more");
    expect(
      workspaceChipOf({ binding, lifecycle: reading, lastTurn: completedTurn(hours(40)), now: NOW })
        ?.words,
      "before a read, how many more is not known, never none",
    ).toBe("webpool · feat-x · last active 40 h ago");
  });
});

describe("the workspaces a Mate's chip lists", () => {
  const binding = { alias: "webpool-3", pool: "webpool", branch: "feat-x" };
  const bound = {
    alias: "webpool-3",
    pool: "webpool",
    branch: "feat-x",
    state: "held",
    acquiredAt: hours(72),
    activity: {
      lastChangeAt: hours(3),
      previewOpenConns: 0,
      acquiredAt: hours(72),
      readAt: hours(1),
    },
    unsaved: { fileCount: 2, unpushedCommits: 1 },
  };
  const sibling = {
    alias: "hqpool-1",
    pool: "hqpool",
    branch: "feat-x",
    state: "held",
    acquiredAt: hours(72),
  };
  const parked = {
    alias: "webpool-5",
    pool: "webpool",
    branch: "b-red",
    state: "parked",
    acquiredAt: hours(80),
    activity: {
      lastChangeAt: hours(50),
      previewOpenConns: 0,
      acquiredAt: hours(80),
      readAt: hours(1),
    },
    unsaved: { fileCount: 0, unpushedCommits: 0 },
  };
  const silent = {
    alias: "apipool-2",
    pool: "apipool",
    state: "held",
    acquiredAt: hours(2),
    notAnswering: "at its process limit: nothing new starts in it",
  };
  const ended = { alias: "webpool-7", pool: "webpool", branch: "d-gone", state: "released" };
  const lifecycleOf = (leases: ReadonlyArray<unknown>) =>
    ({
      state: "known",
      value: { threadId: "thread-1", recentTools: [], envelope: { leases } },
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: { kind: "live" },
    }) as unknown as Known<ZeropsLifecycle>;
  const listed = (
    leases: ReadonlyArray<unknown> | undefined,
    lastTurn: Turn | null = null,
    on: typeof binding | null = binding,
  ) =>
    mateWorkspaceList({
      binding: on,
      lifecycle: leases === undefined ? undefined : lifecycleOf(leases),
      lastTurn,
      now: NOW,
    });

  it("lists every workspace the Mate holds, the bound one first and marked, each with its state, last activity and unsaved work", () => {
    const list = listed([silent, parked, ended, sibling, bound]);
    expect(
      list.map(({ name, alias, state, facts, bound: isBound }) => ({
        name,
        alias,
        state,
        facts,
        bound: isBound,
      })),
    ).toEqual([
      {
        name: "webpool · feat-x",
        alias: "webpool-3",
        state: "held",
        facts: "last active 3 h ago · 1 unpushed · 2 uncommitted",
        bound: true,
      },
      {
        name: "apipool-2",
        alias: undefined,
        state: "not answering",
        facts: "last active 2 h ago",
        bound: false,
      },
      {
        name: "hqpool · feat-x",
        alias: "hqpool-1",
        state: "held",
        facts: "last active 3 d ago",
        bound: false,
      },
      {
        name: "webpool · b-red",
        alias: "webpool-5",
        state: "parked",
        facts: "idle · last active 2 d ago · all pushed",
        bound: false,
      },
    ]);
    expect(list.map(({ idle }) => idle)).toEqual([false, false, false, true]);
  });

  it("names each workspace's lease, which its own Release asks about and asks to release", () => {
    expect(listed([bound, parked]).map(({ lease }) => lease)).toEqual([
      binding,
      { alias: "webpool-5", pool: "webpool", branch: "b-red" },
    ]);
    expect(listed([{ ...parked, repo: "https://hq.example/git/g1/appdev" }])[0]?.lease).toEqual({
      alias: "webpool-5",
      pool: "webpool",
      branch: "b-red",
      repo: "https://hq.example/git/g1/appdev",
    });
  });

  it("says a workspace whose container did not answer is not answering, and why, as zcp said it", () => {
    const [row] = listed([silent]);
    expect(row?.state).toBe("not answering");
    expect(row?.notAnswering).toBe("at its process limit: nothing new starts in it");
    expect(listed([bound])[0]?.notAnswering).toBeUndefined();
  });

  it("dates the bound workspace by the conversation's last turn too, the others only by what zcp read", () => {
    const list = listed([bound, sibling], {
      state: "running",
      requestedAt: hours(1),
      startedAt: hours(1),
      completedAt: null,
    });
    expect(list.map(({ facts }) => facts)).toEqual([
      "last active just now · 1 unpushed · 2 uncommitted",
      "last active 3 d ago",
    ]);
  });

  it("lists the bound workspace alone, named by its binding, before zcp's leases are read", () => {
    expect(listed(undefined, completedTurn(hours(5)))).toEqual([
      {
        lease: binding,
        name: "webpool · feat-x",
        alias: "webpool-3",
        state: undefined,
        notAnswering: undefined,
        facts: "last active 5 h ago",
        idle: false,
        bound: true,
      },
    ]);
  });

  it("leaves out a bound lease zcp no longer holds, and lists nothing for a conversation bound to none", () => {
    expect(listed([{ ...bound, state: "released" }, parked]).map(({ alias }) => alias)).toEqual([
      "webpool-5",
    ]);
    expect(listed([bound, parked], null, null)).toEqual([]);
  });
});

describe("the question a bound conversation's workspace is released by", () => {
  const binding = { alias: "webpool-3", pool: "webpool", branch: "feat-x" };
  const leaseIn = (
    state: string,
    lastChangeHours = 3,
    unsaved = { fileCount: 2, unpushedCommits: 2 },
  ) => ({
    alias: "webpool-3",
    pool: "webpool",
    branch: "feat-x",
    state,
    acquiredAt: hours(72),
    activity: {
      lastChangeAt: hours(lastChangeHours),
      previewOpenConns: 0,
      acquiredAt: hours(72),
      readAt: hours(1),
    },
    unsaved,
  });
  const lifecycleOf = (leases: ReadonlyArray<unknown>) =>
    ({
      state: "known",
      value: { threadId: "thread-1", recentTools: [], envelope: { leases } },
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: { kind: "live" },
    }) as unknown as Known<ZeropsLifecycle>;

  it("asks whether to release the workspace of a conversation bound to a held lease, with what is known of it", () => {
    expect(
      zeropsReleaseAsk({
        binding,
        lifecycle: lifecycleOf([leaseIn("held")]),
        lastTurn: completedTurn(hours(5)),
        now: NOW,
      }),
    ).toEqual({
      alias: "webpool-3",
      question: ZEROPS_RELEASE_QUESTION("webpool-3"),
      facts: "last active 3 h ago · 2 unpushed · 2 uncommitted",
      idle: false,
    });
  });

  it.each([
    ["held", true],
    ["unmounted", true],
    ["parked", true],
    ["released", false],
    ["lost", false],
    ["unknown-holder", false],
  ])("asks about a lease zcp read as %s: %s", (state, asked) => {
    const ask = zeropsReleaseAsk({
      binding,
      lifecycle: lifecycleOf([leaseIn(state)]),
      lastTurn: null,
      now: NOW,
    });
    expect(ask?.alias).toBe(asked ? "webpool-3" : undefined);
  });

  it("asks nothing of a conversation bound to no lease", () => {
    expect(
      zeropsReleaseAsk({
        binding: null,
        lifecycle: lifecycleOf([leaseIn("held")]),
        lastTurn: completedTurn(hours(5)),
        now: NOW,
      }),
    ).toBeUndefined();
  });

  it("names the lease before zcp read it, and says nothing it did not read", () => {
    expect(zeropsReleaseAsk({ binding, lifecycle: undefined, lastTurn: null, now: NOW })).toEqual({
      alias: "webpool-3",
      question: ZEROPS_RELEASE_QUESTION("webpool-3"),
      facts: undefined,
      idle: false,
    });
  });

  it("marks the question of a workspace nothing happened in for 24 h idle, which only makes it stand out", () => {
    const ask = zeropsReleaseAsk({
      binding,
      lifecycle: lifecycleOf([leaseIn("held", 26, { fileCount: 0, unpushedCommits: 0 })]),
      lastTurn: completedTurn(hours(30)),
      now: NOW,
    });
    expect(ask).toEqual({
      alias: "webpool-3",
      question: ZEROPS_RELEASE_QUESTION("webpool-3"),
      facts: "idle · last active 26 h ago · all pushed",
      idle: true,
    });
  });

  it("asks a plain question that names the workspace", () => {
    expect(ZEROPS_RELEASE_QUESTION("webpool-3")).toMatch(/^Release workspace webpool-3\?/);
  });
});

describe("the release request a yes sends", () => {
  const conversation = {
    id: ThreadId.make("thread-1"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
  };
  const ids = { commandId: CommandId.make("command-1"), messageId: MessageId.make("message-1") };
  const turn = () =>
    zeropsReleaseTurn({ conversation, alias: "webpool-3", ids, createdAt: hours(0) });
  const success = { _tag: "Success", value: undefined } as unknown as AtomCommandResult<
    unknown,
    unknown
  >;
  const failure = {
    _tag: "Failure",
    cause: new Error("refused"),
  } as unknown as AtomCommandResult<unknown, unknown>;

  it("asks the conversation's agent to release the lease with zerops_lease, and never to force", () => {
    const request = ZEROPS_RELEASE_REQUEST("webpool-3");
    expect(request).toContain("zerops_lease action=release lease=webpool-3");
    expect(request).not.toMatch(/force\s*=|force:\s*true/iu);
  });

  it("is one visible message of the person's in the bound conversation, in its own model and modes", () => {
    expect(turn()).toEqual({
      commandId: ids.commandId,
      threadId: conversation.id,
      message: {
        messageId: ids.messageId,
        role: "user",
        text: ZEROPS_RELEASE_REQUEST("webpool-3"),
        attachments: [],
      },
      modelSelection: conversation.modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      // Mate's words, not the person's: they never name the conversation.
      fromPanel: true,
      createdAt: hours(0),
    });
  });

  it("is a turn that acts even in a conversation set to plan, since the person asked for the release", () => {
    // The engine keeps no conversation-wide mode: the mode rides each message, so this turn alone
    // runs in the default mode and the conversation's next message is planned as before.
    const planned = zeropsReleaseTurn({
      conversation: { ...conversation, interactionMode: "plan" as const },
      alias: "webpool-3",
      ids,
      createdAt: hours(0),
    });
    expect(planned.interactionMode).toBe("default");
    expect(planned.runtimeMode).toBe("full-access");
  });

  it.each([
    ["a conversation not archived gets the request straight away", false, ["send"]],
    [
      "an archived conversation, which takes no message, is brought back before the request is sent",
      true,
      ["unarchive", "send"],
    ],
  ])("%s", async (_title, archived, steps) => {
    const order: Array<string> = [];
    const unarchive = vi.fn(async () => {
      order.push("unarchive");
      return success;
    });
    const startTurn = vi.fn(async () => {
      order.push("send");
      return success;
    });
    const result = await sendZeropsReleaseRequest({ turn: turn(), archived, unarchive, startTurn });
    expect(result._tag).toBe("Success");
    expect(order).toEqual(steps);
    expect(startTurn).toHaveBeenCalledExactlyOnceWith(turn());
  });

  it("sends nothing when an archived conversation could not be brought back", async () => {
    const startTurn = vi.fn(async () => success);
    const result = await sendZeropsReleaseRequest({
      turn: turn(),
      archived: true,
      unarchive: async () => failure,
      startTurn,
    });
    expect(result).toBe(failure);
    expect(startTurn).not.toHaveBeenCalled();
  });
});
