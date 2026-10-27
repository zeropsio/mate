// @effect-diagnostics nodeBuiltinImport:off -- the fake serves Git from bare repositories on disk through git http-backend.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { serve, type WireRequest, type WireResponse } from "../harness/http.ts";

/**
 * The slice of GitHub the Core's remote probe and Git adoption make, for a scenario that attaches a
 * Git environment: `GET /repos/{o}/{r}` and `GET …/rules/branches/{b}` (`HQ_GITHUB_API`), and Git
 * over smart HTTP under `/git/` (`HQ_GITHUB_GIT_URL`) served by `git http-backend`.
 *
 * Every answer shape is copied from mate-hq's conformance fake, which is measured against GitHub:
 * `conformance/harness/githubFake.ts` `repositoryAnswer` (metadata, rules), `gitAnswer` (401 for an
 * unknown credential, 404 for a repository it does not reach) and `gitBackend` (the CGI call).
 * Anything else it answers 404 and lists in `unmatched`, so a call this fake was never taught
 * is visible, not guessed.
 */
export interface GithubRepository {
  readonly id: number;
  /** The canonical address a user connects: Git itself reaches it through `gitUrl`. */
  readonly url: string;
  /** The one credential that reads and pushes it. */
  readonly token: string;
}

const notFound = { message: "Not Found", documentation_url: "https://docs.github.com/rest" };

const cgi = (
  root: string,
  pathInfo: string,
  request: WireRequest,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> =>
  new Promise((resolve) => {
    const child = NodeChildProcess.spawn("git", ["http-backend"], {
      env: {
        PATH: process.env["PATH"] ?? "",
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: pathInfo,
        QUERY_STRING: request.url.search.slice(1),
        REQUEST_METHOD: request.method,
        CONTENT_TYPE: request.headers["content-type"] ?? "",
        CONTENT_LENGTH: String(request.rawBody?.length ?? 0),
        HTTP_CONTENT_ENCODING: request.headers["content-encoding"] ?? "",
        GIT_PROTOCOL: String(request.headers["git-protocol"] ?? ""),
        // Receive-pack is served only to an authenticated user.
        REMOTE_USER: "x-access-token",
        REMOTE_ADDR: "127.0.0.1",
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    const out: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stdin.on("error", () => {});
    child.stdin.end(request.rawBody);
    child.on("close", () => {
      const output = Buffer.concat(out);
      const end = output.indexOf("\r\n\r\n");
      if (end === -1) return resolve({ status: 502, headers: {}, body: Buffer.alloc(0) });
      let status = 200;
      const headers: Record<string, string> = {};
      for (const line of output.subarray(0, end).toString().split("\r\n")) {
        const colon = line.indexOf(":");
        const name = line.slice(0, colon).trim().toLowerCase();
        const value = line.slice(colon + 1).trim();
        if (name === "status") status = Number.parseInt(value, 10);
        else headers[name] = value;
      }
      resolve({ status, headers, body: output.subarray(end + 4) });
    });
  });

export async function startGithubFake() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scenario-github-"));
  const repositories = new Map<string, GithubRepository & { readonly fullName: string }>();
  const unmatched: string[] = [];
  let serial = 7_000_000;

  const credentialOf = (request: WireRequest) => {
    const authorization = request.headers.authorization ?? "";
    const basic = authorization.match(/^Basic (.+)$/u)?.[1];
    return basic === undefined
      ? authorization.match(/^Bearer (.+)$/u)?.[1]
      : Buffer.from(basic, "base64").toString().split(":").slice(1).join(":");
  };
  const handle = async (request: WireRequest): Promise<WireResponse> => {
    const credential = credentialOf(request);
    const git = request.url.pathname.match(/^\/git\/([^/]+)\/([^/]+?)(?:\.git)?(\/.*)$/u);
    const rest = request.url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/u);
    const found = git ?? rest;
    if (request.method !== "GET" && !(git && request.method === "POST")) {
      unmatched.push(`${request.method} ${request.url.pathname}`);
      return { status: 404, body: notFound };
    }
    if (found === null) {
      unmatched.push(`${request.method} ${request.url.pathname}`);
      return { status: 404, body: notFound };
    }
    const repository = repositories.get(`${found[1]}/${found[2]}`.toLowerCase());
    if (credential === undefined || ![...repositories.values()].some((r) => r.token === credential))
      return git
        ? {
            status: 401,
            bytes: Buffer.from("Invalid username or token."),
            headers: { "www-authenticate": 'Basic realm="GitHub"', "content-type": "text/plain" },
          }
        : { status: 401, body: { message: "Bad credentials" } };
    if (repository === undefined || repository.token !== credential)
      return git
        ? {
            status: 404,
            bytes: Buffer.from("Repository not found."),
            headers: { "content-type": "text/plain" },
          }
        : { status: 404, body: notFound };
    if (git) {
      const answer = await cgi(root, `/${repository.fullName}.git${git[3]}`, request);
      return { status: answer.status, bytes: answer.body, headers: answer.headers };
    }
    if (rest![3] === undefined)
      return {
        body: { id: repository.id, full_name: repository.fullName, archived: false, private: true },
      };
    if (/^\/rules\/branches\/.+$/u.test(rest![3])) return { body: [] };
    // The token's CI reads on a branch no one pushed yet: githubFake.ts documents these answers as
    // the ones GitHub gives and the Core's probes expect (an absent ref after the permission).
    const commit = rest![3].match(/^\/commits\/([^/]+)\/(check-runs|status)$/u);
    if (commit?.[2] === "check-runs")
      return {
        status: 422,
        body: { message: `No commit found for SHA: ${decodeURIComponent(commit[1]!)}` },
      };
    if (commit?.[2] === "status") return { status: 404, body: { message: "Ref not found" } };
    if (rest![3] === "/actions/runs") return { body: { total_count: 0, workflow_runs: [] } };
    unmatched.push(`${request.method} ${request.url.pathname}`);
    return { status: 404, body: notFound };
  };
  const server = await serve(handle);

  return {
    api: server.origin,
    gitUrl: `${server.origin}/git/`,
    /** Calls this fake was never taught. */
    unmatched: () => [...unmatched],
    /** An empty repository `fullName` (`owner/name`) and the token that reaches it. */
    addRepository: (fullName: string): GithubRepository => {
      if (repositories.has(fullName.toLowerCase()))
        throw new Error(`The fake already holds ${fullName}`);
      serial += 1;
      const init = NodeChildProcess.spawnSync("git", [
        "init",
        "--bare",
        "-q",
        "-b",
        "main",
        NodePath.join(root, `${fullName.toLowerCase()}.git`),
      ]);
      if (init.status !== 0) throw new Error(`git init failed: ${init.stderr.toString()}`);
      const repository = {
        id: serial,
        url: `https://github.com/${fullName}.git`,
        token: `github_pat_${serial}`,
      };
      repositories.set(fullName.toLowerCase(), { ...repository, fullName });
      return repository;
    },
    close: async () => {
      await server.close();
      NodeFS.rmSync(root, { recursive: true, force: true });
    },
  };
}
