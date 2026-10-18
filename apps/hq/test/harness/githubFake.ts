// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- GitHub's REST API, as HQ reaches it: over HTTP, its tokens dated by the server's own clock.
/**
 * GitHub's REST API in miniature for the tests: what HQ asked of it, and how it answers — a webhook
 * made (`201 { id }`), refused with a status the test sets; a comment posted (`201 { id }`) or
 * edited; a reaction, a label; a person's permission on the repository and their profile's email
 * (`nova`, a writer whose email is the test org owner's, unless the test says otherwise); the
 * repository's default branch; pull requests opened, read, edited, merged (with the status a test
 * sets) and closed; assignees; an issue's state; a commit's check runs. As the organization's
 * GitHub app sees it too: a manifest's code turned into the app (its private key generated for the
 * test), the app's installations — each asked for with a JWT the app's public key verifies — their
 * tokens, minted and counted, and the repositories each reaches.
 *
 * @module test/harness/githubFake
 */
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

/** A comment's words as a person reads them: HQ's mark (`githubChannel.ts`) taken off. */
const unmarked = (body: string) => body.replace(/\n\n<!-- zerops-mate -->$/u, "");

/** An installation of the app, as GitHub holds it. */
export interface FakeInstallation {
  readonly account: string;
  readonly accountType?: "Organization" | "User";
  readonly selection?: "all" | "selected";
  suspended?: boolean;
  repositories: Array<{
    readonly id: number;
    readonly full_name: string;
    readonly private?: boolean;
    readonly default_branch?: string;
  }>;
}

/** Whether `jwt` is RS256-signed under `publicKey` and good now. */
const jwtHolds = (jwt: string, publicKey: string) => {
  const [header, payload, signature] = jwt.split(".");
  if (header === undefined || payload === undefined || signature === undefined) return false;
  const valid = NodeCrypto.verify(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    publicKey,
    Buffer.from(signature, "base64url"),
  );
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    readonly exp: number;
  };
  return valid && claims.exp > Date.now() / 1000;
};

export interface GithubRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

