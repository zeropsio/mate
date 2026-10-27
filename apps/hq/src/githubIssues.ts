/**
 * What HQ asks of GitHub's REST API for automated Mates, with the token it is handed — the
 * organization's GitHub app's where it reaches the repository, else the repository's own: a
 * webhook on its issues and their comments made, refreshed or removed (`intake.ts`); an issue's
 * reaction, comments (made and edited), labels and state (`githubChannel.ts`); a change's pull
 * request opened, read, edited, assigned, merged, and its head's checks (`pullRequests.ts`); and
 * whether a person may steer Mate there — their permission on the repository, and the email their
 * profile shows (`githubGate.ts`). Each call waits at most 10 s and reads at most 1 MiB of its
 * answer, as `gitTransport.ts`; an answer is its status and what HQ reads of it, never the token.
 *
 * @module githubIssues
 */
import * as ByteSize from "effect/ByteSize";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";

import { HostUnreachable, type RemoteIdentity } from "./gitTransport.ts";

const decodeHook = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ id: Schema.Number })),
);
const decodePermission = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      permission: Schema.String,
      role_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
);
const decodeUser = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.optionalKey(Schema.Number),
      type: Schema.optionalKey(Schema.String),
      email: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
);

const PullEnd = Schema.Struct({
  ref: Schema.optionalKey(Schema.String),
  sha: Schema.optionalKey(Schema.String),
  repo: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.Number }))),
});
const PullRead = Schema.Struct({
  number: Schema.Number,
  html_url: Schema.String,
  state: Schema.String,
  merged: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  user: Schema.optionalKey(Schema.NullOr(Schema.Struct({ login: Schema.String }))),
  head: Schema.optionalKey(PullEnd),
  base: Schema.optionalKey(PullEnd),
  merge_commit_sha: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const decodePull = Schema.decodeUnknownOption(Schema.fromJsonString(PullRead));
const decodePulls = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(PullRead)));
const decodeMessage = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ message: Schema.optionalKey(Schema.String) })),
);
const decodeRefusal = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      message: Schema.optionalKey(Schema.String),
      errors: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            message: Schema.optionalKey(Schema.String),
            field: Schema.optionalKey(Schema.String),
            code: Schema.optionalKey(Schema.String),
          }),
        ),
      ),
    }),
  ),
);

/**
 * GitHub's reason for refusing a write, as it said it: its message and each error's own words, or
 * the field and code where an error has none ("Validation Failed: head invalid").
 */
export const refusalOf = (body: string): string | undefined =>
  Option.getOrUndefined(
    Option.map(decodeRefusal(body), (read) => {
      const details = (read.errors ?? []).flatMap((error) =>
        error.message !== undefined
          ? [error.message]
          : error.field !== undefined || error.code !== undefined
            ? [[error.field, error.code].filter((part) => part !== undefined).join(" ")]
            : [],
      );
      const said = [read.message, details.join("; ")].filter(
        (part): part is string => part !== undefined && part !== "",
      );
      return said.length === 0 ? undefined : said.join(": ");
    }),
  );

const decodeMerged = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ sha: Schema.optionalKey(Schema.String) })),
);
const decodeState = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      state: Schema.String,
      closed_by: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({ login: Schema.String, type: Schema.optionalKey(Schema.String) }),
        ),
      ),
    }),
  ),
);
const decodeRepository = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ default_branch: Schema.optionalKey(Schema.String) })),
);
const decodeCheckRuns = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      check_runs: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          status: Schema.String,
          conclusion: Schema.optionalKey(Schema.NullOr(Schema.String)),
          details_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
        }),
      ),
    }),
  ),
);

/** A pull request as HQ reads it. */
export interface GithubPull {
  readonly number: number;
  readonly url: string;
  readonly state: "open" | "closed";
  readonly merged: boolean;
  readonly body: string;
  /** Who opened it. */
  readonly author: string | undefined;
  /** Its head's commit, and the branch it merges into. */
  readonly headSha: string | undefined;
  readonly base: string | undefined;
  /** Its head is a branch of the repository itself, not of a fork. */
  readonly sameRepository: boolean;
  /** Once merged: the commit the merge made. */
  readonly mergeSha: string | undefined;
}

const pullOf = (read: typeof PullRead.Type): GithubPull => ({
  number: read.number,
  url: read.html_url,
  state: read.state === "open" ? "open" : "closed",
  merged: read.merged === true,
  body: read.body ?? "",
  author: read.user?.login,
  headSha: read.head?.sha,
  base: read.base?.ref,
  sameRepository:
    read.head?.repo != null && read.base?.repo != null && read.head.repo.id === read.base.repo.id,
  mergeSha: read.merge_commit_sha ?? undefined,
});

