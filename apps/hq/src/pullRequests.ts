/**
 * Each open change of a repository HQ mirrors through the organization's GitHub app
 * (`GithubMirror.repositoryOf`) is a pull request on GitHub, opened by the app's bot or, on a
 * branch its Mate named, by its Mate: one change, two views (`hq_pull_request`).
 *
 * - Once the change has a head its Mate described (`ready`), its head goes to its branch on GitHub
 *   (`GithubMirror.pushChange`: HQ's own for a change opened without one, the branch its Mate named
 *   under that name) and a pull request opens from it into GitHub's default branch, or the one
 *   its Mate opened there is taken for it, ready for review: its body says what it does, how it
 *   was checked, where to try it, `Fixes #n` for its task's issue, and a footer naming the Mate,
 *   its task and who asked; who asked is its assignee where they can write; its first comment
 *   says once what the Mate does with it. A later push goes to the same branch; a new description
 *   edits only HQ's part of the body (between {@link MATE_START} and {@link MATE_END}). Kept on
 *   every move of a change, and every minute for any move missed.
 * - Merge in Mate merges the pull request on GitHub (squash, at the head the person saw), then
 *   follows GitHub's default branch (`GithubMirror.sync`), which marks the change merged; GitHub's
 *   refusal is the merge's, in plain words, and nothing moves. Close in Mate closes it there too.
 * - From GitHub (`GithubEvents`): merged there, the change is merged here; closed unmerged, the
 *   change closes and its task ends stopped; a review, a review comment or a comment by a person
 *   who can write (not a bot, no `(aside)`) is said in the change's conversation and told to the
 *   task's Mate; failing checks on its head are told to the task's Mate once per head, three
 *   heads at most, then handed to a person.
 *
 * Everything here is said on GitHub as the app; where GitHub gives the app no token, nothing is.
 *
 * @module pullRequests
 */
import { type GitError, allocated } from "@t3tools/hq-git";
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import {
  COMMENT_BODY_MAX,
  type ChangeReceipt,
  type ChangeReceiptPart,
  type HqChange,
  changeRoutePath,
} from "@t3tools/shared/hqChanges";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { ChangeRefused, Changes } from "./changes.ts";
import { HQ_MARK, marked, quieted } from "./githubChannel.ts";
import { GithubAuth, MATE_GATE, writesGate } from "./githubAuth.ts";
import { type GithubEvent, GithubEvents } from "./githubEvents.ts";
import { GithubGate } from "./githubGate.ts";
import { type GithubCheckRun, GithubIssues } from "./githubIssues.ts";
import { GithubMirror } from "./githubMirror.ts";
import { type RemoteIdentity, remoteIdentity } from "./gitTransport.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { Remotes } from "./repoRemotes.ts";
import { MateTasks, mateTaskLink } from "./mateTasks.ts";
import { Roles } from "./roles.ts";
import { Structure } from "./structure.ts";
import { cleanTaskText, mateNameIn, sourceOfRow } from "./taskSources.ts";
import type { ZeropsError } from "./zerops/api.ts";

/** Where HQ's part of a pull request's body starts and ends: the rest is people's. */
export const MATE_START = "<!-- mate:start -->";
export const MATE_END = "<!-- mate:end -->";

/** How many failing heads of a pull request its Mate hears of before a person takes over. */
export const CHECK_TRIES = 3;

/** How long a change whose branch holds someone else's pull request waits before HQ looks again. */
const TAKEN_FOR_MS = 60 * 60 * 1000;

/** Said once on a pull request whose checks still fail after its Mate's tries. */
export const CHECKS_GIVEN_UP = `Checks still fail after ${String(CHECK_TRIES)} tries; over to a person.`;

/** A pull request's first comment: what its Mate does with it, said once. */
export const firstComment = (mate: string) =>
  `${mate} will fix failing checks and answer review comments from people with write access to this repository. Add \`(aside)\` to a comment to keep it from ${mate}.`;

/** Said on a pull request one who may not close it closed, as HQ opens it again. */
export const closersOnly = (mate: string) =>
  `Only people with write access close ${mate}'s pull requests.`;

/** Why a task ends whose pull request was closed unmerged. */
export const pullClosed = (number: number) => `PR #${String(number)} was closed.`;

/** What a failing head's checks tell its Mate. */
export const checksFailed = (number: number, names: ReadonlyArray<string>, url: string | null) =>
  `Checks failed on PR #${String(number)}: ${names.join(", ")}.${url === null ? "" : ` ${url}`}`;

/** A comment its author keeps from the Mate. */
export const isAside = (text: string) => /\(aside\)/iu.test(text);

/** What a pull request's body carries of its change, HQ's part of it. */
export interface PullFacts {
  readonly mate: string;
  readonly description: string;
  readonly receipt: ChangeReceipt | null;
  /**
   * Its Mate's other changes with a receipt, each by its page in Mate: their previews are this
   * one's, so a later deploy of one by another of them shows that change there now.
   */
  readonly alongside: ReadonlyArray<{
    readonly number: number;
    readonly link: string;
    readonly receipt: ChangeReceipt;
  }>;
  /** The issue of the same repository its task came from. */
  readonly fixes: number | null;
  /** Where its task is followed in Mate; none for a change no task asked for. */
  readonly taskLink: string | null;
  /** Its change's page in Mate. */
  readonly changeLink: string;
  /** Who asked: a GitHub login (`@`-named), or a person's name; none known. */
  readonly requester: { readonly login: string } | { readonly name: string } | null;
}

/** How each part was checked, as its receipt says; none where it says nothing. */
const checkedLines = (receipt: ChangeReceipt | null) =>
  (receipt?.parts ?? []).flatMap((part) =>
    part.deploy === "none"
      ? []
      : [
          `- \`${part.setup}\`: ${
            part.deploy === "ok"
              ? part.verified
                ? "deployed to its stage and verified"
                : "deployed to its stage, not verified"
              : "its deploy to stage failed"
          }`,
        ],
  );

/** When a part's preview was deployed ok, as a receipt says; none where it was not. */
const deployedOkAt = (part: ChangeReceiptPart) =>
  part.deploy === "ok" && part.deployedAt !== undefined ? Date.parse(part.deployedAt) : undefined;

/** The other change a preview shows now: the one that deployed it after this one did; none. */
const shownBy = (part: ChangeReceiptPart, alongside: PullFacts["alongside"]) => {
  const own = deployedOkAt(part);
  if (own === undefined) return undefined;
  let latest: { readonly at: number; readonly change: PullFacts["alongside"][number] } | undefined;
  for (const change of alongside)
    for (const other of change.receipt.parts) {
      const at = other.previewHostname === part.previewHostname ? deployedOkAt(other) : undefined;
      if (at !== undefined && at > own && (latest === undefined || at > latest.at))
        latest = { at, change };
    }
  return latest?.change;
};

