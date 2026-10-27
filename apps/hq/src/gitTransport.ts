/** Canonical remote identity and authenticated, read-only host requests. No guide owns identity. */
import * as ByteSize from "effect/ByteSize";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";

export interface RemoteIdentity {
  readonly kind: "github" | "gitlab" | "unknown";
  readonly host: string;
  readonly path: string;
  readonly url: string;
  readonly key: string;
}

/** HTTPS only, without credentials or request parameters; GitHub repository paths ignore case. */
export const remoteIdentity = (input: string): RemoteIdentity | undefined => {
  // URL normalizes dot segments before they can be checked; reject those in the original input.
  if (/%|\\|\s/u.test(input) || input.split("/").some((part) => part === "." || part === ".."))
    return undefined;
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return undefined;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.port
  )
    return undefined;
  const host = parsed.hostname.toLowerCase();
  const kind =
    host === "github.com" || host.endsWith(".github.com")
      ? "github"
      : host === "gitlab.com" || host.startsWith("gitlab.")
        ? "gitlab"
        : "unknown";
  const raw = parsed.pathname
    .replace(/\/+$/u, "")
    .replace(/\.git$/iu, "")
    .slice(1);
  const parts = raw.split("/");
  if (
    parts.length < 2 ||
    (kind === "github" && parts.length !== 2) ||
    parts.some((part) => !/^[\w.-]+$/u.test(part) || part === "." || part === "..")
  )
    return undefined;
  const path = kind === "github" ? raw.toLowerCase() : raw;
  return { kind, host, path, url: `https://${host}/${path}.git`, key: `${host}/${path}` };
};

export interface HostReply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** Internal probe evidence only; classifiers never return or persist the raw body. */
  readonly body: string;
}
export class HostUnreachable extends Schema.TaggedError<HostUnreachable>()("HostUnreachable", {}) {
  override get message() {
    return "The repository host could not be reached in time.";
  }
}
export class GitTransport extends Context.Service<
  GitTransport,
  {
    readonly metadata: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
    ) => Effect.Effect<HostReply, HostUnreachable>;
    readonly receivePack: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
    ) => Effect.Effect<HostReply, HostUnreachable>;
    readonly rules: (
      remote: RemoteIdentity,
      branch: string,
      token: Redacted.Redacted,
    ) => Effect.Effect<HostReply, HostUnreachable>;
    /** A REST read under the repository (`path` starts with `/`); an ETag makes it conditional. */
    readonly read: (
      remote: RemoteIdentity,
      path: string,
      token: Redacted.Redacted,
      etag?: string,
    ) => Effect.Effect<HostReply, HostUnreachable>;
  }
>()("@t3tools/hq/gitTransport") {}

export const gitTransportLayer = Layer.effect(
  GitTransport,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const request = (url: string, token: Redacted.Redacted, git = false, etag?: string) =>
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* client.execute(
            HttpClientRequest.get(url).pipe(
              git
                ? HttpClientRequest.basicAuth("x-access-token", token)
                : HttpClientRequest.bearerToken(token),
              HttpClientRequest.setHeader("user-agent", "Zerops-Mate"),
              HttpClientRequest.setHeader(
                "accept",
                git
                  ? "application/x-git-receive-pack-advertisement"
                  : "application/vnd.github+json",
              ),
              HttpClientRequest.setHeader("x-github-api-version", "2022-11-28"),
              etag === undefined
                ? (request) => request
                : HttpClientRequest.setHeader("if-none-match", etag),
            ),
          );
          const body = yield* response.text;
          return { status: response.status, headers: response.headers, body };
        }).pipe(
          Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(1)),
          Effect.timeout(Duration.seconds(10)),
          Effect.mapError(() => new HostUnreachable({})),
        ),
      );
    const api = (remote: RemoteIdentity) =>
      remote.host === "github.com" ? "https://api.github.com" : `https://${remote.host}/api/v3`;
    return GitTransport.of({
      metadata: (remote, token) =>
        Effect.gen(function* () {
          const url = `${api(remote)}/repos/${remote.path}`;
          const reply = yield* request(url, token);
          // A same-origin REST redirect may reveal a rename, never permission to follow a Git write.
          if (reply.status !== 301 && reply.status !== 302) return reply;
          const location = reply.headers.location;
          let next: URL;
          try {
            next = new URL(location ?? "", url);
          } catch {
            return reply;
          }
          if (
            !location ||
            next.origin !== new URL(url).origin ||
            next.username ||
            next.password ||
            next.search ||
            next.hash ||
            !/^\/(?:api\/v3\/)?(?:repos|repositories)\/[\w/.-]+$/u.test(next.pathname)
          )
            return reply;
          return yield* request(next.toString(), token);
        }),
      receivePack: (remote, token) =>
        request(`${remote.url}/info/refs?service=git-receive-pack`, token, true),
      rules: (remote, branch, token) =>
        request(
          `${api(remote)}/repos/${remote.path}/rules/branches/${encodeURIComponent(branch)}`,
          token,
        ),
      read: (remote, path, token, etag) =>
        request(`${api(remote)}/repos/${remote.path}${path}`, token, false, etag),
    });
  }),
);
