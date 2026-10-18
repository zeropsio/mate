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
 * repository gets new ones, and the webhook HQ made on the old one goes. Stopped or moved, the
 * tasks no Mate took yet from the repository it leaves are dropped. Where the organization's
 * GitHub app (`githubApp.ts`) reaches the repository, its own webhook delivers the repository's
 * issues (`GithubEvents`): HQ makes no webhook there and removes the one it made, and a delivery
 * to the intake's own address is passed by. Either way an event is worked the same.
 *
 * A delivery is taken only once its `X-Hub-Signature-256` holds — an HMAC-SHA256 of its bytes under
 * the secret, compared in constant time — before a byte of it is parsed (`receive`); JSON, or
 * form-encoded as a webhook pasted with GitHub's defaults sends it. An issue opened, labelled or
 * reopened carrying the label, in any case, becomes a task through HQ's door (`TaskIntake`): once
 * per delivery and once per issue while it is live; an event of a closed issue makes none. Only a
 * person who can write to the repository may hand an issue over (`githubGate.ts`), the task asked
 * for by the member their GitHub profile's email names, if any — anyone else is told why on the
 * issue, once per try, and a bot is passed by. A public repository's issues are taken only where its intake says `public`.
 * Closing an issue or removing its label stops its task (`TaskIntake.stop`). After it came in, a
 * comment such a person makes on the issue (not a bot's, not HQ's own) and an edit of the issue
 * are said to its task (`TaskIntake.message`); an edit before any Mate took it rewrites the task.
 * Such a comment after its task ended is answered once per end, on the issue, with how it ended.
 *
 * @module intake
 */
import * as NodeCrypto from "node:crypto";

import type { GithubIssueSource } from "@t3tools/contracts";
import type { HqIntakeRequest, HqIntakeView } from "@t3tools/shared/hqIntake";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type * as Statement from "effect/sql/Statement";
import type { SqlError } from "effect/sql/SqlError";

import { AutomationRefused } from "./automationRefused.ts";
import { DeployKeys } from "./deployKeys.ts";
import { GithubAuth } from "./githubAuth.ts";
import { type GithubEvent, GithubEvents } from "./githubEvents.ts";
import { GithubIssues } from "./githubIssues.ts";
import { type RemoteIdentity, remoteIdentity } from "./gitTransport.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { can } from "./permissions.ts";
import { Remotes } from "./repoRemotes.ts";
import { Roles, confirmingRefusal } from "./roles.ts";
import { Structure } from "./structure.ts";
import { MateTasks, taskListens } from "./mateTasks.ts";
import { HQ_MARK, marked } from "./githubChannel.ts";
import { type GithubActor, GithubGate } from "./githubGate.ts";
import {
  TaskIntake,
  TaskIntakeUnavailable,
  cleanTaskText,
  cleanTaskTitle,
  taskEndWords,
} from "./taskSources.ts";

import type { ZeropsError } from "./zerops/api.ts";

/** Why an issue's task stopped, as its status line says. */
export const ISSUE_CLOSED = "the issue was closed.";
export const LABEL_REMOVED = "the label was removed.";
const INTAKE_MOVED = "the application's intake moved to another repository.";
const INTAKE_STOPPED = "the application's intake was stopped.";

/** An issue's work item (`TaskEnqueue.sourceKey`). */
export const issueKey = (repo: string, number: number) => `github:${repo}#${String(number)}`;

/** An issue as its task's source names it. */
const issueSource = (
  repo: string,
  issue: {
    readonly number: number;
    readonly title: string;
    readonly html_url: string;
    readonly user?: { readonly login: string } | null;
  },
): GithubIssueSource => ({
  kind: "github-issue",
  repo,
  number: issue.number,
  url: issue.html_url,
  title: cleanTaskTitle(issue.title, `Issue #${String(issue.number)}`),
  author: issue.user?.login ?? null,
});

/** Where GitHub delivers an intake's webhooks, below HQ's own address. */
export const INTAKE_WEBHOOK_PATH = "/api/intake/github";