/**
 * Where to try it: a part's preview that names a whole host — and, where another change of its
 * Mate deployed there since, that the preview shows that change now.
 */
const previewLines = (receipt: ChangeReceipt | null, alongside: PullFacts["alongside"]) =>
  (receipt?.parts ?? []).flatMap((part) => {
    if (part.deploy !== "ok" || !part.previewHostname.includes(".")) return [];
    const other = shownBy(part, alongside);
    return [
      other === undefined
        ? `- https://${part.previewHostname}`
        : `- https://${part.previewHostname} — it shows [change #${String(other.number)}](${other.link}) now`,
    ];
  });

/**
 * A Mate's words as a pull request's body shows them: they read the same, but close no issue
 * (`Fixes #3`, `closes owner/repo#4`, `resolved <issue link>`), link none and ping nobody — a word
 * joiner, unseen, breaks each closing keyword and reference (`quieted`). Only HQ's own `Fixes #n`
 * line closes the task's issue.
 */
export const inert = (text: string) =>
  quieted(text).replace(
    /\b(c)(lose[sd]?)\b|\b(f)(ix(?:e[sd])?)\b|\b(r)(esolve[sd]?)\b/giu,
    (_word, ...parts: ReadonlyArray<string | undefined>) => {
      const [c, close, f, fix, r, resolve] = parts;
      return `${c ?? f ?? r ?? ""}\u2060${close ?? fix ?? resolve ?? ""}`;
    },
  );

/** HQ's part of a pull request's body, markers included. */
export const pullSection = (facts: PullFacts) => {
  const checked = checkedLines(facts.receipt);
  const preview = previewLines(facts.receipt, facts.alongside);
  const requester =
    facts.requester === null
      ? ""
      : ` · Requested by ${"login" in facts.requester ? `@${facts.requester.login}` : facts.requester.name}`;
  const footer = `${facts.mate} · ${
    facts.taskLink === null
      ? `[Change in Mate](${facts.changeLink})`
      : `[Mate task](${facts.taskLink})`
  }${requester}`;
  return [
    MATE_START,
    "## What it does",
    "",
    facts.description.trim() === "" ? "_Not described yet._" : inert(facts.description.trim()),
    ...(checked.length === 0 ? [] : ["", "## How it was checked", "", ...checked]),
    ...(preview.length === 0 ? [] : ["", "## Try it", "", ...preview]),
    ...(facts.fixes === null ? [] : ["", `Fixes #${String(facts.fixes)}`]),
    "",
    "---",
    footer,
    MATE_END,
  ].join("\n");
};

/** `body` with HQ's part replaced by `section`, or added after people's where it has none. */
export const withSection = (body: string, section: string) => {
  const start = body.indexOf(MATE_START);
  const end = body.indexOf(MATE_END, start);
  if (start === -1 || end === -1) return body.trim() === "" ? section : `${section}\n\n${body}`;
  return `${body.slice(0, start)}${section}${body.slice(end + MATE_END.length)}`;
};

/** The merge's commit message: the change's summary, then whom it credits. */
export const mergeMessage = (merge: {
  readonly description: string;
  readonly coAuthor: { readonly login: string; readonly id: number } | null;
  readonly taskLink: string | null;
}) => {
  const summary =
    merge.description
      .trim()
      .split(/\n\s*\n/u)[0]
      ?.trim() ?? "";
  const trailers = [
    ...(merge.coAuthor === null
      ? []
      : [
          `Co-authored-by: ${merge.coAuthor.login} <${String(merge.coAuthor.id)}+${merge.coAuthor.login}@users.noreply.github.com>`,
        ]),
    ...(merge.taskLink === null ? [] : [`Mate-Task: ${merge.taskLink}`]),
  ];
  return [summary, trailers.join("\n")].filter((part) => part !== "").join("\n\n");
};

/** What GitHub's checks on a head say: failing where any failed, pending while any runs. */
export const checksOf = (runs: ReadonlyArray<GithubCheckRun>) => {
  const failing = runs.filter(
    (run) =>
      run.status === "completed" &&
      ["failure", "timed_out", "startup_failure", "action_required"].includes(run.conclusion ?? ""),
  );
  const state =
    runs.length === 0
      ? undefined
      : failing.length > 0
        ? ("failing" as const)
        : runs.some((run) => run.status !== "completed")
          ? ("pending" as const)
          : ("passing" as const);
  return { state, failing };
};

type MergeError = ChangeRefused | NotLeader | SqlError | ZeropsError | GitError;

export class PullRequests extends Context.Service<
  PullRequests,
  {
    /**
     * What Merge in Mate does: a change with a pull request merges on GitHub, then HQ follows
     * (`GithubMirror.sync`); any other merges in HQ (`Changes.mergeChange`).
     */
    readonly merge: (
      userId: string,
      appId: string,
      repo: string,
      number: number,
      expectedHead: string,
    ) => Effect.Effect<HqChange, MergeError>;
    /** What Close in Mate does: the change closed, and its pull request on GitHub with it. */
    readonly close: (
      userId: string,
      appId: string,
      repo: string,
      number: number,
      expectedHead: string | null,
    ) => Effect.Effect<HqChange, MergeError>;
    /**
     * A Mate giving up its own open change (`Changes.mateCloseChange`): closed, and its pull request
     * on GitHub with it, as a person's Close does.
     */
    readonly mateClose: (
      projectId: string,
      repo: string,
      number: number,
    ) => Effect.Effect<HqChange, MergeError>;
  }
>()("@t3tools/hq/pullRequests") {}

export interface PullRequestsOptions {
  /** How often every open change's pull request is looked at, for a move missed; a minute. */
  readonly sweepEvery?: Duration.Duration;
}

interface PullRow {
  readonly app_id: string;
  readonly repo: string;
  readonly number: number;
  readonly github_repo: string;
  readonly pr_number: number;
  readonly url: string;
  readonly state: "open" | "merged" | "closed";
  readonly head_sha: string | null;
  readonly checks: string | null;
  readonly checks_told_sha: string | null;
  readonly checks_told: number;
  readonly checks_given_up: boolean;
  readonly described: string | null;
  readonly merged_sha: string | null;
  readonly merged_head: string | null;
}

