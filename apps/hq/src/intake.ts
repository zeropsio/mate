// @effect-diagnostics nodeBuiltinImport:off -- a webhook's secret and address are the system's randomness.
/**
 * Where an application's automated Mates take tasks from (`hq_intake`): one of its repositories with
 * a GitHub remote, and the label its issues carry (`@t3tools/shared/hqIntake`). Set and stopped by
 * the organization's structure writers (`keep_intake`).
 *
 * GitHub tells HQ of the repository's issues at `https://<HQ's own domain>/api/intake/github/<id>`
 * — HQ's address is its project's domain, as the anchor names it (`official.ts`) — signed with a
 * secret only HQ and GitHub hold, sealed (`deployKeys.ts`). HQ makes that webhook itself with the
 * repository's token where the token may (Webhooks: Read and write); else the person pastes the
 * address and the secret into the repository's settings, and HQ says why. Setting the same
 * repository again keeps its address and secret, so a pasted webhook goes on working; another
 * repository gets new ones, and the webhook HQ made on the old one goes.
 *
 * A delivery is taken only once its `X-Hub-Signature-256` holds — an HMAC-SHA256 of its bytes under
 * the secret, compared in constant time — before a byte of it is parsed (`receive`); JSON, or
 * form-encoded as a webhook pasted with GitHub's defaults sends it. An issue opened,
 * labelled or reopened carrying the label, in any case, waits as a task (`hq_task`, `queued`): once
 * per delivery and once per issue while it is live; an event of a closed issue makes none. One closed
 * or unlabelled before a Mate took it — waiting, or handed out — is dropped; one a Mate took stays
 * its Mate's.
 *
 * @module intake
 */
import * as NodeCrypto from "node:crypto";

import { MATE_TASK_BODY_MAX, MATE_TASK_TITLE_MAX } from "@t3tools/contracts";
import type { HqIntakeRequest, HqIntakeView } from "@t3tools/shared/hqIntake";
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
import { GithubIssues } from "./githubIssues.ts";
import { type RemoteIdentity, remoteIdentity } from "./gitTransport.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { can } from "./permissions.ts";
import { Remotes } from "./repoRemotes.ts";
import { Roles, confirmingRefusal } from "./roles.ts";
import { Structure } from "./structure.ts";
import type { ZeropsError } from "./zerops/api.ts";

/** Where GitHub delivers an intake's webhooks, below HQ's own address. */
export const INTAKE_WEBHOOK_PATH = "/api/intake/github";

/** A repository as GitHub names it, `owner/name`. */
const GITHUB_REPO = /^[\w.-]{1,100}\/[\w.-]{1,100}$/u;
/** A GitHub label: at most 50 characters, none of them a control character. */
const LABEL = /^[^\p{Cc}]{1,50}$/u;

/** How the person sets up the webhook they paste: GitHub's form defaults to neither. */
const PASTE_AS = "Content type: application/json; events: Issues.";

/** Why the person pastes the webhook, in their words, and how. */
const WHY = {
  refused: `The repository's token may not make webhooks. Give it Webhooks: Read and write, or add this webhook in the repository's settings. ${PASTE_AS}`,
  exists: `GitHub refused the webhook; one to this address may be there already. Check the repository's webhooks, or add this one. ${PASTE_AS}`,
  noToken: `Mate holds no working token for this repository. Add this webhook in the repository's settings. ${PASTE_AS}`,
  unreachable: `GitHub couldn't be reached. Add this webhook in the repository's settings. ${PASTE_AS}`,
} as const;

type IntakeError = AutomationRefused | NotLeader | SqlError | ZeropsError;

/** A delivery as GitHub sends it: its headers HQ reads, and its bytes as they came. */
export interface Delivery {
  readonly event: string | undefined;
  /** JSON, or form-encoded with the JSON in `payload` (GitHub's form default). */
  readonly contentType: string | undefined;
  readonly id: string | undefined;
  readonly signature: string | undefined;
  readonly body: Uint8Array;
}

/**
 * What became of a delivery: no intake at that address, its signature refused, a ping, one HQ
 * cannot read, or taken — a task queued or dropped where it moved one (`moved`), in `appId`.
 */
export type Received =
  | { readonly kind: "unknown" | "refused" | "ping" | "invalid" }
  | { readonly kind: "taken"; readonly appId: string; readonly moved: boolean };

