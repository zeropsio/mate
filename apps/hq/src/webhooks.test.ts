// @effect-diagnostics nodeBuiltinImport:off -- a webhook's caller signs with HMAC-SHA256.
import * as NodeCrypto from "node:crypto";

import { assert, describe, it } from "@effect/vitest";
import type { MateTask } from "@t3tools/contracts";
import type { HqWebhookView } from "@t3tools/shared/hqIntake";
import type { HqNavigationProject } from "@t3tools/shared/hqStream";
import * as Effect from "effect/Effect";

import { attention, automatedPool } from "../test/harness/automated.ts";
import { rowsWhere } from "../test/harness/mates.ts";
import { sessionFor, ticketFor } from "../test/harness/runningCore.ts";
import { nextScopeValue, scopeReset } from "../test/harness/scopes.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

type Pool = Effect.Success<ReturnType<typeof automatedPool>>;

const NAV = { kind: "navigation" } as const;

/** The application's webhook `name`, as its maker is answered. */
const webhookOf = (core: Pool, name = "Sentry") =>
  Effect.map(
    core.call("POST", `/api/apps/${core.appId}/webhooks`, {
      session: core.owner,
      body: { name },
    }),
    (made) => {
      assert.strictEqual(made.status, 201);
      return made.body as HqWebhookView & { readonly secret: string };
    },
  );

/** A call on the webhook: `payload` as JSON, signed with `secret` unless a signature is given. */
const called = (
  core: Pool,
  hook: { readonly url: string; readonly secret: string },
  payload: unknown,
  options: { readonly signature?: string | null; readonly delivery?: string } = {},
) => {
  const bytes = new TextEncoder().encode(
    typeof payload === "string" ? payload : JSON.stringify(payload),
  );
  const signature =
    options.signature === undefined
      ? `sha256=${NodeCrypto.createHmac("sha256", hook.secret).update(bytes).digest("hex")}`
      : options.signature;
  return core.call("POST", new URL(hook.url).pathname, {
    body: bytes,
    headers: {
      "content-type": "application/json",
      ...(signature === null ? {} : { "x-mate-signature": signature }),
      ...(options.delivery === undefined ? {} : { "x-mate-delivery": options.delivery }),
    },
  });
};

const taskRows = (core: Pool, matches: (rows: ReadonlyArray<Record<string, unknown>>) => boolean) =>
  rowsWhere(core.url, "SELECT source_key, state, body FROM hq_task ORDER BY seq", matches);