export const githubFake = Effect.gen(function* () {
  const keys = NodeCrypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const state = {
    /** The app a manifest's `code` becomes, once. */
    app: {
      code: "code-1",
      id: 42,
      slug: "tea-shop-mate",
      owner: "acme",
      pem: keys.privateKey,
      publicKey: keys.publicKey,
      webhookSecret: NodeCrypto.randomBytes(16).toString("hex"),
      clientSecret: NodeCrypto.randomBytes(16).toString("hex"),
      converted: 0,
    },
    /** The app's installations by id. */
    installations: new Map<number, FakeInstallation>(),
    /** How long an installation token GitHub mints lives. */
    tokenLifeMs: 60 * 60_000,
    /** The installation tokens minted, in order, with the installation each is of. */
    minted: [] as Array<{ readonly token: string; readonly installation: number }>,
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
    /** The next pull request's number. */
    pullNumber: 2,
    /** Each pull request opened, by number. */
    pulls: new Map<
      number,
      {
        title: string;
        body: string;
        head: string;
        state: "open" | "closed";
        merged: boolean;
        /** Who opened it: the app's bot when its token asked; `nova` otherwise. */
        author?: string;
        /** The branch it merges into; `main`. */
        base?: string;
        /** Its head's repository; the repository's own (501) unless a fork's. */
        headRepoId?: number;
        /** Its head's commit, and once merged, the merge's. */
        headSha?: string;
        mergeSha?: string;
        /** Who closed it. */
        closedBy?: { readonly login: string; readonly type?: string };
      }
    >(),
    /** How a merge answers: its status and GitHub's message. */
    merge: { status: 200, message: "Pull Request successfully merged" } as {
      status: number;
      message: string;
      /** The commit the merge made; one of forty `f`s unless the test names HQ's own. */
      sha?: string;
    },
    /** Each issue's state; open unless closed. */
    issues: new Map<number, "open" | "closed">(),
    /** Each commit's check runs, by sha. */
    checkRuns: new Map<
      string,
      ReadonlyArray<{
        readonly name: string;
        readonly status: string;
        readonly conclusion: string | null;
        readonly details_url?: string;
      }>
    >(),
  };
  const pullJson = (number: number) => {
    const pull = state.pulls.get(number)!;
    return {
      number,
      html_url: `https://github.com/acme/tea-shop/pull/${String(number)}`,
      state: pull.state,
      merged: pull.merged,
      body: pull.body,
      title: pull.title,
      user: { login: pull.author ?? "nova" },
      head: { ref: pull.head, sha: pull.headSha, repo: { id: pull.headRepoId ?? 501 } },
      base: { ref: pull.base ?? "main", repo: { id: 501 } },
      merge_commit_sha: pull.mergeSha ?? null,
    };
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
              const reply = (status: number, body: unknown) => {
                response.writeHead(status);
                response.end(JSON.stringify(body));
              };
              const bearer = /^Bearer (.+)$/u.exec(request.headers["authorization"] ?? "")?.[1];
              const conversion = /^\/app-manifests\/([^/]+)\/conversions$/u.exec(path);
              if (request.method === "POST" && conversion !== null) {
                if (
                  decodeURIComponent(conversion[1]!) !== state.app.code ||
                  state.app.converted > 0
                )
                  return reply(404, { message: "Not Found" });
                state.app.converted += 1;
                return reply(201, {
                  id: state.app.id,
                  slug: state.app.slug,
                  name: "Tea Shop Mate",
                  html_url: `https://github.com/apps/${state.app.slug}`,
                  owner: { login: state.app.owner, type: "Organization" },
                  client_id: "Iv1.teashop",
                  client_secret: state.app.clientSecret,
                  webhook_secret: state.app.webhookSecret,
                  pem: state.app.pem,
                });
              }
              const appInstallation = /^\/app\/installations\/(\d+)(\/access_tokens)?$/u.exec(path);
              if (appInstallation !== null) {
                if (bearer === undefined || !jwtHolds(bearer, state.app.publicKey))
                  return reply(401, { message: "A JSON web token could not be decoded" });
                const id = Number(appInstallation[1]);
                const found = state.installations.get(id);
                if (found === undefined) return reply(404, { message: "Not Found" });
                if (appInstallation[2] === undefined && request.method === "GET")
                  return reply(200, {
                    id,
                    account: { login: found.account, type: found.accountType ?? "Organization" },
                    repository_selection: found.selection ?? "selected",
                    suspended_at: found.suspended === true ? "2026-10-01T00:00:00Z" : null,
                  });
                if (request.method === "POST") {
                  if (found.suspended === true)
                    return reply(403, { message: "This installation has been suspended" });
                  const token = ["ghs", "fake", String(state.minted.length + 1)].join("_");
                  state.minted.push({ token, installation: id });
                  return reply(201, {
                    token,
                    expires_at: new Date(Date.now() + state.tokenLifeMs).toISOString(),
                  });
                }
              }
              if (request.method === "GET" && path.startsWith("/installation/repositories")) {
                const id = state.minted.find((minted) => minted.token === bearer)?.installation;
                const found = id === undefined ? undefined : state.installations.get(id);
                if (found === undefined) return reply(401, { message: "Bad credentials" });
                const page = Number(new URL(path, "http://github").searchParams.get("page") ?? 1);
                return reply(200, {
                  total_count: found.repositories.length,
                  repositories: found.repositories
                    .slice((page - 1) * 100, page * 100)
                    .map((repo) => ({
                      private: true,
                      default_branch: "main",
                      ...repo,
                    })),
                });
              }
              const botUser = /^\/users\/([^/]+%5Bbot%5D)$/iu.exec(path);
              if (request.method === "GET" && botUser !== null) {
                const login = decodeURIComponent(botUser[1]!);
                return login === `${state.app.slug}[bot]`
                  ? reply(200, { login, id: 4242, type: "Bot" })
                  : reply(404, { message: "Not Found" });
              }
              const answer = (status: number, body: unknown) => {
                response.writeHead(status);
                response.end(JSON.stringify(body));
              };
              const bare = path.split("?")[0]!;
              const pullAt = /\/pulls\/(\d+)(\/merge)?$/u.exec(bare);
              const issueAt = /\/issues\/(\d+)$/u.exec(bare);
              if (request.method === "GET" && /^\/repos\/[^/]+\/[^/]+$/u.test(bare))
                return answer(200, { default_branch: "main" });
              if (request.method === "POST" && bare.endsWith("/pulls")) {
                const body = JSON.parse(text) as { title: string; body: string; head: string };
                // GitHub keeps one open pull request per branch.
                if (
                  [...state.pulls.values()].some(
                    (pull) => pull.head === body.head && pull.state === "open",
                  )
                )
                  return answer(422, { message: "A pull request already exists" });
                const number = state.pullNumber++;
                state.pulls.set(number, {
                  ...body,
                  state: "open",
                  merged: false,
                  author: state.minted.some(
                    (minted) => `Bearer ${minted.token}` === request.headers["authorization"],
                  )
                    ? `${state.app.slug}[bot]`
                    : "nova",
                });
                return answer(201, pullJson(number));
              }
              if (request.method === "GET" && bare.endsWith("/pulls"))
                return answer(
                  200,
                  [...state.pulls.keys()]
                    .filter((number) =>
                      path.includes(encodeURIComponent(`:${state.pulls.get(number)!.head}`)),
                    )
                    .map(pullJson),
                );
              if (pullAt !== null && state.pulls.has(Number(pullAt[1]))) {
                const number = Number(pullAt[1]);
                const pull = state.pulls.get(number)!;
                if (request.method === "GET") return answer(200, pullJson(number));
                if (request.method === "PATCH") {
                  const edit = JSON.parse(text) as {
                    title?: string;
                    body?: string;
                    state?: "closed" | "open";
                  };
                  // A merged pull request is neither closed nor opened again.
                  if (pull.merged && edit.state !== undefined)
                    return answer(422, { message: "Validation Failed" });
                  state.pulls.set(number, { ...pull, ...edit });
                  return answer(200, pullJson(number));
                }
                if (request.method === "PUT" && pullAt[2] !== undefined) {
                  if (state.merge.status === 200)
                    state.pulls.set(number, {
                      ...pull,
                      state: "closed",
                      merged: true,
                      mergeSha: state.merge.sha ?? "f".repeat(40),
                    });
                  return answer(
                    state.merge.status,
                    state.merge.status === 200
                      ? {
                          sha: state.merge.sha ?? "f".repeat(40),
                          merged: true,
                          message: state.merge.message,
                        }
                      : { message: state.merge.message },
                  );
                }
              }
              if (request.method === "POST" && bare.endsWith("/assignees")) return answer(201, {});
              if (issueAt !== null && request.method === "GET") {
                const pull = state.pulls.get(Number(issueAt[1]));
                return answer(
                  200,
                  pull === undefined
                    ? { state: state.issues.get(Number(issueAt[1])) ?? "open" }
                    : { state: pull.state, closed_by: pull.closedBy ?? null },
                );
              }
              if (issueAt !== null && request.method === "PATCH") {
                state.issues.set(Number(issueAt[1]), "closed");
                return answer(200, {});
              }
              const runsAt = /\/commits\/([^/]+)\/check-runs$/u.exec(bare);
              if (request.method === "GET" && runsAt !== null)
                return answer(200, {
                  check_runs: state.checkRuns.get(decodeURIComponent(runsAt[1]!)) ?? [],
                });
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
                      : {
                          id: 1000 + [...state.users.keys()].indexOf(decodeURIComponent(user[1]!)),
                          type: found.bot === true ? "Bot" : "User",
                          email: found.email,
                        },
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