/** One check of a commit, as GitHub reports it. */
export interface GithubCheckRun {
  readonly name: string;
  /** `queued`, `in_progress`, `completed`, … */
  readonly status: string;
  /** Once completed: `success`, `failure`, `neutral`, `skipped`, `timed_out`, … */
  readonly conclusion: string | null;
  readonly detailsUrl: string | null;
}

/** The events an intake's webhook delivers: issues, and the comments on them. */
export const INTAKE_EVENTS = ["issues", "issue_comment"] as const;

/** A person's standing on a repository, as GitHub answers it. */
export interface GithubPermission {
  readonly status: number;
  /** `admin`, `maintain`, `write`, `triage`, `read` or `none`; none where GitHub did not say. */
  readonly role: string | undefined;
}

/** A GitHub user's profile, as far as HQ reads it: one GitHub lets show only a verified email. */
export interface GithubUser {
  readonly status: number;
  /** The account's id: its noreply email is `<id>+<login>@users.noreply.github.com`. */
  readonly id: number | undefined;
  readonly bot: boolean;
  readonly email: string | undefined;
}

export class GithubIssues extends Context.Service<
  GithubIssues,
  {
    /** A webhook of the repository's `issues` events to `url`, signed with `secret`. */
    readonly makeHook: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      hook: { readonly url: string; readonly secret: Redacted.Redacted },
    ) => Effect.Effect<
      { readonly status: number; readonly id: number | undefined },
      HostUnreachable
    >;
    readonly removeHook: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      id: number,
    ) => Effect.Effect<number, HostUnreachable>;
    /** The events of the webhook HQ made, set to `INTAKE_EVENTS`; its status. */
    readonly refreshHook: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      id: number,
    ) => Effect.Effect<number, HostUnreachable>;
    /** A comment on the issue `number`; its status, and its id once made. */
    readonly comment: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      number: number,
      body: string,
    ) => Effect.Effect<
      { readonly status: number; readonly id: number | undefined },
      HostUnreachable
    >;
    /** The comment `id`'s words replaced; its status. */
    readonly editComment: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      id: number,
      body: string,
    ) => Effect.Effect<number, HostUnreachable>;
    /** A reaction (`eyes` when taken, `rocket` when merged) on the issue `number`; its status. */
    readonly react: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      number: number,
      content: "eyes" | "rocket",
    ) => Effect.Effect<number, HostUnreachable>;
    /** Whether the issue (or pull request) `number` is open, and who closed it. */
    readonly issueState: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      number: number,
    ) => Effect.Effect<
      {
        readonly status: number;
        readonly state: string | undefined;
        readonly closedBy: { readonly login: string; readonly type?: string } | undefined;
      },
      HostUnreachable
    >;
    /** The issue `number` closed as done (`completed`); its status. */
    readonly closeIssue: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      number: number,
    ) => Effect.Effect<number, HostUnreachable>;
    /** The repository's default branch. */
    readonly defaultBranch: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
    ) => Effect.Effect<
      { readonly status: number; readonly branch: string | undefined },
      HostUnreachable
    >;
    /** A pull request of `head` into `base`, ready for review (not a draft); GitHub's reason if not. */
    readonly openPull: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      pull: {
        readonly title: string;
        readonly head: string;
        readonly base: string;
        readonly body: string;
      },
    ) => Effect.Effect<
      {
        readonly status: number;
        readonly pull: GithubPull | undefined;
        readonly refusal?: string | undefined;
      },
      HostUnreachable
    >;
    /** The repository's pull requests from its own branch `branch`, open or not. */
    readonly pullsOf: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      branch: string,
    ) => Effect.Effect<ReadonlyArray<GithubPull>, HostUnreachable>;
    /** The pull request `number`. */
    readonly pull: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      number: number,
    ) => Effect.Effect<
      { readonly status: number; readonly pull: GithubPull | undefined },
      HostUnreachable
    >;
    /** The pull request `number` retitled, described, or closed; its status. */
    readonly editPull: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      number: number,
      edit: {
        readonly title?: string;
        readonly body?: string;
        readonly state?: "closed" | "open";
      },
    ) => Effect.Effect<number, HostUnreachable>;
    /**
     * The pull request `number` merged into its base by `method` — squashed, or `merge`: its
     * commits kept, under one merge commit — if its head is still `sha`: its status, the commit it
     * made, or GitHub's reason.
     */
    readonly mergePull: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      number: number,
      merge: {
        readonly sha: string;
        readonly title: string;
        readonly message: string;
        readonly method: "squash" | "merge";
      },
    ) => Effect.Effect<
      {
        readonly status: number;
        readonly sha: string | undefined;
        readonly message: string | undefined;
      },
      HostUnreachable
    >;
    /** The commit status `context` on `sha` set to `state`; GitHub's answer's status. */
    readonly setStatus: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      sha: string,
      status: {
        readonly state: "success";
        readonly context: string;
        readonly description: string;
        readonly targetUrl: string;
      },
    ) => Effect.Effect<number, HostUnreachable>;
    /** `logins` made assignees of the issue or pull request `number`; its status. */
    readonly assign: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      number: number,
      logins: ReadonlyArray<string>,
    ) => Effect.Effect<number, HostUnreachable>;
    /** The checks GitHub reports on the commit `sha`. */
    readonly checkRuns: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      sha: string,
    ) => Effect.Effect<
      { readonly status: number; readonly runs: ReadonlyArray<GithubCheckRun> },
      HostUnreachable
    >;
    /** The label added to the issue `number`, or taken off it; its status. */
    readonly label: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      number: number,
      label: string,
      on: boolean,
    ) => Effect.Effect<number, HostUnreachable>;
    /** What `login` may do on the repository. */
    readonly permission: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      login: string,
    ) => Effect.Effect<GithubPermission, HostUnreachable>;
    /** `login`'s profile. */
    readonly user: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      login: string,
    ) => Effect.Effect<GithubUser, HostUnreachable>;
  }
