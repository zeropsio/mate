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
      "five concurrent readers get navigation within budget; unchanged segments send no values",
      () =>
        Effect.gen(function* () {
          const core = yield* startCore(true, { reconcileEvery: Duration.hours(1) });
          yield* untilHealth(core.call, "active");
          const session = yield* sessionFor(core.call, "door-owner");
          const created = yield* core.call("POST", "/api/apps", {
            session,
            body: { name: "Alpha" },
          });
          assert.strictEqual(created.status, 201);
          yield* Effect.forEach(
            Array.from({ length: 29 }, (_, index) => index),
            (index) => core.call("POST", "/api/apps", { session, body: { name: `App ${index}` } }),
            { concurrency: 4 },
          );
          const tickets = yield* Effect.forEach(
            [0, 1, 2, 3, 4],
            () => ticketFor(core.call, session),
            { concurrency: "unbounded" },
          );
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
                      if (message.type === "scope-reset" || message.type === "scope-values")
                        deliveries.push(message);
                      if (message.type === "scope-ready") {
                        clearTimeout(timeout);
                        ws.close();
                        resolve({
                          elapsed: performance.now() - began,
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
          const times = samples.map((sample) => sample.elapsed).sort((a, b) => a - b);
          console.info(
            `HQ five subscribers p50=${times[2]?.toFixed(1)}ms p95=${times[4]?.toFixed(1)}ms`,
          );
          assert.isAtMost(times[2]!, 300);
          assert.isAtMost(times[4]!, 600);
          for (const sample of samples) {
            assert.lengthOf(sample.deliveries, 1);
            const payload = JSON.stringify(sample.deliveries);
            assert.include(payload, "Alpha");
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
