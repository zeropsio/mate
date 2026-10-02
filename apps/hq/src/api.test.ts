// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off -- the tests reach Core as a client does: over HTTP and a WebSocket.
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as HttpServer from "effect/unstable/http/HttpServer";

import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { type FakeWorld, emptyWorld, fakeZeropsApi } from "../test/harness/zeropsFake.ts";
import { coreApp } from "./core.ts";
import { treeMigrations } from "./migrationFiles.ts";
import { ZeropsApi, type ZeropsMember, type ZeropsOwnToken } from "./zerops/api.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));

const HQ = "HQ1";
const ADDRESS = "https://hqzone.prg1-zerops.zone";
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
  door("door-reader", "reader");
  door("door-other-org", "owner", { orgId: "ORG2" });
  door("door-wrong-name", "owner", { name: "mate-door:ELSEWHERE:n0nce" });
  door("door-invited", "invitee");
  door("door-stale", "owner", { createdMs: now - 10 * 60_000 });
  fake.members.set(orgId, [
    person("owner", "OWNER"),
    person("dev", "NO_ACCESS"),
    person("reader", "READ_ONLY"),
    { ...person("invitee", "ADMIN"), status: "INVITED" },
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
    fake.projects.push({
      id,
      orgId,
      name: id,
      status: "ACTIVE",
      tags: [],
      userRoles: [],
      publicZone: id === HQ ? "hqzone.prg1-zerops.zone" : `${id}.prg1-zerops.zone`,
    });
  }
  return fake;
};

/**
 * Core on a fresh database (or `url`'s), served over a real Node server on a free port, as the
 * container serves it; requests as `{ status, body, headers }`. `stop` ends it — drain included —
 * before the test does.
 */
const startCore = (anchored: boolean, given?: { readonly url: string; readonly orgId: string }) =>
  Effect.gen(function* () {
    const url = given?.url ?? (yield* (yield* TempPostgres).createDatabase);
    const fake = world(yield* Clock.currentTimeMillis, anchored, given?.orgId ?? "ORG");
    const options = {
      databaseUrl: Redacted.make(url),
      migrations: treeMigrations(),
      hqProjectId: HQ,
      credential: Option.some(Redacted.make("hq")),
      clientOrigins: [CLIENT, "http://localhost:4380"],
      build: "test",
      drainFor: Duration.millis(300),
      heartbeat: Duration.millis(100),
      retryAfter: Duration.millis(100),
      viewTtl: Duration.millis(200),
      reconcileEvery: Duration.millis(200),
      streamRecheck: Duration.millis(200),
      pingEvery: Duration.millis(300),
    };
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      coreApp(options).pipe(
        Layer.provide(Layer.succeed(ZeropsApi, fakeZeropsApi(fake))),
        Layer.provideMerge(NodeHttpServer.layer(() => NodeHttp.createServer(), { port: 0 })),
      ),
      scope,
    );
    const address = Context.get(context, HttpServer.HttpServer).address;
    const base = `127.0.0.1:${String("port" in address ? address.port : 0)}`;
    const stop = Scope.close(scope, Exit.void);
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
        const response = await fetch(`http://${base}${path}`, {
          method,
          headers: {
            ...(options.body === undefined ? {} : { "content-type": "application/json" }),
            ...(options.session === undefined
              ? {}
              : { authorization: `Bearer ${options.session}` }),
            ...options.headers,
          },
          ...(options.body === undefined ? {} : { body: encodeJson(options.body) }),
        });
        const text = await response.text();
        return {
          status: response.status,
          body: text === "" ? null : decodeJson(text),
          headers: response.headers,
        };
      });
    /** A WebSocket to `path`: its messages one by one, its close, a pong for every ping while `answering`. */
    const socket = (path: string) =>
      Effect.gen(function* () {
        const messages: Array<{ readonly type: string }> = [];
        const pings = { seen: 0, answering: true };
        let closed: { readonly code: number } | undefined;
        const ws = new WebSocket(`ws://${base}${path}`);
        ws.addEventListener("message", (event) => {
          const message = decodeJson(String(event.data)) as { readonly type: string };
          if (message.type !== "ping") messages.push(message);
          else {
            pings.seen += 1;
            if (pings.answering) ws.send(encodeJson({ type: "pong" }));
          }
        });
        ws.addEventListener("close", (event) => {
          closed = { code: event.code };
        });
        const opened = yield* Effect.promise(
          () =>
            new Promise<boolean>((resolve) => {
              ws.addEventListener("open", () => resolve(true));
              ws.addEventListener("error", () => resolve(false));
            }),
        );
        const until = <A>(found: () => A | undefined, what: string) =>
          Effect.suspend(() => {
            const value = found();
            return value === undefined ? Effect.fail(what) : Effect.succeed(value);
          }).pipe(
            Effect.retry(Schedule.spaced(Duration.millis(20))),
            Effect.timeout(Duration.seconds(5)),
            Effect.orDie,
          );
        const next = (type: "snapshot" | "change") =>
          until(() => {
            const found = messages.findIndex((message) => message.type === type);
            return found < 0 ? undefined : messages.splice(0, found + 1).at(-1);
          }, type).pipe(Effect.map(({ type: _type, ...rest }) => rest));
        return {
          opened,
          pings,
          next,
          /** What arrived within `window`. */
          quiet: (window: Duration.Input) =>
            Effect.andThen(
              Effect.sleep(window),
              Effect.sync(() => [...messages]),
            ),
          closedWith: until(() => closed?.code, "close"),
          close: Effect.sync(() => ws.close()),
        };
      });
    return { call, fake, url, stop, socket };
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

