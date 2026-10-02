// @effect-diagnostics nodeBuiltinImport:off - native Node smart HTTP and real git process boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import {
  GitError,
  type HqGit,
  type HqGitOptions,
  type ImportCredentials,
  type Repo,
} from "./api.ts";
import { GitRunner, converge, scratch, sweep } from "./git.ts";
import { makeHandler } from "./http.ts";
import { eventPort, makeOperations } from "./operations.ts";
import { defaultImportHost, resolveSource } from "./source.ts";

const validId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
const isGitError = Schema.is(GitError);
// Node errors name absolute paths: anything unexpected becomes a generic git_failed.
const failure = (operation: string, error: unknown) =>
  isGitError(error)
    ? error
    : new GitError({ operation, reason: "git_failed", message: "Git layer failed" });
const attempt = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (error) => failure(operation, error) });

/** One instance per root: whatever an earlier instance left behind is debris, never a live build. */
const recover = async (root: string) => {
  for (const entry of await NodeFSP.readdir(root, { withFileTypes: true })) {
    const path = NodePath.join(root, entry.name);
    if (entry.name.startsWith(".home-")) await NodeFSP.rm(path, { recursive: true, force: true });
    if (!entry.isDirectory() || !validId(entry.name)) continue;
    for (const name of await NodeFSP.readdir(path)) {
      const child = NodePath.join(path, name);
      if (name.startsWith(".build-")) await NodeFSP.rm(child, { recursive: true, force: true });
      else if (name.endsWith(".git")) {
        for (const debris of (await NodeFSP.readdir(child).catch(() => [])).filter(scratch))
          await NodeFSP.rm(NodePath.join(child, debris), { recursive: true, force: true });
        // A reservation is an empty directory; rmdir refuses anything holding a repository.
        await NodeFSP.rmdir(child).catch(() => {});
      }
    }
  }
};

