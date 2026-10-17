// @effect-diagnostics nodeBuiltinImport:off -- GitHub's REST API, as HQ reaches it: over HTTP.
/**
 * GitHub's REST API in miniature for the tests: what HQ asked of it, and how it answers — a webhook
 * made (`201 { id }`), refused with a status the test sets, a comment posted.
 *
 * @module test/harness/githubFake
 */
import * as NodeHttp from "node:http";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

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
                response.writeHead(state.commentStatuses.shift() ?? 201);
                response.end("{}");
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
  /** The comments HQ posted, in order: the issue's path and the words. */
  const comments = Effect.sync(() =>
    state.seen
      .filter((request) => request.path.endsWith("/comments"))
      .map((request) => [request.path, (request.body as { body: string }).body] as const),
  );
  return { url, state, seenWhere, comments };
});
