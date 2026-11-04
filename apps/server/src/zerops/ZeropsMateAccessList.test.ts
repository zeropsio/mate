import { assert, describe, it } from "@effect/vitest";
import type { KeyLinkAccess } from "@t3tools/shared/mateLink";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type { AccessRead } from "./ZeropsAccessRead.ts";
import type { AccessFrame, AccessLiveEvent } from "./ZeropsAccessSocket.ts";
import {
  ACCESS_LIST_HOLDS,
  ACCESS_READ_BUDGET,
  type AccessList,
  accessReport,
  administersProject,
  make as makeAccessList,
  nextAccessList,
  ownAccessList,
} from "./ZeropsMateAccessList.ts";

const AT = "2026-10-24T10:00:00.000Z";
const JAN = { userId: "jan", role: "OWNER", visibility: "open" } as const;
const EVA = { userId: "eva", role: "READ_ONLY", visibility: "listed" } as const;

const full = (version: number, members: KeyLinkAccess["members"]): KeyLinkAccess => ({
  type: "access",
  version,
  viewAt: AT,
  full: true,
  members,
});
const delta = (version: number, members: KeyLinkAccess["members"]): KeyLinkAccess => ({
  type: "access",
  version,
  viewAt: AT,
  full: false,
  members,
});

/** Who a list names, by user and visibility; `none` before any list. */
const named = (list: AccessList | undefined) =>
  list === undefined
    ? "none"
    : list.members.map((member) => `${member.userId}:${member.visibility}`).join(",");

describe("nextAccessList", () => {
  it.each<[string, ReadonlyArray<KeyLinkAccess>, string]>([
    ["a delta before any snapshot is discarded", [delta(5, [JAN])], "none"],
    ["a snapshot is the baseline", [full(3, [JAN, EVA])], "jan:open,eva:listed"],
    [
      "a snapshot numbered below the last still replaces it",
      [full(9, [JAN, EVA]), full(1, [EVA])],
      "eva:listed",
    ],
    [
      "a delta above the last applies its entries",
      [full(3, [JAN]), delta(4, [EVA, { ...JAN, role: "READ_ONLY", visibility: "listed" }])],
      "jan:listed,eva:listed",
    ],
    [
      "a delta entry with visibility none removes its member",
      [full(3, [JAN, EVA]), delta(4, [{ ...EVA, visibility: "none" }])],
      "jan:open",
    ],
    [
      "a delta at the last version is discarded",
      [full(3, [JAN]), delta(3, [{ ...JAN, visibility: "none" }])],
      "jan:open",
    ],
    [
      "a delta below the last is discarded",
      [full(3, [JAN]), delta(4, [EVA]), delta(2, [{ ...JAN, visibility: "none" }])],
      "jan:open,eva:listed",
    ],
  ])(
    "A full access frame resets the Mate's baseline whatever its version; only deltas are compared by version: %s",
    (_name, frames, expected) => {
      const list = frames.reduce<AccessList | undefined>(
        (held, frame) => nextAccessList(held, frame, 0),
        undefined,
      );
      assert.strictEqual(named(list), expected);
    },
  );
});