describe("an application's signed webhooks", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a structure writer makes an application's webhook, its secret shown once; a developer may not; removed, it takes no more calls",
      () =>
        Effect.gen(function* () {
          const core = yield* automatedPool();
          const hook = yield* webhookOf(core);
          assert.match(
            hook.url,
            /^https:\/\/hqzone\.prg1-zerops\.zone\/api\/intake\/webhook\/\S+$/u,
          );
          assert.match(hook.secret, /^[0-9a-f]{64}$/u);
          const listed = yield* core.call("GET", `/api/apps/${core.appId}/webhooks`, {
            session: core.owner,
          });
          assert.deepStrictEqual(listed.body, {
            webhooks: [{ id: hook.id, name: "Sentry", url: hook.url, createdAt: hook.createdAt }],
          });
          const developer = yield* sessionFor(core.call, "door-dev");
          const refused = yield* core.call("POST", `/api/apps/${core.appId}/webhooks`, {
            session: developer,
            body: { name: "PagerDuty" },
          });
          assert.strictEqual(refused.status, 403);
          const removed = yield* core.call(
            "DELETE",
            `/api/apps/${core.appId}/webhooks/${hook.id}`,
            { session: core.owner },
          );
          assert.strictEqual(removed.status, 204);
          assert.strictEqual((yield* called(core, hook, { title: "Down" })).status, 404);
        }),
    );

    it.effect(
      "a call signed with the webhook's secret becomes a task of the application, named for the webhook; one that is unsigned, mis-signed, too big or unreadable takes nothing in",
      () =>
        Effect.gen(function* () {
          const core = yield* automatedPool();
          const hook = yield* webhookOf(core);
          const ok = { title: "TypeError in checkout", body: "Stack: …" };
          assert.strictEqual((yield* called(core, hook, ok, { signature: null })).status, 401);
          assert.strictEqual(
            (yield* called(core, hook, ok, { signature: `sha256=${"0".repeat(64)}` })).status,
            401,
          );
          assert.strictEqual((yield* called(core, hook, "not json")).status, 400);
          assert.strictEqual((yield* called(core, hook, { body: "no title" })).status, 400);
          assert.strictEqual(
            (yield* called(core, hook, { title: "Big", body: "x".repeat(1024 * 1024) })).status,
            413,
          );
          const taken = yield* called(core, hook, {
            ...ok,
            url: "https://sentry.example/issues/7",
            author: "Sentry",
          });
          assert.deepStrictEqual(
            [taken.status, taken.body],
            [202, { status: "queued", position: 1 }],
          );
          const frame = yield* core.robot.link.takeWhere(
            "the webhook's task",
            (message) =>
              message.type === "task" && (message["task"] as MateTask).source.kind === "webhook",
          );
          const task = frame["task"] as MateTask;
          assert.deepStrictEqual(task.source, {
            kind: "webhook",
            name: "Sentry",
            url: "https://sentry.example/issues/7",
            title: "TypeError in checkout",
            author: "Sentry",
          });
          assert.strictEqual(task.body, "Stack: …");
          // A link a person could not safely follow is none.
          yield* called(core, hook, { title: "Odd", url: "javascript:alert(1)" });
          const rows = yield* rowsWhere(
            core.url,
            "SELECT source->'url' AS url FROM hq_task ORDER BY seq",
            (found) => found.length === 2,
          );
          assert.strictEqual(rows[1]!["url"], null);
        }),
    );

    it.effect(
      "calls with one dedupeKey are one task while it is live, a later one with news a message to it; a delivery sent twice is taken once",
      () =>
        Effect.gen(function* () {
          const core = yield* automatedPool({ busy: true });
          const hook = yield* webhookOf(core);
          const alert = (body: string, delivery?: string) =>
            called(
              core,
              hook,
              { title: "Checkout down", body, dedupeKey: "incident-42" },
              delivery === undefined ? {} : { delivery },
            );
          assert.deepStrictEqual((yield* alert("Down since 10:00.", "d-1")).body, {
            status: "queued",
            position: 1,
          });
          assert.deepStrictEqual((yield* alert("Down since 10:00.", "d-1")).body, {
            status: "duplicate",
          });
          assert.deepStrictEqual((yield* alert("Still down at 10:30.")).body, { status: "told" });
          const rows = yield* taskRows(core, (found) => found.length === 1);
          assert.match(String(rows[0]!["source_key"]), /^webhook:[0-9a-f-]+\/incident-42$/u);
          const [message] = yield* rowsWhere(
            core.url,
            "SELECT source, text FROM hq_task_message",
            (found) => found.length === 1,
          );
          assert.deepStrictEqual(message, { source: "edit", text: "Still down at 10:30." });
        }),
    );

    it.effect("a call with no dedupeKey replayed while its task is live is no new task", () =>
      Effect.gen(function* () {
        const core = yield* automatedPool({ busy: true });
        const hook = yield* webhookOf(core);
        const call = { title: "Checkout down", body: "Down since 10:00." };
        assert.deepInclude((yield* called(core, hook, call)).body, { status: "queued" });
        assert.deepStrictEqual((yield* called(core, hook, call)).body, { status: "told" });
        assert.deepInclude(
          (yield* called(core, hook, { ...call, body: "Down since 11:00." })).body,
          { status: "queued", position: 2 },
        );
        const rows = yield* taskRows(core, (found) => found.length === 2);
        assert.strictEqual(rows.length, 2);
      }),
    );

    it.effect(
      "an automated Mate on a task from elsewhere names it on its row: where it came from, its title and link, no issue number",
      () =>
        Effect.gen(function* () {
          const core = yield* automatedPool({ busy: true });
          const watching = yield* core.socket(
            `/api/structure/ws?ticket=${yield* ticketFor(core.call, core.owner)}`,
          );
          yield* scopeReset(watching, NAV);
          const hook = yield* webhookOf(core);
          yield* called(core, hook, { title: "Checkout down", url: "https://status.example/1" });
          yield* core.robot.link.send(attention(0));
          const frame = yield* core.robot.link.take("task");
          const task = frame["task"] as MateTask;
          const row = yield* nextScopeValue<HqNavigationProject>(
            watching,
            NAV,
            "project:P_ROBOT",
            (project) => project.mate?.task != null,
          );
          assert.deepStrictEqual(row.mate?.task, {
            id: task.id,
            title: "Checkout down",
            url: "https://status.example/1",
            label: "the Sentry webhook",
          });
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "waiting", question: "Roll back?" },
          });
          const waiting = yield* nextScopeValue<HqNavigationProject>(
            watching,
            NAV,
            "project:P_ROBOT",
            (project) => project.mate?.task?.waiting === true,
          );
          assert.strictEqual(waiting.mate?.task?.label, "the Sentry webhook");
          yield* watching.close;
        }),
    );
  });
});
