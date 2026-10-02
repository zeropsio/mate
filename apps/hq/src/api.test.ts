import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { type FakeWorld, emptyWorld, fakeZeropsApi } from "../test/harness/zeropsFake.ts";
import { coreRoutes, coreServices } from "./core.ts";
import { treeMigrations } from "./migrationFiles.ts";
import { ZeropsApi, type ZeropsMember, type ZeropsOwnToken } from "./zerops/api.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));

const HQ = "HQ1";
const ADDRESS = "https://hq.test";
const CLIENT = "https://mate.zerops.io";

const person = (userId: string, roleCode: string): ZeropsMember => ({
  name: userId,
  kind: "person",
  roleCode,
  status: "ACTIVE",
  userId,
  clientUserId: `C-${userId}`,
  canCreateProjects: false,
});

const tokenRecord = (patch: Partial<ZeropsOwnToken>): Omit<ZeropsOwnToken, "readAtMs"> => ({
  id: "T",
  name: "",
  orgId: "ORG",
  roleCode: "NO_ACCESS",
  canCreateProjects: false,
  canViewFinances: false,
  canEditFinances: false,
  projects: [],
  createdMs: 0,
  createdByUser: null,
  ...patch,
});

/** The rig in miniature: HQ's token and anchor, an owner, a Developer, the HQ project and a Mate's. */
const world = (now: number, anchored: boolean, orgId: string): FakeWorld => {
  const fake = emptyWorld();
  fake.tokens.set(
    "hq",
    tokenRecord({ id: "T-hq", orgId, name: `mate-hq-org:${HQ}`, roleCode: "READ_ONLY" }),
  );
  const door = (value: string, createdByUser: string, patch: Partial<ZeropsOwnToken> = {}) =>
    fake.tokens.set(
      value,
      tokenRecord({
        id: value,
        orgId,
        name: `mate-door:${HQ}:n0nce`,
        createdMs: now,
        createdByUser,
        ...patch,
      }),
    );
  door("door-owner", "owner");
  door("door-owner-2", "owner");
  door("door-dev", "dev");
  door("door-flagged", "owner", { canCreateProjects: true });
  door("door-stale", "owner", { createdMs: now - 10 * 60_000 });
  fake.members.set(orgId, [
    person("owner", "OWNER"),
    person("dev", "NO_ACCESS"),
    { ...person("T-hq", "READ_ONLY"), name: `mate-hq-org:${HQ}`, kind: "token" },
    ...(anchored
      ? [
          {
            ...person("T-anchor", "ADMIN"),
            name: `mate-hq:${HQ}:${ADDRESS}`,
            kind: "token" as const,
          },
        ]
      : []),
  ]);
  for (const id of [HQ, "P_MATE"]) {
    fake.projects.push({ id, orgId, name: id, status: "ACTIVE", tags: [], userRoles: [] });
  }
  return fake;
};

/**
 * Core on a fresh database (or `url`'s), as a fetch handler; requests as `{ status, body, headers }`.
 * `stop` ends it before the test does.
 */
const startCore = (anchored: boolean, given?: { readonly url: string; readonly orgId: string }) =>
  Effect.gen(function* () {
    const url = given?.url ?? (yield* (yield* TempPostgres).createDatabase);
    const fake = world(yield* Clock.currentTimeMillis, anchored, given?.orgId ?? "ORG");
    const options = {
      databaseUrl: Redacted.make(url),
      migrations: treeMigrations(),
      hqProjectId: HQ,
      address: ADDRESS,
      credential: Option.some(Redacted.make("hq")),
      clientOrigins: [CLIENT, "http://localhost:4380"],
      build: "test",
      heartbeat: Duration.millis(100),
      retryAfter: Duration.millis(100),
    };
    const { handler, dispose } = HttpRouter.toWebHandler(
      coreRoutes(options).pipe(
        Layer.provideMerge(coreServices(options)),
        Layer.provide(Layer.succeed(ZeropsApi, fakeZeropsApi(fake))),
      ),
    );
    const stop = Effect.promise(() => dispose());
    yield* Effect.addFinalizer(() => stop);
    const call = (
      method: string,
      path: string,
      options: {
        readonly body?: unknown;
        readonly session?: string;
        readonly headers?: Record<string, string>;
      } = {},
    ) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://hq.test${path}`, {
            method,
            headers: {
              ...(options.body === undefined ? {} : { "content-type": "application/json" }),
              ...(options.session === undefined
                ? {}
                : { authorization: `Bearer ${options.session}` }),
              ...options.headers,
            },
            ...(options.body === undefined ? {} : { body: encodeJson(options.body) }),
          }),
          Context.empty(),
        );
        const text = await response.text();
        return {
          status: response.status,
          body: text === "" ? null : decodeJson(text),
          headers: response.headers,
        };
      });
    return { call, fake, url, stop };
  });

