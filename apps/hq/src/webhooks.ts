// @effect-diagnostics nodeBuiltinImport:off -- a webhook's secret and address are the system's randomness.
/**
 * An application's signed webhooks (`hq_webhook`, `@t3tools/shared/hqIntake` `HqWebhookView`):
 * anything that can sign a request — a Sentry alert, a PagerDuty incident, a Jira rule — hands the
 * application's automated Mates a task. Made, listed and removed by the organization's structure
 * writers (`keep_intake`); the secret is answered once, by the call that made it, and kept sealed
 * (`deployKeys.ts` `sealSecret`).
 *
 * A call is `POST https://<HQ's own domain>/api/intake/webhook/<id>` with JSON
 * `{title, body?, url?, author?, dedupeKey?}`, signed `X-Mate-Signature: sha256=<hex>` — an
 * HMAC-SHA256 of its bytes under the secret, checked in constant time before a byte of it is
 * parsed. It becomes a task through HQ's door (`TaskIntake`) of a `WebhookSource`: one per key
 * while its task is live — its `dedupeKey`, else a hash of its bytes, so a replay is no new task —
 * a second call with news being a message to it. `X-Mate-Delivery` names a call its sender may send twice, taken once.
 *
 * @module webhooks
 */
import * as NodeCrypto from "node:crypto";

import { MATE_TASK_TITLE_MAX } from "@t3tools/contracts";
import type { HqWebhookRequest, HqWebhookView } from "@t3tools/shared/hqIntake";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { AutomationRefused } from "./automationRefused.ts";
import { DeployKeys } from "./deployKeys.ts";
import { signatureHolds } from "./intake.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { can } from "./permissions.ts";
import { Roles, confirmingRefusal } from "./roles.ts";
import {
  type TaskEnqueued,
  TaskIntake,
  type TaskIntakeUnavailable,
  cleanTaskTitle,
} from "./taskSources.ts";
import type { ZeropsError } from "./zerops/api.ts";

/** Where a webhook's calls come, below HQ's own address. */
export const WEBHOOK_PATH = "/api/intake/webhook";
/** How many webhooks an application keeps. */
const WEBHOOKS_MAX = 20;
const TABLE = "hq_webhook";

