// @effect-diagnostics nodeBuiltinImport:off - native Node smart HTTP and real git process boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import { GitError, type HqGit, type HqGitOptions, type Repo } from "./api.ts";
import { GitRunner, converge, scratch, sweep } from "./git.ts";
import { makeHandler } from "./http.ts";
import { eventPort, makeOperations } from "./operations.ts";

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
      if (name.startsWith(".build-") || name.startsWith(".removed-"))
        await NodeFSP.rm(child, { recursive: true, force: true });
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
    for (const ms of [options.requestTimeoutMs, options.refLockTimeoutMs]) {
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
    const build = async (repo: Repo, signal: AbortSignal, bundle?: string) => {
      const dest = directory(repo);
      // Reservation prevents competing creators, without exposing a partially built repository.
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
      attempt("restore", (signal) => build(repo, signal, bundle === null ? undefined : bundle));
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
    const remove: HqGit["remove"] = (repo) =>
      attempt("remove", async () => {
        const dir = directory(repo);
        const app = NodePath.dirname(dir);
        // Out of `list`'s sight in one rename, its deletion after it: a crash between is swept.
        const doomed = NodePath.join(app, `.removed-${repo.id}-${String(process.hrtime.bigint())}`);
        const moved = await NodeFSP.rename(dir, doomed).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        );
        if (moved) await NodeFSP.rm(doomed, { recursive: true, force: true });
        // The application's directory goes with its last repository; rmdir refuses one holding more.
        await NodeFSP.rmdir(app).catch(() => {});
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
    return {
      create,
      restore,
      list,
      remove,
      convergeRepo,
      handler,
      ...operations,
    };
  });
