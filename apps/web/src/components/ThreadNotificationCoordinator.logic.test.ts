import type { MateAttention } from "@t3tools/contracts";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import type { ThreadDigest } from "@t3tools/shared/mateLink";
import { describe, expect, it } from "vite-plus/test";

import {
  attentionWatch,
  overviewWatch,
  watchMates,
  type WatchedMate,
} from "./ThreadNotificationCoordinator.logic";

const NOW = Date.parse("2026-10-03T12:00:00.000Z");

/** A chat as its Mate digests it: resting, its last turn completed long ago. */
const digest = (id: string, over: Partial<ThreadDigest> = {}): ThreadDigest => ({
  id: id as ThreadDigest["id"],
  title: `Chat ${id}`,
  kind: "idle",
  turnId: "turn-1" as ThreadDigest["turnId"],
  turnState: "completed",
  completedAt: "2026-10-01T09:00:00.000Z",
  ...over,
});

/** A Mate HQ holds online, its environment `env`, with the chats `list`. */
const mate = (env: string, list: ReadonlyArray<ThreadDigest>): MateLiveView => ({
  presence: { online: true, since: "2026-10-03T08:00:00.000Z", overview: "live" },
  identity: {
    environmentId: env as NonNullable<MateLiveView["identity"]>["environmentId"],
    serverVersion: "0.11.90",
    update: null,
  },
  main: null,
  threads: { list, omitted: 0 },
  logins: {},
  crew: { status: "off" },
});

const mates = (
  entries: ReadonlyArray<readonly [string, MateLiveView]>,
): ReadonlyMap<string, WatchedMate> =>
  new Map(
    entries.flatMap(([projectId, view]) => {
      const watched = overviewWatch(view);
      return watched === undefined ? [] : [[projectId, watched] as const];
    }),
  );

describe("watchMates", () => {
  // No socket to the Mate is needed: HQ's overview of it is what rings.
  it("rings for a thread of a Mate it holds no socket to", () => {
    const first = watchMates(null, mates([["p-ada", mate("env-ada", [digest("t1")])]]), NOW);
    const asked = watchMates(
      first.next,
      mates([
        [
          "p-ada",
          mate("env-ada", [
            digest("t1", {
              kind: "approval",
              turnId: "turn-2" as ThreadDigest["turnId"],
              turnState: "running",
              completedAt: null,
            }),
          ]),
        ],
      ]),
      NOW + 1_000,
    );
    expect(asked.rings).toEqual([
      {
        environmentId: "env-ada",
        threadId: "t1",
        title: "Chat t1",
        kind: "input",
        status: "approval",
      },
    ]);
  });

  // What was already there when HQ's view arrived never rings: the snapshot is the baseline.
  it("takes a snapshot as the baseline", () => {
    const waiting = mate("env-ada", [
      digest("asks", {
        kind: "approval",
        turnId: "turn-2" as ThreadDigest["turnId"],
        turnState: "running",
        completedAt: null,
      }),
      digest("done", { completedAt: "2026-10-03T11:59:00.000Z" }),
    ]);
    const first = watchMates(null, mates([["p-ada", waiting]]), NOW);
    expect(first.rings).toEqual([]);
    const again = watchMates(first.next, mates([["p-ada", waiting]]), NOW + 1_000);
    expect(again.rings).toEqual([]);
    // Nothing known again (HQ's view gone), then the view back: a baseline once more.
    const gone = watchMates(again.next, null, NOW + 2_000);
    expect(gone.next).toBeNull();
    expect(watchMates(gone.next, mates([["p-ada", waiting]]), NOW + 3_000).rings).toEqual([]);
  });

  // A chat the Mate started after its baseline counts from nothing: its first stop rings.
  it("rings for a chat that appears after the baseline and stops on an approval", () => {
    const first = watchMates(null, mates([["p-ada", mate("env-ada", [digest("t1")])]]), NOW);
    const asking = digest("t2", {
      kind: "approval",
      turnId: "turn-1" as ThreadDigest["turnId"],
      turnState: "running",
      completedAt: null,
    });
    const next = watchMates(
      first.next,
      mates([["p-ada", mate("env-ada", [asking, digest("t1")])]]),
      NOW + 1_000,
    );
    expect(next.rings).toEqual([
      {
        environmentId: "env-ada",
        threadId: "t2",
        title: "Chat t2",
        kind: "input",
        status: "approval",
      },
    ]);
  });

  // A completion rings once; a resting chat that comes back into the list of forty after the
  // baseline brings a completion from before it, which never rings.
  it("rings once when a chat completes a turn, never for one completed before its baseline", () => {
    const working = digest("t1", {
      kind: "working",
      turnId: "turn-2" as ThreadDigest["turnId"],
      turnState: "running",
      completedAt: null,
    });
    const first = watchMates(null, mates([["p-ada", mate("env-ada", [working])]]), NOW);
    const completed = digest("t1", {
      turnId: "turn-2" as ThreadDigest["turnId"],
      completedAt: "2026-10-03T12:00:30.000Z",
    });
    const done = watchMates(
      first.next,
      mates([["p-ada", mate("env-ada", [completed])]]),
      NOW + 31_000,
    );
    expect(done.rings).toEqual([
      {
        environmentId: "env-ada",
        threadId: "t1",
        title: "Chat t1",
        kind: "completion",
        status: "idle",
      },
    ]);
    const back = watchMates(
      done.next,
      mates([["p-ada", mate("env-ada", [completed, digest("old")])]]),
      NOW + 32_000,
    );
    expect(back.rings).toEqual([]);
  });

  // A crewmate's chat speaks through the crew line, never as a thread alert.
  it("never rings for a crewmate's thread", () => {
    const crewed = (threadKind: "idle" | "approval"): MateLiveView => ({
      ...mate("env-ada", [digest("t1")]),
      crew: {
        status: "applied",
        crewmates: [
          {
            handle: "backend",
            displayName: "Backend",
            tint: "sky",
            lead: false,
            threadId: "crew-backend-1" as ThreadDigest["id"],
            threadKind,
            loginKey: "claude-code",
          },
        ],
        attention: [],
        readyTasks: [],
        personLands: true,
      },
    });
    const first = watchMates(null, mates([["p-ada", crewed("idle")]]), NOW);
    expect(
      watchMates(first.next, mates([["p-ada", crewed("approval")]]), NOW + 1_000).rings,
    ).toEqual([]);
  });
});