/** What HQ reads of an `issues` event; everything else in it is passed by. */
const IssuesEvent = Schema.Struct({
  action: Schema.String,
  issue: Schema.Struct({
    number: Schema.Int,
    title: Schema.String,
    body: Schema.optionalKey(Schema.NullOr(Schema.String)),
    html_url: Schema.String,
    state: Schema.optionalKey(Schema.String),
    user: Schema.optionalKey(Schema.NullOr(Schema.Struct({ login: Schema.String }))),
    labels: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Schema.String }))),
  }),
  label: Schema.optionalKey(Schema.Struct({ name: Schema.String })),
  repository: Schema.Struct({ full_name: Schema.String }),
});
const decodeIssuesEvent = Schema.decodeUnknownOption(Schema.fromJsonString(IssuesEvent));

/** A delivery's JSON: its body, or a form-encoded body's `payload`. */
const deliveredJson = (delivery: Delivery) => {
  const text = new TextDecoder().decode(delivery.body);
  const form = /^application\/x-www-form-urlencoded\b/iu.test(delivery.contentType ?? "");
  return form ? (new URLSearchParams(text).get("payload") ?? "") : text;
};

/** Whether `signature` (`sha256=<hex>`) is the HMAC-SHA256 of `body` under `secret`. */
export const signatureHolds = (
  secret: Redacted.Redacted,
  body: Uint8Array,
  signature: string | undefined,
) => {
  const presented = /^sha256=([0-9a-f]{64})$/u.exec(signature ?? "")?.[1];
  if (presented === undefined) return false;
  const expected = NodeCrypto.createHmac("sha256", Redacted.value(secret)).update(body).digest();
  return NodeCrypto.timingSafeEqual(expected, Buffer.from(presented, "hex"));
};

export class Intake extends Context.Service<
  Intake,
  {
    readonly keep: (
      userId: string,
      appId: string,
      request: HqIntakeRequest,
    ) => Effect.Effect<HqIntakeView, IntakeError>;
    readonly stop: (userId: string, appId: string) => Effect.Effect<void, IntakeError>;
    /** GitHub's delivery to the intake at `publicId`. */
    readonly receive: (
      publicId: string,
      delivery: Delivery,
    ) => Effect.Effect<Received, NotLeader | SqlError>;
  }
>()("@t3tools/hq/intake") {}

interface IntakeRow {
  readonly repo: string;
  readonly hq_repo: string;
  readonly label: string;
  readonly public_id: string;
  readonly sealed: Uint8Array;
  readonly key_id: string;
  readonly hook_id: string | null;
}

const randomId = (bytes: number) => NodeCrypto.randomBytes(bytes).toString("base64url");