>()("@t3tools/hq/githubIssues") {}

/**
 * Over HTTP; `api` replaces GitHub's API address for every repository (the tests' fake), else
 * github.com's is `https://api.github.com` and an Enterprise host's `https://<host>/api/v3`.
 */
export const githubIssuesLayer = (api?: string) =>
  Layer.effect(
    GithubIssues,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const base = (remote: RemoteIdentity) =>
        api ??
        (remote.host === "github.com" ? "https://api.github.com" : `https://${remote.host}/api/v3`);
      const send = (
        method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
        url: string,
        token: Redacted.Redacted,
        body?: unknown,
      ) =>
        Effect.scoped(
          Effect.gen(function* () {
            const request = HttpClientRequest.make(method)(url).pipe(
              HttpClientRequest.bearerToken(token),
              HttpClientRequest.setHeader("user-agent", "Zerops-Mate"),
              HttpClientRequest.setHeader("accept", "application/vnd.github+json"),
              HttpClientRequest.setHeader("x-github-api-version", "2022-11-28"),
            );
            const response = yield* client.execute(
              body === undefined ? request : HttpClientRequest.bodyJsonUnsafe(request, body),
            );
            return { status: response.status, body: yield* response.text };
          }).pipe(
            Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(1)),
            Effect.timeout(Duration.seconds(10)),
            Effect.mapError(() => new HostUnreachable({})),
          ),
        );
      const repo = (remote: RemoteIdentity) => `${base(remote)}/repos/${remote.path}`;
      return GithubIssues.of({
        makeHook: (remote, token, hook) =>
          Effect.map(
            send("POST", `${repo(remote)}/hooks`, token, {
              name: "web",
              active: true,
              events: INTAKE_EVENTS,
              config: {
                url: hook.url,
                content_type: "json",
                secret: Redacted.value(hook.secret),
                insecure_ssl: "0",
              },
            }),
            (reply) => ({
              status: reply.status,
              id:
                reply.status === 201
                  ? Option.getOrUndefined(decodeHook(reply.body))?.id
                  : undefined,
            }),
          ),
        removeHook: (remote, token, id) =>
          Effect.map(
            send("DELETE", `${repo(remote)}/hooks/${String(id)}`, token),
            (reply) => reply.status,
          ),
        refreshHook: (remote, token, id) =>
          Effect.map(
            send("PATCH", `${repo(remote)}/hooks/${String(id)}`, token, { events: INTAKE_EVENTS }),
            (reply) => reply.status,
          ),
        comment: (remote, token, number, body) =>
          Effect.map(
            send("POST", `${repo(remote)}/issues/${String(number)}/comments`, token, { body }),
            (reply) => ({
              status: reply.status,
              id:
                reply.status === 201
                  ? Option.getOrUndefined(decodeHook(reply.body))?.id
                  : undefined,
            }),
          ),
        editComment: (remote, token, id, body) =>
          Effect.map(
            send("PATCH", `${repo(remote)}/issues/comments/${String(id)}`, token, { body }),
            (reply) => reply.status,
          ),
        react: (remote, token, number, content) =>
          Effect.map(
            send("POST", `${repo(remote)}/issues/${String(number)}/reactions`, token, { content }),
            (reply) => reply.status,
          ),
        label: (remote, token, number, label, on) =>
          Effect.map(
            on
              ? send("POST", `${repo(remote)}/issues/${String(number)}/labels`, token, {
                  labels: [label],
                })
              : send(
                  "DELETE",
                  `${repo(remote)}/issues/${String(number)}/labels/${encodeURIComponent(label)}`,
                  token,
                ),
            (reply) => reply.status,
          ),
        issueState: (remote, token, number) =>
          Effect.map(send("GET", `${repo(remote)}/issues/${String(number)}`, token), (reply) => {
            const read =
              reply.status === 200 ? Option.getOrUndefined(decodeState(reply.body)) : undefined;
            return {
              status: reply.status,
              state: read?.state,
              closedBy: read?.closed_by ?? undefined,
            };
          }),
        closeIssue: (remote, token, number) =>
          Effect.map(
            send("PATCH", `${repo(remote)}/issues/${String(number)}`, token, {
              state: "closed",
              state_reason: "completed",
            }),
            (reply) => reply.status,
          ),
        defaultBranch: (remote, token) =>
          Effect.map(send("GET", repo(remote), token), (reply) => ({
            status: reply.status,
            branch:
              reply.status === 200
                ? Option.getOrUndefined(decodeRepository(reply.body))?.default_branch
                : undefined,
          })),
        openPull: (remote, token, pull) =>
          Effect.map(
            send("POST", `${repo(remote)}/pulls`, token, { ...pull, draft: false }),
            (reply) => {
              const read = reply.status === 201 ? decodePull(reply.body) : Option.none();
              return {
                status: reply.status,
                pull: Option.getOrUndefined(Option.map(read, pullOf)),
                ...(reply.status === 201 ? {} : { refusal: refusalOf(reply.body) }),
              };
            },
          ),
        pullsOf: (remote, token, branch) =>
          Effect.map(
            send(
              "GET",
              `${repo(remote)}/pulls?state=all&head=${encodeURIComponent(
                `${remote.path.split("/")[0] ?? ""}:${branch}`,
              )}`,
              token,
            ),
            (reply) =>
              reply.status === 200
                ? Option.getOrElse(decodePulls(reply.body), () => []).map(pullOf)
                : [],
          ),
        pull: (remote, token, number) =>
          Effect.map(send("GET", `${repo(remote)}/pulls/${String(number)}`, token), (reply) => {
            const read = reply.status === 200 ? decodePull(reply.body) : Option.none();
            return { status: reply.status, pull: Option.getOrUndefined(Option.map(read, pullOf)) };
          }),
        editPull: (remote, token, number, edit) =>
          Effect.map(
            send("PATCH", `${repo(remote)}/pulls/${String(number)}`, token, edit),
            (reply) => reply.status,
          ),
        mergePull: (remote, token, number, merge) =>
          Effect.map(
            send("PUT", `${repo(remote)}/pulls/${String(number)}/merge`, token, {
              merge_method: merge.method,
              sha: merge.sha,
              commit_title: merge.title,
              commit_message: merge.message,
            }),
            (reply) => ({
              status: reply.status,
              sha:
                reply.status === 200
                  ? Option.getOrUndefined(decodeMerged(reply.body))?.sha
                  : undefined,
              message: Option.getOrUndefined(decodeMessage(reply.body))?.message,
            }),
          ),
        setStatus: (remote, token, sha, status) =>
          Effect.map(
            send("POST", `${repo(remote)}/statuses/${encodeURIComponent(sha)}`, token, {
              state: status.state,
              context: status.context,
              description: status.description,
              target_url: status.targetUrl,
            }),
            (reply) => reply.status,
          ),
        assign: (remote, token, number, logins) =>
          Effect.map(
            send("POST", `${repo(remote)}/issues/${String(number)}/assignees`, token, {
              assignees: logins,
            }),
            (reply) => reply.status,
          ),
        checkRuns: (remote, token, sha) =>
          Effect.map(
            send(
              "GET",
              `${repo(remote)}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`,
              token,
            ),
            (reply) => ({
              status: reply.status,
              runs:
                reply.status === 200
                  ? Option.getOrElse(decodeCheckRuns(reply.body), () => ({
                      check_runs: [],
                    })).check_runs.map((run) => ({
                      name: run.name,
                      status: run.status,
                      conclusion: run.conclusion ?? null,
                      detailsUrl: run.details_url ?? null,
                    }))
                  : [],
            }),
          ),
        permission: (remote, token, login) =>
          Effect.map(
            send(
              "GET",
              `${repo(remote)}/collaborators/${encodeURIComponent(login)}/permission`,
              token,
            ),
            (reply) => {
              const read =
                reply.status === 200
                  ? Option.getOrUndefined(decodePermission(reply.body))
                  : undefined;
              return { status: reply.status, role: read?.role_name ?? read?.permission };
            },
          ),
        user: (remote, token, login) =>
          Effect.map(
            send("GET", `${base(remote)}/users/${encodeURIComponent(login)}`, token),
            (reply) => {
              const read =
                reply.status === 200 ? Option.getOrUndefined(decodeUser(reply.body)) : undefined;
              return {
                status: reply.status,
                id: read?.id,
                bot: read?.type === "Bot",
                email: read?.email?.trim().toLowerCase() || undefined,
              };
            },
          ),
      });
    }),
  );
