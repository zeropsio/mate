import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsIdentityStatusModule from "./ZeropsIdentityStatus.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import { make as makeMateKey } from "./ZeropsMateKey.ts";
import * as ZeropsOrgReadModule from "./ZeropsOrgRead.ts";
import {
  type LastGoodRead,
  make as makeWatch,
  planMembershipRecheck,
  recordIdentity,
  runMembershipRecheck,
  ZEROPS_SUBJECT_PREFIX,
  type MembershipRead,
} from "./ZeropsMembershipWatch.ts";
import * as ZeropsProjectAccessModule from "./ZeropsProjectAccess.ts";

const PROJECT_ID = "nTV3oMB2SS634ImDJnQckg";
const CLIENT_ID = "BkC8AGjFQMyFrLbzjHoE9g";
const JAN = "jan-user-id";
const EVA = "eva-user-id";
const MATE_KEY = "the-mates-own-zerops-key";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const environment = resolveZeropsEnvironment({
  projectId: PROJECT_ID,
  apiHost: undefined,
  apiToken: MATE_KEY,
})!;

const session = (sessionId: string, userId: string, ageMs = 0) => ({
  sessionId,
  subject: `${ZEROPS_SUBJECT_PREFIX}${userId}`,
  issuedAtEpochMs: NOW - ageMs,
});

const opens = (...userIds: ReadonlyArray<string>): MembershipRead => ({
  ok: true,
  opensFor: new Set(userIds),
});

const BLIND: MembershipRead = { ok: false };

describe("planMembershipRecheck", () => {
  const INTERVAL_MS = 5 * 60_000;
  /** The last good answer: this long ago, read by this Mate itself, or relayed by HQ. */
  const good = (agoMs: number) => ({ atMs: NOW - agoMs, relayed: false });
  const relayed = (agoMs: number) => ({ atMs: NOW - agoMs, relayed: true });
  // Everything that ends a session, and everything that does not. Each row is one pass: the
  // sessions live, what the read said, and when the last good answer before it was read.
  it.each(
    Array.from(
      [
        [
          "a member whose role still opens the door keeps their session",
          [session("s1", JAN)],
          opens(JAN),
          good(INTERVAL_MS),
          [],
        ],
        [
          "a removed member's session ends within one re-check",
          [session("s1", JAN)],
          opens(EVA),
          good(INTERVAL_MS),
          ["s1"],
        ],
        [
          "a lowered role ends it — the read simply stops naming them",
          [session("s1", JAN), session("s2", EVA)],
          opens(EVA),
          good(INTERVAL_MS),
          ["s1"],
        ],
        [
          "every device that person signed in from ends together",
          [session("s1", JAN), session("s2", JAN)],
          opens(),
          good(INTERVAL_MS),
          ["s1", "s2"],
        ],
        [
          "a failed read keeps sessions for one more interval",
          [session("s1", JAN)],
          BLIND,
          good(INTERVAL_MS),
          [],
        ],
        [
          "a second failed read in a row ends them",
          [session("s1", JAN)],
          BLIND,
          good(2 * INTERVAL_MS),
          ["s1"],
        ],
        // R6: HQ's relay held for one interval from its read already; with nothing answering after
        // it, the bound a removed person keeps their screen for is spent.
        [
          "HQ's relay past its hold with nothing answering ends them",
          [session("s1", JAN)],
          BLIND,
          relayed(INTERVAL_MS + 1),
          ["s1"],
        ],
        [
          "a session older than a day ends whatever the read said",
          [session("s1", JAN, DAY_MS + 1)],
          opens(JAN),
          good(INTERVAL_MS),
          ["s1"],
        ],
        [
          "and ends on a pass that could not read at all",
          [session("s1", JAN, DAY_MS + 1)],
          BLIND,
          good(INTERVAL_MS),
          ["s1"],
        ],
        [
          "a session one second short of a day stays",
          [session("s1", JAN, DAY_MS - 1_000)],
          opens(JAN),
          good(INTERVAL_MS),
          [],
        ],
      ] as const,
      ([name, sessions, read, lastGood, ended]) => ({
        title: name,
        sessions,
        read,
        lastGood,
        ended,
      }),
    ),
  )("$title", ({ sessions, read, lastGood, ended }) => {
    const plan = planMembershipRecheck({
      sessions,
      read,
      nowEpochMs: NOW,
      maxSessionAgeMs: DAY_MS,
      lastGood,
      intervalMs: INTERVAL_MS,
    });
    assert.deepStrictEqual([...plan.endSessions], [...ended]);
  });

  it("leaves sessions that did not come from the Zerops door alone", () => {
    const plan = planMembershipRecheck({
      sessions: [
        { sessionId: "paired", subject: "pairing:a-laptop", issuedAtEpochMs: NOW - DAY_MS * 30 },
        session("s1", JAN),
      ],
      read: opens(),
      nowEpochMs: NOW,
      maxSessionAgeMs: DAY_MS,
      lastGood: good(INTERVAL_MS),
      intervalMs: INTERVAL_MS,
    });
    assert.deepStrictEqual([...plan.endSessions], ["s1"]);
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const MEMBERS = {
  clientUserList: [
    { id: "cu-jan", userId: JAN, roleCode: "BASIC_USER", status: "ACTIVE" },
    { id: "cu-eva", userId: EVA, roleCode: "READ_ONLY", status: "ACTIVE" },
    { id: "cu-gone", userId: "gone", roleCode: "BASIC_USER", status: "INVITED" },
  ],
};

const readLayer = (
  route: (url: string) => Response,
  mateKey: ZeropsMateKeyModule.ZeropsMateKeyReader = ZeropsMateKeyModule.snapshotOnlyReader(
    MATE_KEY,
  ),
) => {
  const seen: Array<string | undefined> = [];
  const paths: Array<string> = [];
  const layer = ZeropsProjectAccessModule.layer.pipe(
    Layer.provideMerge(
      ZeropsOrgReadModule.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) => {
                seen.push(request.headers.authorization);
                paths.push(new URL(request.url).pathname);
                return Effect.succeed(HttpClientResponse.fromWeb(request, route(request.url)));
              }),
            ),
            Layer.succeed(ZeropsMateKeyModule.ZeropsMateKey, mateKey),
            ZeropsIdentityStatusModule.layer,
            ServerConfig.layer({ zerops: environment } as ServerConfig.ServerConfig["Service"]),
          ),
        ),
      ),
    ),
  );
  return { layer, seen, paths } as const;
};

