// @effect-diagnostics nodeBuiltinImport:off -- the Zerops API the proxy forwards to is a real HTTP server here.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import { rowsWhere } from "../test/harness/mates.ts";
import { sessionFor, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import type { FakeWorld } from "../test/harness/zeropsFake.ts";
import { CHIEF_LIMIT } from "./rateLimit.ts";

interface Asked {
  readonly method: string;
  readonly url: string;
  readonly authorization: string;
  readonly body: string;
}

/** The Zerops API as the proxy reaches it: every request recorded, answered by `answer`. */
const fakeUpstream = Effect.acquireRelease(
  Effect.promise(
    () =>
      new Promise<{
        readonly url: string;
        readonly asked: Array<Asked>;
        answer: (asked: Asked) => { readonly status: number; readonly body: string };
        readonly server: NodeHttp.Server;
      }>((resolve) => {
        const state: {
          asked: Array<Asked>;
          answer: (asked: Asked) => { readonly status: number; readonly body: string };
        } = { asked: [], answer: () => ({ status: 200, body: "{}" }) };
        const server = NodeHttp.createServer((request, response) => {
          const chunks: Array<Uint8Array> = [];
          request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
          request.on("end", () => {
            const asked = {
              method: request.method ?? "",
              url: request.url ?? "",
              authorization: String(request.headers["authorization"] ?? ""),
              body: Buffer.concat(chunks).toString("utf8"),
            };
            state.asked.push(asked);
            const { status, body } = state.answer(asked);
            response.writeHead(status, { "content-type": "application/json" }).end(body);
          });
        });
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          const port = typeof address === "object" && address !== null ? address.port : 0;
          resolve({
            url: `http://127.0.0.1:${String(port)}/api/rest/public`,
            server,
            get asked() {
              return state.asked;
            },
            get answer() {
              return state.answer;
            },
            set answer(next) {
              state.answer = next;
            },
          });
        });
      }),
  ),
  (upstream) =>
    Effect.promise(() => new Promise<void>((done) => upstream.server.close(() => done()))),
);

/**
 * The rig's org with `dev` — no org role — holding Full access on two Chief projects and on one
 * that is no Chief, and Read only on `P_IN`; `P_OUT` is the org's, not theirs to read.
 */
const seedChiefs = (fake: FakeWorld) => {
  const project = (id: string, tags: ReadonlyArray<string>, devRole: string | null) =>
    fake.projects.push({
      id,
      orgId: "ORG",
      name: id,
      status: "ACTIVE",
      tags,
      userRoles: devRole === null ? [] : [{ clientUserId: "C-dev", roleCode: devRole }],
      publicZone: `${id}.prg1-zerops.zone`,
    });
  project("P_CHIEF", ["chief"], "ADMIN");
  project("P_CHIEF_2", ["chief"], "ADMIN");
  project("P_PLAIN", [], "ADMIN");
  project("P_IN", [], "READ_ONLY");
  project("P_OUT", [], null);
  const service = (id: string, projectId: string) =>
    fake.services.push({
      id,
      projectId,
      name: id,
      status: "ACTIVE",
      isSystem: false,
      subdomainAccess: false,
      http: true,
      named: null,
      activeVersionId: null,
    });
  service("S_IN", "P_IN");
  service("S_OUT", "P_OUT");
};

const PROXY = "/api/chief/zerops";

