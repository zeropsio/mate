// @effect-diagnostics nodeBuiltinImport:off -- GitHub's REST API, as HQ reaches it: over HTTP.
/**
 * GitHub's REST API in miniature for the tests: what HQ asked of it, and how it answers — a webhook
 * made (`201 { id }`), refused with a status the test sets; a comment posted (`201 { id }`) or
 * edited; a reaction, a label; a person's permission on the repository and their profile's email
 * (`nova`, a writer whose email is the test org owner's, unless the test says otherwise).
 *
 * @module test/harness/githubFake
 */
import * as NodeHttp from "node:http";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

/** A comment's words as a person reads them: HQ's mark (`githubChannel.ts`) taken off. */
const unmarked = (body: string) => body.replace(/\n\n<!-- zerops-mate -->$/u, "");

export interface GithubRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

export const githubFake = Effect.gen(function* () {
  const state = {
    seen: [] as Array<GithubRequest>,
    /** The status the next webhook made answers; 201 with `hookId`. */
    hookStatus: 201,
    hookId: 7,
    /** The status each comment answers, in turn; 201 once they run out. */
    commentStatuses: [] as Array<number>,
    /** The next comment's id. */
    commentId: 100,
    /** Each person's role on the repository; `none` for anyone not named. */
    roles: new Map<string, string>([["nova", "write"]]),
    /** Each person's profile: its email and whether it is a bot's. */
    users: new Map<string, { readonly email: string | null; readonly bot?: boolean }>([
      ["nova", { email: "owner@tea.test" }],
    ]),
  };
  const { url } = yield* Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{ server: NodeHttp.Server; url: string }>((resolve) => {
          const server = NodeHttp.createServer((request, response) => {
            let text = "";
            request.on("data", (chunk: Buffer) => {
              text += chunk.toString("utf8");
            });
            request.on("end", () => {
              const path = request.url ?? "";
              state.seen.push({
                method: request.method ?? "",
                path,
                authorization: request.headers["authorization"],
                body: text === "" ? undefined : JSON.parse(text),
              });
              response.setHeader("content-type", "application/json");
              if (request.method === "POST" && path.endsWith("/hooks")) {
                response.writeHead(state.hookStatus);
                response.end(JSON.stringify(state.hookStatus === 201 ? { id: state.hookId } : {}));
                return;
              }
              if (request.method === "POST" && path.endsWith("/comments")) {
                const status = state.commentStatuses.shift() ?? 201;
                response.writeHead(status);
                response.end(JSON.stringify(status === 201 ? { id: (state.commentId += 1) } : {}));
                return;
              }
              if (request.method === "PATCH" && /\/hooks\/\d+$/u.test(path)) {
                response.writeHead(200);
                response.end("{}");
                return;
              }
              if (request.method === "PATCH" && /\/issues\/comments\/\d+$/u.test(path)) {
                response.writeHead(200);
                response.end("{}");
                return;
              }
              const permission = /\/collaborators\/([^/]+)\/permission$/u.exec(path);
              if (request.method === "GET" && permission !== null) {
                const role = state.roles.get(decodeURIComponent(permission[1]!)) ?? "none";
                response.writeHead(200);
                response.end(
                  JSON.stringify({
                    permission: role === "maintain" ? "write" : role,
                    role_name: role,
                  }),
                );
                return;
              }
              const user = /^\/users\/([^/]+)$/u.exec(path);
              if (request.method === "GET" && user !== null) {
                const found = state.users.get(decodeURIComponent(user[1]!));
                response.writeHead(found === undefined ? 404 : 200);
                response.end(
                  JSON.stringify(
                    found === undefined
                      ? {}
                      : { type: found.bot === true ? "Bot" : "User", email: found.email },
                  ),
                );
                return;
              }
              if (request.method === "POST" && /\/(reactions|labels)$/u.test(path)) {
                response.writeHead(201);
                response.end("[]");
                return;
              }
              response.writeHead(request.method === "DELETE" ? 204 : 404);
              response.end();
            });
          }).listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (address && typeof address !== "string")
              resolve({ server, url: `http://127.0.0.1:${address.port}` });
          });
        }),
    ),
    ({ server }) =>
      Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  /** What HQ asked of GitHub once `matches` holds of it; fails after ten seconds. */
  const seenWhere = (what: string, matches: (seen: ReadonlyArray<GithubRequest>) => boolean) =>
    Effect.suspend(() =>
      matches(state.seen) ? Effect.succeed([...state.seen]) : Effect.fail(what),
    ).pipe(
      Effect.retry(Schedule.spaced(Duration.millis(20))),
      Effect.timeout(Duration.seconds(10)),
      Effect.orDie,
    );
  /** The comments HQ posted, in order: the issue's path and the words, without HQ's mark. */
  const comments = Effect.sync(() =>
    state.seen
      .filter((request) => request.method === "POST" && request.path.endsWith("/comments"))
      .map((request) => [request.path, unmarked((request.body as { body: string }).body)] as const),
  );
  /** Every comment HQ made or edited, in order: how, where, and the words without HQ's mark. */
  const commentLog = Effect.sync(() =>
    state.seen
      .filter(
        (request) =>
          (request.method === "POST" && request.path.endsWith("/comments")) ||
          (request.method === "PATCH" && /\/issues\/comments\/\d+$/u.test(request.path)),
      )
      .map(
        (request) =>
          [
            request.method,
            request.path,
            unmarked((request.body as { body: string }).body),
          ] as const,
      ),
  );
  return { url, state, seenWhere, comments, commentLog };
});