describe("watchMates — a Mate that publishes its attention", () => {
  const said = (over: Partial<MateAttention>): MateAttention =>
    ({
      source: { environmentId: "env-ada", epoch: 1, incarnation: "m1", revision: 1 },
      mainThreadId: "t1",
      lastThreadId: "t1",
      working: 0,
      waiting: 0,
      results: [],
      questions: [],
      truncated: false,
      ...over,
    }) as MateAttention;
  const look = (attention: MateAttention) =>
    new Map([["p-ada", attentionWatch(attention, (threadId) => `Chat ${threadId}`)]]);

  it("rings once for what a chat waits on its person for, and once for a finished turn", () => {
    const first = watchMates(null, look(said({})), NOW);
    expect(first.rings).toEqual([]);
    const asked = watchMates(
      first.next,
      look(said({ questions: [{ threadId: "t1", kind: "approval", turnId: "turn-2" }] as never })),
      NOW + 1_000,
    );
    expect(asked.rings).toEqual([
      {
        environmentId: "env-ada",
        threadId: "t1",
        title: "Chat t1",
        kind: "input",
        status: "approval",
      },
    ]);
    const again = watchMates(
      asked.next,
      look(said({ questions: [{ threadId: "t1", kind: "approval", turnId: "turn-2" }] as never })),
      NOW + 2_000,
    );
    expect(again.rings).toEqual([]);
    const done = watchMates(
      again.next,
      look(
        said({
          results: [
            { threadId: "t1", turnId: "turn-2", completedAt: "2026-10-03T12:00:05.000Z" },
          ] as never,
        }),
      ),
      NOW + 6_000,
    );
    expect(done.rings).toMatchObject([{ threadId: "t1", kind: "completion" }]);
  });

  it("takes the first look at a Mate as its baseline", () => {
    const first = watchMates(
      null,
      look(said({ questions: [{ threadId: "t1", kind: "input", turnId: null }] as never })),
      NOW,
    );
    expect(first.rings).toEqual([]);
  });
});