export const intakeLayer = (options: { readonly hqProjectId: string }) =>
  Layer.effect(
    Intake,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const leader = yield* Leader;
      const roles = yield* Roles;
      const keys = yield* DeployKeys;
      const remotes = yield* Remotes;
      const github = yield* GithubIssues;
      const structure = yield* Structure;

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

      const rowOf = (appId: string) =>
        Effect.map(
          sql<IntakeRow>`
            SELECT repo, hq_repo, label, public_id, sealed, key_id, hook_id::text AS hook_id
            FROM hq_intake WHERE app_id::text = ${appId}`,
          (rows) => rows[0],
        );

      /** The application's repository whose GitHub remote is `repo`, and that remote. */
      const remoteFor = (appId: string, repo: string) =>
        Effect.gen(function* () {
          const rows = yield* sql<{ readonly repo: string; readonly url: string }>`
            SELECT repo, url FROM hq_repo_remote WHERE app_id::text = ${appId} ORDER BY repo`;
          for (const row of rows) {
            const remote = remoteIdentity(row.url);
            if (remote?.kind === "github" && remote.path === repo)
              return { hqRepo: row.repo, remote };
          }
          return yield* refuse("conflict", "repo_not_connected");
        });

      /** HQ's own address, as GitHub reaches it. */
      const webhookUrl = (publicId: string) =>
        Effect.gen(function* () {
          const zone = (yield* roles.view).projects.find(
            (project) => project.id === options.hqProjectId,
          )?.publicZone;
          if (!zone) return yield* refuse("conflict", "hq_address_unknown");
          return `https://${zone}${INTAKE_WEBHOOK_PATH}/${publicId}`;
        });

      /** The webhook made with the repository's token, or why the person makes it. */
      const makeHook = (
        appId: string,
        hqRepo: string,
        remote: RemoteIdentity,
        url: string,
        secret: Redacted.Redacted,
      ) =>
        Effect.gen(function* () {
          const { token } = yield* remotes.tokenOf({ appId, repo: hqRepo });
          const reply = yield* github.makeHook(remote, token, { url, secret });
          if (reply.status === 201 && reply.id !== undefined) return { id: reply.id } as const;
          yield* Effect.logInfo("intake webhook not made", { appId, status: reply.status });
          return { why: reply.status === 422 ? WHY.exists : WHY.refused } as const;
        }).pipe(
          Effect.catch((error) =>
            Effect.as(Effect.logInfo("intake webhook not made", { appId, why: error._tag }), {
              why: error._tag === "HostUnreachable" ? WHY.unreachable : WHY.noToken,
            } as const),
          ),
        );

      /** The webhook HQ made on `hqRepo`, removed; one it cannot remove now is left, logged. */
      const removeHook = (appId: string, hqRepo: string, hookId: number) =>
        Effect.gen(function* () {
          const { token, remote } = yield* remotes.tokenOf({ appId, repo: hqRepo });
          const identity = remoteIdentity(remote.url);
          if (identity === undefined) return;
          const status = yield* github.removeHook(identity, token, hookId);
          if (status !== 204 && status !== 404)
            yield* Effect.logWarning("intake webhook not removed", { appId, status });
        }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("intake webhook not removed", { appId, why: error._tag }),
          ),
        );

      /** An issue's task, waiting: once per delivery, once per issue while it is live. */
      const queue = (appId: string, deliveryId: string, event: typeof IssuesEvent.Type) =>
        Effect.gen(function* () {
          const { issue } = event;
          const title =
            issue.title.trim().slice(0, MATE_TASK_TITLE_MAX) || `Issue #${String(issue.number)}`;
          const rows = yield* leader.write(sql`
            INSERT INTO hq_task (app_id, repo, number, title, body, url, author, delivery_id, state)
            VALUES (${appId}::uuid, ${event.repository.full_name.toLowerCase()}, ${issue.number},
              ${title}, ${(issue.body ?? "").slice(0, MATE_TASK_BODY_MAX)}, ${issue.html_url},
              ${issue.user?.login ?? null}, ${deliveryId}, 'queued')
            ON CONFLICT DO NOTHING
            RETURNING 1`);
          return rows.length > 0;
        });

      /**
       * The issue's task no Mate took yet, dropped — waiting, or handed out and not taken: its
       * issue closed or lost the label. The Mate it was handed to is free again.
       */
      const drop = (appId: string, repo: string, number: number, why: string) =>
        Effect.gen(function* () {
          const rows = yield* leader.write(sql<{ readonly was: string | null }>`
            WITH gone AS (
              SELECT id, mate_project_id AS was FROM hq_task
              WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}
                AND state IN ('queued', 'assigned')
              FOR UPDATE)
            UPDATE hq_task t SET state = 'dropped', detail = ${why}, mate_project_id = NULL,
              assigned_at = NULL, updated_at = now()
            FROM gone WHERE t.id = gone.id
            RETURNING gone.was`);
          for (const { was } of rows) if (was !== null) yield* structure.mateTouched(was);
          return rows.length > 0;
        });

      return Intake.of({
        receive: (publicId, delivery) =>
          Effect.gen(function* () {
            const [row] = yield* sql<{
              readonly app_id: string;
              readonly repo: string;
              readonly label: string;
              readonly sealed: Uint8Array;
              readonly key_id: string;
            }>`
              SELECT app_id::text AS app_id, repo, label, sealed, key_id FROM hq_intake
              WHERE public_id = ${publicId}`;
            if (row === undefined) return { kind: "unknown" } as const;
            const secret = keys.openIntake(row.app_id, publicId, {
              sealed: row.sealed,
              keyId: row.key_id,
            });
            if (secret === undefined || !signatureHolds(secret, delivery.body, delivery.signature))
              return { kind: "refused" } as const;
            if (delivery.event === "ping") return { kind: "ping" } as const;
            if (delivery.event !== "issues")
              return { kind: "taken", appId: row.app_id, moved: false } as const;
            const read = decodeIssuesEvent(deliveredJson(delivery));
            if (Option.isNone(read) || delivery.id === undefined || delivery.id === "")
              return { kind: "invalid" } as const;
            const event = read.value;
            const repo = event.repository.full_name.toLowerCase();
            if (repo !== row.repo || event.issue.number < 1)
              return { kind: "taken", appId: row.app_id, moved: false } as const;
            const label = row.label.toLowerCase();
            const carries = (event.issue.labels ?? []).some(
              (candidate) => candidate.name.toLowerCase() === label,
            );
            const named = event.label?.name.toLowerCase() === label;
            // A closed issue is no task, whatever else its event says.
            const open = (event.issue.state ?? "open") === "open";
            const moved =
              event.action === "opened" || event.action === "reopened"
                ? open && carries && (yield* queue(row.app_id, delivery.id, event))
                : event.action === "labeled"
                  ? open && named && (yield* queue(row.app_id, delivery.id, event))
                  : event.action === "closed"
                    ? yield* drop(row.app_id, repo, event.issue.number, "issue closed")
                    : event.action === "unlabeled" && named
                      ? yield* drop(row.app_id, repo, event.issue.number, "label removed")
                      : false;
            if (moved) yield* structure.touched;
            return { kind: "taken", appId: row.app_id, moved } as const;
          }),
        keep: (userId, appId, request) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* authorized(userId, appId);
              const repo = request.repo.toLowerCase();
              const label = request.label.trim();
              if (!GITHUB_REPO.test(repo)) return yield* refuse("invalid", "repo");
              if (!LABEL.test(label)) return yield* refuse("invalid", "label");
              const { hqRepo, remote } = yield* remoteFor(appId, repo);
              const before = yield* rowOf(appId);
              const same = before?.repo === repo && before.hq_repo === hqRepo;
              const kept =
                same && before !== undefined
                  ? keys.openIntake(appId, before.public_id, {
                      sealed: before.sealed,
                      keyId: before.key_id,
                    })
                  : undefined;
              const publicId =
                kept !== undefined && before !== undefined ? before.public_id : randomId(24);
              const secret = kept ?? Redacted.make(NodeCrypto.randomBytes(32).toString("hex"));
              const sealed = keys.sealIntake(appId, publicId, secret);
              if (sealed === undefined) return yield* refuse("conflict", "no_key_secret");
              const url = yield* webhookUrl(publicId);
              const heldHook =
                kept !== undefined && before?.hook_id != null ? before.hook_id : null;
              yield* leader.write(sql`
                INSERT INTO hq_intake (app_id, repo, hq_repo, label, public_id, sealed, key_id, hook_id, created_by)
                VALUES (${appId}::uuid, ${repo}, ${hqRepo}, ${label}, ${publicId}, ${sealed.sealed},
                  ${sealed.keyId}, ${heldHook}::bigint, ${userId})
                ON CONFLICT (app_id) DO UPDATE SET repo = EXCLUDED.repo, hq_repo = EXCLUDED.hq_repo,
                  label = EXCLUDED.label, public_id = EXCLUDED.public_id, sealed = EXCLUDED.sealed,
                  key_id = EXCLUDED.key_id, hook_id = EXCLUDED.hook_id, updated_at = now()`);
              yield* structure.touched;
              // The old repository's webhook goes once nothing delivers to it any more.
              if (before?.hook_id != null && heldHook === null)
                yield* removeHook(appId, before.hq_repo, Number(before.hook_id));
              if (heldHook !== null)
                return { appId, repo, label, webhookUrl: url, hook: { kind: "made" } } as const;
              const hook = yield* makeHook(appId, hqRepo, remote, url, secret);
              if ("id" in hook) {
                yield* leader.write(sql`
                  UPDATE hq_intake SET hook_id = ${hook.id} WHERE app_id::text = ${appId}
                    AND public_id = ${publicId}`);
                return { appId, repo, label, webhookUrl: url, hook: { kind: "made" } } as const;
              }
              return {
                appId,
                repo,
                label,
                webhookUrl: url,
                hook: { kind: "paste", secret: Redacted.value(secret), why: hook.why },
              } as const;
            }),
          ),
        stop: (userId, appId) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* authorized(userId, appId);
              const before = yield* rowOf(appId);
              if (before === undefined) return;
              yield* leader.write(
                Effect.gen(function* () {
                  yield* sql`DELETE FROM hq_intake WHERE app_id::text = ${appId}`;
                  // What still waits came from it: nobody takes it now.
                  yield* sql`
                    UPDATE hq_task SET state = 'dropped', detail = 'intake stopped', updated_at = now()
                    WHERE app_id::text = ${appId} AND state = 'queued'`;
                }),
              );
              yield* structure.touched;
              if (before.hook_id !== null)
                yield* removeHook(appId, before.hq_repo, Number(before.hook_id));
            }),
          ),
      });
    }),
  );