describe("ZeropsMateAccessList", () => {
  it.effect("TC-13 a view within 60 seconds of the Mate clock caps the hold from receipt", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(AT));
      const list = yield* makeAccessList();
      yield* list.heard({ ...full(1, [JAN]), viewAt: "2026-10-24T09:59:00.000Z" });
      yield* TestClock.adjust("14 minutes");
      assert.strictEqual(yield* list.admits("jan"), "open");
      yield* TestClock.adjust(1);
      assert.strictEqual(yield* list.admits("jan"), "not_in_list");
    }).pipe(Effect.scoped),
  );

  it.effect("answers from HQ's relay while it is fresh, reading nothing of Zerops", () =>
    Effect.gen(function* () {
      // The list is built from nothing but the frames: no Zerops reader, no key.
      const list = yield* makeAccessList();
      assert.isTrue(Option.isNone(yield* list.current));
      yield* list.heard(full(1, [JAN, EVA]));
      yield* TestClock.adjust(Duration.minutes(10));
      assert.strictEqual(named(Option.getOrUndefined(yield* list.current)), "jan:open,eva:listed");
    }).pipe(Effect.scoped),
  );

  it.effect("tells a relay that changed who it lets in, never one that only aged", () =>
    Effect.gen(function* () {
      const list = yield* makeAccessList();
      const told = yield* Stream.runCollect(Stream.take(list.changes, 4)).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* list.heard(full(1, [JAN]));
      yield* list.heard(delta(2, []));
      yield* list.heard(full(3, [JAN]));
      yield* list.heard(delta(4, [EVA]));
      yield* list.heard(delta(4, [{ ...EVA, visibility: "none" }]));
      yield* list.heard({ type: "access", version: 5, full: true, refused: true, members: [] });
      yield* Effect.repeat(Effect.yieldNow, { times: 10 });
      // Three changes so far: the first list, Eva listed, the refusal.
      assert.isUndefined(told.pollUnsafe());
      yield* list.heard(full(6, [JAN]));
      assert.lengthOf(yield* Fiber.join(told), 4);
    }).pipe(Effect.scoped),
  );
});

describe("administersProject", () => {
  const list = (members: AccessList["members"], refused = false): Option.Option<AccessList> =>
    Option.some({ version: 1, members, refused, heardAtMs: 0, expiresAtMs: 1 });
  const ADA = { userId: "ada", role: "ADMIN", visibility: "open" } as const;
  const BEN = { userId: "ben", role: "BASIC_USER", visibility: "open" } as const;
  const ADA_LISTED = { ...ADA, visibility: "listed" } as const;

  it.each([
    ["its organisation's owner", list([JAN, ADA]), "zerops-user:jan", true],
    ["an admin it opens for", list([JAN, ADA]), "zerops-user:ada", true],
    ["a basic user", list([JAN, BEN]), "zerops-user:ben", false],
    ["an admin it only lists", list([ADA_LISTED]), "zerops-user:ada", false],
    ["an admin while the key is refused", list([ADA], true), "zerops-user:ada", false],
    ["an admin without a list that holds", Option.none<AccessList>(), "zerops-user:ada", false],
    ["a session that is no Zerops person", list([ADA]), "ada", false],
  ] as const)(
    "an admin of the Mate's project is one the list opens it for at Admin or above: %s",
    (_, held, subject, admin) => {
      assert.strictEqual(administersProject(held, subject), admin);
    },
  );
});

const PROJECT = "P_MATE";
/** A person of the organisation as the member search names them. */
const person = (userId: string, orgRole: string, status = "ACTIVE") => ({
  clientUserId: `cu-${userId}`,
  userId,
  orgRole,
  status,
  canCreateProjects: false,
});
const read = (
  members: ReadonlyArray<ReturnType<typeof person>>,
  overrides: Record<string, string> = {},
): Extract<AccessRead, { kind: "read" }> => ({
  kind: "read",
  project: { clientId: "org", overrides },
  members,
});

describe("ownAccessList", () => {
  it.each<[string, Extract<AccessRead, { kind: "read" }>, string]>([
    ["an active org Basic user is opened for", read([person("ben", "BASIC_USER")]), "ben:open"],
    ["an active org Read only is listed", read([person("eva", "READ_ONLY")]), "eva:listed"],
    ["an org No access without an override is absent", read([person("nia", "NO_ACCESS")]), ""],
    [
      "an override on this project beats a lower org role",
      read([person("nia", "NO_ACCESS")], { "cu-nia": "BASIC_USER" }),
      "nia:open",
    ],
    [
      "an override on this project beats a higher org role",
      read([person("ada", "ADMIN")], { "cu-ada": "READ_ONLY" }),
      "ada:listed",
    ],
    [
      "an integration token in userRoles with no matching person is ignored",
      read([person("jan", "OWNER")], { "cu-token": "BASIC_USER" }),
      "jan:open",
    ],
    [
      "a member who is not active is absent whatever their role",
      read([person("ola", "OWNER", "WAITING_AUTHORIZATION")]),
      "",
    ],
  ])(
    "A person is an opener when their effective role (own override on this project, else org role) is Basic user or higher and their status is ACTIVE; listed when Read only; otherwise absent: %s",
    (_name, input, expected) => {
      assert.strictEqual(named(ownAccessList(PROJECT, input, 0)), expected);
    },
  );
});

