// @effect-diagnostics nodeBuiltinImport:off -- the Zerops API the proxy forwards to is a real HTTP server here.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import { mateInApp, rowsWhere } from "../test/harness/mates.ts";
import { sessionFor, startCore, untilHealth, ticketFor } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { scopeReset, nextScopeValue } from "../test/harness/scopes.ts";
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

    it.effect.each(["deleted", "deleting", "untagged"] as const)(
      "a person's deleted or untagged Chief is absent from their current record: %s",
      (state) =>
        Effect.gen(function* () {
          const { core, call, dev } = yield* running;
          yield* call("POST", "/api/chief", { session: dev, body: { projectId: "P_CHIEF" } });
          const at = core.fake.projects.findIndex((project) => project.id === "P_CHIEF");
          if (state === "deleted") core.fake.projects.splice(at, 1);
          else
            core.fake.projects.splice(at, 1, {
              ...core.fake.projects[at]!,
              ...(state === "deleting" ? { status: "DELETING" } : { tags: [] }),
            });
          const answer = yield* call("GET", "/api/chief", { session: dev }).pipe(
            Effect.filterOrFail((answer) => (answer.body as { chief: unknown }).chief === null),
            Effect.retry(Schedule.spaced(Duration.millis(50))),
            Effect.timeout(Duration.seconds(5)),
          );
          assert.deepStrictEqual(answer.body, { chief: null });
        }),
    );

    it.effect("marking the organisation's Chief publishes it to every device of its readers", () =>
      Effect.gen(function* () {
        const core = yield* startCore(true, {
          reconcileEvery: Duration.infinity,
          streamRecheck: Duration.infinity,
        });
        seedChiefs(core.fake);
        yield* untilHealth(core.call, "active");
        const owner = yield* sessionFor(core.call, "door-owner");
        const dev = yield* sessionFor(core.call, "door-dev");
        yield* mateInApp(core.call, core.fake, owner, "P_CHIEF", "Chief · Dev");
        const nav = { kind: "navigation" } as const;
        const sockets = [];
        for (const session of [dev, owner]) {
          const socket = yield* core.socket(
            `/api/structure/ws?ticket=${yield* ticketFor(core.call, session)}`,
          );
          assert.strictEqual(
            (yield* scopeReset(socket, nav)).some((value) => value.key === "project:P_CHIEF"),
            false,
          );
          sockets.push(socket);
        }
        const marked = yield* core.call("PUT", "/api/chief", {
          session: owner,
          body: { projectId: "P_CHIEF" },
        });
        assert.strictEqual(marked.status, 200);
        assert.strictEqual(
          (marked.body as { chief: { projectId: string } }).chief.projectId,
          "P_CHIEF",
        );
        for (const socket of sockets) {
          const entry = yield* nextScopeValue<{
            person: { chief: string; chiefProjectId: string };
          }>(socket, nav, "project:P_CHIEF");
          assert.strictEqual(entry.person.chief, "org");
          assert.strictEqual(entry.person.chiefProjectId, "P_CHIEF");
        }
        for (const session of [dev, owner])
          assert.include(
            JSON.stringify((yield* core.call("GET", "/api/structure", { session })).body),
            "P_CHIEF",
          );
      }),
    );

    it.effect(
      "only an Owner or Admin marks or removes the organisation's Chief, of a project the org has",
      () =>
        Effect.gen(function* () {
          const { call, dev, owner } = yield* running;
          const refusal = (answer: { status: number; body: unknown }) => [
            answer.status,
            (answer.body as { code?: string; reason?: string }).code,
            (answer.body as { code?: string; reason?: string }).reason,
          ];
          assert.deepStrictEqual(
            refusal(
              yield* call("PUT", "/api/chief", { session: dev, body: { projectId: "P_CHIEF" } }),
            ),
            [403, "forbidden", "not_structure_writer"],
          );
          assert.deepStrictEqual(
            refusal(
              yield* call("PUT", "/api/chief", { session: owner, body: { projectId: "P_NONE" } }),
            ),
            [404, "project_not_found", "project_gone"],
          );
          const first = yield* call("PUT", "/api/chief", {
            session: owner,
            body: { projectId: "P_CHIEF" },
          });
          const again = yield* call("PUT", "/api/chief", {
            session: owner,
            body: { projectId: "P_CHIEF" },
          });
          assert.deepStrictEqual(again.body, first.body);
          assert.include(
            JSON.stringify((yield* call("GET", "/api/structure", { session: dev })).body),
            "P_CHIEF",
          );
          assert.deepStrictEqual(refusal(yield* call("DELETE", "/api/chief", { session: dev })), [
            403,
            "forbidden",
            "not_structure_writer",
          ]);
          assert.strictEqual((yield* call("DELETE", "/api/chief", { session: owner })).status, 204);
          assert.notInclude(
            JSON.stringify((yield* call("GET", "/api/structure", { session: dev })).body),
            "P_CHIEF",
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

    it.effect(
      "a Chief's proxy withholds another person's Chief even when platform project roles grant access",
      () =>
        Effect.gen(function* () {
          const { proxy, call, owner, upstream } = yield* withChief;
          assert.strictEqual(
            (yield* call("POST", "/api/chief", {
              session: owner,
              body: { projectId: "P_CHIEF_2" },
            })).status,
            200,
          );
          upstream.answer = () => ({
            status: 200,
            body: JSON.stringify({
              items: [
                { id: "P_CHIEF", clientId: "ORG" },
                { id: "P_CHIEF_2", clientId: "ORG" },
              ],
              totalHits: 2,
            }),
          });
          assert.deepStrictEqual((yield* proxy("POST", "project/search", {})).body, {
            items: [{ id: "P_CHIEF", clientId: "ORG" }],
            totalHits: 1,
          });
          assert.strictEqual((yield* proxy("GET", "project/P_CHIEF_2/log")).status, 403);
        }),
    );

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

    it.effect(
      "a Chief asks HQ who its person is: their name, their org role and what it lets them do",
      () =>
        Effect.gen(function* () {
          const { proxy, upstream } = yield* withChief;
          const answer = yield* proxy("GET", "chief/person");
          assert.strictEqual(answer.status, 200);
          assert.deepStrictEqual(answer.body, {
            name: "dev",
            roleCode: "NO_ACCESS",
            canViewFinances: false,
            canEditFinances: false,
            canCreateProjects: false,
          });
          assert.deepStrictEqual(upstream.asked, []);
        }),
    );

    const costs = {
      client: { id: "ORG", periodCost: { thisMonth: 10, today: 1 } },
      project: [
        { id: "P_IN", periodCost: { thisMonth: 3, today: 0.5 } },
        { id: "P_OUT", periodCost: { thisMonth: 7, today: 0.5 } },
      ],
      stack: [
        { id: "S_IN", periodCost: { thisMonth: 3, today: 0.5 } },
        { id: "S_OUT", periodCost: { thisMonth: 7, today: 0.5 } },
      ],
    };
    const answersCosts = (asked: { readonly url: string }) =>
      asked.url.endsWith("/transaction-debit/cost-search")
        ? { status: 200, body: JSON.stringify(costs) }
        : {
            status: 200,
            body: JSON.stringify({
              items: [
                { id: "S_IN", projectId: "P_IN", clientId: "ORG" },
                { id: "S_OUT", projectId: "P_OUT", clientId: "ORG" },
              ],
            }),
          };

    it.effect(
      "a Chief's person outside the org's finances reads only their projects' costs, totalled",
      () =>
        Effect.gen(function* () {
          const { proxy, upstream } = yield* withChief;
          upstream.answer = answersCosts;
          const answer = yield* proxy("POST", "transaction-debit/cost-search", {
            search: [{ name: "clientId", operator: "eq", value: "ORG2" }],
          });
          assert.strictEqual(answer.status, 200);
          assert.deepStrictEqual(answer.body, {
            client: { id: "ORG", periodCost: { thisMonth: 3, today: 0.5 } },
            project: [{ id: "P_IN", periodCost: { thisMonth: 3, today: 0.5 } }],
            stack: [{ id: "S_IN", periodCost: { thisMonth: 3, today: 0.5 } }],
          });
          const [asked] = upstream.asked;
          assert.strictEqual(asked?.url, "/api/rest/public/transaction-debit/cost-search");
          assert.strictEqual(asked?.authorization, "Bearer hq");
          assert.deepStrictEqual(JSON.parse(asked?.body ?? ""), {
            search: [{ name: "clientId", operator: "eq", value: "ORG" }],
          });
        }),
    );

    it.effect("a Chief's person who sees the org's finances reads its costs whole", () =>
      Effect.gen(function* () {
        const { proxy, upstream, core } = yield* withChief;
        const members = core.fake.members.get("ORG") ?? [];
        core.fake.members.set(
          "ORG",
          members.map((member) =>
            member.name === "dev" ? { ...member, canViewFinances: true } : member,
          ),
        );
        upstream.answer = answersCosts;
        // HQ's view of its org is at most 30 s old: the flag reads once it is renewed.
        const answer = yield* proxy("POST", "transaction-debit/cost-search", { search: [] }).pipe(
          Effect.repeat({
            until: (each) =>
              (each.body as { project?: ReadonlyArray<unknown> }).project?.length === 2,
            schedule: Schedule.spaced(Duration.millis(200)),
          }),
          Effect.timeout(Duration.seconds(40)),
        );
        assert.deepStrictEqual(answer.body, costs);
      }),
    );

    it.effect(
      "a Chief's resource use goes out pinned with its range, and answers only its person's projects",
      () =>
        Effect.gen(function* () {
          const { proxy, upstream } = yield* withChief;
          upstream.answer = () => ({
            status: 200,
            body: JSON.stringify({
              items: [
                { projectId: "P_IN", serviceStackId: "S_IN", ramUsed: 0.3, ramLimit: 1 },
                { projectId: "P_OUT", serviceStackId: "S_OUT", ramUsed: 0.9, ramLimit: 1 },
              ],
              totalHits: 2,
            }),
          });
          const range = {
            from: "2026-10-13T15:00:00Z",
            till: "2026-10-14T15:00:00Z",
            timeZone: "UTC",
            groupBy: "serviceStackId",
            timeGroupBy: "1h",
          };
          const answer = yield* proxy("POST", "stats-history/group-by-search", {
            search: [{ name: "projectId", operator: "eq", value: "P_IN" }],
            ...range,
            receiverId: "R1",
          });
          assert.strictEqual(answer.status, 200);
          assert.deepStrictEqual(answer.body, {
            items: [{ projectId: "P_IN", serviceStackId: "S_IN", ramUsed: 0.3, ramLimit: 1 }],
            totalHits: 1,
          });
          const [asked] = upstream.asked;
          assert.strictEqual(asked?.url, "/api/rest/public/stats-history/group-by-search");
          assert.deepStrictEqual(JSON.parse(asked?.body ?? ""), {
            search: [
              { name: "projectId", operator: "eq", value: "P_IN" },
              { name: "clientId", operator: "eq", value: "ORG" },
            ],
            ...range,
          });
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

    it.effect("a Chief whose project is no longer tagged chief reads nothing", () =>
      Effect.gen(function* () {
        const { proxy, core, upstream } = yield* withChief;
        upstream.answer = () => ({
          status: 200,
          body: JSON.stringify({ id: "U", clientUserList: [{ clientId: "ORG" }] }),
        });
        assert.strictEqual((yield* proxy("GET", "user/info")).status, 200);
        const at = core.fake.projects.findIndex((project) => project.id === "P_CHIEF");
        core.fake.projects.splice(at, 1, { ...core.fake.projects[at]!, tags: [] });
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

    it.effect(
      "a Mate's Chief offer binds its person and recipient, and is rechecked on approval",
      () =>
        Effect.gen(function* () {
          const { call, core, dev, owner } = yield* running;
          const plain = core.fake.projects.find((project) => project.id === "P_PLAIN")!;
          core.fake.projects.splice(core.fake.projects.indexOf(plain), 1, {
            ...plain,
            userRoles: [{ clientUserId: "C-dev", roleCode: "OWNER" }],
          });
          const { credential } = yield* mateInApp(
            call,
            core.fake,
            owner,
            "P_PLAIN",
            "Chief identity",
          );
          const auth = { headers: { authorization: `Mate ${credential}` } };
          assert.deepStrictEqual((yield* call("GET", "/api/mate/chief", auth)).body, {
            chief: null,
          });
          assert.strictEqual((yield* call("POST", "/api/mate/chief/proposals", auth)).status, 403);
          assert.strictEqual(
            (yield* call("POST", "/api/chief", {
              session: dev,
              body: { projectId: "P_CHIEF" },
            })).status,
            200,
          );
          assert.deepStrictEqual((yield* call("GET", "/api/mate/chief", auth)).body, {
            chief: { projectId: "P_CHIEF", ownerUserId: "dev" },
          });
          const offered = yield* call("POST", "/api/mate/chief/proposals", auth);
          assert.strictEqual(offered.status, 200);
          const { id } = offered.body as { readonly id: string };
          const body = { projectId: "P_PLAIN", kind: "chief.message", decision: "approved" };
          // Even relabeling a registered offer cannot make the reader its person.
          assert.strictEqual(
            (yield* call("PUT", `/api/proposals/${id}`, {
              session: owner,
              body: { ...body, kind: "mate.message" },
            })).status,
            403,
          );
          assert.strictEqual(
            (yield* call("PUT", `/api/proposals/${id}`, {
              session: dev,
              body,
            })).status,
            200,
          );
          const pending = yield* call("POST", "/api/mate/chief/proposals", auth);
          assert.strictEqual(pending.status, 200);
          assert.strictEqual(
            (yield* call("POST", "/api/chief", {
              session: dev,
              body: { projectId: "P_CHIEF_2" },
            })).status,
            200,
          );
          assert.strictEqual(
            (yield* call("PUT", `/api/proposals/${(pending.body as { id: string }).id}`, {
              session: dev,
              body,
            })).status,
            403,
          );
        }),
    );

    it.effect("a decision on a Mate's Chief offer is read only by the Chief's person", () =>
      Effect.gen(function* () {
        const { call, core, dev, owner } = yield* running;
        const plain = core.fake.projects.find((project) => project.id === "P_PLAIN")!;
        core.fake.projects.splice(core.fake.projects.indexOf(plain), 1, {
          ...plain,
          userRoles: [{ clientUserId: "C-dev", roleCode: "OWNER" }],
        });
        const { credential } = yield* mateInApp(call, core.fake, owner, "P_PLAIN", "Chief read");
        const auth = { headers: { authorization: `Mate ${credential}` } };
        yield* call("POST", "/api/chief", { session: dev, body: { projectId: "P_CHIEF" } });
        const { id } = (yield* call("POST", "/api/mate/chief/proposals", auth)).body as {
          readonly id: string;
        };
        assert.strictEqual(
          (yield* call("PUT", `/api/proposals/${id}`, {
            session: dev,
            body: { projectId: "P_PLAIN", kind: "chief.message", decision: "approved" },
          })).status,
          200,
        );
        const readBy = (session: string) =>
          Effect.map(call("GET", `/api/proposals?ids=${id}`, { session }), (read) =>
            (
              read.body as { readonly decisions: ReadonlyArray<{ readonly id: string }> }
            ).decisions.map((decision) => decision.id),
          );
        // The owner observes the conversation, yet the Chief's decision is its person's alone.
        assert.deepStrictEqual([yield* readBy(dev), yield* readBy(owner)], [[id], []]);
      }),
    );

    it.effect("a Mate whose person has no Chief never offers to ask one", () =>
      Effect.gen(function* () {
        const { call, dev, owner } = yield* running;
        // The reader has a Chief; the conversation's person does not.
        assert.strictEqual(
          (yield* call("POST", "/api/chief", {
            session: owner,
            body: { projectId: "P_CHIEF" },
          })).status,
          200,
        );
        const answer = yield* call("PUT", "/api/proposals/no-chief", {
          session: dev,
          body: { projectId: "P_PLAIN", kind: "chief.message", decision: "approved" },
        });
        assert.strictEqual(
          answer.status,
          403,
          "a reader's Chief cannot authorize this Mate's offer",
        );
      }),
    );

    it.effect("only the Chief's person approves a Mate's request to that Chief", () =>
      Effect.gen(function* () {
        const { call, dev, owner } = yield* running;
        assert.strictEqual(
          (yield* call("POST", "/api/chief", {
            session: dev,
            body: { projectId: "P_CHIEF" },
          })).status,
          200,
        );
        const answer = yield* call("PUT", "/api/proposals/another-person", {
          session: owner,
          body: { projectId: "P_PLAIN", kind: "chief.message", decision: "approved" },
        });
        assert.strictEqual(answer.status, 403, "reading the conversation is not Chief ownership");
      }),
    );

    it.effect("a proposal's decision is recorded once, by whoever its conversation opens for", () =>
      Effect.gen(function* () {
        const { call, dev, owner } = yield* running;
        const put = (session: string, id: string, body: unknown) =>
          call("PUT", `/api/proposals/${id}`, { session, body });
        const approved = yield* put(dev, "p-1", { projectId: "P_CHIEF", decision: "approved" });
        assert.strictEqual(approved.status, 200);
        assert.deepInclude(approved.body as object, {
          id: "p-1",
          projectId: "P_CHIEF",
          decision: "approved",
          outcome: null,
          words: null,
          by: "dev",
        });
        const cases: ReadonlyArray<readonly [string, string, string, unknown, number]> = [
          ["the same again", dev, "p-1", { projectId: "P_CHIEF", decision: "approved" }, 200],
          ["turned", dev, "p-1", { projectId: "P_CHIEF", decision: "declined" }, 409],
          [
            "in a project they cannot open",
            dev,
            "p-2",
            { projectId: "P_IN", decision: "approved" },
            403,
          ],
          ["by the owner there", owner, "p-2", { projectId: "P_OUT", decision: "declined" }, 200],
          [
            "outcome on a decline",
            owner,
            "p-2",
            { projectId: "P_OUT", decision: "declined", outcome: "done" },
            409,
          ],
          [
            "outcome after the approval",
            dev,
            "p-1",
            { projectId: "P_CHIEF", decision: "approved", outcome: "failed", words: "quota" },
            200,
          ],
          [
            "outcome turned",
            dev,
            "p-1",
            { projectId: "P_CHIEF", decision: "approved", outcome: "done" },
            409,
          ],
          ["no decision", dev, "p-3", { projectId: "P_CHIEF" }, 400],
        ];
        for (const [what, session, id, body, status] of cases) {
          assert.strictEqual((yield* put(session, id, body)).status, status, what);
        }
        const read = yield* call("GET", "/api/proposals?ids=p-1,p-2,p-none", { session: dev });
        assert.strictEqual(read.status, 200);
        const decisions = (read.body as { readonly decisions: ReadonlyArray<object> }).decisions;
        assert.strictEqual(decisions.length, 1);
        assert.deepInclude(decisions[0]!, {
          id: "p-1",
          decision: "approved",
          outcome: "failed",
          words: "quota",
          by: "dev",
        });
        const many = Array.from({ length: 101 }, (_, index) => `p-${String(index)}`).join(",");
        assert.strictEqual(
          (yield* call("GET", `/api/proposals?ids=${many}`, { session: dev })).status,
          400,
        );
        assert.strictEqual((yield* call("GET", "/api/proposals?ids=p-1")).status, 401);
      }),
    );
  });
});