const membershipRoute =
  (overrides: { readonly userRoles?: unknown; readonly memberStatus?: number } = {}) =>
  (url: string) => {
    if (url.endsWith(`/project/${PROJECT_ID}`)) {
      return json({ id: PROJECT_ID, clientId: CLIENT_ID, userRoles: overrides.userRoles ?? [] });
    }
    if (url.endsWith("/user/list")) return json(MEMBERS, overrides.memberStatus ?? 200);
    return json({ message: "unexpected route" }, 500);
  };

describe("recordIdentity", () => {
  it.effect("records the identity status of its own-project read", () => {
    const { layer } = readLayer(membershipRoute());
    return Effect.gen(function* () {
      yield* recordIdentity({ environment });
      const status = yield* ZeropsIdentityStatusModule.ZeropsIdentityStatus;
      const current = yield* status.current;
      assert.strictEqual(current.identity, "ok");
      assert.strictEqual(current.keySource, "snapshot");
    }).pipe(Effect.provide(layer));
  });
});

/** Just enough of the auth service for one pass to list and revoke. */
const fakeAuth = (
  sessions: ReadonlyArray<{ sessionId: string; subject: string }>,
  issuedAtEpochMs = NOW,
) => {
  const revoked: Array<string> = [];
  const service = {
    listSessions: () =>
      Effect.succeed(
        sessions.map((entry) => ({
          ...entry,
          issuedAt: { epochMilliseconds: issuedAtEpochMs },
        })),
      ),
    revokeSession: (sessionId: string) =>
      Effect.sync(() => {
        revoked.push(sessionId);
        return true;
      }),
  };
  return {
    layer: Layer.succeed(
      EnvironmentAuth.EnvironmentAuth,
      service as unknown as EnvironmentAuth.EnvironmentAuth["Service"],
    ),
    revoked,
  } as const;
};