/** A call's JSON, as HQ reads it. */
const Call = Schema.Struct({
  title: Schema.String,
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  url: Schema.optionalKey(Schema.NullOr(Schema.String)),
  author: Schema.optionalKey(Schema.NullOr(Schema.String)),
  dedupeKey: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const decodeCall = Schema.decodeUnknownOption(Schema.fromJsonString(Call));

/** A call as it came: the bytes its signature covers, and the headers HQ reads. */
export interface WebhookCall {
  readonly signature: string | undefined;
  readonly delivery: string | undefined;
  readonly body: Uint8Array;
}

/** What became of a call: no webhook there, its signature refused, unreadable, or taken in. */
export type WebhookReceived =
  | { readonly kind: "unknown" | "refused" | "invalid" }
  | { readonly kind: "taken"; readonly enqueued: TaskEnqueued };

type WebhookError = AutomationRefused | NotLeader | SqlError | ZeropsError;

export class Webhooks extends Context.Service<
  Webhooks,
  {
    readonly make: (
      userId: string,
      appId: string,
      request: HqWebhookRequest,
    ) => Effect.Effect<HqWebhookView, WebhookError>;
    readonly list: (
      userId: string,
      appId: string,
    ) => Effect.Effect<ReadonlyArray<HqWebhookView>, WebhookError>;
    readonly remove: (
      userId: string,
      appId: string,
      id: string,
    ) => Effect.Effect<void, WebhookError>;
    readonly receive: (
      publicId: string,
      call: WebhookCall,
    ) => Effect.Effect<WebhookReceived, SqlError | TaskIntakeUnavailable>;
  }
>()("@t3tools/hq/webhooks") {}

/** A link a caller gave, where it is one a person may follow; none otherwise. */
const linkOf = (url: string | null | undefined) => {
  const trimmed = url?.trim() ?? "";
  return /^https?:\/\/\S+$/iu.test(trimmed) && trimmed.length <= 2000 ? trimmed : null;
};
/** A short text a caller gave, or none. */
const shortOf = (text: string | null | undefined, max: number) => {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed.slice(0, max);
};

export const webhooksLayer = (options: { readonly hqProjectId: string }) =>
  Layer.effect(
    Webhooks,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const leader = yield* Leader;
      const roles = yield* Roles;
      const keys = yield* DeployKeys;
      const intake = yield* TaskIntake;

      const refuse = (code: AutomationRefused["code"], reason: string) =>
        Effect.fail(new AutomationRefused({ code, reason }));

      const authorized = (userId: string, appId: string) =>
        Effect.gen(function* () {
          const verdict = can(
            { kind: "person", userId },
            "keep_intake",
            null,
            yield* roles.forWrite,
          );
          if (!verdict.allow) return yield* refuse("forbidden", verdict.reason);
          const apps = yield* sql`SELECT 1 FROM hq_app WHERE id::text = ${appId}`;
          if (apps.length === 0) return yield* refuse("app_not_found", "app_not_found");
        });

      /** HQ's own address, as a caller reaches it. */
      const urlOf = (publicId: string) =>
        Effect.gen(function* () {
          const zone = (yield* roles.view).projects.find(
            (project) => project.id === options.hqProjectId,
          )?.publicZone;
          if (!zone) return yield* refuse("conflict", "hq_address_unknown");
          return `https://${zone}${WEBHOOK_PATH}/${publicId}`;
        });

      const viewOf = (
        row: {
          readonly id: string;
          readonly name: string;
          readonly public_id: string;
          readonly created_at: string;
        },
        url: string,
      ): HqWebhookView => ({ id: row.id, name: row.name, url, createdAt: row.created_at });

      const COLUMNS = sql.literal(`id::text AS id, name, public_id,
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at`);

      return Webhooks.of({
        make: (userId, appId, request) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* authorized(userId, appId);
              const name = request.name.trim();
              if (name.length > 80) return yield* refuse("invalid", "name");
              const [count] = yield* sql<{ readonly count: number }>`
                SELECT count(*)::int AS count FROM hq_webhook WHERE app_id::text = ${appId}`;
              if ((count?.count ?? 0) >= WEBHOOKS_MAX) return yield* refuse("conflict", "too_many");
              const publicId = NodeCrypto.randomBytes(24).toString("base64url");
              const secret = Redacted.make(NodeCrypto.randomBytes(32).toString("hex"));
              const sealed = keys.sealSecret(TABLE, [appId, publicId], secret);
              if (sealed === undefined) return yield* refuse("conflict", "no_key_secret");
              const url = yield* urlOf(publicId);
              const [row] = yield* leader.write(sql<{
                readonly id: string;
                readonly name: string;
                readonly public_id: string;
                readonly created_at: string;
              }>`
                INSERT INTO hq_webhook (app_id, name, public_id, sealed, key_id, created_by)
                VALUES (${appId}::uuid, ${name}, ${publicId}, ${sealed.sealed}, ${sealed.keyId},
                  ${userId})
                RETURNING ${COLUMNS}`);
              return { ...viewOf(row!, url), secret: Redacted.value(secret) };
            }),
          ),
        list: (userId, appId) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* authorized(userId, appId);
              const rows = yield* sql<{
                readonly id: string;
                readonly name: string;
                readonly public_id: string;
                readonly created_at: string;
              }>`SELECT ${COLUMNS} FROM hq_webhook WHERE app_id::text = ${appId} ORDER BY seq`;
              const views: Array<HqWebhookView> = [];
              for (const row of rows) views.push(viewOf(row, yield* urlOf(row.public_id)));
              return views;
            }),
          ),
        remove: (userId, appId, id) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* authorized(userId, appId);
              const gone = yield* leader.write(sql`
                DELETE FROM hq_webhook WHERE app_id::text = ${appId} AND id::text = ${id}
                RETURNING 1`);
              if (gone.length === 0) return yield* refuse("not_found", "webhook_not_found");
            }),
          ),
        receive: (publicId, call) =>
          Effect.gen(function* () {
            const [row] = yield* sql<{
              readonly id: string;
              readonly app_id: string;
              readonly name: string;
              readonly sealed: Uint8Array;
              readonly key_id: string;
            }>`
              SELECT id::text AS id, app_id::text AS app_id, name, sealed, key_id FROM hq_webhook
              WHERE public_id = ${publicId}`;
            if (row === undefined) return { kind: "unknown" } as const;
            const secret = keys.openSecret(TABLE, [row.app_id, publicId], {
              sealed: row.sealed,
              keyId: row.key_id,
            });
            if (secret === undefined || !signatureHolds(secret, call.body, call.signature))
              return { kind: "refused" } as const;
            const read = decodeCall(new TextDecoder().decode(call.body));
            if (Option.isNone(read) || read.value.title.trim() === "")
              return { kind: "invalid" } as const;
            const given = read.value;
            const delivery = shortOf(call.delivery, 200) ?? NodeCrypto.randomUUID();
            const dedupeKey = shortOf(given.dedupeKey, 200);
            const enqueued = yield* intake.enqueue({
              appId: row.app_id,
              source: {
                kind: "webhook",
                name: row.name,
                url: linkOf(given.url),
                title: cleanTaskTitle(given.title, "Untitled call"),
                author: shortOf(given.author, MATE_TASK_TITLE_MAX),
              },
              body: given.body ?? "",
              // With no key of its own, a call is the work item its bytes say: replayed while its
              // task is live, it is no new task.
              sourceKey: `webhook:${row.id}/${
                dedupeKey ??
                `sha256:${NodeCrypto.createHash("sha256").update(call.body).digest("hex")}`
              }`,
              deliveryId: `webhook:${row.id}:${delivery}`,
              requestedBy: null,
            });
            return { kind: "taken", enqueued } as const;
          }),
      });
    }),
  );