describe("accessReport", () => {
  it("After every recompute the report names openers and listed; missing are whom the previous report named and the list does not", () => {
    const first = accessReport(
      undefined,
      ownAccessList(PROJECT, read([person("jan", "OWNER"), person("eva", "READ_ONLY")]), 0),
      "2026-11-03T10:00:00.000Z",
    );
    assert.deepStrictEqual(first, {
      at: "2026-11-03T10:00:00.000Z",
      openers: ["jan"],
      listed: ["eva"],
      missing: [],
    });
    const second = accessReport(
      first,
      ownAccessList(PROJECT, read([person("eva", "BASIC_USER"), person("ben", "ADMIN")]), 0),
      "2026-11-03T10:05:00.000Z",
    );
    assert.deepStrictEqual(second, {
      at: "2026-11-03T10:05:00.000Z",
      openers: ["eva", "ben"],
      listed: [],
      missing: ["jan"],
    });
    // Missing is against the previous report only: Jan, gone already, is not reported again.
    assert.deepStrictEqual(accessReport(second, ownAccessList(PROJECT, read([]), 0), "t").missing, [
      "eva",
      "ben",
    ]);
  });
});

/** The Mate's own read, answering what the test sets; `reads` counts the reads made. */
const ownRead = Effect.gen(function* () {
  const answer = yield* Ref.make<AccessRead>(read([person("jan", "OWNER")]));
  const reads = yield* Ref.make(0);
  return {
    answer,
    reads,
    own: {
      projectId: PROJECT,
      read: Ref.update(reads, (count) => count + 1).pipe(Effect.andThen(Ref.get(answer))),
    },
  };
});
/** A random source that always draws `unit` (0 the lowest, just under 1 the highest). */
const drawing = (unit: number): Random.Random => ({
  nextDoubleUnsafe: () => unit,
  nextIntUnsafe: () => 0,
});