/** A one-use ticket for `session`'s socket. */
const ticketFor = (call: Call, session: string) =>
  Effect.map(
    call("POST", "/api/stream-ticket", { session }),
    (response) => (response.body as { readonly ticket: string }).ticket,
  );

/** The owner sets `projectId` up as a Mate in no application: what makes it enrollable. */
const setUpMate = (call: Call, projectId: string) =>
  Effect.gen(function* () {
    const session = yield* sessionFor(call, "door-owner");
    const created = yield* call("POST", "/api/mates", {
      session,
      body: { projectId, name: "Ada", face: "face-1" },
    });
    assert.strictEqual(created.status, 201);
  });

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
            ungrouped: [],
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
            [403, { code: "forbidden", reason: "not_structure_writer" }],
          );
          assert.deepStrictEqual((yield* call("GET", "/api/structure", { session: dev })).body, {
            ungrouped: [],
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
        // Refused on their declared length, before a byte is read: no connection is cut.
        const tooLarge = yield* Effect.all([
          call("POST", "/api/door", { body: { token: "x".repeat(9000) } }),
          call("POST", "/api/apps", { session, body: { name: "x".repeat(70_000) } }),
        ]);
        assert.deepStrictEqual(
          tooLarge.map((answer) => [
            answer.status,
            (answer.body as { readonly code: string }).code,
          ]),
          [
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

    it.effect(
      "streams the caller's structure over a WebSocket: a snapshot, then each change, pings answered",
      () =>
        Effect.gen(function* () {
          const { call, fake, socket } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          const owner = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, session)}`,
          );
          assert.deepStrictEqual(
            yield* owner.next("snapshot"),
            (yield* call("GET", "/api/structure", { session })).body,
          );
          const appId = (
            (yield* call("POST", "/api/apps", { session, body: { name: "Shop" } })).body as {
              readonly id: string;
            }
          ).id;
          assert.deepStrictEqual(yield* owner.next("change"), {
            key: appId,
            value: { id: appId, name: "Shop", projects: [] },
          });
          yield* call("POST", `/api/apps/${appId}/projects`, {
            session,
            body: { projectId: "P_MATE", kind: "mate", mate: { name: "Ada", face: "sky:flower" } },
          });
          const shopWith = (mate: { readonly name: string; readonly face: string }) => ({
            key: appId,
            value: {
              id: appId,
              name: "Shop",
              projects: [{ projectId: "P_MATE", name: "P_MATE", kind: "mate", mate }],
            },
          });
          assert.deepStrictEqual(
            yield* owner.next("change"),
            shopWith({ name: "Ada", face: "sky:flower" }),
          );
          yield* call("PATCH", "/api/mates/P_MATE", { session, body: { name: "Ada 2" } });
          assert.deepStrictEqual(
            yield* owner.next("change"),
            shopWith({ name: "Ada 2", face: "sky:flower" }),
          );

          // Deleted in Zerops: the reconcile drops it, and the socket says so.
          fake.projects.splice(
            fake.projects.findIndex((project) => project.id === "P_MATE"),
            1,
          );
          assert.deepStrictEqual(yield* owner.next("change"), {
            key: appId,
            value: { id: appId, name: "Shop", projects: [] },
          });
          // Three pings answered: still open.
          yield* Effect.sleep(Duration.millis(1100));
          assert.isAtLeast(owner.pings.seen, 3);
          assert.deepStrictEqual(yield* owner.quiet("1 millis"), []);
          yield* owner.close;
        }),
    );

    it.effect(
      "sets a Mate up, renames an application and moves the Mate: each change on the socket",
      () =>
        Effect.gen(function* () {
          const { call, socket } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          const owner = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, session)}`,
          );
          assert.deepStrictEqual(yield* owner.next("snapshot"), { ungrouped: [], apps: [] });
          const ada = { name: "Ada", face: "sky:flower" };
          const lone = [{ projectId: "P_MATE", name: "P_MATE", mate: ada }];

          const setUp = yield* call("POST", "/api/mates", {
            session,
            body: { projectId: "P_MATE", ...ada },
          });
          assert.deepStrictEqual(
            [setUp.status, setUp.body],
            [201, { projectId: "P_MATE", ...ada }],
          );
          assert.deepStrictEqual(yield* owner.next("change"), { key: "ungrouped", value: lone });

          const appId = (
            (yield* call("POST", "/api/apps", { session, body: { name: "Shop" } })).body as {
              readonly id: string;
            }
          ).id;
          yield* owner.next("change");
          const renamed = yield* call("PATCH", `/api/apps/${appId}`, {
            session,
            body: { name: "Store" },
          });
          assert.deepStrictEqual(
            [renamed.status, renamed.body],
            [200, { id: appId, name: "Store" }],
          );
          assert.deepStrictEqual(yield* owner.next("change"), {
            key: appId,
            value: { id: appId, name: "Store", projects: [] },
          });

          const moved = yield* call("PUT", "/api/projects/P_MATE/app", {
            session,
            body: { appId, kind: "mate" },
          });
          assert.deepStrictEqual(
            [moved.status, moved.body],
            [200, { projectId: "P_MATE", appId, kind: "mate" }],
          );
          assert.sameDeepMembers(
            [yield* owner.next("change"), yield* owner.next("change")] as Array<object>,
            [
              { key: "ungrouped", value: [] },
              {
                key: appId,
                value: {
                  id: appId,
                  name: "Store",
                  projects: [{ projectId: "P_MATE", name: "P_MATE", kind: "mate", mate: ada }],
                },
              },
            ],
          );
          const out = yield* call("PUT", "/api/projects/P_MATE/app", {
            session,
            body: { appId: null, kind: "mate" },
          });
          assert.deepStrictEqual(
            [out.status, out.body],
            [200, { projectId: "P_MATE", appId: null, kind: null }],
          );
          assert.sameDeepMembers(
            [yield* owner.next("change"), yield* owner.next("change")] as Array<object>,
            [
              { key: "ungrouped", value: lone },
              { key: appId, value: { id: appId, name: "Store", projects: [] } },
            ],
          );
          yield* owner.close;
        }),
    );

    it.effect("a Developer's socket holds only what they see, and follows a role they gain", () =>
      Effect.gen(function* () {
        const { call, fake, socket } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const dev = yield* sessionFor(call, "door-dev");
        const devSocket = yield* socket(`/api/structure/ws?ticket=${yield* ticketFor(call, dev)}`);
        assert.deepStrictEqual(yield* devSocket.next("snapshot"), { ungrouped: [], apps: [] });
        const appId = (
          (yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } })).body as {
            readonly id: string;
          }
        ).id;
        yield* call("POST", `/api/apps/${appId}/projects`, {
          session: owner,
          body: { projectId: "P_MATE", kind: "stage" },
        });
        assert.deepStrictEqual(yield* devSocket.quiet("700 millis"), []);

        // Zerops grants dev the project: the open socket shows the application within its recheck.
        const project = fake.projects.find((candidate) => candidate.id === "P_MATE")!;
        Object.assign(project, {
          userRoles: [{ clientUserId: "C-dev", roleCode: "BASIC_USER" }],
        });
        assert.deepStrictEqual(yield* devSocket.next("change"), {
          key: appId,
          value: {
            id: appId,
            name: "Shop",
            projects: [{ projectId: "P_MATE", name: "P_MATE", kind: "stage", mate: null }],
          },
        });
        yield* devSocket.close;
      }),
    );

    it.effect("a socket follows a role its holder loses: what they no longer see goes", () =>
      Effect.gen(function* () {
        const { call, fake, socket } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const reader = yield* sessionFor(call, "door-reader");
        const appId = (
          (yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } })).body as {
            readonly id: string;
          }
        ).id;
        const readerSocket = yield* socket(
          `/api/structure/ws?ticket=${yield* ticketFor(call, reader)}`,
        );
        assert.deepStrictEqual(yield* readerSocket.next("snapshot"), {
          ungrouped: [],
          apps: [{ id: appId, name: "Shop", projects: [] }],
        });

        // Zerops lowers the reader to no access: the open socket drops the application.
        const member = fake.members.get("ORG")!.find((row) => row.userId === "reader")!;
        Object.assign(member, { roleCode: "NO_ACCESS" });
        assert.deepStrictEqual(yield* readerSocket.next("change"), { key: appId, value: null });
        yield* readerSocket.close;
      }),
    );

    it.effect(
      "refuses at the door every throwaway that is not this HQ's own, fresh, of an active member",
      () =>
        Effect.gen(function* () {
          const { call, fake } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const knock = (token: string) =>
            Effect.map(call("POST", "/api/door", { body: { token } }), (answer) => [
              answer.status,
              (answer.body as { readonly code: string }).code,
            ]);
          assert.deepStrictEqual(
            yield* Effect.all([
              knock("door-other-org"),
              knock("door-wrong-name"),
              knock("door-invited"),
            ]),
            [
              [401, "zerops_throwaway_required"],
              [401, "zerops_throwaway_required"],
              [401, "zerops_throwaway_required"],
            ],
          );
          // The platform's clock missing is HQ's trouble, never the caller's verdict.
          fake.apiClock = false;
          assert.deepStrictEqual(yield* knock("door-owner"), [503, "zerops_unavailable"]);
        }),
    );

    it.effect(
      "opens a socket only with a fresh one-use ticket, and closes one that ends its session or stops answering",
      () =>
        Effect.gen(function* () {
          const { call, socket } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          const ticket = yield* ticketFor(call, session);
          const opened = yield* socket(`/api/structure/ws?ticket=${ticket}`);
          assert.deepStrictEqual(yield* opened.next("snapshot"), { ungrouped: [], apps: [] });
          assert.deepStrictEqual(
            [
              (yield* socket(`/api/structure/ws?ticket=${ticket}`)).opened,
              (yield* socket("/api/structure/ws")).opened,
            ],
            [false, false],
          );
          // The session ends: the socket closes 4401 within its recheck.
          yield* call("DELETE", "/api/session", { session });
          assert.strictEqual(yield* opened.closedWith, 4401);

          // A client that never answers a ping is closed after three: 4408.
          const silent = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, yield* sessionFor(call, "door-owner-2"))}`,
          );
          silent.pings.answering = false;
          assert.strictEqual(yield* silent.closedWith, 4408);
        }),
    );

    it.effect(
      "drains on shutdown: gives the lead up, sends sockets away (1001), and still answers meanwhile",
      () =>
        Effect.gen(function* () {
          const { call, socket, stop } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = yield* sessionFor(call, "door-owner");
          const open = yield* socket(`/api/structure/ws?ticket=${yield* ticketFor(call, session)}`);
          yield* open.next("snapshot");
          const stopping = yield* Effect.forkChild(stop);
          assert.strictEqual(yield* open.closedWith, 1001);
          const health = yield* call("GET", "/health");
          assert.deepStrictEqual(
            [health.status, (health.body as { readonly state: string }).state],
            [200, "standby"],
          );
          yield* Fiber.join(stopping);
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

    it.effect(
      "a Mate proves its project through the project's env and HQ knows it by its credential",
      () =>
        Effect.gen(function* () {
          const { call, fake } = yield* startCore(true);
          yield* untilHealth(call, "active");
          yield* setUpMate(call, "P_MATE");
          const challenge = yield* call("POST", "/api/mate/challenge", {
            body: { projectId: "P_MATE" },
          });
          assert.strictEqual(challenge.status, 200);
          const { nonce, expiresIn } = challenge.body as {
            readonly nonce: string;
            readonly expiresIn: number;
          };
          assert.strictEqual(expiresIn, 120);
          fake.env.set("P_MATE", [{ key: "MATE_HQ_CHALLENGE", value: nonce, sensitive: false }]);

          const issued = yield* call("POST", "/api/mate/credential", {
            body: { projectId: "P_MATE", nonce },
          });
          assert.strictEqual(issued.status, 200);
          const { credential } = issued.body as { readonly credential: string };
          const whoami = (authorization: string) =>
            Effect.map(
              call("GET", "/api/mate/whoami", { headers: { authorization } }),
              (answer) => [answer.status, answer.body],
            );
          assert.deepStrictEqual(yield* whoami(`Mate ${credential}`), [
            200,
            { projectId: "P_MATE" },
          ]);
          for (const forged of [`Mate ${credential}x`, `Bearer ${credential}`, ""]) {
            assert.deepStrictEqual(yield* whoami(forged), [
              401,
              { code: "mate_credential_required" },
            ]);
          }
        }),
    );

    it.effect(
      "answers each refusal of a Mate's proof with its code, and limits the Mate's door per address",
      () =>
        Effect.gen(function* () {
          const { call, fake } = yield* startCore(true);
          yield* untilHealth(call, "active");
          yield* setUpMate(call, "P_MATE");
          for (const [id, orgId] of [
            ["P_ELSE", "ORG2"],
            ["P_PLAIN", "ORG"],
          ] as const) {
            fake.projects.push({
              id,
              orgId,
              name: id,
              status: "ACTIVE",
              tags: [],
              userRoles: [],
              publicZone: `${id}.prg1-zerops.zone`,
            });
          }
          const { nonce } = (yield* call("POST", "/api/mate/challenge", {
            body: { projectId: "P_MATE" },
          })).body as { readonly nonce: string };
          const answers = yield* Effect.forEach(
            [
              ["/api/mate/challenge", { projectId: "P_ELSE" }],
              ["/api/mate/challenge", { projectId: "P_NONE" }],
              ["/api/mate/challenge", { projectId: "P_PLAIN" }],
              ["/api/mate/credential", { projectId: "P_MATE", nonce: "never-handed-out" }],
              ["/api/mate/credential", { projectId: "P_MATE", nonce }],
              ["/api/mate/credential", { projectId: "P_MATE" }],
            ] as const,
            ([path, body]) => call("POST", path, { body }),
          );
          assert.deepStrictEqual(
            answers.map((answer) => [
              answer.status,
              (answer.body as { readonly code: string }).code,
            ]),
            [
              [403, "not_a_mate"],
              [403, "not_a_mate"],
              [403, "not_a_mate"],
              [401, "unknown_nonce"],
              [401, "env_mismatch"],
              [400, "invalid"],
            ],
          );

          const knock = (path: string, body: unknown) =>
            Effect.map(
              call("POST", path, { body, headers: { "x-real-ip": "10.0.0.9" } }),
              (answer) => answer.status,
            );
          const statuses = yield* Effect.forEach(Array.from({ length: 11 }), () =>
            knock("/api/mate/credential", { projectId: "P_MATE", nonce: "never-handed-out" }),
          );
          assert.deepStrictEqual(statuses, [...Array(10).fill(401), 429]);
          // A person's door at the same address keeps its own bucket.
          assert.strictEqual(yield* knock("/api/door", { token: "unknown" }), 401);
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