type Call = Effect.Success<ReturnType<typeof startCore>>["call"];

const untilHealth = (call: Call, state: string) =>
  call("GET", "/health").pipe(
    Effect.filterOrFail(
      (response) => (response.body as { readonly state: string }).state === state,
    ),
    Effect.retry(Schedule.spaced(Duration.millis(50))),
    Effect.timeout(Duration.seconds(10)),
  );

const sessionFor = (call: Call, token: string) =>
  Effect.map(call("POST", "/api/door", { body: { token } }), (response) => {
    assert.strictEqual(response.status, 200);
    return (response.body as { readonly session: string }).session;
  });

describe("HQ API", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "an owner comes through the door, creates an application, attaches a Mate and reads it",
      () =>
        Effect.gen(function* () {
          const { call } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          const created = yield* call("POST", "/api/apps", { session, body: { name: "Shop" } });
          assert.strictEqual(created.status, 201);
          const appId = (created.body as { readonly id: string }).id;
          const attached = yield* call("POST", `/api/apps/${appId}/projects`, {
            session,
            body: { projectId: "P_MATE", kind: "mate", mate: { name: "Ada", face: "face-3" } },
          });
          assert.strictEqual(attached.status, 201);
          assert.deepStrictEqual((yield* call("GET", "/api/structure", { session })).body, {
            apps: [
              {
                id: appId,
                name: "Shop",
                projects: [
                  {
                    projectId: "P_MATE",
                    name: "P_MATE",
                    kind: "mate",
                    mate: { name: "Ada", face: "face-3" },
                  },
                ],
              },
            ],
          });
        }),
    );

    it.effect(
      "a Developer comes through, may not create, and sees nothing Zerops hides from them",
      () =>
        Effect.gen(function* () {
          const { call } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
          const dev = yield* sessionFor(call, "door-dev");
          const refused = yield* call("POST", "/api/apps", {
            session: dev,
            body: { name: "Mine" },
          });
          // The refusal says what and why, nothing of the server's own types.
          assert.deepStrictEqual(
            [refused.status, refused.body],
            [
              403,
              { code: "forbidden", message: "Only an org owner or admin changes the structure." },
            ],
          );
          assert.deepStrictEqual((yield* call("GET", "/api/structure", { session: dev })).body, {
            apps: [],
          });
        }),
    );

    it.effect(
      "refuses a token that is no fresh throwaway with one code, and a call without a live session",
      () =>
        Effect.gen(function* () {
          const { call } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const answers = yield* Effect.all([
            call("POST", "/api/door", { body: { token: "door-flagged" } }),
            call("POST", "/api/door", { body: { token: "door-stale" } }),
            call("POST", "/api/door", { body: { token: "unknown" } }),
            call("POST", "/api/door", { body: { nope: true } }),
            call("GET", "/api/structure"),
            call("GET", "/api/structure", { session: "forged" }),
          ]);
          assert.deepStrictEqual(
            answers.map((answer) => [
              answer.status,
              (answer.body as { readonly code: string }).code,
            ]),
            [
              [401, "zerops_throwaway_required"],
              [401, "zerops_throwaway_required"],
              [401, "zerops_throwaway_required"],
              [400, "invalid"],
              [401, "session_required"],
              [401, "session_required"],
            ],
          );
          const session = yield* sessionFor(call, "door-owner");
          assert.strictEqual((yield* call("DELETE", "/api/session", { session })).status, 204);
          assert.strictEqual((yield* call("GET", "/api/structure", { session })).status, 401);
        }),
    );

    it.effect(
      "answers 503 while Zerops gives an empty member list, never a refusal or nothing",
      () =>
        Effect.gen(function* () {
          const { call, fake } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          fake.members.set("ORG", []);
          const answers = yield* Effect.all([
            call("POST", "/api/apps", { session, body: { name: "Two" } }),
            call("POST", "/api/door", { body: { token: "door-dev" } }),
          ]);
          assert.deepStrictEqual(
            answers.map((answer) => [
              answer.status,
              (answer.body as { readonly code: string }).code,
            ]),
            [
              [503, "zerops_unavailable"],
              [503, "zerops_unavailable"],
            ],
          );
        }),
    );

    it.effect("opens one session per throwaway: its replay is refused", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(true);
        yield* untilHealth(call, "active");
        yield* sessionFor(call, "door-owner");
        const replay = yield* call("POST", "/api/door", { body: { token: "door-owner" } });
        assert.deepStrictEqual(
          [replay.status, (replay.body as { readonly code: string }).code],
          [401, "zerops_throwaway_required"],
        );
      }),
    );

    it.effect("judges a presented token before spending HQ's own credential on it", () =>
      Effect.gen(function* () {
        const { call, fake } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const spent = () => fake.calls.filter((entry) => entry.endsWith(":hq")).length;
        const before = spent();
        for (const token of ["door-flagged", "door-stale", "unknown"]) {
          yield* call("POST", "/api/door", { body: { token } });
        }
        assert.strictEqual(spent(), before);
      }),
    );

    it.effect("limits the door per client address, and bounds every body", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const knock = (ip: string) =>
          Effect.map(
            call("POST", "/api/door", { body: { token: "unknown" }, headers: { "x-real-ip": ip } }),
            (answer) => answer.status,
          );
        const statuses = yield* Effect.forEach(Array.from({ length: 11 }), () => knock("10.0.0.1"));
        assert.deepStrictEqual(statuses, [...Array(10).fill(401), 429]);
        assert.strictEqual(yield* knock("10.0.0.2"), 401);

        const session = yield* sessionFor(call, "door-owner");
        const tooLarge = yield* Effect.all([
          call("POST", "/api/door", { body: { token: "x".repeat(9000) } }),
          call("POST", "/api/apps", { session, body: { name: "x".repeat(70_000) } }),
          // Refused on its declared length, before a byte is read: no socket is cut.
          call("POST", "/api/door", {
            body: { token: "x" },
            headers: { "content-length": "100000" },
          }),
        ]);
        assert.deepStrictEqual(
          tooLarge.map((answer) => [
            answer.status,
            (answer.body as { readonly code: string }).code,
          ]),
          [
            [413, "too_large"],
            [413, "too_large"],
            [413, "too_large"],
          ],
        );
      }),
    );

    it.effect("ends a session whose organization is no longer this HQ's", () =>
      Effect.gen(function* () {
        const first = yield* startCore(true);
        yield* untilHealth(first.call, "active");
        const session = yield* sessionFor(first.call, "door-owner");
        yield* first.stop;
        // HQ restarts with a credential of another org, where the same people are members.
        const moved = yield* startCore(true, { url: first.url, orgId: "ORG2" });
        yield* untilHealth(moved.call, "active");
        const answer = yield* moved.call("POST", "/api/apps", { session, body: { name: "Moved" } });
        assert.deepStrictEqual(
          [answer.status, (answer.body as { readonly code: string }).code],
          [401, "session_required"],
        );
        assert.strictEqual((yield* sessionFor(moved.call, "door-owner-2")).length, 43);
      }),
    );

    it.effect("answers a client origin's preflight, and no other origin", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(true);
        const preflight = (origin: string) =>
          call("OPTIONS", "/api/structure", {
            headers: {
              origin,
              "access-control-request-method": "GET",
              "access-control-request-headers": "authorization",
            },
          });
        const allowed = yield* preflight(CLIENT);
        assert.isBelow(allowed.status, 300);
        assert.strictEqual(allowed.headers.get("access-control-allow-origin"), CLIENT);
        assert.strictEqual(
          (yield* preflight("http://localhost:4380")).headers.get("access-control-allow-origin"),
          "http://localhost:4380",
        );
        assert.isNull(
          (yield* preflight("https://evil.example")).headers.get("access-control-allow-origin"),
        );
      }),
    );

    it.effect("an HQ that is not the official one answers its API 503 not_active", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(false);
        yield* untilHealth(call, "standby");
        const door = yield* call("POST", "/api/door", { body: { token: "door-owner" } });
        assert.deepStrictEqual(
          [door.status, (door.body as { readonly code: string }).code],
          [503, "not_active"],
        );
      }),
    );
  });
});
