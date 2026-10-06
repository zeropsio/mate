// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off globalTimers:off preferSchemaOverJson:off globalConsoleInEffect:off -- real HQ socket acceptance test.
import { assert, describe, it } from "@effect/vitest";
import { HqAttentionValue } from "@t3tools/shared/hqStream";
import * as Schema from "effect/Schema";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { overviewOf } from "../test/harness/overviews.ts";
import {
  startCore,
  sessionFor,
  setUpMate,
  enrollMate,
  ticketFor,
  untilHealth,
} from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

const readAttention = Schema.decodeEffect(HqAttentionValue);

describe("HQ scoped socket", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "five distinct people get cold navigation with Mate facts within budget; unchanged resumes send no values",
      () =>
        Effect.gen(function* () {
          const core = yield* startCore(true, {
            reconcileEvery: Duration.hours(1),
            viewTtl: Duration.zero,
          });
          yield* untilHealth(core.call, "active");
          const session = yield* sessionFor(core.call, "door-owner");
          const created = yield* core.call("POST", "/api/apps", {
            session,
            body: { name: "Alpha" },
          });
          assert.strictEqual(created.status, 201);
          const people = ["owner", "person-1", "person-2", "person-3", "person-4"];
          for (const userId of people.slice(1)) {
            core.fake.members.get("ORG")!.push({
              name: userId,
              userId,
              clientUserId: `C-${userId}`,
              kind: "person",
              status: "ACTIVE",
              roleCode: "OWNER",
              canCreateProjects: false,
            });
            core.fake.tokens.set(`door-${userId}`, {
              ...core.fake.tokens.get("door-owner")!,
              id: `door-${userId}`,
              createdByUser: userId,
            });
          }
          const projects = Array.from({ length: 30 }, (_, index) =>
            index === 0 ? "P_MATE" : `P_MATE_${index}`,
          );
          for (const id of projects.slice(1))
            core.fake.projects.push({
              ...core.fake.projects.find((project) => project.id === "P_MATE")!,
              id,
              name: id,
              publicZone: `${id}.zone`,
              userRoles: [{ clientUserId: "C-owner", roleCode: "OWNER" }],
            });
          yield* Effect.forEach(
            projects,
            (projectId, index) =>
              Effect.gen(function* () {
                const app =
                  index === 0
                    ? created
                    : yield* core.call("POST", "/api/apps", {
                        session,
                        body: { name: `App ${index}` },
                      });
                assert.strictEqual(app.status, 201);
                const appId = (app.body as { id: string }).id;
                assert.strictEqual(
                  (yield* core.call("POST", "/api/mates", {
                    session,
                    body: { projectId, face: "face" },
                  })).status,
                  201,
                );
                assert.strictEqual(
                  (yield* core.call("PUT", `/api/projects/${projectId}/app`, {
                    session,
                    body: { appId, kind: "mate" },
                  })).status,
                  200,
                );
                const link = yield* core.overviews.connect(projectId);
                yield* core.overviews.report(projectId, link, {
                  type: "overview",
                  full: true,
                  overview: overviewOf(),
                });
                yield* core.overviews.reportAttention(projectId, link, {
                  source: { environmentId: `env-${index}`, incarnation: "boot", revision: 1 },
                  mainThreadId: "thread",
                  lastThreadId: "thread",
                  working: 1,
                  waiting: 0,
                  results: [
                    {
                      threadId: "thread",
                      turnId: "result",
                      completedAt: "2026-10-06T00:00:00.000Z",
                    },
                  ],
                  questions: [],
                  truncated: false,
                });
              }),
            { concurrency: 4 },
          );
          const sessions = yield* Effect.forEach(people, (userId) =>
            userId === "owner" ? Effect.succeed(session) : sessionFor(core.call, `door-${userId}`),
          );
          assert.strictEqual(new Set(sessions).size, 5);
          const tickets = yield* Effect.forEach(
            sessions,
            (personSession) => ticketFor(core.call, personSession),
            { concurrency: "unbounded" },
          );
          const coldReads = core.fake.calls.filter((call) => call === "members:hq").length;
          const samples = yield* Effect.promise(() =>
            Promise.all(
              tickets.map(
                (ticket) =>
                  new Promise<{
                    elapsed: number;
                    deliveries: Array<Record<string, unknown>>;
                    cursor: { incarnation: string; revision: number };
                  }>((resolve, reject) => {
                    const began = performance.now();
                    let firstData: number | undefined;
                    const ws = new WebSocket(
                      `${core.origin.replace("http:", "ws:")}/api/structure/ws?ticket=${ticket}`,
                    );
                    const timeout = setTimeout(() => {
                      ws.close();
                      reject(new Error("no scope receipt"));
                    }, 3000);
                    const deliveries: Array<Record<string, unknown>> = [];
                    ws.addEventListener("open", () =>
                      ws.send(
                        JSON.stringify({
                          type: "subscribe",
                          scopes: [{ scope: { kind: "navigation" } }],
                        }),
                      ),
                    );
                    ws.addEventListener("message", (event) => {
                      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
                      if (message.type === "ping") ws.send('{"type":"pong"}');
                      if (message.type === "scope-reset" || message.type === "scope-values") {
                        firstData ??= performance.now() - began;
                        deliveries.push(message);
                      }
                      if (message.type === "scope-ready") {
                        clearTimeout(timeout);
                        ws.close();
                        resolve({
                          elapsed: firstData!,
                          deliveries,
                          cursor: {
                            incarnation: String(message.incarnation),
                            revision: Number(message.revision),
                          },
                        });
                      }
                    });
                    ws.addEventListener("error", reject);
                  }),
              ),
            ),
          );
          assert.isAbove(
            core.fake.calls.filter((call) => call === "members:hq").length,
            coldReads,
            "roles view was cold",
          );
          const times = samples.map((sample) => sample.elapsed).sort((a, b) => a - b);
          process.stdout.write(
            `HQ five people / 30 Mates / cold roles: p50=${times[2]?.toFixed(1)}ms p95=${times[4]?.toFixed(1)}ms\n`,
          );
          assert.isAtMost(times[2]!, 300);
          assert.isAtMost(times[4]!, 600);
          for (const sample of samples) {
            assert.lengthOf(sample.deliveries, 1);
            const payload = JSON.stringify(sample.deliveries);
            assert.include(payload, "Alpha");
            assert.include(payload, "project:P_MATE");
            assert.include(payload, '"person":{"role":');
            assert.notInclude(payload, '"recipes"');
            assert.notInclude(payload, '"releases"');
            assert.notInclude(payload, '"repos"');
            assert.notInclude(payload, '"moveTo"');
          }
          const ticket = yield* ticketFor(core.call, session);
          const resumed = yield* Effect.promise(
            () =>
              new Promise<Array<string>>((resolve, reject) => {
                const ws = new WebSocket(
                  `${core.origin.replace("http:", "ws:")}/api/structure/ws?ticket=${ticket}`,
                );
                const timeout = setTimeout(() => {
                  ws.close();
                  reject(new Error("no resume receipt"));
                }, 3000);
                const types: string[] = [];
                ws.addEventListener("open", () =>
                  ws.send(
                    JSON.stringify({
                      type: "subscribe",
                      scopes: [
                        {
                          scope: { kind: "navigation" },
                          cursor: samples[0]!.cursor,
                          knownKeys: [
                            "org",
                            ...(samples[0]!.deliveries[0]!.values as Array<{ key: string }>).map(
                              (value) => value.key,
                            ),
                          ],
                        },
                      ],
                    }),
                  ),
                );
                ws.addEventListener("message", (event) => {
                  const message = JSON.parse(String(event.data)) as { type: string };
                  types.push(message.type);
                  if (message.type === "scope-ready") {
                    clearTimeout(timeout);
                    ws.close();
                    resolve(types);
                  }
                });
              }),
          );
          assert.deepStrictEqual(resumed, ["scope-ready"]);
        }).pipe(Effect.scoped),
    );
    it.effect("seen results survive a Core restart and remain person-specific", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const core = yield* startCore(true, { reconcileEvery: Duration.hours(1) });
          yield* untilHealth(core.call, "active");
          const session = yield* setUpMate(core.call, "P_MATE");
          const attention = {
            source: { environmentId: "environment", incarnation: "boot", revision: 1 },
            mainThreadId: "thread",
            lastThreadId: "thread",
            working: 0,
            waiting: 0,
            results: [
              { threadId: "thread", turnId: "result", completedAt: "2026-10-06T00:00:00.000Z" },
            ],
            questions: [],
            truncated: false,
          };
          const report = (instance: typeof core) =>
            Effect.gen(function* () {
              const link = yield* instance.overviews.connect("P_MATE");
              yield* instance.overviews.reportAttention("P_MATE", link, attention);
            });
          yield* report(core);
          const navigation = (origin: string, ticket: string, acknowledge = false) =>
            Effect.promise(
              () =>
                new Promise<number | null>((resolve, reject) => {
                  const ws = new WebSocket(
                    `${origin.replace("http:", "ws:")}/api/structure/ws?ticket=${ticket}`,
                  );
                  const timeout = setTimeout(() => {
                    ws.close();
                    reject(new Error("no navigation receipt"));
                  }, 3000);
                  let unseen: number | null = null;
                  let ready = false;
                  ws.addEventListener("open", () =>
                    ws.send(
                      JSON.stringify({
                        type: "subscribe",
                        scopes: [{ scope: { kind: "navigation" } }],
                      }),
                    ),
                  );
                  ws.addEventListener("error", reject);
                  ws.addEventListener("message", (event) => {
                    const message = JSON.parse(String(event.data)) as {
                      type: string;
                      values?: Array<{
                        key: string;
                        value: { person?: { unseen: number | null } };
                      }>;
                    };
                    if (message.type === "ping") ws.send('{"type":"pong"}');
                    const project = message.values?.find((value) => value.key === "project:P_MATE");
                    if (project !== undefined) unseen = project.value.person!.unseen;
                    if (message.type === "scope-ready") {
                      ready = true;
                      if (acknowledge)
                        ws.send(
                          JSON.stringify({
                            type: "seen",
                            projectId: "P_MATE",
                            resultIds: ["result", "not-a-published-result"],
                          }),
                        );
                    }
                    if (ready && (!acknowledge || (project !== undefined && unseen === 0))) {
                      clearTimeout(timeout);
                      ws.close();
                      resolve(unseen);
                    }
                  });
                }),
            );
          assert.strictEqual(
            yield* navigation(core.origin, yield* ticketFor(core.call, session)),
            1,
          );
          assert.strictEqual(
            yield* navigation(core.origin, yield* ticketFor(core.call, session), true),
            0,
          );
          yield* core.stop;
          const restarted = yield* startCore(true, {
            url: core.url,
            reconcileEvery: Duration.hours(1),
          });
          yield* untilHealth(restarted.call, "active");
          yield* report(restarted);
          const owner = yield* sessionFor(restarted.call, "door-owner-2");
          assert.strictEqual(
            yield* navigation(restarted.origin, yield* ticketFor(restarted.call, owner)),
            0,
          );
          const other = yield* sessionFor(restarted.call, "door-reader");
          // This person has no observation grant, so result coverage remains unknown.
          assert.strictEqual(
            yield* navigation(restarted.origin, yield* ticketFor(restarted.call, other)),
            null,
          );
          assert.strictEqual(
            (yield* restarted.sql`SELECT * FROM hq_attention_seen WHERE project_id = ${"P_MATE"}`)
              .length,
            1,
          );
          yield* restarted.overviews.forget(["P_MATE"]);
          assert.strictEqual(
            (yield* restarted.sql`SELECT * FROM hq_attention_seen WHERE project_id = ${"P_MATE"}`)
              .length,
            0,
          );
          yield* report(restarted);
          assert.strictEqual(
            yield* navigation(restarted.origin, yield* ticketFor(restarted.call, owner)),
            1,
          );
        }),
      ),
    );
    it.effect("seen acknowledges devstage attention without a Mate record", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const core = yield* startCore(true, { reconcileEvery: Duration.hours(1) });
          yield* untilHealth(core.call, "active");
          const session = yield* sessionFor(core.call, "door-owner");
          const app = yield* core.call("POST", "/api/apps", {
            session,
            body: { name: "Devstage" },
          });
          assert.strictEqual(app.status, 201);
          const attached = yield* core.call(
            "POST",
            `/api/apps/${(app.body as { id: string }).id}/projects`,
            {
              session,
              body: { projectId: "P_MATE", kind: "devstage", mate: { face: "face" } },
            },
          );
          assert.strictEqual(attached.status, 201);
          // This branch requires a body at attach; reproduce an attached project without its record.
          yield* core.sql`DELETE FROM hq_mate WHERE project_id = ${"P_MATE"}`;
          assert.lengthOf(yield* core.sql`SELECT * FROM hq_mate WHERE project_id = ${"P_MATE"}`, 0);
          const credential = yield* enrollMate(core.call, core.fake, "P_MATE");
          const issued = yield* core.call("POST", "/api/mate/link-ticket", {
            headers: { authorization: `Mate ${credential}` },
          });
          assert.strictEqual(issued.status, 200);
          const received = yield* Stream.toPull(
            core.overviews.changes.pipe(
              Stream.filterEffect(() =>
                Effect.map(
                  core.overviews.all,
                  (entries) => entries.get("P_MATE")?.attention !== undefined,
                ),
              ),
            ),
          );
          const wire = yield* Effect.acquireRelease(
            Effect.promise(
              () =>
                new Promise<WebSocket>((resolve, reject) => {
                  const ws = new WebSocket(
                    `${core.origin.replace("http:", "ws:")}/api/mate/link?ticket=${(issued.body as { ticket: string }).ticket}`,
                  );
                  ws.addEventListener("open", () => resolve(ws), { once: true });
                  ws.addEventListener("error", reject, { once: true });
                }),
            ),
            (ws) => Effect.sync(() => ws.close()),
          );
          wire.send(
            JSON.stringify({
              type: "attention",
              attention: {
                source: { environmentId: "devstage", incarnation: "boot", revision: 1 },
                mainThreadId: "thread",
                lastThreadId: "thread",
                working: 0,
                waiting: 0,
                results: [
                  { threadId: "thread", turnId: "result", completedAt: "2026-10-06T00:00:00.000Z" },
                ],
                questions: [],
                truncated: false,
              },
            }),
          );
          yield* received;
          const ticket = yield* ticketFor(core.call, session);
          const unseen = yield* Effect.promise(
            () =>
              new Promise<Array<number | null>>((resolve, reject) => {
                const ws = new WebSocket(
                  `${core.origin.replace("http:", "ws:")}/api/structure/ws?ticket=${ticket}`,
                );
                const fail = (error: unknown) => {
                  clearTimeout(timeout);
                  ws.close();
                  reject(error);
                };
                const timeout = setTimeout(() => fail(new Error("no seen receipt")), 3000);
                const values: Array<number | null> = [];
                ws.addEventListener("open", () =>
                  ws.send(
                    JSON.stringify({
                      type: "subscribe",
                      scopes: [{ scope: { kind: "navigation" } }],
                    }),
                  ),
                );
                ws.addEventListener("error", fail);
                ws.addEventListener("message", (event) => {
                  const message = JSON.parse(String(event.data)) as {
                    type: string;
                    values?: Array<{ key: string; value: { person?: { unseen: number | null } } }>;
                  };
                  if (message.type === "ping") ws.send('{"type":"pong"}');
                  if (message.type === "scope-error") return fail(new Error(String(event.data)));
                  const project = message.values?.find((value) => value.key === "project:P_MATE");
                  if (project !== undefined) values.push(project.value.person!.unseen);
                  if (message.type === "scope-ready")
                    ws.send(
                      JSON.stringify({
                        type: "seen",
                        projectId: "P_MATE",
                        resultIds: ["result"],
                      }),
                    );
                  if (values.at(-1) === 0) {
                    clearTimeout(timeout);
                    ws.close();
                    resolve(values);
                  }
                });
              }),
          );
          assert.deepStrictEqual(unseen, [1, 0]);
          assert.lengthOf(
            yield* core.sql`SELECT * FROM hq_attention_seen WHERE project_id = ${"P_MATE"}`,
            1,
          );
          assert.lengthOf(yield* core.sql`SELECT * FROM hq_mate WHERE project_id = ${"P_MATE"}`, 0);
        }),
      ),
    );
    it.effect("the real Mate link ingests today's overview and revisioned attention", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const core = yield* startCore(true, { reconcileEvery: Duration.hours(1) });
          yield* untilHealth(core.call, "active");
          yield* setUpMate(core.call, "P_MATE");
          const credential = yield* enrollMate(core.call, core.fake, "P_MATE");
          const issued = yield* core.call("POST", "/api/mate/link-ticket", {
            headers: { authorization: `Mate ${credential}` },
          });
          const ticket = (issued.body as { ticket: string }).ticket;
          const received = yield* Stream.toPull(
            core.overviews.changes.pipe(
              Stream.filterEffect(() =>
                Effect.map(
                  core.overviews.all,
                  (entries) => entries.get("P_MATE")?.attention?.source.revision === 3,
                ),
              ),
            ),
          );
          const wire = yield* Effect.acquireRelease(
            Effect.promise(
              () =>
                new Promise<WebSocket>((resolve, reject) => {
                  const ws = new WebSocket(
                    `${core.origin.replace("http:", "ws:")}/api/mate/link?ticket=${ticket}`,
                  );
                  ws.addEventListener("open", () => resolve(ws), { once: true });
                  ws.addEventListener("error", reject, { once: true });
                }),
            ),
            (ws) => Effect.sync(() => ws.close()),
          );
          const overview = overviewOf();
          const attention = {
            source: { environmentId: "environment", incarnation: "boot", revision: 3 },
            mainThreadId: "thread",
            lastThreadId: "thread",
            working: 1,
            waiting: 0,
            results: [],
            questions: [],
            truncated: false,
          };
          wire.send(JSON.stringify({ type: "overview", full: true, overview }));
          wire.send(
            JSON.stringify({ type: "attention", attention: { ...attention, results: null } }),
          );
          wire.send(JSON.stringify({ type: "attention", attention }));
          yield* received;
          const entry = (yield* core.overviews.all).get("P_MATE");
          assert.deepStrictEqual(entry?.overview, overview);
          assert.deepStrictEqual(entry?.attention, yield* readAttention(attention));
          assert.strictEqual(entry?.attentionState, "live");
        }),
      ),
    );
  });
});
