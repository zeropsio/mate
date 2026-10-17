/**
 * What HQ asks of GitHub's REST API for automated Mates, with a repository's own token: a webhook
 * on its issues made or removed (`intake.ts`), and a comment on an issue (`mateTasks.ts`). Each call
 * waits at most 10 s and reads at most 1 MiB of its answer, as `gitTransport.ts`; an answer is its
 * status and what HQ reads of it, never the token.
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
    /** A comment on the issue `number`; its status. */
    readonly comment: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      number: number,
      body: string,
    ) => Effect.Effect<number, HostUnreachable>;
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
        method: "POST" | "DELETE",
        url: string,
        token: Redacted.Redacted,
        body?: unknown,
      ) =>
        Effect.scoped(
          Effect.gen(function* () {
            const request = (
              method === "POST" ? HttpClientRequest.post(url) : HttpClientRequest.delete(url)
            ).pipe(
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
              events: ["issues"],
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
        comment: (remote, token, number, body) =>
          Effect.map(
            send("POST", `${repo(remote)}/issues/${String(number)}/comments`, token, { body }),
            (reply) => reply.status,
          ),
      });
    }),
  );