describe("ZeropsMateAccessList, computed by the Mate", () => {
  it.effect.each([
    { name: "at its shortest", unit: 0, wait: Duration.minutes(4) },
    { name: "at its longest", unit: 0.999_999, wait: Duration.minutes(6) },
  ])("The list is recomputed every 5 minutes with ±60 s jitter: $name", ({ unit, wait }) =>
    Effect.gen(function* () {
      const { reads, own } = yield* ownRead;
      yield* makeAccessList(own).pipe(Effect.provideService(Random.Random, drawing(unit)));
      yield* TestClock.adjust(Duration.zero);
      assert.strictEqual(yield* Ref.get(reads), 1);
      yield* TestClock.adjust(Duration.subtract(wait, Duration.millis(1)));
      assert.strictEqual(yield* Ref.get(reads), 1);
      yield* TestClock.adjust(Duration.millis(1));
      assert.strictEqual(yield* Ref.get(reads), 2);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "The list is recomputed once immediately when a ticket names a person the list does not contain",
    () =>
      Effect.gen(function* () {
        const { answer, reads, own } = yield* ownRead;
        const list = yield* makeAccessList(own);
        yield* TestClock.adjust(Duration.zero);
        assert.strictEqual(yield* list.admits("jan"), "open");
        assert.strictEqual(yield* Ref.get(reads), 1);
        yield* Ref.set(answer, read([person("jan", "OWNER"), person("ben", "BASIC_USER")]));
        assert.strictEqual(yield* list.admits("ben"), "open");
        assert.strictEqual(yield* Ref.get(reads), 2);
        assert.strictEqual(yield* list.admits("nobody"), "not_in_list");
        assert.strictEqual(yield* Ref.get(reads), 3);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "A refused read (401, 400 userNotFound|projectNotFound) keeps the last list and marks it stale: HQ's relay decides while the Mate cannot read Zerops itself",
    () =>
      Effect.gen(function* () {
        const { answer, own } = yield* ownRead;
        const list = yield* makeAccessList(own);
        yield* TestClock.adjust(Duration.zero);
        yield* list.heard(full(1, [EVA]));
        // The Mate's own list is authoritative: HQ's relay is not what decides.
        assert.strictEqual(named(Option.getOrUndefined(yield* list.current)), "jan:open");
        for (const status of [401, 400]) {
          yield* Ref.set(answer, { kind: "refused", status });
          yield* TestClock.adjust(Duration.minutes(6));
          assert.strictEqual(named(Option.getOrUndefined(yield* list.current)), "eva:listed");
          yield* Ref.set(answer, read([person("jan", "OWNER")]));
          yield* TestClock.adjust(Duration.minutes(6));
          assert.strictEqual(named(Option.getOrUndefined(yield* list.current)), "jan:open");
        }
        // Without a relay the stale list is kept, not emptied.
        const alone = yield* makeAccessList(own);
        yield* TestClock.adjust(Duration.zero);
        yield* Ref.set(answer, { kind: "refused", status: 401 });
        yield* TestClock.adjust(Duration.minutes(6));
        assert.strictEqual(named(Option.getOrUndefined(yield* alone.current)), "jan:open");
      }).pipe(Effect.scoped),
  );

  it.effect(
    "A list older than 15 minutes refuses new tickets with reason not_in_list but is kept for the connections already open",
    () =>
      Effect.gen(function* () {
        const { answer, own } = yield* ownRead;
        const list = yield* makeAccessList(own);
        yield* TestClock.adjust(Duration.zero);
        yield* Ref.set(answer, { kind: "failed", reason: "unreachable" });
        yield* TestClock.adjust(ACCESS_LIST_HOLDS);
        assert.strictEqual(yield* list.admits("jan"), "open");
        yield* TestClock.adjust(Duration.millis(1));
        assert.strictEqual(yield* list.admits("jan"), "not_in_list");
        assert.strictEqual(named(Option.getOrUndefined(yield* list.current)), "jan:open");
      }).pipe(Effect.scoped),
  );

  it.effect("reports the list after every recompute that read it, never after a failed one", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-11-03T10:00:00.000Z"));
      const { answer, own } = yield* ownRead;
      const list = yield* makeAccessList(own).pipe(
        Effect.provideService(Random.Random, drawing(0.5)),
      );
      const reports = yield* Stream.runCollect(Stream.take(list.reports, 2)).pipe(Effect.forkChild);
      yield* TestClock.adjust(Duration.zero);
      yield* Ref.set(answer, { kind: "failed", reason: "unreachable" });
      yield* TestClock.adjust(Duration.minutes(5));
      yield* Ref.set(answer, read([person("eva", "READ_ONLY")]));
      yield* TestClock.adjust(Duration.minutes(5));
      assert.deepStrictEqual(yield* Fiber.join(reports), [
        { at: "2026-11-03T10:00:00.000Z", openers: ["jan"], listed: [], missing: [] },
        { at: "2026-11-03T10:10:00.000Z", openers: [], listed: ["eva"], missing: ["jan"] },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "A Zerops read that never answers counts as failed after its budget, so a ticket is answered rather than left waiting",
    () =>
      Effect.gen(function* () {
        const list = yield* makeAccessList({ projectId: PROJECT, read: Effect.never });
        const answered = yield* list.admits("jan").pipe(Effect.forkChild);
        yield* TestClock.adjust(ACCESS_READ_BUDGET);
        assert.strictEqual(yield* Fiber.join(answered), "not_in_list");
      }).pipe(Effect.scoped),
  );

  it.effect(
    "A ticket that names an unknown person while a recompute is in flight waits on that recompute instead of reading again",
    () =>
      Effect.gen(function* () {
        const { answer, reads, own } = yield* ownRead;
        const readAnswers = yield* Deferred.make<void>();
        const list = yield* makeAccessList({
          projectId: PROJECT,
          read: Deferred.await(readAnswers).pipe(Effect.andThen(own.read)),
        });
        yield* Ref.set(answer, read([person("ben", "BASIC_USER")]));
        const answered = yield* list.admits("ben").pipe(Effect.forkChild);
        yield* TestClock.adjust(Duration.zero);
        yield* Deferred.succeed(readAnswers, undefined);
        assert.strictEqual(yield* Fiber.join(answered), "open");
        assert.strictEqual(yield* Ref.get(reads), 1);
      }).pipe(Effect.scoped),
  );
});

/** The own read, and a live socket whose events the test pushes; `orgs` are what it was opened for. */
const liveRead = Effect.gen(function* () {
  const rig = yield* ownRead;
  const events = yield* Queue.unbounded<AccessLiveEvent>();
  const orgs: Array<string> = [];
  const live = (clientId: string) => {
    orgs.push(clientId);
    return Stream.fromQueue(events);
  };
  const frame = (frame: AccessFrame) => Queue.offer(events, { _tag: "frame", frame });
  return {
    ...rig,
    orgs,
    frame,
    connected: Queue.offer(events, { _tag: "connected" }),
    own: { ...rig.own, live },
  };
});
const evaRole = (orgRole: string): AccessFrame => ({
  kind: "members",
  upsert: [{ clientUserId: "cu-eva", userId: "eva", orgRole, status: "ACTIVE" }],
  remove: [],
});

describe("ZeropsMateAccessList, live over the Zerops websocket", () => {
  it.effect(
    "Every frame recomputes the list from its content and the last known rows; a frame seen twice changes nothing",
    () =>
      Effect.gen(function* () {
        const { answer, frame, own, orgs } = yield* liveRead;
        yield* Ref.set(answer, read([person("jan", "OWNER"), person("eva", "BASIC_USER")]));
        const list = yield* makeAccessList(own);
        const reports = yield* Stream.runCollect(Stream.take(list.reports, 3)).pipe(
          Effect.forkChild,
        );
        yield* TestClock.adjust(Duration.zero);
        yield* frame(evaRole("READ_ONLY"));
        yield* frame(evaRole("READ_ONLY"));
        yield* frame({ kind: "project", overrides: { "cu-eva": "BASIC_USER" } });
        const [first, second, third] = yield* Fiber.join(reports);
        assert.deepStrictEqual(orgs, ["org"]);
        assert.deepStrictEqual(
          [first, second, third].map((report) => [report?.openers, report?.listed]),
          [
            [["jan", "eva"], []],
            [["jan"], ["eva"]],
            [["jan", "eva"], []],
          ],
        );
      }).pipe(Effect.scoped),
  );

  it.effect("A websocket (re)connect runs the Zerops read once", () =>
    Effect.gen(function* () {
      const { connected, own, reads } = yield* liveRead;
      const list = yield* makeAccessList(own);
      const reports = yield* Stream.runCollect(Stream.take(list.reports, 3)).pipe(Effect.forkChild);
      yield* TestClock.adjust(Duration.zero);
      yield* connected;
      yield* connected;
      yield* Fiber.join(reports);
      assert.strictEqual(yield* Ref.get(reads), 3);
    }).pipe(Effect.scoped),
  );

  it.effect("The 5-minute fallback read still runs while the websocket is live", () =>
    Effect.gen(function* () {
      const { own, reads } = yield* liveRead;
      yield* makeAccessList(own).pipe(Effect.provideService(Random.Random, drawing(0.5)));
      yield* TestClock.adjust(Duration.zero);
      assert.strictEqual(yield* Ref.get(reads), 1);
      yield* TestClock.adjust(Duration.minutes(5));
      assert.strictEqual(yield* Ref.get(reads), 2);
    }).pipe(Effect.scoped),
  );
});
