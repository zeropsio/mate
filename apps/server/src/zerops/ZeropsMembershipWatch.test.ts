import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import {
  planMembershipRecheck,
  readProjectMembership,
  runMembershipRecheck,
  ZEROPS_SUBJECT_PREFIX,
  type MembershipRead,
} from "./ZeropsMembershipWatch.ts";

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
  allowedOrigins: [],
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
  // Everything that ends a session, and everything that does not. Each row is
  // one pass: the sessions live, what the two reads said, and how many passes
  // in a row had already failed before it.
  for (const [name, sessions, read, failures, ended, nextFailures] of [
    [
      "a member whose role still opens the door keeps their session",
      [session("s1", JAN)],
      opens(JAN),
      0,
      [],
      0,
    ],
    [
      "a removed member's session ends within one re-check",
      [session("s1", JAN)],
      opens(EVA),
      0,
      ["s1"],
      0,
    ],
    [
      "a lowered role ends it — the read simply stops naming them",
      [session("s1", JAN), session("s2", EVA)],
      opens(EVA),
      0,
      ["s1"],
      0,
    ],
    [
      "every device that person signed in from ends together",
      [session("s1", JAN), session("s2", JAN)],
      opens(),
      0,
      ["s1", "s2"],
      0,
    ],
    ["a failed read keeps sessions for one more interval", [session("s1", JAN)], BLIND, 0, [], 1],
    ["a second failed read in a row ends them", [session("s1", JAN)], BLIND, 1, ["s1"], 2],
    [
      "a read that works resets the count, so the next failure is a first one again",
      [session("s1", JAN)],
      opens(JAN),
      1,
      [],
      0,
    ],
    [
      "a session older than a day ends whatever the read said",
      [session("s1", JAN, DAY_MS + 1)],
      opens(JAN),
      0,
      ["s1"],
      0,
    ],
    [
      "and ends on a pass that could not read at all",
      [session("s1", JAN, DAY_MS + 1)],
      BLIND,
      0,
      ["s1"],
      1,
    ],
    [
      "a session one second short of a day stays",
      [session("s1", JAN, DAY_MS - 1_000)],
      opens(JAN),
      0,
      [],
      0,
    ],
  ] as const) {
    it(name, () => {
      const plan = planMembershipRecheck({
        sessions,
        read,
        nowEpochMs: NOW,
        maxSessionAgeMs: DAY_MS,
        failures,
      });
      assert.deepStrictEqual([...plan.endSessions], [...ended]);
      assert.strictEqual(plan.failures, nextFailures);
    });
  }

  it("leaves sessions that did not come from the Zerops door alone", () => {
    const plan = planMembershipRecheck({
      sessions: [
        { sessionId: "paired", subject: "pairing:a-laptop", issuedAtEpochMs: NOW - DAY_MS * 30 },
        session("s1", JAN),
      ],
      read: opens(),
      nowEpochMs: NOW,
      maxSessionAgeMs: DAY_MS,
      failures: 0,
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

const readLayer = (route: (url: string) => Response) => {
  const seen: Array<string | undefined> = [];
  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      seen.push(request.headers.authorization);
      return Effect.succeed(HttpClientResponse.fromWeb(request, route(request.url)));
    }),
  );
  return { layer, seen } as const;
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

describe("readProjectMembership", () => {
  it.effect("names every member the door would open for, and reads as the Mate", () => {
    const { layer, seen } = readLayer(membershipRoute());
    return readProjectMembership({ environment }).pipe(
      Effect.tap((read) =>
        Effect.sync(() => {
          assert.isTrue(read.ok);
          assert.deepStrictEqual(read.ok ? [...read.opensFor] : [], [JAN]);
          // Two reads a pass, however many people are signed in, and never
          // anyone's token but the Mate's own.
          assert.deepStrictEqual(seen, [`Bearer ${MATE_KEY}`, `Bearer ${MATE_KEY}`]);
        }),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("lets a project override open the door for an org READ_ONLY member", () => {
    const { layer } = readLayer(
      membershipRoute({ userRoles: [{ clientUserId: "cu-eva", roleCode: "OWNER" }] }),
    );
    return readProjectMembership({ environment }).pipe(
      Effect.tap((read) =>
        Effect.sync(() =>
          assert.deepStrictEqual(
            read.ok ? [...read.opensFor].toSorted() : [],
            [EVA, JAN].toSorted(),
          ),
        ),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("answers nothing at all when a read fails", () => {
    const { layer } = readLayer(membershipRoute({ memberStatus: 500 }));
    return readProjectMembership({ environment }).pipe(
      Effect.tap((read) => Effect.sync(() => assert.isFalse(read.ok))),
      Effect.provide(layer),
    );
  });

  it.effect("reads an empty member list as an outage, never as a lockout", () => {
    const { layer } = readLayer((url) =>
      url.endsWith("/user/list")
        ? json({ clientUserList: [] })
        : json({ id: PROJECT_ID, clientId: CLIENT_ID }),
    );
    return readProjectMembership({ environment }).pipe(
      Effect.tap((read) => Effect.sync(() => assert.isFalse(read.ok))),
      Effect.provide(layer),
    );
  });

  it.effect("makes no call at all when this Mate has no key of its own", () => {
    const { layer, seen } = readLayer(membershipRoute());
    const keyless = resolveZeropsEnvironment({
      projectId: PROJECT_ID,
      apiHost: undefined,
      allowedOrigins: [],
    })!;
    return readProjectMembership({ environment: keyless }).pipe(
      Effect.tap((read) =>
        Effect.sync(() => {
          assert.isFalse(read.ok);
          assert.deepStrictEqual(seen, []);
        }),
      ),
      Effect.provide(layer),
    );
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
  it.effect("ends the sessions the plan named and carries the failure count", () =>
    Effect.gen(function* () {
      const failures = yield* Ref.make(0);
      const auth = fakeAuth([
        { sessionId: "jan", subject: `${ZEROPS_SUBJECT_PREFIX}${JAN}` },
        { sessionId: "eva", subject: `${ZEROPS_SUBJECT_PREFIX}${EVA}` },
      ]);
      const { layer } = readLayer(membershipRoute());
      const ended = yield* runMembershipRecheck({ environment, failures }).pipe(
        Effect.provide(Layer.mergeAll(auth.layer, layer)),
      );
      // Eva is READ_ONLY here: she keeps her row in the list and loses her seat.
      assert.strictEqual(ended, 1);
      assert.deepStrictEqual(auth.revoked, ["eva"]);
      assert.strictEqual(yield* Ref.get(failures), 0);
    }),
  );

  it.effect("keeps everyone on the first failed pass and ends them on the second", () =>
    Effect.gen(function* () {
      const failures = yield* Ref.make(0);
      const auth = fakeAuth([{ sessionId: "jan", subject: `${ZEROPS_SUBJECT_PREFIX}${JAN}` }]);
      const { layer } = readLayer(membershipRoute({ memberStatus: 500 }));
      const run = runMembershipRecheck({ environment, failures }).pipe(
        Effect.provide(Layer.mergeAll(auth.layer, layer)),
      );

      assert.strictEqual(yield* run, 0);
      assert.deepStrictEqual(auth.revoked, []);
      assert.strictEqual(yield* Ref.get(failures), 1);

      assert.strictEqual(yield* run, 1);
      assert.deepStrictEqual(auth.revoked, ["jan"]);
    }),
  );

  it.effect("reads nothing when nobody is signed in", () =>
    Effect.gen(function* () {
      const failures = yield* Ref.make(0);
      const auth = fakeAuth([]);
      const { layer, seen } = readLayer(membershipRoute());
      const ended = yield* runMembershipRecheck({ environment, failures }).pipe(
        Effect.provide(Layer.mergeAll(auth.layer, layer)),
      );
      assert.strictEqual(ended, 0);
      assert.deepStrictEqual(seen, []);
    }),
  );
});
