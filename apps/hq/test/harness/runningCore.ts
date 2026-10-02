// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off -- the tests reach Core as a client does: over HTTP and a WebSocket.
/**
 * A whole Core as the tests run it: on a fresh database of the test file's temp cluster (or a given
 * one), over the in-memory Zerops of a miniature rig, served by a real Node server on a free port;
 * and what a client and zcp do to it — come through the door, mint a ticket, set a Mate up, enroll
 * it.
 *
 * @module test/harness/runningCore
 */
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { assert } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Exit from "effect/Exit";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as HttpServer from "effect/unstable/http/HttpServer";

import { coreApp } from "../../src/core.ts";
import { treeMigrations } from "../../src/migrationFiles.ts";
import { ZeropsApi, type ZeropsMember, type ZeropsOwnToken } from "../../src/zerops/api.ts";
import { TempPostgres } from "./tempPostgres.ts";
import { type FakeWorld, emptyWorld, fakeZeropsApi } from "./zeropsFake.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));

const HQ = "HQ1";
const ADDRESS = "https://hqzone.prg1-zerops.zone";
export const CLIENT = "https://mate.zerops.io";

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
 * Core on a fresh database and git root (or the given ones), served over a real Node server on a
 * free port, as the container serves it; requests as `{ status, body, headers }`. `stop` ends it —
 * drain included — before the test does.
 */
export const startCore = (
  anchored: boolean,
  given: { readonly url?: string; readonly orgId?: string; readonly gitRoot?: string } = {},
) =>
  Effect.gen(function* () {
    const url = given.url ?? (yield* (yield* TempPostgres).createDatabase);
    const gitRoot =
      given.gitRoot ??
      (yield* Effect.acquireRelease(
        Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-git-"))),
        (root) => Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true })),
      ));
    const fake = world(yield* Clock.currentTimeMillis, anchored, given.orgId ?? "ORG");
    const options = {
      databaseUrl: Redacted.make(url),
      gitRoot,
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
        /** JSON, or bytes sent as they are (their `content-type` among the headers). */
        readonly body?: unknown;
        readonly session?: string;
        readonly headers?: Record<string, string>;
      } = {},
    ) =>
      Effect.promise(async () => {
        const raw = options.body instanceof Uint8Array;
        // A redirect is an answer to see, never one to follow.
        const response = await fetch(`http://${base}${path}`, {
          method,
          redirect: "manual",
          headers: {
            ...(options.body === undefined || raw ? {} : { "content-type": "application/json" }),
            ...(options.session === undefined
              ? {}
              : { authorization: `Bearer ${options.session}` }),
            ...options.headers,
          },
          ...(options.body === undefined
            ? {}
            : { body: raw ? (options.body as Uint8Array) : encodeJson(options.body) }),
        });
        const bytes = new Uint8Array(await response.arrayBuffer());
        const text = new TextDecoder().decode(bytes);
        const isJson = response.headers.get("content-type")?.includes("json") ?? false;
        return {
          status: response.status,
          body: text === "" ? null : isJson ? decodeJson(text) : text,
          bytes,
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
        const next = (type: string) =>
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
          send: (message: unknown) => Effect.sync(() => ws.send(encodeJson(message))),
        };
      });
    return { call, fake, url, gitRoot, origin: `http://${base}`, stop, socket };
  });

export type Call = Effect.Success<ReturnType<typeof startCore>>["call"];

export const untilHealth = (call: Call, state: string) =>
  call("GET", "/health").pipe(
    Effect.filterOrFail(
      (response) => (response.body as { readonly state: string }).state === state,
    ),
    Effect.retry(Schedule.spaced(Duration.millis(50))),
    Effect.timeout(Duration.seconds(10)),
  );

/** A one-use ticket for `session`'s socket. */
export const ticketFor = (call: Call, session: string) =>
  Effect.map(
    call("POST", "/api/stream-ticket", { session }),
    (response) => (response.body as { readonly ticket: string }).ticket,
  );

/** The owner sets `projectId` up as a Mate in no application (what makes it enrollable); their session. */
export const setUpMate = (call: Call, projectId: string) =>
  Effect.gen(function* () {
    const session = yield* sessionFor(call, "door-owner");
    const created = yield* call("POST", "/api/mates", {
      session,
      body: { projectId, name: "Ada", face: "face-1" },
    });
    assert.strictEqual(created.status, 201);
    return session;
  });

/** What zcp does: the challenge, written into the project's env, presented back; the credential. */
export const enrollMate = (call: Call, fake: FakeWorld, projectId: string) =>
  Effect.gen(function* () {
    const { nonce } = (yield* call("POST", "/api/mate/challenge", { body: { projectId } }))
      .body as { readonly nonce: string };
    fake.env.set(projectId, [{ key: "MATE_HQ_CHALLENGE", value: nonce, sensitive: false }]);
    const issued = yield* call("POST", "/api/mate/credential", { body: { projectId, nonce } });
    assert.strictEqual(issued.status, 200);
    return (issued.body as { readonly credential: string }).credential;
  });

export const sessionFor = (call: Call, token: string) =>
  Effect.map(call("POST", "/api/door", { body: { token } }), (response) => {
    assert.strictEqual(response.status, 200);
    return (response.body as { readonly session: string }).session;
  });