/** A scoped instance owns its empty git HOME and all subprocesses; Core owns the HTTP server. */
export const makeHqGit = (options: HqGitOptions): Effect.Effect<HqGit, GitError, Scope.Scope> =>
  Effect.gen(function* () {
    const root = NodePath.resolve(options.rootDir);
    for (const ms of [
      options.importTimeoutMs,
      options.requestTimeoutMs,
      options.refLockTimeoutMs,
    ]) {
      if (ms !== undefined && !(Number.isSafeInteger(ms) && ms > 0))
        return yield* new GitError({
          operation: "open",
          reason: "invalid_config",
          message: "Timeouts must be positive integers of milliseconds",
        });
    }
    const resource = yield* Effect.acquireRelease(
      attempt("open", async () => {
        await NodeFSP.mkdir(root, { recursive: true });
        await recover(root);
        const home = await NodeFSP.mkdtemp(NodePath.join(root, ".home-"));
        return { home, runner: new GitRunner(home) };
      }),
      ({ home, runner }) =>
        Effect.promise(async () => {
          await runner.close();
          await NodeFSP.rm(home, { recursive: true, force: true });
        }),
    );
    const { runner } = resource;
    const directory = (repo: Repo) => {
      if (!validId(repo.appId) || !validId(repo.id))
        throw new GitError({
          operation: "locate",
          reason: "invalid_id",
          message: "Invalid repository identity",
        });
      return NodePath.join(root, repo.appId, `${repo.id}.git`);
    };
    const locate = async (repo: Repo): Promise<string | null> => {
      const dir = directory(repo);
      const head = await NodeFSP.stat(NodePath.join(dir, "HEAD")).catch(() => null);
      return head?.isFile() ? dir : null;
    };
    const build = async (
      repo: Repo,
      signal: AbortSignal,
      source?: string,
      credentials?: ImportCredentials,
      bundle?: string,
    ) => {
      const dest = directory(repo);
      const from =
        source === undefined
          ? undefined
          : await resolveSource(source, {
              root,
              importRoots: options.importRoots ?? [],
              allowHost: options.allowImportHost ?? defaultImportHost,
            });
      if (credentials && from?.protocol !== "https")
        throw new GitError({
          operation: "import",
          reason: "source_refused",
          message: "Credentials require an https source",
        });
      // Reservation prevents competing creators, without exposing a partially imported repository.
      await NodeFSP.mkdir(NodePath.join(root, repo.appId), { recursive: true });
      await NodeFSP.mkdir(dest).catch((error: NodeJS.ErrnoException) => {
        throw error.code === "EEXIST"
          ? new GitError({ operation: "create", reason: "exists", message: "Repository exists" })
          : error;
      });
      let staging: string | undefined;
      try {
        staging = await NodeFSP.mkdtemp(NodePath.join(root, repo.appId, ".build-"));
        const repoPath = NodePath.join(staging, "repo.git");
        await runner.run(["init", "--bare", "--template=", "--initial-branch=main", repoPath], {
          signal,
        });
        await converge(runner, repoPath, signal);
        if (bundle !== undefined) {
          await runner.run(
            [
              "-c",
              "protocol.file.allow=always",
              "-C",
              repoPath,
              "fetch",
              "--no-write-fetch-head",
              "--",
              bundle,
              "+refs/*:refs/*",
            ],
            { signal },
          );
          await converge(runner, repoPath, signal);
        }
        if (from) {
          // Environment config avoids both credential URLs and askpass prompt argv.
          const env: Record<string, string> = credentials
            ? {
                GIT_CONFIG_COUNT: "1",
                GIT_CONFIG_KEY_0: "http.extraHeader",
                GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`,
              }
            : {};
          const deadline = AbortSignal.timeout(options.importTimeoutMs ?? 10 * 60 * 1000);
          // Fetch instead of clone: source config, hooks, alternates, and remotes are never copied.
          // Change branches are born here, so an imported mate/* could impersonate one.
          await runner
            .run(
              [
                "-c",
                `protocol.${from.protocol}.allow=always`,
                "-c",
                "credential.helper=",
                "-c",
                "http.followRedirects=false",
                "-C",
                repoPath,
                "fetch",
                "--no-write-fetch-head",
                "--no-recurse-submodules",
                "--",
                from.source,
                "+refs/heads/*:refs/heads/*",
                "+refs/tags/*:refs/tags/*",
                "^refs/heads/mate/*",
              ],
              { env, signal: AbortSignal.any([signal, deadline]) },
            )
            .catch((error: unknown) => {
              throw deadline.aborted
                ? new GitError({
                    operation: "import",
                    reason: "timeout",
                    message: "Import timed out",
                  })
                : error;
            });
          const main = await runner.run(
            ["-C", repoPath, "for-each-ref", "--format=%(objectname)", "refs/heads/main"],
            { signal },
          );
          if (main.length === 0)
            throw new GitError({
              operation: "import",
              reason: "no_main",
              message: "Import source has no main branch",
            });
          await converge(runner, repoPath, signal);
        }
        await NodeFSP.rename(repoPath, dest);
        return { appId: repo.appId, id: repo.id };
      } catch (error) {
        await NodeFSP.rm(dest, { recursive: true, force: true });
        throw error;
      } finally {
        if (staging) await NodeFSP.rm(staging, { recursive: true, force: true });
      }
    };
    const create: HqGit["create"] = (repo) => attempt("create", (signal) => build(repo, signal));
    const restore: HqGit["restore"] = (repo, bundle) =>
      attempt("restore", (signal) =>
        build(repo, signal, undefined, undefined, bundle === null ? undefined : bundle),
      );
    const importRepo: HqGit["import"] = (repo, source, credentials) =>
      attempt("import", (signal) => build(repo, signal, source, credentials));
    const list: HqGit["list"] = (appId) =>
      attempt("list", async () => {
        if (appId !== undefined && !validId(appId))
          throw new GitError({
            operation: "list",
            reason: "invalid_id",
            message: "Invalid app identity",
          });
        const apps = (await NodeFSP.readdir(root, { withFileTypes: true })).filter(
          (entry) =>
            entry.isDirectory() &&
            validId(entry.name) &&
            (appId === undefined || appId === entry.name),
        );
        const repos: Repo[] = [];
        for (const app of apps) {
          for (const entry of await NodeFSP.readdir(NodePath.join(root, app.name), {
            withFileTypes: true,
          })) {
            const id = entry.name.slice(0, -4);
            if (!entry.isDirectory() || !entry.name.endsWith(".git") || !validId(id)) continue;
            const repo = { appId: app.name, id };
            if (await locate(repo)) repos.push(repo);
          }
        }
        return repos.sort((a, b) => `${a.appId}/${a.id}`.localeCompare(`${b.appId}/${b.id}`));
      });
    const convergeRepo: HqGit["convergeRepo"] = (repo) =>
      attempt("converge", async (signal) => {
        const dir = await locate(repo);
        if (!dir)
          throw new GitError({
            operation: "converge",
            reason: "not_found",
            message: "Repository not found",
          });
        await converge(runner, dir, signal);
        await sweep(dir);
      });
    const emit = eventPort(options);
    const operations = makeOperations(runner, locate, options, attempt, emit);
    const handler = yield* Effect.try({
      try: () => makeHandler(options, runner, locate, emit),
      catch: (error) => failure("handler", error),
    });
    return { create, restore, import: importRepo, list, convergeRepo, handler, ...operations };
  });