describe("the Chief", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    const running = Effect.gen(function* () {
      const upstream = yield* fakeUpstream;
      const core = yield* startCore(true, { chiefUpstream: upstream.url });
      seedChiefs(core.fake);
      yield* untilHealth(core.call, "active");
      const dev = yield* sessionFor(core.call, "door-dev");
      const owner = yield* sessionFor(core.call, "door-owner");
      return { core, upstream, dev, owner, call: core.call };
    });
    const registered = (body: unknown) =>
      body as {
        readonly chief: { readonly projectId: string; readonly since: string };
        readonly credential: string;
        readonly proxyUrl: string;
      };

    it.effect("a person registers a project tagged chief that opens for them, and only that", () =>
      Effect.gen(function* () {
        const { call, dev, owner } = yield* running;
        const cases: ReadonlyArray<readonly [string, string, string, number]> = [
          ["a project they cannot read", dev, "P_OUT", 403],
          ["a project they only read", dev, "P_IN", 403],
          ["a project of theirs without the tag", dev, "P_PLAIN", 403],
          ["a project the org does not have", dev, "P_NONE", 403],
          ["their Chief", dev, "P_CHIEF", 200],
          ["someone else's Chief", owner, "P_CHIEF", 409],
        ];
        for (const [what, session, projectId, status] of cases) {
          const answer = yield* call("POST", "/api/chief", { session, body: { projectId } });
          assert.strictEqual(answer.status, status, what);
        }
        const mine = yield* call("GET", "/api/chief", { session: dev });
        assert.strictEqual(
          (mine.body as { readonly chief: { readonly projectId: string } }).chief.projectId,
          "P_CHIEF",
        );
        const theirs = yield* call("GET", "/api/chief", { session: owner });
        assert.deepStrictEqual(theirs.body, { chief: null });
      }),
    );

    it.effect(
      "a registration answers the credential once, kept only as its hash, and the next revokes it",
      () =>
        Effect.gen(function* () {
          const { call, dev, core, upstream } = yield* running;
          const first = registered(
            (yield* call("POST", "/api/chief", { session: dev, body: { projectId: "P_CHIEF" } }))
              .body,
          );
          assert.strictEqual(first.chief.projectId, "P_CHIEF");
          assert.match(first.chief.since, /^\d{4}-\d\d-\d\dT/u);
          assert.match(first.credential, /^[A-Za-z0-9_-]{43}$/u);
          assert.strictEqual(first.proxyUrl, `https://hqzone.prg1-zerops.zone${PROXY}`);
          const hash = NodeCrypto.createHash("sha256").update(first.credential).digest("hex");
          const rows = yield* rowsWhere(
            core.url,
            "SELECT * FROM hq_chief",
            (found) => found.length === 1,
          );
          assert.strictEqual(rows[0]?.["credential_hash"], hash);
          assert.notInclude(JSON.stringify(rows), first.credential);

          const proxied = (credential: string) =>
            Effect.map(
              call("GET", `${PROXY}/user/info`, {
                headers: { authorization: `Bearer ${credential}` },
              }),
              (answer) => answer.status,
            );
          upstream.answer = () => ({
            status: 200,
            body: JSON.stringify({ id: "U", clientUserList: [{ clientId: "ORG" }] }),
          });
          assert.strictEqual(yield* proxied(first.credential), 200);

          // The same project again, then another: each revokes the one before.
          const again = registered(
            (yield* call("POST", "/api/chief", { session: dev, body: { projectId: "P_CHIEF" } }))
              .body,
          );
          assert.notStrictEqual(again.credential, first.credential);
          assert.strictEqual(yield* proxied(first.credential), 401);
          const moved = registered(
            (yield* call("POST", "/api/chief", { session: dev, body: { projectId: "P_CHIEF_2" } }))
              .body,
          );
          assert.strictEqual(yield* proxied(again.credential), 401);
          assert.strictEqual(yield* proxied(moved.credential), 200);
          assert.strictEqual(yield* proxied("unknown"), 401);
          const mine = yield* call("GET", "/api/chief", { session: dev });
          assert.strictEqual(
            (mine.body as { readonly chief: { readonly projectId: string } }).chief.projectId,
            "P_CHIEF_2",
          );
        }),
    );

    /** `dev`'s Chief registered: its credential's header, and a call through the proxy. */
    const withChief = Effect.gen(function* () {
      const context = yield* running;
      const { credential } = registered(
        (yield* context.call("POST", "/api/chief", {
          session: context.dev,
          body: { projectId: "P_CHIEF" },
        })).body,
      );
      const proxy = (method: string, path: string, body?: unknown) =>
        context.call(method, `${PROXY}/${path}`, {
          headers: { authorization: `Bearer ${credential}` },
          ...(body === undefined ? {} : { body }),
        });
      return { ...context, credential, proxy };
    });

    it.effect("the proxy refuses a write's method and any read zcp's org mode does not make", () =>
      Effect.gen(function* () {
        const { proxy, upstream } = yield* withChief;
        const cases: ReadonlyArray<readonly [string, string, number]> = [
          ["PUT", "project/P_IN", 405],
          ["DELETE", "service-stack/S_IN", 405],
          ["PATCH", "project/P_IN", 405],
          ["POST", "service-stack/S_IN/restart", 405],
          ["POST", "user-data/search", 403],
          ["GET", "project/P_IN", 403],
          ["GET", "project/P_IN/env-file", 403],
          ["GET", "client/ORG/user/list", 403],
        ];
        for (const [method, path, status] of cases) {
          // Node's client sends a GET's or a DELETE's body unframed: neither carries one here.
          const answer = yield* proxy(
            method,
            path,
            method === "GET" || method === "DELETE" ? undefined : {},
          );
          assert.strictEqual(answer.status, status, `${method} ${path}`);
        }
        assert.deepStrictEqual(upstream.asked, []);
      }),
    );

    it.effect(
      "a search goes out pinned to HQ's org as HQ, and answers only the projects its person reads",
      () =>
        Effect.gen(function* () {
          const { proxy, upstream } = yield* withChief;
          upstream.answer = () => ({
            status: 200,
            body: JSON.stringify({
              items: [
                { id: "S_IN", projectId: "P_IN", clientId: "ORG" },
                { id: "S_OUT", projectId: "P_OUT", clientId: "ORG" },
                { id: "S_ELSEWHERE", projectId: "P_IN", clientId: "ORG2" },
              ],
              totalHits: 3,
            }),
          });
          const answer = yield* proxy("POST", "service-stack/search", {
            search: [{ name: "clientId", operator: "eq", value: "ORG2" }],
            limit: 1000,
          });
          assert.strictEqual(answer.status, 200);
          assert.deepStrictEqual(answer.body, {
            items: [{ id: "S_IN", projectId: "P_IN", clientId: "ORG" }],
            totalHits: 1,
          });
          const [asked] = upstream.asked;
          assert.strictEqual(asked?.method, "POST");
          assert.strictEqual(asked?.url, "/api/rest/public/service-stack/search");
          assert.strictEqual(asked?.authorization, "Bearer hq");
          assert.deepStrictEqual(JSON.parse(asked?.body ?? ""), {
            search: [{ name: "clientId", operator: "eq", value: "ORG" }],
            limit: 1000,
          });
        }),
    );

    it.effect("a single read answers inside its person's reach, as Zerops answered it", () =>
      Effect.gen(function* () {
        const { proxy, upstream } = yield* withChief;
        const logAccess =
          '{"url":"GET https://log.zerops.io/p?accessToken=ZEROPS_OWN","expiration":"x"}';
        upstream.answer = (asked) =>
          asked.url.includes("/log")
            ? { status: 200, body: logAccess }
            : asked.url.includes("public-http-routing")
              ? { status: 400, body: '{"error":{"code":"somethingWrong"}}' }
              : { status: 200, body: '{"items":[{"key":"A","content":"1"}]}' };
        const cases: ReadonlyArray<readonly [string, number, string | null]> = [
          ["project/P_IN/log", 200, logAccess],
          ["project/P_OUT/log", 403, null],
          ["project/P_NONE/log", 403, null],
          ["service-stack/S_IN/env", 200, '{"items":[{"key":"A","content":"1"}]}'],
          ["service-stack/S_OUT/env", 403, null],
          ["service-stack/S_NONE/env", 403, null],
          // Zerops' own refusal passes through as it said it.
          ["project/P_IN/public-http-routing?limit=10", 400, '{"error":{"code":"somethingWrong"}}'],
        ];
        for (const [path, status, body] of cases) {
          const answer = yield* proxy("GET", path);
          assert.strictEqual(answer.status, status, path);
          if (body !== null) assert.strictEqual(new TextDecoder().decode(answer.bytes), body, path);
        }
        assert.deepStrictEqual(
          upstream.asked.map((asked) => asked.url),
          [
            "/api/rest/public/project/P_IN/log",
            "/api/rest/public/service-stack/S_IN/env",
            "/api/rest/public/project/P_IN/public-http-routing?limit=10",
          ],
        );
      }),
    );

    it.effect("a Chief whose person left the org reads nothing", () =>
      Effect.gen(function* () {
        const { proxy, core, upstream } = yield* withChief;
        upstream.answer = () => ({
          status: 200,
          body: JSON.stringify({ id: "U", clientUserList: [{ clientId: "ORG" }] }),
        });
        assert.strictEqual((yield* proxy("GET", "user/info")).status, 200);
        const members = core.fake.members.get("ORG")!;
        members.splice(
          members.findIndex((member) => member.userId === "dev"),
          1,
        );
        const refused = yield* proxy("GET", "user/info").pipe(
          Effect.filterOrFail((answer) => answer.status !== 200),
          Effect.retry(Schedule.spaced(Duration.millis(50))),
          Effect.timeout(Duration.seconds(5)),
        );
        assert.strictEqual(refused.status, 403);
      }),
    );

    it.effect("a Chief's calls are limited per credential", () =>
      Effect.gen(function* () {
        const { proxy, upstream } = yield* withChief;
        upstream.answer = () => ({
          status: 200,
          body: JSON.stringify({ id: "U", clientUserList: [] }),
        });
        // Past its burst, by more than the bucket refills while the calls run.
        const statuses = yield* Effect.forEach(
          Array.from({ length: CHIEF_LIMIT.capacity + 20 }),
          () => Effect.map(proxy("GET", "user/info"), (answer) => answer.status),
        );
        assert.strictEqual(statuses[0], 200);
        assert.strictEqual(statuses.at(-1), 429);
      }),
    );
  });
});