const PULL_COLUMNS = `app_id::text AS app_id, repo, number, github_repo, pr_number, url, state,
  head_sha, checks, checks_told_sha, checks_told, checks_given_up, described, merged_sha,
  merged_head`;

interface ChangeFactsRow {
  readonly state: string;
  readonly head: string | null;
  readonly ready: boolean;
  readonly title: string;
  readonly body: string;
  readonly receipt: ChangeReceipt | null;
  readonly mate_project_id: string;
  readonly made_by: string | null;
  readonly app_name: string | null;
  readonly task_id: string | null;
  readonly task_source: unknown;
}

/** An event's payload as `schema` reads it, parsed or still JSON; none where it does not. */
const decode = <A, I>(schema: Schema.Codec<A, I>) => {
  const read = Schema.decodeUnknownOption(schema);
  return (payload: unknown): A | undefined => {
    if (typeof payload !== "string") return Option.getOrUndefined(read(payload));
    try {
      return Option.getOrUndefined(read(JSON.parse(payload)));
    } catch {
      return undefined;
    }
  };
};

const Actor = Schema.Struct({ login: Schema.String, type: Schema.optionalKey(Schema.String) });

const readPullEvent = decode(
  Schema.Struct({
    action: Schema.String,
    pull_request: Schema.Struct({
      number: Schema.Number,
      merged: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
      merge_commit_sha: Schema.optionalKey(Schema.NullOr(Schema.String)),
      head: Schema.optionalKey(Schema.Struct({ sha: Schema.optionalKey(Schema.String) })),
    }),
    sender: Schema.optionalKey(Actor),
  }),
);
const readReview = decode(
  Schema.Struct({
    action: Schema.String,
    pull_request: Schema.Struct({ number: Schema.Number }),
    review: Schema.Struct({
      id: Schema.Number,
      body: Schema.optionalKey(Schema.NullOr(Schema.String)),
      state: Schema.String,
      user: Actor,
    }),
  }),
);
const readReviewComment = decode(
  Schema.Struct({
    action: Schema.String,
    pull_request: Schema.Struct({ number: Schema.Number }),
    comment: Schema.Struct({
      id: Schema.Number,
      body: Schema.String,
      path: Schema.optionalKey(Schema.NullOr(Schema.String)),
      line: Schema.optionalKey(Schema.NullOr(Schema.Number)),
      original_line: Schema.optionalKey(Schema.NullOr(Schema.Number)),
      user: Actor,
    }),
  }),
);
const readIssueComment = decode(
  Schema.Struct({
    action: Schema.String,
    issue: Schema.Struct({
      number: Schema.Number,
      pull_request: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
    }),
    comment: Schema.Struct({ id: Schema.Number, body: Schema.String, user: Actor }),
  }),
);
const PullOfCheck = Schema.Struct({
  head: Schema.Struct({ repo: Schema.Struct({ id: Schema.Number }) }),
  base: Schema.Struct({ repo: Schema.Struct({ id: Schema.Number }) }),
});
const readCheckRun = decode(
  Schema.Struct({
    action: Schema.String,
    check_run: Schema.Struct({
      head_sha: Schema.String,
      pull_requests: Schema.optionalKey(Schema.Array(PullOfCheck)),
    }),
  }),
);
const readCheckSuite = decode(
  Schema.Struct({
    action: Schema.String,
    check_suite: Schema.Struct({
      head_sha: Schema.String,
      pull_requests: Schema.optionalKey(Schema.Array(PullOfCheck)),
    }),
  }),
);

const refuse = (reason: ChangeRefused["reason"]) =>
  Effect.fail(new ChangeRefused({ code: "conflict", reason }));