describe("runMembershipRecheck", () => {
  /** The last good answer, one interval before the pass. */
  const lastGoodAt = (atMs: number) => Ref.make<LastGoodRead>({ atMs, relayed: false });

  it.effect("ends the sessions the plan named and keeps when its answer was read", () =>
    Effect.gen(function* () {
      const lastGood = yield* lastGoodAt(-300_000);
      const auth = fakeAuth([
        { sessionId: "jan", subject: `${ZEROPS_SUBJECT_PREFIX}${JAN}` },
        { sessionId: "eva", subject: `${ZEROPS_SUBJECT_PREFIX}${EVA}` },
      ]);
      const { layer } = readLayer(membershipRoute());
      const ended = yield* runMembershipRecheck({ environment, lastGood }).pipe(
        Effect.provide(Layer.mergeAll(auth.layer, layer)),
      );
      // Eva is READ_ONLY here: she keeps her row in the list and loses her seat.
      assert.strictEqual(ended, 1);
      assert.deepStrictEqual(auth.revoked, ["eva"]);
      assert.deepStrictEqual(yield* Ref.get(lastGood), { atMs: 0, relayed: false });
    }),
  );

  it.effect("keeps everyone on the first failed pass and ends them on the second", () =>
    Effect.gen(function* () {
      const lastGood = yield* lastGoodAt(0);
      const auth = fakeAuth([{ sessionId: "jan", subject: `${ZEROPS_SUBJECT_PREFIX}${JAN}` }]);
      const { layer } = readLayer(membershipRoute({ memberStatus: 500 }));
      const run = runMembershipRecheck({ environment, lastGood }).pipe(
        Effect.provide(Layer.mergeAll(auth.layer, layer)),
      );

      yield* TestClock.adjust(Duration.minutes(5));
      assert.strictEqual(yield* run, 0);
      assert.deepStrictEqual(auth.revoked, []);

      yield* TestClock.adjust(Duration.minutes(5));
      assert.strictEqual(yield* run, 1);
      assert.deepStrictEqual(auth.revoked, ["jan"]);
    }),
  );

  // R6: while HQ's relay holds, who the project lets in is its answer: the member list is not
  // read, and only the Mate's own project is, for the descriptor (S4).
  it.effect("reads no member list while HQ's relay holds", () =>
    Effect.gen(function* () {
      const lastGood = yield* lastGoodAt(-300_000);
      const auth = fakeAuth([
        { sessionId: "jan", subject: `${ZEROPS_SUBJECT_PREFIX}${JAN}` },
        { sessionId: "eva", subject: `${ZEROPS_SUBJECT_PREFIX}${EVA}` },
      ]);
      const { layer, paths } = readLayer(membershipRoute());
      const ended = yield* Effect.gen(function* () {
        yield* (yield* ZeropsProjectAccessModule.ZeropsProjectAccess).relayed({
          members: [{ userId: EVA, role: "OWNER", visibility: "open" }],
          ageMs: 60_000,
        });
        return yield* runMembershipRecheck({ environment, lastGood });
      }).pipe(Effect.provide(Layer.mergeAll(auth.layer, layer)));
      assert.strictEqual(ended, 1);
      assert.deepStrictEqual(auth.revoked, ["jan"]);
      assert.deepStrictEqual(paths, [`/api/rest/public/project/${PROJECT_ID}`]);
      assert.deepStrictEqual(yield* Ref.get(lastGood), { atMs: -60_000, relayed: true });
    }),
  );

  it.effect("reads nothing when nobody is signed in", () =>
    Effect.gen(function* () {
      const lastGood = yield* lastGoodAt(-600_000);
      const auth = fakeAuth([]);
      const { layer, seen } = readLayer(membershipRoute());
      const ended = yield* runMembershipRecheck({ environment, lastGood }).pipe(
        Effect.provide(Layer.mergeAll(auth.layer, layer)),
      );
      assert.strictEqual(ended, 0);
      assert.deepStrictEqual(seen, []);
      // Nobody to keep in: whoever signs in next is let in by the door's own answer.
      assert.deepStrictEqual(yield* Ref.get(lastGood), { atMs: 0, relayed: false });
    }),
  );

  it.effect("a rotated key does not end sessions", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-watch-key-rotate-" });
      const storePath = path.join(dir, "env.json");
      yield* fs.writeFileString(storePath, `{"ZCP_API_KEY":"old-key"}`);
      const mateKey = yield* makeMateKey({ fs, snapshot: MATE_KEY, storePath });

      const lastGood = yield* lastGoodAt(0);
      const auth = fakeAuth([{ sessionId: "jan", subject: `${ZEROPS_SUBJECT_PREFIX}${JAN}` }]);
      const seen: Array<string | undefined> = [];
      const layer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.gen(function* () {
            const authorization = request.headers.authorization;
            seen.push(authorization);
            const token = authorization?.replace("Bearer ", "");
            if (token === "old-key") {
              // Rotated on the platform the instant the old key is rejected —
              // mirrors the client's hardening step moving the key mid-flight.
              yield* fs.writeFileString(storePath, `{"ZCP_API_KEY":"new-key"}`).pipe(Effect.orDie);
              return HttpClientResponse.fromWeb(request, json({ message: "unauthorized" }, 401));
            }
            return HttpClientResponse.fromWeb(request, membershipRoute()(request.url));
          }),
        ),
      );

      const ended = yield* runMembershipRecheck({ environment, lastGood }).pipe(
        Effect.provide(
          ZeropsProjectAccessModule.layer.pipe(
            Layer.provideMerge(
              ZeropsOrgReadModule.layer.pipe(
                Layer.provideMerge(
                  Layer.mergeAll(
                    auth.layer,
                    layer,
                    ServerConfig.layer({
                      zerops: environment,
                    } as ServerConfig.ServerConfig["Service"]),
                  ),
                ),
              ),
            ),
          ),
        ),
        Effect.provideService(ZeropsMateKeyModule.ZeropsMateKey, mateKey),
        Effect.provide(ZeropsIdentityStatusModule.layer),
      );
      assert.strictEqual(ended, 0);
      assert.deepStrictEqual(auth.revoked, []);
      // The own-key calls hit the rejected key once each before retrying —
      // never the presented-token path, and never a third attempt.
      assert.isTrue(seen.some((header) => header === "Bearer new-key"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("the re-check loop", () => {
  // As the counter it replaced: a pass at start that cannot say is the one tolerated, and the next
  // one that cannot ends every session.
  it.effect("ends every session on the second pass from start that cannot say", () =>
    Effect.gen(function* () {
      const { layer } = readLayer(membershipRoute({ memberStatus: 500 }));
      const auth = fakeAuth([{ sessionId: "jan", subject: `${ZEROPS_SUBJECT_PREFIX}${JAN}` }]);
      yield* Effect.gen(function* () {
        yield* makeWatch;
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(auth.revoked, [], "the first pass is tolerated");
        yield* TestClock.adjust(environment.roleRecheckInterval);
        assert.deepStrictEqual(auth.revoked, ["jan"]);
      }).pipe(Effect.provide(Layer.mergeAll(layer, auth.layer)));
    }).pipe(Effect.scoped),
  );

  // R6: HQ relaying a different answer is a removal landing now, not at the next interval.
  it.effect("runs a pass at once when HQ relays a different answer", () =>
    Effect.gen(function* () {
      const { layer } = readLayer(membershipRoute());
      const auth = fakeAuth([{ sessionId: "jan", subject: `${ZEROPS_SUBJECT_PREFIX}${JAN}` }]);
      yield* Effect.gen(function* () {
        yield* makeWatch;
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(auth.revoked, []);
        yield* (yield* ZeropsProjectAccessModule.ZeropsProjectAccess).relayed({
          members: [{ userId: EVA, role: "OWNER", visibility: "open" }],
          ageMs: 0,
        });
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(auth.revoked, ["jan"]);
      }).pipe(Effect.provide(Layer.mergeAll(layer, auth.layer)));
    }).pipe(Effect.scoped),
  );

  // The worst case the bound has to survive: the role is lowered just after a
  // pass, the next pass cannot read, and the configured interval is above the
  // ceiling. The session still ends within two clamped intervals.
  const clamped = resolveZeropsEnvironment({
    projectId: PROJECT_ID,
    apiHost: undefined,
    apiToken: MATE_KEY,
    roleRecheckSeconds: 3_600,
  })!;
  const LOWERED = {
    clientUserList: MEMBERS.clientUserList.map((member) =>
      member.userId === JAN ? { ...member, roleCode: "READ_ONLY" } : member,
    ),
  };

  it.effect.each(
    Array.from(
      [
        ["the second pass reads", "reads"],
        ["the second pass fails", "fails"],
      ] as const,
      ([label, secondPass]) => ({
        title: `a lowered role ends the session within two recheck intervals whether or not the second pass reads (${label})`,
        secondPass,
      }),
    ),
  )("$title", ({ secondPass }) =>
    Effect.gen(function* () {
      let members: { readonly status: number; readonly body: unknown } = {
        status: 200,
        body: MEMBERS,
      };
      const { layer, seen } = readLayer((url) =>
        url.endsWith("/user/list")
          ? json(members.body, members.status)
          : json({ id: PROJECT_ID, clientId: CLIENT_ID, userRoles: [] }),
      );
      const auth = fakeAuth([{ sessionId: "jan", subject: `${ZEROPS_SUBJECT_PREFIX}${JAN}` }]);
      yield* makeWatch.pipe(
        Effect.provide(
          Layer.mergeAll(
            layer,
            auth.layer,
            ServerConfig.layer({ zerops: clamped } as ServerConfig.ServerConfig["Service"]),
          ),
        ),
      );
      yield* TestClock.adjust(Duration.zero);
      assert.strictEqual(seen.length, 2, "the first pass ran at start");
      assert.deepStrictEqual(auth.revoked, []);

      // Lowered right after that pass; the next one cannot read.
      members = { status: 500, body: LOWERED };
      yield* TestClock.adjust(Duration.seconds(300));
      assert.deepStrictEqual(auth.revoked, [], "one failed pass is tolerated");

      members = secondPass === "reads" ? { status: 200, body: LOWERED } : members;
      yield* TestClock.adjust(Duration.seconds(300));
      assert.deepStrictEqual(auth.revoked, ["jan"]);
    }).pipe(Effect.scoped),
  );
});
