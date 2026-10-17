/**
 * What HQ asks of GitHub's REST API for automated Mates, with a repository's own token: a webhook
 * on its issues and their comments made, refreshed or removed (`intake.ts`); an issue's reaction,
 * comments (made and edited) and labels (`githubChannel.ts`); and whether a person may steer
 * Mate there — their permission on the repository, and the email their profile shows
 * (`githubGate.ts`). Each call waits at most 10 s and reads at most 1 MiB of its answer, as
 * `gitTransport.ts`; an answer is its status and what HQ reads of it, never the token.
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
      type: Schema.optionalKey(Schema.String),
      email: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
);

/** The events an intake's webhook delivers: issues, and the comments on them. */
export const INTAKE_EVENTS = ["issues"] as const;

/** A person's standing on a repository, as GitHub answers it. */
export interface GithubPermission {
  readonly status: number;
  /** `admin`, `maintain`, `write`, `triage`, `read` or `none`; none where GitHub did not say. */
  readonly role: string | undefined;
}

/** A GitHub user's profile, as far as HQ reads it: one GitHub lets show only a verified email. */
export interface GithubUser {
  readonly status: number;
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
    /** A reaction (`eyes`) on the issue `number`; its status. */
    readonly react: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      number: number,
      content: "eyes",
    ) => Effect.Effect<number, HostUnreachable>;
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
        method: "GET" | "POST" | "PATCH" | "DELETE",
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
                bot: read?.type === "Bot",
                email: read?.email?.trim().toLowerCase() || undefined,
              };
            },
          ),
      });
    }),
  );