/** A repository as GitHub names it, `owner/name`. */
const GITHUB_REPO = /^[\w.-]{1,100}\/[\w.-]{1,100}$/u;
/** A GitHub label: at most 50 characters, none of them a control character. */
const LABEL = /^[^\p{Cc}]{1,50}$/u;

/** How the person sets up the webhook they paste: GitHub's form defaults to neither. */
const PASTE_AS = "Content type: application/json; events: Issues, Issue comments.";

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

const Actor = Schema.Struct({ login: Schema.String, type: Schema.optionalKey(Schema.String) });
const Issue = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  html_url: Schema.String,
  state: Schema.optionalKey(Schema.String),
  user: Schema.optionalKey(Schema.NullOr(Actor)),
  labels: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Schema.String }))),
});
const Repository = Schema.Struct({
  full_name: Schema.String,
  private: Schema.optionalKey(Schema.Boolean),
});

/** What HQ reads of an `issues` event; everything else in it is passed by. */
const IssuesEvent = Schema.Struct({
  action: Schema.String,
  issue: Issue,
  label: Schema.optionalKey(Schema.Struct({ name: Schema.String })),
  repository: Repository,
  sender: Schema.optionalKey(Actor),
  /** What an edit changed: a field it left alone is absent. */
  changes: Schema.optionalKey(
    Schema.Struct({
      title: Schema.optionalKey(Schema.Unknown),
      body: Schema.optionalKey(Schema.Unknown),
    }),
  ),
});
const decodeIssuesEvent = Schema.decodeUnknownOption(IssuesEvent);

/** What HQ reads of an `issue_comment` event. */
const CommentEvent = Schema.Struct({
  action: Schema.String,
  /** `pull_request` set: a pull request's conversation, never an issue's (`pullRequests.ts`). */
  issue: Schema.Struct({
    ...Issue.fields,
    pull_request: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
  }),
  comment: Schema.Struct({
    id: Schema.Number,
    body: Schema.optionalKey(Schema.NullOr(Schema.String)),
    user: Schema.optionalKey(Schema.NullOr(Actor)),
    performed_via_github_app: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
  }),
  repository: Repository,
  sender: Schema.optionalKey(Actor),
});
const decodeCommentEvent = Schema.decodeUnknownOption(CommentEvent);

const decodeUnknownJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodeJson = (text: string) => Option.getOrUndefined(decodeUnknownJson(text));

/** An issue's event as HQ reads it, whichever webhook delivered it. */
type IssueEventRead =
  | { readonly kind: "issues"; readonly event: typeof IssuesEvent.Type }
  | { readonly kind: "comment"; readonly event: typeof CommentEvent.Type };

/** `payload` read as the event `name` (`issues`, `issue_comment`); anything else is none. */
const readEvent = (name: string | undefined, payload: unknown): IssueEventRead | undefined =>
  name === "issues"
    ? Option.match(decodeIssuesEvent(payload), {
        onNone: () => undefined,
        onSome: (event) => ({ kind: "issues", event }),
      })
    : name === "issue_comment"
      ? Option.match(decodeCommentEvent(payload), {
          onNone: () => undefined,
          onSome: (event) => ({ kind: "comment", event }),
        })
      : undefined;

/** An intake as an event is worked for it. */
interface IntakeTarget {
  readonly app_id: string;
  readonly repo: string;
  readonly hq_repo: string;
  readonly label: string;
  readonly public: boolean;
}