export const pullRequestsLayer = (options: PullRequestsOptions = {}) =>
  Layer.effect(
    PullRequests,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const leader = yield* Leader;
      const changes = yield* Changes;
      const structure = yield* Structure;
      const tasks = yield* MateTasks;
      const roles = yield* Roles;
      const github = yield* GithubIssues;
      const gate = yield* GithubGate;
      const remotes = yield* Remotes;
      const auth = yield* GithubAuth;
      /**
       * Changes whose branch on GitHub holds a pull request HQ did not open, and until when they
       * are not tried again: they stay unmirrored, and HQ's log says why.
       */
      const taken = new Map<string, number>();
      const mirror = yield* GithubMirror;
      const events = yield* GithubEvents;
      // One pull request's step at a time: a sweep, an event and a merge never cross.
      const working = yield* Semaphore.make(1);
      const leading = Effect.map(leader.status, (status) => status.state === "active");
      /** GitHub user ids by login, for a merge's `Co-authored-by`. */
      const userIds = new Map<string, number>();

      /** The app's way into the GitHub repository `owner/name`; none while it has none. */
      /**
       * The app's way into the GitHub repository `repository` that HQ's `repo` of `appId` mirrors
       * to (`Remotes.tokenOf`, acting), for its pull requests or, `merge`, merging one; none where
       * GitHub gives HQ no app token for it — never a person's token: everything here is the bot's.
       */
      const asApp = (
        appId: string,
        repo: string,
        repository: string,
        use: "pullRequests" | "merge" | "gate" = "pullRequests",
      ) =>
        Effect.gen(function* () {
          const remote = remoteIdentity(`https://github.com/${repository}`);
          const reached = yield* remotes.tokenOf({ appId, repo }, use, "act");
          return remote === undefined || reached.as !== "app"
            ? undefined
            : { remote, token: reached.token };
        });

      const pullOf = (appId: string, repo: string, number: number) =>
        Effect.map(
          sql<PullRow>`
            SELECT ${sql.literal(PULL_COLUMNS)} FROM hq_pull_request
            WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}`,
          (rows) => rows[0],
        );

      const pullOnGithub = (repository: string, prNumber: number) =>
        Effect.map(
          sql<PullRow>`
            SELECT ${sql.literal(PULL_COLUMNS)} FROM hq_pull_request
            WHERE lower(github_repo) = lower(${repository}) AND pr_number = ${prNumber}`,
          (rows) => rows[0],
        );

      /** The change as its pull request carries it, with its task's, its Mate's and app's names. */
      const factsOf = (appId: string, repo: string, number: number) =>
        Effect.gen(function* () {
          const [row] = yield* sql<ChangeFactsRow>`
            SELECT c.state, c.head, COALESCE(c.ready_head = c.head, false) AS ready, c.title,
              c.body, c.receipt, c.mate_project_id, m.made_by, a.name AS app_name,
              t.id::text AS task_id, t.source AS task_source
            FROM hq_change c
            LEFT JOIN hq_app a ON a.id = c.app_id
            LEFT JOIN hq_mate m ON m.project_id = c.mate_project_id
            LEFT JOIN LATERAL (
              SELECT id, source FROM hq_task
              WHERE app_id = c.app_id AND change_repo = c.repo AND change_number = c.number
              ORDER BY seq DESC LIMIT 1) t ON true
            WHERE c.app_id::text = ${appId} AND c.repo = ${repo} AND c.number = ${number}`;
          if (row === undefined) return undefined;
          // Their previews are this one's: read only where this one deployed one.
          const alongside =
            row.receipt?.parts.some((part) => part.deploy === "ok") === true
              ? yield* sql<{
                  readonly repo: string;
                  readonly number: number;
                  readonly receipt: ChangeReceipt;
                }>`
                  SELECT repo, number, receipt FROM hq_change
                  WHERE app_id::text = ${appId} AND mate_project_id = ${row.mate_project_id}
                    AND receipt IS NOT NULL AND NOT (repo = ${repo} AND number = ${number})`
              : [];
          const view = yield* Effect.orElseSucceed(roles.view, () => undefined);
          const project = view?.projects.find((found) => found.id === row.mate_project_id);
          const mate = project === undefined ? "Mate" : mateNameIn(project.name, row.app_name);
          const source = sourceOfRow(row.task_source);
          const taskLink = row.task_id === null ? null : yield* tasks.link(row.task_id);
          return { row, alongside, mate: mate || "Mate", source, view, taskLink };
        });

      /** What the pull request of the change says of it, for the GitHub repository `repository`. */
      const sectionOf = (
        appId: string,
        repo: string,
        number: number,
        repository: string,
        facts: NonNullable<Effect.Success<ReturnType<typeof factsOf>>>,
      ) => {
        const { row, source, view } = facts;
        const fromIssue =
          source?.kind === "github-issue" && source.repo.toLowerCase() === repository.toLowerCase()
            ? source
            : undefined;
        const maker =
          row.made_by === null
            ? undefined
            : view?.members.find((member) => member.userId === row.made_by)?.name;
        const requester =
          source?.kind === "github-issue" && source.author !== null
            ? { login: source.author }
            : source !== undefined && "author" in source && source.author !== null
              ? { name: source.author }
              : row.task_id === null && maker !== undefined && maker !== ""
                ? { name: maker }
                : null;
        return {
          section: pullSection({
            mate: facts.mate,
            description: row.body,
            receipt: row.receipt,
            alongside: facts.alongside.map((other) => ({
              number: other.number,
              link: `${DEFAULT_HOSTED_APP_URL}${changeRoutePath(appId, other.repo, other.number)}`,
              receipt: other.receipt,
            })),
            fixes: fromIssue?.number ?? null,
            taskLink: facts.taskLink,
            changeLink: `${DEFAULT_HOSTED_APP_URL}${changeRoutePath(appId, repo, number)}`,
            requester,
          }),
          login: requester !== null && "login" in requester ? requester.login : undefined,
        };
      };

      /** A change's pull request moved: its readers and its Mate's row read again. */
      const moved = (mateProjectId: string) =>
        Effect.andThen(changes.touch, structure.mateTouched(mateProjectId));

      /** Its task's status line, with the pull request it has now. */
      const toldOpened = (taskId: string) =>
        tasks.tell(taskId, ({ mate, change, pullRequest }) =>
          change === null || pullRequest === null
            ? undefined
            : { kind: "change", mate: mate ?? "Mate", link: change, pullRequest },
        );

      /** Open the change's pull request, or keep it as the change is now. */
      const keep = (appId: string, repo: string, number: number, reconcile: boolean) =>
        Effect.gen(function* () {
          const repository = yield* mirror.repositoryOf(appId, repo);
          if (repository === undefined) return;
          const facts = yield* factsOf(appId, repo, number);
          if (facts === undefined) return;
          const row = yield* pullOf(appId, repo, number);
          const { row: change } = facts;
          // Merged on GitHub, not yet here: followed again.
          if (row?.state === "merged" && row.merged_sha !== null && facts.row.state === "open")
            return yield* landed(row, row.merged_sha, row.merged_head);
          // Closed on GitHub, its change not yet here: closed now.
          if (row?.state === "closed" && facts.row.state === "open")
            return yield* closedUnmerged(row);
          if (row !== undefined && row.state !== "open") return;
          // Closed in Mate while GitHub did not answer: closed there now.
          if (row !== undefined && change.state === "closed") return yield* closeOnGithub(row);
          if (change.state !== "open" || change.head === null) return;
          // What GitHub says of it now, on the timed sweep: a merge or a close whose event never
          // came is followed as the event would have been.
          if (row !== undefined && reconcile) {
            const app = yield* asApp(appId, repo, repository);
            const now =
              app === undefined
                ? undefined
                : yield* github.pull(app.remote, app.token, row.pr_number);
            if (app !== undefined && now?.pull?.merged === true)
              return yield* mergedOnGithub(row, now.pull.mergeSha, now.pull.headSha);
            if (app !== undefined && now?.pull?.state === "closed") {
              const issue = yield* github.issueState(app.remote, app.token, row.pr_number);
              return yield* closedOnGithub(row, issue.closedBy);
            }
          }
          if (row === undefined && !change.ready) return;
          if (
            row === undefined &&
            (taken.get(`${appId}/${repo}/${String(number)}`) ?? 0) >
              (yield* Clock.currentTimeMillis)
          )
            return;
          const app = yield* asApp(appId, repo, repository);
          if (app === undefined) return;
          const { section } = sectionOf(appId, repo, number, repository, facts);
          const described = `${change.title}\n${section}`;
          if (row === undefined) return yield* open(appId, repo, number, repository, app, facts);
          if (row.head_sha !== change.head) {
            const pushed = yield* mirror.pushChange(appId, repo, number);
            if (pushed !== undefined)
              yield* leader.write(sql`
                UPDATE hq_pull_request SET head_sha = ${pushed.sha}, checks = NULL,
                  updated_at = now()
                WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}`);
            yield* moved(change.mate_project_id);
          }
          if (row.described === described) return;
          const now = yield* github.pull(app.remote, app.token, row.pr_number);
          if (now.pull === undefined) return;
          const edited = yield* github.editPull(app.remote, app.token, row.pr_number, {
            title: change.title,
            body: withSection(now.pull.body, section),
          });
          if (edited === 200)
            yield* leader.write(sql`
              UPDATE hq_pull_request SET described = ${described}, updated_at = now()
              WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}`);
        });

      const open = (
        appId: string,
        repo: string,
        number: number,
        repository: string,
        app: { readonly remote: RemoteIdentity; readonly token: Redacted.Redacted },
        facts: NonNullable<Effect.Success<ReturnType<typeof factsOf>>>,
      ) =>
        Effect.gen(function* () {
          const { row: change } = facts;
          const pushed = yield* mirror.pushChange(appId, repo, number);
          if (pushed === undefined) return;
          const { section, login } = sectionOf(appId, repo, number, repository, facts);
          const base = (yield* github.defaultBranch(app.remote, app.token)).branch ?? "main";
          const made = yield* github.openPull(app.remote, app.token, {
            title: change.title,
            head: pushed.branch,
            base,
            body: section,
          });
          // Opened before, its record lost: the open one of its branch is it — only one the app's
          // bot opened from the repository itself. Anyone else's holds the branch: never taken. A
          // branch its Mate named is the Mate's: the open one from the repository itself is the
          // change's, whoever opened it (the Mate's own `gh pr create`).
          const named = !allocated(pushed.branch);
          const bot = made.pull === undefined && made.status === 422 ? yield* auth.bot : undefined;
          const found =
            bot === undefined
              ? undefined
              : (yield* github.pullsOf(app.remote, app.token, pushed.branch)).find(
                  (candidate) => candidate.state === "open",
                );
          const adopted =
            found !== undefined && found.sameRepository && (named || found.author === bot?.login)
              ? found
              : undefined;
          const pull = made.pull ?? adopted;
          if (pull === undefined) {
            taken.set(
              `${appId}/${repo}/${String(number)}`,
              (yield* Clock.currentTimeMillis) + TAKEN_FOR_MS,
            );
            return yield* Effect.logWarning(
              found === undefined
                ? "a change's pull request not opened"
                : "a change's branch on GitHub holds a pull request someone else opened",
              {
                appId,
                repo,
                number,
                status: made.status,
                refusal: made.refusal,
                pull: found?.number,
              },
            );
          }
          const kept = yield* leader.write(sql`
            INSERT INTO hq_pull_request (app_id, repo, number, github_repo, pr_number, url,
              head_sha, described)
            VALUES (${appId}::uuid, ${repo}, ${number}, ${repository}, ${pull.number}, ${pull.url},
              ${pushed.sha}, ${named && made.pull === undefined ? "" : `${change.title}\n${section}`})
            ON CONFLICT DO NOTHING RETURNING 1`);
          if (kept.length === 0) return;
          yield* moved(change.mate_project_id);
          // Who asked is its assignee, where they can write to the repository.
          if (login !== undefined) {
            const verdict = yield* gate.verdict(app.remote, app.token, { login });
            if (verdict?.kind === "writer")
              yield* github.assign(app.remote, app.token, pull.number, [login]).pipe(Effect.ignore);
          }
          const first = yield* github.comment(
            app.remote,
            app.token,
            pull.number,
            marked(firstComment(facts.mate)),
          );
          if (first.id !== undefined)
            yield* leader.write(sql`
              UPDATE hq_pull_request SET first_comment_id = ${first.id}
              WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}`);
          if (change.task_id !== null) yield* toldOpened(change.task_id);
        });

      /**
       * The pull request closed on GitHub, and only then a line saying so; recorded closed here.
       * GitHub refusing because it is merged or closed already records what it is, once: nothing
       * is asked of GitHub again for it. GitHub not answering leaves it for the sweep.
       */
      const closeOnGithub = (row: PullRow) =>
        Effect.gen(function* () {
          const app = yield* asApp(row.app_id, row.repo, row.github_repo);
          if (app === undefined) return;
          const closed = yield* github.editPull(app.remote, app.token, row.pr_number, {
            state: "closed",
          });
          if (closed === 200) {
            yield* github
              .comment(app.remote, app.token, row.pr_number, marked("Closed in Mate."))
              .pipe(Effect.ignore);
            return yield* closedUnmerged(row);
          }
          const now = yield* github.pull(app.remote, app.token, row.pr_number);
          if (now.pull?.merged === true)
            return yield* mergedOnGithub(row, now.pull.mergeSha, now.pull.headSha);
          if (now.pull?.state === "closed") return yield* closedUnmerged(row);
        });

      /**
       * The pull request was closed unmerged on GitHub by `closer`: by one who may (a person with
       * write, or another app), its change closes and its task stops; by anyone else, it is opened
       * again with a line saying who may close it, and nothing moves. GitHub not saying who may
       * leaves it for the sweep.
       */
      const closedOnGithub = (
        row: PullRow,
        closer: { readonly login: string; readonly type?: string | undefined } | undefined,
      ) =>
        Effect.gen(function* () {
          if (row.state !== "open") return;
          const app = yield* asApp(row.app_id, row.repo, row.github_repo);
          if (app === undefined || closer === undefined) return;
          const bot = yield* auth.bot;
          const verdict =
            closer.login === bot?.login
              ? ({ kind: "bot" } as const)
              : yield* gate.verdict(app.remote, app.token, closer);
          if (verdict === undefined) return;
          if (verdict.kind !== "refused") return yield* closedUnmerged(row);
          const opened = yield* github.editPull(app.remote, app.token, row.pr_number, {
            state: "open",
          });
          if (opened !== 200) return;
          const facts = yield* factsOf(row.app_id, row.repo, row.number);
          yield* github.comment(
            app.remote,
            app.token,
            row.pr_number,
            marked(closersOnly(facts?.mate ?? "Mate")),
          );
        });

      /**
       * The pull request is closed unmerged: recorded, its change closed, its task stopped — each
       * step once, and a record closed with its change still open (a write that stopped between
       * them) finished.
       */
      const closedUnmerged = (row: PullRow) =>
        Effect.gen(function* () {
          const ended = yield* leader.write(sql<{ readonly mate_project_id: string }>`
            UPDATE hq_pull_request pr SET state = 'closed', updated_at = now()
            FROM hq_change c
            WHERE pr.app_id::text = ${row.app_id} AND pr.repo = ${row.repo}
              AND pr.number = ${row.number} AND pr.state = 'open'
              AND c.app_id = pr.app_id AND c.repo = pr.repo AND c.number = pr.number
            RETURNING c.mate_project_id`);
          const closedNow = yield* changes.closeOnGithub(row.app_id, row.repo, row.number, {
            by: "github",
            pullRequest: row.pr_number,
          });
          const mate = closedNow?.mateProjectId ?? ended[0]?.mate_project_id;
          if (mate === undefined) return;
          yield* moved(mate);
          const task = yield* taskOf(row);
          if (task !== undefined) yield* tasks.stop(task, pullClosed(row.pr_number));
        });

      /**
       * The change of a pull request merged on GitHub as `mergedSha`, merged here too: HQ follows
       * GitHub's default branch (`GithubMirror.sync`, which imports the squash), then records the
       * change merged by it (`Changes.landImported`). Either failing leaves it for the next try
       * (the sweep); one merged already stays as it is.
       */
      const landed = (row: PullRow, mergedSha: string, mergedHead: string | null) =>
        Effect.gen(function* () {
          yield* mirror.sync(row.app_id, row.repo);
          yield* changes.landImported(
            row.app_id,
            row.repo,
            row.number,
            mergedSha,
            mergedHead ?? undefined,
          );
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("GitHub's merge not followed yet", { pull: row.pr_number, cause }),
          ),
        );

      /**
       * The pull request is merged as `mergedSha`: recorded, its change merged here, and its task's
       * status line says so.
       */
      const mergedOnGithub = (
        row: PullRow,
        mergedSha: string | undefined,
        mergedHead: string | undefined,
      ) =>
        Effect.gen(function* () {
          const ended = yield* leader.write(sql<{ readonly mate_project_id: string }>`
            UPDATE hq_pull_request pr SET state = 'merged',
              merged_sha = COALESCE(${mergedSha ?? null}, pr.merged_sha),
              merged_head = COALESCE(${mergedHead ?? null}, pr.merged_head), updated_at = now()
            FROM hq_change c
            WHERE pr.app_id::text = ${row.app_id} AND pr.repo = ${row.repo}
              AND pr.number = ${row.number} AND pr.state = 'open'
              AND c.app_id = pr.app_id AND c.repo = pr.repo AND c.number = pr.number
            RETURNING c.mate_project_id`);
          const sha = mergedSha ?? row.merged_sha;
          if (sha !== null) yield* landed(row, sha, mergedHead ?? row.merged_head);
          if (ended.length === 0) return;
          yield* moved(ended[0]!.mate_project_id);
          const task = yield* taskOf(row);
          if (task !== undefined)
            yield* tasks.tell(task, ({ mate }) => ({
              kind: "merged",
              mate: mate ?? "Mate",
              pullRequest: { number: row.pr_number, url: row.url },
            }));
        });

      /** The task whose change it is, the latest one. */
      const taskOf = (row: Pick<PullRow, "app_id" | "repo" | "number">) =>
        Effect.map(
          sql<{ readonly id: string }>`
            SELECT id::text AS id FROM hq_task
            WHERE app_id::text = ${row.app_id} AND change_repo = ${row.repo}
              AND change_number = ${row.number} AND mate_project_id IS NOT NULL
            ORDER BY seq DESC LIMIT 1`,
          (rows) => rows[0]?.id,
        );

      /**
       * Every open change a pull request is due for, or whose pull request may have moved;
       * `reconcile`, also what GitHub says of each open one. Only repositories reached through the
       * app (`GithubMirror.repositoryOf` says which): any ref's move wakes this, and a change
       * elsewhere is never kept, so it costs no read of its own.
       */
      const keepAll = (reconcile: boolean) =>
        Effect.gen(function* () {
          if (!(yield* leading)) return;
          const due = yield* sql<{
            readonly app_id: string;
            readonly repo: string;
            readonly number: number;
          }>`
          SELECT c.app_id::text AS app_id, c.repo, c.number
          FROM hq_change c
          JOIN hq_repo_remote remote
            ON remote.app_id = c.app_id AND remote.repo = c.repo AND remote.via = 'app'
          LEFT JOIN hq_pull_request pr
            ON pr.app_id = c.app_id AND pr.repo = c.repo AND pr.number = c.number
          WHERE c.repo <> ${RECIPE_REPO} AND (
            (pr.app_id IS NULL AND c.state = 'open' AND c.head IS NOT NULL
              AND c.ready_head = c.head)
            OR (pr.state = 'open' AND c.state IN ('open', 'closed'))
            OR (pr.state = 'merged' AND c.state = 'open' AND pr.merged_sha IS NOT NULL)
            OR (pr.state = 'closed' AND c.state = 'open'))
          ORDER BY c.app_id, c.repo, c.number`;
          for (const change of due)
            yield* keep(change.app_id, change.repo, change.number, reconcile).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("a change's pull request not kept", { change, cause }),
              ),
            );
        }).pipe(working.withPermits(1));

      /** A comment said on a pull request, kept and told where its author may steer the Mate. */
      const heard = (
        repository: string | undefined,
        prNumber: number,
        comment: {
          readonly key: string;
          readonly actor: { readonly login: string; readonly type?: string | undefined };
          readonly text: string;
        },
      ) =>
        Effect.gen(function* () {
          if (repository === undefined) return;
          if (comment.text.includes(HQ_MARK) || isAside(comment.text)) return;
          if (comment.text.trim() === "") return;
          const row = yield* pullOnGithub(repository, prNumber);
          if (row === undefined) return;
          const app = yield* asApp(row.app_id, row.repo, row.github_repo);
          if (app === undefined) return;
          const verdict = yield* gate.verdict(app.remote, app.token, comment.actor);
          if (verdict?.kind !== "writer") return;
          const fresh = yield* changes.githubComment(row.app_id, row.repo, row.number, {
            key: comment.key,
            login: comment.actor.login,
            body: comment.text.slice(0, COMMENT_BODY_MAX),
          });
          if (!fresh) return;
          const task = yield* taskOf(row);
          if (task !== undefined)
            yield* tasks.message(task, {
              id: `github:${comment.key}`,
              from: "review",
              author: comment.actor.login,
              text: cleanTaskText(comment.text),
            });
        });

      /** A head's checks finished: kept, and a failing head told to its Mate once, three at most. */
      const checked = (
        repository: string | undefined,
        sha: string,
        pulls: ReadonlyArray<typeof PullOfCheck.Type> | undefined,
      ) =>
        Effect.gen(function* () {
          if (repository === undefined) return;
          // A fork's pull request is never the Mate's to fix.
          if ((pulls ?? []).some((pull) => pull.head.repo.id !== pull.base.repo.id)) return;
          const rows = yield* sql<PullRow>`
            SELECT ${sql.literal(PULL_COLUMNS)} FROM hq_pull_request
            WHERE lower(github_repo) = lower(${repository}) AND head_sha = ${sha}
              AND state = 'open'`;
          for (const row of rows) {
            const app = yield* asApp(row.app_id, row.repo, row.github_repo);
            if (app === undefined) continue;
            const runs = yield* github.checkRuns(app.remote, app.token, sha);
            if (runs.status !== 200) continue;
            const { state, failing } = checksOf(runs.runs);
            if (state === undefined) continue;
            const [mate] = yield* leader.write(sql<{ readonly mate_project_id: string }>`
              UPDATE hq_pull_request pr SET checks = ${state}, updated_at = now()
              FROM hq_change c
              WHERE pr.app_id::text = ${row.app_id} AND pr.repo = ${row.repo}
                AND pr.number = ${row.number} AND pr.head_sha = ${sha}
                AND c.app_id = pr.app_id AND c.repo = pr.repo AND c.number = pr.number
              RETURNING c.mate_project_id`);
            if (mate !== undefined && row.checks !== state) yield* moved(mate.mate_project_id);
            if (state !== "failing" || row.checks_given_up) continue;
            const task = yield* taskOf(row);
            if (task === undefined) continue;
            const [told] = yield* leader.write(sql<{ readonly tries: number }>`
              UPDATE hq_pull_request
              SET checks_told_sha = ${sha}, checks_told = checks_told + 1,
                checks_given_up = checks_told >= ${CHECK_TRIES}
              WHERE app_id::text = ${row.app_id} AND repo = ${row.repo} AND number = ${row.number}
                AND checks_told_sha IS DISTINCT FROM ${sha} AND NOT checks_given_up
              RETURNING checks_told AS tries`);
            if (told === undefined) continue;
            if (told.tries > CHECK_TRIES) {
              yield* github.comment(app.remote, app.token, row.pr_number, marked(CHECKS_GIVEN_UP));
              continue;
            }
            yield* tasks.message(task, {
              id: `github:checks:${sha}`,
              from: "review",
              author: null,
              text: checksFailed(
                row.pr_number,
                failing.map((run) => run.name),
                failing.find((run) => run.detailsUrl !== null)?.detailsUrl ?? null,
              ),
            });
          }
        });

      /** One of the app's events, handled one at a time with every other step here. */
      const listen = <E>(name: string, handle: (event: GithubEvent) => Effect.Effect<void, E>) =>
        events.on(name, (event) =>
          handle(event).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("a GitHub event not handled", {
                event: name,
                deliveryId: event.deliveryId,
                cause,
              }),
            ),
            working.withPermits(1),
          ),
        );

      yield* listen("pull_request", (event) =>
        Effect.gen(function* () {
          const read = readPullEvent(event.payload);
          if (read === undefined || read.action !== "closed" || event.repository === undefined)
            return;
          const row = yield* pullOnGithub(event.repository, read.pull_request.number);
          if (row === undefined) return;
          if (read.pull_request.merged === true)
            yield* mergedOnGithub(
              row,
              read.pull_request.merge_commit_sha ?? undefined,
              read.pull_request.head?.sha,
            );
          else yield* closedOnGithub(row, read.sender);
        }),
      );
      yield* listen("pull_request_review", (event) =>
        Effect.gen(function* () {
          const read = readReview(event.payload);
          if (read === undefined || read.action !== "submitted") return;
          const body = read.review.body?.trim() ?? "";
          const requested = read.review.state.toLowerCase() === "changes_requested";
          if (body === "" && !requested) return;
          yield* heard(event.repository, read.pull_request.number, {
            key: `review:${String(read.review.id)}`,
            actor: read.review.user,
            text: body === "" ? "Changes requested." : body,
          });
        }),
      );
      yield* listen("pull_request_review_comment", (event) =>
        Effect.gen(function* () {
          const read = readReviewComment(event.payload);
          if (read === undefined || read.action !== "created") return;
          const line = read.comment.line ?? read.comment.original_line;
          const where =
            read.comment.path == null
              ? ""
              : `\`${read.comment.path}${line == null ? "" : `:${String(line)}`}\`: `;
          yield* heard(event.repository, read.pull_request.number, {
            key: `review_comment:${String(read.comment.id)}`,
            actor: read.comment.user,
            text: `${where}${read.comment.body}`,
          });
        }),
      );
      yield* listen("issue_comment", (event) =>
        Effect.gen(function* () {
          const read = readIssueComment(event.payload);
          // An issue's own comments are the intake's.
          if (read === undefined || read.action !== "created" || read.issue.pull_request == null)
            return;
          yield* heard(event.repository, read.issue.number, {
            key: `issue_comment:${String(read.comment.id)}`,
            actor: read.comment.user,
            text: read.comment.body,
          });
        }),
      );
      yield* listen("check_run", (event) =>
        Effect.gen(function* () {
          const read = readCheckRun(event.payload);
          if (read === undefined || read.action !== "completed") return;
          yield* checked(event.repository, read.check_run.head_sha, read.check_run.pull_requests);
        }),
      );
      yield* listen("check_suite", (event) =>
        Effect.gen(function* () {
          const read = readCheckSuite(event.payload);
          if (read === undefined || read.action !== "completed") return;
          yield* checked(
            event.repository,
            read.check_suite.head_sha,
            read.check_suite.pull_requests,
          );
        }),
      );

      // On every move of a change, and every minute for any missed.
      yield* Effect.forkScoped(
        Stream.runForEach(changes.changes.pipe(Stream.debounce(Duration.millis(100))), () =>
          keepAll(false).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("changes' pull requests not kept", { cause }),
            ),
          ),
        ),
      );
      // The timed sweep also asks GitHub how each open pull request stands.
      yield* Effect.forkScoped(
        keepAll(true).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("changes' pull requests not kept", { cause }),
          ),
          Effect.repeat(Schedule.spaced(options.sweepEvery ?? Duration.minutes(1))),
        ),
      );

      /** The GitHub user id of `login`, kept once read. */
      const userIdOf = (
        app: { readonly remote: RemoteIdentity; readonly token: Redacted.Redacted },
        login: string,
      ) =>
        Effect.gen(function* () {
          const known = userIds.get(login.toLowerCase());
          if (known !== undefined) return known;
          const user = yield* github.user(app.remote, app.token, login);
          if (user.id === undefined) return undefined;
          if (userIds.size >= 500) userIds.clear();
          userIds.set(login.toLowerCase(), user.id);
          return user.id;
        }).pipe(Effect.orElseSucceed(() => undefined));

      /**
       * `mate/gate = success` on `sha`, as the app: a ruleset requiring it from the app lets nothing
       * else satisfy it. An installation that has not approved writing statuses is asked nothing for
       * it — no token, no status — and its merge goes on: its repository is advisory, never refused
       * for it.
       */
      const gateOnGithub = (row: PullRow, sha: string, link: string) =>
        Effect.gen(function* () {
          const grant = yield* auth.grantOf(row.github_repo);
          if (grant === undefined || !writesGate(grant.permissions)) return;
          const gate = yield* asApp(row.app_id, row.repo, row.github_repo, "gate");
          if (gate === undefined) return;
          const status = yield* github.setStatus(gate.remote, gate.token, sha, {
            state: "success",
            context: MATE_GATE,
            description: "Approved in Mate",
            targetUrl: link,
          });
          if (status !== 201)
            yield* Effect.logWarning("mate/gate not written on GitHub", {
              pull: row.pr_number,
              status,
            });
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("mate/gate not written on GitHub", { pull: row.pr_number, cause }),
          ),
        );

      const mergeOnGithub = (
        userId: string,
        row: PullRow,
        expectedHead: string,
      ): Effect.Effect<HqChange, MergeError> =>
        Effect.gen(function* () {
          const { app_id: appId, repo, number } = row;
          yield* changes.personMay(userId, appId, "merge_change");
          const change = yield* changes.change(appId, repo, number);
          if (change.state !== "open") return yield* refuse("change_not_open");
          if (change.head !== expectedHead) return yield* refuse("head_moved");
          const app = yield* asApp(row.app_id, row.repo, row.github_repo, "merge").pipe(
            Effect.orElseSucceed(() => undefined),
          );
          if (app === undefined) return yield* refuse("github_unreachable");
          // GitHub merges the head the person saw, or nothing.
          if (row.head_sha !== expectedHead) {
            const pushed = yield* mirror
              .pushChange(appId, repo, number)
              .pipe(Effect.orElseSucceed(() => undefined));
            if (pushed?.sha !== expectedHead) return yield* refuse("github_unreachable");
            yield* leader.write(sql`
              UPDATE hq_pull_request SET head_sha = ${pushed.sha}, checks = NULL
              WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}`);
          }
          // GitHub merges it into the repository's default branch, or not at all.
          const [base, now] = yield* Effect.all([
            github.defaultBranch(app.remote, app.token),
            github.pull(app.remote, app.token, row.pr_number),
          ]).pipe(Effect.orElseSucceed(() => [undefined, undefined] as const));
          if (base?.branch === undefined || now?.pull === undefined)
            return yield* refuse("github_unreachable");
          if (now.pull.base !== base.branch) return yield* refuse("github_wrong_base");
          const facts = yield* factsOf(appId, repo, number);
          const { login } =
            facts === undefined
              ? { login: undefined }
              : sectionOf(appId, repo, number, row.github_repo, facts);
          const id = login === undefined ? undefined : yield* userIdOf(app, login);
          // The person merges this head in Mate: recorded, then said on GitHub before its merge.
          // `hq_gate` records the Zerops person's press, whatever GitHub answers: that is the rule.
          yield* leader.write(sql`
            INSERT INTO hq_gate (app_id, repo, sha, by)
            VALUES (${appId}::uuid, ${repo}, ${expectedHead}, ${userId})
            ON CONFLICT (app_id, repo, sha) DO UPDATE SET by = excluded.by, at = now()`);
          yield* gateOnGithub(
            row,
            expectedHead,
            `${DEFAULT_HOSTED_APP_URL}${changeRoutePath(appId, repo, number)}`,
          );
          const merged = yield* github
            .mergePull(app.remote, app.token, row.pr_number, {
              sha: expectedHead,
              title: `${change.title} (#${String(row.pr_number)})`,
              message: mergeMessage({
                description: change.body,
                coAuthor: login === undefined || id === undefined ? null : { login, id },
                taskLink: facts?.taskLink ?? null,
              }),
            })
            .pipe(Effect.orElseSucceed(() => undefined));
          if (merged === undefined) return yield* refuse("github_unreachable");
          if (merged.status === 409) return yield* refuse("head_moved");
          if (merged.status === 405)
            return yield* refuse(
              /not mergeable|conflict/iu.test(merged.message ?? "") ? "conflict" : "github_blocked",
            );
          if (merged.status !== 200) {
            yield* Effect.logWarning("GitHub refused a merge", {
              appId,
              repo,
              number,
              status: merged.status,
            });
            return yield* refuse("github_refused");
          }
          // The head GitHub merged is the one it was asked to: `sha` holds it to it.
          yield* mergedOnGithub(row, merged.sha, expectedHead);
          return yield* answered(appId, repo, number);
        });

      /**
       * A mirrored change as a merge on GitHub left it: merged here, or — HQ not having followed
       * GitHub yet — refused as such, for the sweep to finish.
       */
      const answered = (appId: string, repo: string, number: number) =>
        Effect.gen(function* () {
          const change = yield* changes.change(appId, repo, number);
          if (change.state !== "merged") return yield* refuse("github_landing");
          return change;
        });

      /**
       * A change just closed in Mate: its pull request closed on GitHub too, read under the permit,
       * so a sweep that closed it meanwhile closed it once. GitHub not answering leaves it for the
       * sweep; the close in Mate stands.
       */
      const closedThere = (closed: HqChange) =>
        Effect.gen(function* () {
          const row = yield* pullOf(closed.appId, closed.repo, closed.number);
          if (row?.state === "open") yield* closeOnGithub(row);
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("a pull request not closed on GitHub yet", { cause }),
          ),
          working.withPermits(1),
        );

      return PullRequests.of({
        merge: (userId, appId, repo, number, expectedHead) =>
          Effect.gen(function* () {
            // A change mirrored to GitHub merges there and only there: never by HQ's own squash.
            const repository = yield* mirror.repositoryOf(appId, repo);
            if (repository === undefined)
              return yield* changes.mergeChange(userId, appId, repo, number, expectedHead);
            return yield* Effect.gen(function* () {
              yield* changes.personMay(userId, appId, "merge_change");
              const row = yield* pullOf(appId, repo, number);
              if (row === undefined) return yield* refuse("github_no_pull");
              if (row.state === "closed") return yield* refuse("github_closed");
              if (row.state === "open") return yield* mergeOnGithub(userId, row, expectedHead);
              // Merged on GitHub already: followed now, if it was not.
              if (row.merged_sha !== null) yield* landed(row, row.merged_sha, row.merged_head);
              return yield* answered(appId, repo, number);
            }).pipe(working.withPermits(1));
          }),
        close: (userId, appId, repo, number, expectedHead) =>
          Effect.tap(changes.closeChange(userId, appId, repo, number, expectedHead), closedThere),
        mateClose: (projectId, repo, number) =>
          Effect.tap(changes.mateCloseChange(projectId, repo, number), closedThere),
      });
    }),
  );
