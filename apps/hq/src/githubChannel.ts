/**
 * How a GitHub issue's task hears back (`TaskSourceChannel` of `github-issue`), as the
 * organization's GitHub app where it reaches the issue's repository, else with the token of the
 * application's repository whose remote it is (`Remotes.tokenOf`):
 *
 * - at intake, 👀 on the issue;
 * - ONE status comment, made once and edited as the task moves (its id is the task's
 *   `status_ref`): its place in the queue, the Mate that picked it up, the question it waits on
 *   (and the label `mate:blocked` while it waits), the change it opened, how it ended. A comment
 *   gone from the issue is made again;
 * - once, a day into a wait, a new comment asking again (an edit tells nobody).
 *
 * Every comment HQ makes carries `HQ_MARK`, so its own comments are never taken for a person's. A
 * call GitHub refuses is tried once more, then logged; it never moves the task.
 *
 * @module githubChannel
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/sql/SqlClient";

import { GithubIssues } from "./githubIssues.ts";
import { remoteIdentity } from "./gitTransport.ts";
import { Remotes } from "./repoRemotes.ts";
import { type TaskOnSource, TaskSourceChannels, type TaskStatus } from "./taskSources.ts";

/** The label an issue carries while its task waits for a person's answer. */
export const BLOCKED_LABEL = "mate:blocked";

/** What marks a comment as HQ's own: unseen on GitHub, and stripped from any person's text. */
export const HQ_MARK = "<!-- zerops-mate -->";

/**
 * Words from a Mate or a reason, as an issue shows them: they read the same, but ping nobody
 * (`@user`, `@org/team`) and link no other issue (`#12`, `GH-12`, `owner/repo#12`) — a word
 * joiner, unseen, keeps GitHub from taking them as such.
 */
export const quieted = (text: string) =>
  text
    .replace(/@(?=[\w-])/gu, "@\u2060")
    .replace(/#(?=\d)/gu, "#\u2060")
    .replace(/\b(GH)-(?=\d)/giu, "$1\u2060-");

/** A status line's words on the issue: plain sentences, the Mate by name. */
export const statusWords = (status: TaskStatus): string => {
  switch (status.kind) {
    case "queued":
      return `Queued for an automated Mate: #${String(status.position)} in line.`;
    case "picked":
      return `${status.mate} picked this up.`;
    case "waiting":
      return `${status.mate} is waiting for you: ${quieted(status.question)}\n\nAnswer in a comment here.`;
    case "change":
      return `${status.mate} opened a change for review: ${status.link}`;
    case "done":
      return status.link === null
        ? `${status.mate} is done.`
        : `${status.mate} is done; its change: ${status.link}`;
    case "failed":
      return status.mate === null
        ? `No automated Mate could take this up: ${quieted(status.why)}`
        : `${status.mate} couldn't finish this: ${quieted(status.why)}`;
    case "stopped":
      return status.mate === null
        ? `Stopped: ${quieted(status.why)}`
        : `${status.mate} stopped: ${quieted(status.why)}`;
  }
};

/** A comment's body as HQ posts it: its words, then its mark. */
export const marked = (words: string) => `${words}\n\n${HQ_MARK}`;

export const githubChannelLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const remotes = yield* Remotes;
    const github = yield* GithubIssues;
    const channels = yield* TaskSourceChannels;

    /** The issue's repository as the application holds it, with its token; none where it holds none. */
    const issueOf = (task: TaskOnSource) =>
      Effect.gen(function* () {
        if (task.source.kind !== "github-issue") return undefined;
        const repo = task.source.repo;
        const rows = yield* sql<{ readonly repo: string; readonly url: string }>`
          SELECT repo, url FROM hq_repo_remote WHERE app_id::text = ${task.appId} ORDER BY repo`;
        const found = rows.find((row) => remoteIdentity(row.url)?.path === repo);
        const remote = found === undefined ? undefined : remoteIdentity(found.url);
        if (found === undefined || remote === undefined) return undefined;
        const { token } = yield* remotes.tokenOf({ appId: task.appId, repo: found.repo });
        return { remote, token, number: task.source.number };
      });

    /** A call GitHub answered with something but `ok`, tried once more. */
    const twice = <E, R>(call: Effect.Effect<number, E, R>, ok: (status: number) => boolean) =>
      call.pipe(
        Effect.filterOrFail(ok, (status) => ({ _tag: "GithubRefused", status }) as const),
        Effect.retry({ schedule: Schedule.spaced(Duration.seconds(1)), times: 1 }),
      );

    const quietly =
      (what: string, task: TaskOnSource) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.as(Effect.logWarning(what, { taskId: task.taskId, cause }), undefined),
          ),
        );

    yield* channels.register({
      kind: "github-issue",
      acknowledge: (task) =>
        Effect.gen(function* () {
          const issue = yield* issueOf(task);
          if (issue === undefined) return;
          yield* twice(github.react(issue.remote, issue.token, issue.number, "eyes"), (status) =>
            [200, 201].includes(status),
          );
        }).pipe(quietly("an issue not acknowledged", task), Effect.asVoid),
      status: (task, status) =>
        Effect.gen(function* () {
          const issue = yield* issueOf(task);
          if (issue === undefined)
            return yield* Effect.logInfo("a task's status not said: no remote", {
              taskId: task.taskId,
            });
          const body = marked(statusWords(status));
          // Waiting for an answer shows on the issue's labels too; picked up again, or ended, not.
          const blocked =
            status.kind === "waiting"
              ? true
              : status.kind === "queued" || status.kind === "change"
                ? undefined
                : false;
          if (blocked !== undefined)
            yield* github
              .label(issue.remote, issue.token, issue.number, BLOCKED_LABEL, blocked)
              .pipe(Effect.ignore);
          if (task.statusRef !== undefined) {
            const edited = yield* twice(
              github.editComment(issue.remote, issue.token, Number(task.statusRef), body),
              (answer) => answer === 200 || answer === 404,
            );
            if (edited === 200) return task.statusRef;
          }
          const made = yield* github.comment(issue.remote, issue.token, issue.number, body).pipe(
            Effect.filterOrFail(
              (answer) => answer.status === 201,
              (answer) => ({ _tag: "GithubRefused", status: answer.status }) as const,
            ),
            Effect.retry({ schedule: Schedule.spaced(Duration.seconds(1)), times: 1 }),
          );
          return made.id === undefined ? undefined : String(made.id);
        }).pipe(quietly("a task's status not said", task)),
      remind: (task, question) =>
        Effect.gen(function* () {
          const issue = yield* issueOf(task);
          if (issue === undefined) return;
          yield* github
            .comment(
              issue.remote,
              issue.token,
              issue.number,
              marked(
                `Still waiting for an answer: ${quieted(question)}\n\nAnswer in a comment here.`,
              ),
            )
            .pipe(
              Effect.filterOrFail(
                (answer) => answer.status === 201,
                (answer) => ({ _tag: "GithubRefused", status: answer.status }) as const,
              ),
              Effect.retry({ schedule: Schedule.spaced(Duration.seconds(1)), times: 1 }),
            );
        }).pipe(quietly("a task's reminder not posted", task), Effect.asVoid),
    });
  }),
);