/** Why a public repository's issue was not taken, said on it. */
export const PUBLIC_REFUSED =
  "Mate takes issues only from private repositories here: anyone can open an issue on this one. An admin can allow public issues in Mate's settings.";

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
    ) => Effect.Effect<Received, NotLeader | SqlError | TaskIntakeUnavailable>;
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
      const intake = yield* TaskIntake;
      const tasks = yield* MateTasks;
      const gate = yield* GithubGate;
      const auth = yield* GithubAuth;
      const events = yield* GithubEvents;

      /** Whether the organization's GitHub app reaches `repository`, so its webhook delivers. */
      const appDelivers = (repository: string) =>
        auth.tokenFor(repository, "reach").pipe(
          Effect.map((token) => token !== undefined),
          Effect.orElseSucceed(() => false),
        );

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
          const { token } = yield* remotes.tokenOf({ appId, repo: hqRepo }, "reach", "kept");
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
          const { token, remote } = yield* remotes.tokenOf(
            { appId, repo: hqRepo },
            "reach",
            "kept",
          );
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

      /**
       * The tasks `where` names that no Mate took yet, dropped — waiting, or handed out and not
       * taken — saying why; the Mates they were handed to, free again. A statement of a write.
       */
      const dropping = (where: Statement.Fragment, why: string) =>
        sql<{ readonly id: string; readonly app_id: string; readonly was: string | null }>`
          WITH gone AS (
            SELECT id, mate_project_id AS was FROM hq_task
            WHERE ${where} AND state IN ('queued', 'assigned')
            FOR UPDATE)
          UPDATE hq_task t SET state = 'dropped', detail = ${why}, mate_project_id = NULL,
            assigned_at = NULL, updated_at = now()
          FROM gone WHERE t.id = gone.id
          RETURNING t.id::text AS id, t.app_id::text AS app_id, gone.was`;
      /** Every reader of the dropped tasks' Mates told, and their sources; whether any was dropped. */
      const dropped = (
        rows: ReadonlyArray<{
          readonly id: string;
          readonly app_id: string;
          readonly was: string | null;
        }>,
        why: string,
      ) =>
        Effect.gen(function* () {
          for (const { was } of rows) if (was !== null) yield* structure.mateTouched(was);
          yield* tasks.dropped(rows, why);
          return rows.length > 0;
        });

      /** Whether the application holds a live task of the work item `key`. */
      const liveTask = (appId: string, key: string) =>
        Effect.map(
          sql`
            SELECT 1 FROM hq_task WHERE app_id::text = ${appId} AND source_key = ${key}
              AND state IN ('queued', 'assigned', 'working', 'waiting')`,
          (rows) => rows.length > 0,
        );

      /**
       * Whether a task of the work item `key` keeps what is said of it: live, or done while its
       * change waits for review.
       */
      const listeningTask = (appId: string, key: string) =>
        Effect.map(
          sql`
            SELECT 1 FROM hq_task t WHERE t.app_id::text = ${appId} AND t.source_key = ${key}
              AND ${taskListens(sql, sql`t`)}`,
          (rows) => rows.length > 0,
        );

      /** The intake's repository as GitHub names it, with its token; none where it holds none. */
      const repositoryOf = (target: { readonly appId: string; readonly hqRepo: string }) =>
        Effect.gen(function* () {
          const { token, remote } = yield* remotes.tokenOf(
            { appId: target.appId, repo: target.hqRepo },
            "issues",
          );
          const identity = remoteIdentity(remote.url);
          return identity === undefined ? undefined : { remote: identity, token };
        }).pipe(Effect.orElseSucceed(() => undefined));

      /**
       * Whether `actor` may steer Mate on the intake's repository; HQ unable to tell (no token,
       * GitHub away) asks GitHub to deliver again rather than guess.
       */
      const verdictOf = (
        target: { readonly appId: string; readonly hqRepo: string },
        actor: GithubActor,
      ) =>
        Effect.gen(function* () {
          const repository = yield* repositoryOf(target);
          const verdict =
            repository === undefined
              ? undefined
              : yield* gate.verdict(repository.remote, repository.token, actor);
          if (verdict === undefined) return yield* new TaskIntakeUnavailable();
          return verdict;
        });

      /** HQ's `words` said on the issue once; never failing the delivery. */
      const say = (
        target: { readonly appId: string; readonly hqRepo: string },
        number: number,
        words: string,
        unsaid: string,
      ) =>
        Effect.gen(function* () {
          const repository = yield* repositoryOf(target);
          if (repository === undefined) return;
          const posted = yield* github.comment(
            repository.remote,
            repository.token,
            number,
            marked(words),
          );
          if (posted.status !== 201) yield* Effect.logInfo(unsaid, { status: posted.status });
        }).pipe(Effect.catchCause((cause) => Effect.logWarning(unsaid, cause)));

      /** Why the issue was not taken, said on it once; never failing the delivery. */
      const decline = (
        target: { readonly appId: string; readonly hqRepo: string },
        number: number,
        why: string,
      ) => say(target, number, why, "an issue's refusal not posted");

      /** An issue's event, from the intake's own webhook or the app's, worked for the intake `row`. */
      const handled = (row: IntakeTarget, read: IssueEventRead, deliveryId: string) =>
        Effect.gen(function* () {
          const passed = { kind: "taken", appId: row.app_id, moved: false } as const;
          const { event } = read;
          const repo = event.repository.full_name.toLowerCase();
          const number = event.issue.number;
          if (repo !== row.repo || number < 1) return passed;
          const key = issueKey(repo, number);
          const target = { appId: row.app_id, hqRepo: row.hq_repo };

          if (read.kind === "comment") {
            const { comment } = read.event;
            const author = comment.user ?? read.event.sender;
            const text = comment.body ?? "";
            // A bot's, an app's or HQ's own comment is nobody's word to its task, and one on a
            // pull request is the pull request's.
            if (
              read.event.action !== "created" ||
              read.event.issue.pull_request != null ||
              author == null ||
              comment.performed_via_github_app != null ||
              text.includes(HQ_MARK)
            )
              return passed;
            // Its task ended (and no change of it waits for review): one who may steer it hears
            // how, once per end, never silence.
            if (!(yield* listeningTask(row.app_id, key))) {
              const end = yield* intake.answerEnded(
                key,
                Effect.map(verdictOf(target, author), (verdict) => verdict.kind === "writer"),
              );
              if (end !== undefined)
                yield* say(
                  target,
                  number,
                  taskEndWords(end, `Open a new issue labelled \`${row.label}\``),
                  "an ended task's answer not posted",
                );
              return passed;
            }
            const verdict = yield* verdictOf(target, author);
            if (verdict.kind !== "writer") return passed;
            yield* intake.message(key, {
              id: `github-comment:${String(comment.id)}`,
              from: "comment",
              author: author.login,
              text,
            });
            return passed;
          }

          const issues = read.event;
          const actor = issues.sender ?? issues.issue.user ?? undefined;
          const label = row.label.toLowerCase();
          const carries = (issues.issue.labels ?? []).some(
            (candidate) => candidate.name.toLowerCase() === label,
          );
          const named = issues.label?.name.toLowerCase() === label;
          // A closed issue is no task, whatever else its event says.
          const open = (issues.issue.state ?? "open") === "open";
          switch (issues.action) {
            case "opened":
            case "reopened":
            case "labeled": {
              const asked = issues.action === "labeled" ? named : carries;
              if (!open || !asked || actor === undefined) return passed;
              if (issues.repository.private === false && !row.public) {
                yield* decline(target, number, PUBLIC_REFUSED);
                return passed;
              }
              const verdict = yield* verdictOf(target, actor);
              if (verdict.kind === "bot") return passed;
              if (verdict.kind === "refused") {
                yield* decline(target, number, verdict.why);
                return passed;
              }
              const taken = yield* intake.enqueue({
                appId: row.app_id,
                source: issueSource(repo, issues.issue),
                body: issues.issue.body ?? "",
                sourceKey: key,
                deliveryId,
                requestedBy: verdict.userId,
              });
              return { ...passed, moved: taken.kind === "queued" };
            }
            case "closed": {
              // Its opener withdrawing it, or one who may steer it; anyone else's close is
              // nobody's word to its task.
              const opener = issues.issue.user?.login;
              const closer = actor?.login;
              const own = closer !== undefined && closer.toLowerCase() === opener?.toLowerCase();
              const may =
                own ||
                (actor !== undefined &&
                  (yield* liveTask(row.app_id, key)) &&
                  (yield* verdictOf(target, actor)).kind === "writer");
              if (!may) {
                yield* Effect.logInfo("an issue's close passed by: its closer may not steer it", {
                  appId: row.app_id,
                });
                return passed;
              }
              yield* intake.stop(key, ISSUE_CLOSED);
              return { ...passed, moved: true };
            }
            case "unlabeled":
              if (!named) return passed;
              yield* intake.stop(key, LABEL_REMOVED);
              return { ...passed, moved: true };
            case "edited": {
              if (actor === undefined || !(yield* listeningTask(row.app_id, key))) return passed;
              const verdict = yield* verdictOf(target, actor);
              if (verdict.kind !== "writer") return passed;
              // Only what the edit changed is taken: the rest of the issue may read as someone
              // nobody let steer the task left it.
              const titled = issues.changes?.title !== undefined;
              const bodied = issues.changes?.body !== undefined;
              if (!titled && !bodied) return passed;
              const title = issueSource(repo, issues.issue).title;
              const body = cleanTaskText(issues.issue.body ?? "");
              // Before any Mate took it, the task reads as the edit left it.
              const rewritten = yield* leader.write(sql`
                  UPDATE hq_task SET
                    title = ${titled ? title : sql`title`},
                    source = ${titled ? sql`jsonb_set(source, '{title}', to_jsonb(${title}::text))` : sql`source`},
                    body = ${bodied ? body : sql`body`}, updated_at = now()
                  WHERE app_id::text = ${row.app_id} AND source_key = ${key} AND state = 'queued'
                  RETURNING 1`);
              if (rewritten.length === 0)
                yield* intake.message(key, {
                  id: `github-edit:${deliveryId}`,
                  from: "edit",
                  author: actor.login,
                  text: bodied
                    ? `The issue now reads:\n\n${title}\n\n${body}`
                    : `The issue's title now reads: ${title}`,
                });
              return passed;
            }
            default:
              return passed;
          }
        });

      /** The app's event of an issue, worked for every intake of its repository. */
      const fromApp = (event: GithubEvent) =>
        Effect.gen(function* () {
          const read = readEvent(event.name, event.payload);
          if (read === undefined) return;
          const repo = read.event.repository.full_name.toLowerCase();
          const rows = yield* sql<IntakeTarget>`
            SELECT app_id::text AS app_id, repo, hq_repo, label, public FROM hq_intake
            WHERE repo = ${repo}`;
          for (const row of rows) yield* handled(row, read, event.deliveryId);
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("an issue's event from the GitHub app not taken", {
              deliveryId: event.deliveryId,
              cause,
            }),
          ),
        );
      yield* events.on("issues", fromApp);
      yield* events.on("issue_comment", fromApp);

      return Intake.of({
        receive: (publicId, delivery) =>
          Effect.gen(function* () {
            const [row] = yield* sql<{
              readonly app_id: string;
              readonly repo: string;
              readonly hq_repo: string;
              readonly label: string;
              readonly public: boolean;
              readonly sealed: Uint8Array;
              readonly key_id: string;
            }>`
              SELECT app_id::text AS app_id, repo, hq_repo, label, public, sealed, key_id
              FROM hq_intake WHERE public_id = ${publicId}`;
            if (row === undefined) return { kind: "unknown" } as const;
            const secret = keys.openIntake(row.app_id, publicId, {
              sealed: row.sealed,
              keyId: row.key_id,
            });
            if (secret === undefined || !signatureHolds(secret, delivery.body, delivery.signature))
              return { kind: "refused" } as const;
            if (delivery.event === "ping") return { kind: "ping" } as const;
            const passed = { kind: "taken", appId: row.app_id, moved: false } as const;
            if (delivery.event !== "issues" && delivery.event !== "issue_comment") return passed;
            if (delivery.id === undefined || delivery.id === "")
              return { kind: "invalid" } as const;
            const deliveryId = delivery.id;
            const read = readEvent(delivery.event, decodeJson(deliveredJson(delivery)));
            if (read === undefined) return { kind: "invalid" } as const;
            // Where the organization's GitHub app reaches the repository, its webhook delivers.
            if (yield* appDelivers(read.event.repository.full_name)) return passed;
            return yield* handled(row, read, deliveryId);
          }),
        keep: (userId, appId, request) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* authorized(userId, appId);
              const repo = request.repo.toLowerCase();
              const label = request.label.trim();
              const takesPublic = request.public === true;
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
              // The app's own webhook delivers where it reaches the repository: no hook of HQ's.
              const viaApp = yield* remotes.tokenOf({ appId, repo: hqRepo }, "reach").pipe(
                Effect.map((use) => use.as === "app"),
                // The repository connected through the app is gone from GitHub: no intake on it.
                Effect.catchTags({
                  RemoteRefused: (error) =>
                    error.reason === "repository_changed"
                      ? refuse("conflict", "repository_changed")
                      : Effect.succeed(false),
                  ProbeRefused: () => Effect.succeed(false),
                }),
              );
              const heldHook =
                !viaApp && kept !== undefined && before?.hook_id != null ? before.hook_id : null;
              const left = yield* leader.write(
                Effect.gen(function* () {
                  yield* sql`
                    INSERT INTO hq_intake (app_id, repo, hq_repo, label, public_id, sealed, key_id, hook_id,
                      created_by, public)
                    VALUES (${appId}::uuid, ${repo}, ${hqRepo}, ${label}, ${publicId}, ${sealed.sealed},
                      ${sealed.keyId}, ${heldHook}::bigint, ${userId}, ${takesPublic})
                    ON CONFLICT (app_id) DO UPDATE SET repo = EXCLUDED.repo, hq_repo = EXCLUDED.hq_repo,
                      label = EXCLUDED.label, public_id = EXCLUDED.public_id, sealed = EXCLUDED.sealed,
                      key_id = EXCLUDED.key_id, hook_id = EXCLUDED.hook_id, public = EXCLUDED.public,
                      updated_at = now()`;
                  // What came from the repository it leaves: nobody takes it now.
                  return before === undefined || before.repo === repo
                    ? []
                    : yield* dropping(
                        sql`app_id::text = ${appId} AND repo = ${before.repo}`,
                        INTAKE_MOVED,
                      );
                }),
              );
              yield* dropped(left, INTAKE_MOVED);
              yield* structure.touched;
              // The old repository's webhook goes once nothing delivers to it any more.
              if (before?.hook_id != null && heldHook === null)
                yield* removeHook(appId, before.hq_repo, Number(before.hook_id));
              if (viaApp)
                return {
                  appId,
                  repo,
                  label,
                  public: takesPublic,
                  webhookUrl: url,
                  hook: { kind: "app" },
                } as const;
              if (heldHook !== null) {
                // A webhook HQ made before it heard issues' comments hears them from now on.
                yield* Effect.gen(function* () {
                  const { token } = yield* remotes.tokenOf(
                    { appId, repo: hqRepo },
                    "reach",
                    "kept",
                  );
                  const status = yield* github.refreshHook(remote, token, Number(heldHook));
                  if (status !== 200)
                    yield* Effect.logInfo("intake webhook not refreshed", { appId, status });
                }).pipe(
                  Effect.catch((error) =>
                    Effect.logInfo("intake webhook not refreshed", { appId, why: error._tag }),
                  ),
                );
                return {
                  appId,
                  repo,
                  label,
                  public: takesPublic,
                  webhookUrl: url,
                  hook: { kind: "made" },
                } as const;
              }
              const hook = yield* makeHook(appId, hqRepo, remote, url, secret);
              if ("id" in hook) {
                yield* leader.write(sql`
                  UPDATE hq_intake SET hook_id = ${hook.id} WHERE app_id::text = ${appId}
                    AND public_id = ${publicId}`);
                return {
                  appId,
                  repo,
                  label,
                  public: takesPublic,
                  webhookUrl: url,
                  hook: { kind: "made" },
                } as const;
              }
              return {
                appId,
                repo,
                label,
                public: takesPublic,
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
              const left = yield* leader.write(
                Effect.gen(function* () {
                  yield* sql`DELETE FROM hq_intake WHERE app_id::text = ${appId}`;
                  // What no Mate took yet came from it: nobody takes it now.
                  return yield* dropping(
                    sql`app_id::text = ${appId} AND source_kind = 'github-issue'`,
                    INTAKE_STOPPED,
                  );
                }),
              );
              yield* dropped(left, INTAKE_STOPPED);
              yield* structure.touched;
              if (before.hook_id !== null)
                yield* removeHook(appId, before.hq_repo, Number(before.hook_id));
            }),
          ),
      });
    }),
  );
