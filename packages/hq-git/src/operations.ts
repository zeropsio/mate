// @effect-diagnostics nodeBuiltinImport:off - native streams and isolated git index files.
// @effect-diagnostics globalDate:off -- a tag records the wall-clock time it was made.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";
import {
  GitError,
  type Author,
  type CommitSummary,
  type FileStat,
  type HqGit,
  type HqGitOptions,
  type Repo,
  type GitEvent,
  type Mergeability,
  type ChangeBranch,
  type ChangeSnapshot,
} from "./api.ts";
import {
  GITHUB_REFS,
  followRefs as followRemoteRefs,
  unfollowRefs as unfollowRemoteRefs,
} from "./followRefs.ts";
import { GitRunner, fetchDeadlineMs, sweepPartialPacks, terminate } from "./git.ts";
import { validRef } from "./rules.ts";
import { streamArchive } from "./browse/archive.ts";

// Hard ceilings bound memory even when refs, messages, paths, or blobs are hostile.
const readLimits = {
  entries: 1000,
  bytes: 1024 * 1024,
  messageBytes: 64 * 1024,
  diffBytes: 8 * 1024 * 1024,
  log: 100,
  history: 10000,
} as const;
const isGitError = Schema.is(GitError);
const error = (message: string) =>
  new GitError({ operation: "operations", reason: "invalid_config", message });
const pathError = (message: string) =>
  new GitError({ operation: "operations", reason: "invalid_path", message });
/** A timed-out remote operation as the error every caller already reads. */
const timedOut = (operation: string) => (cause: unknown) =>
  isGitError(cause)
    ? cause
    : new GitError({
        operation,
        reason: "git_failed",
        message: "The remote did not answer in time",
      });
const validSha = (sha: string) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha);
const checkedSnapshot = (snapshot: ChangeSnapshot | undefined) => {
  if (
    snapshot !== undefined &&
    [snapshot.head, snapshot.main].some((sha) => sha !== null && !validSha(sha))
  ) {
    throw error("Invalid review commit");
  }
  return snapshot;
};
const bound = (n: number, ceiling: number) => {
  if (!Number.isSafeInteger(n) || n < 1) throw error("Read bounds must be positive integers");
  return Math.min(n, ceiling);
};
const pathName = (path: string, allowRoot = false) => {
  if (allowRoot && path === "") return;
  if (
    !path ||
    path.includes("\0") ||
    path.split("/").some((p) => !p || p === "." || p === ".." || p.toLowerCase() === ".git")
  )
    throw pathError("Invalid git path");
};
const identity = (author: Author): Record<string, string> => {
  if (!author.name || !author.email || /[\0\r\n<>]/.test(author.name + author.email))
    throw error("Invalid author");
  return {
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: author.name,
    GIT_COMMITTER_EMAIL: author.email,
  };
};
const summary = (record: string): CommitSummary => {
  const [sha = "", name = "", email = "", parents = "", committedAt = "", ...rest] =
    record.split("\0");
  return {
    sha,
    author: { name, email },
    parents: parents.split(" ").filter(Boolean),
    committedAt,
    message: rest.join("\0"),
  };
};
// The message comes last: it is the only field that may hold anything.
const format = "%H%x00%an%x00%ae%x00%P%x00%cI%x00%B";
const stats = (bytes: Buffer): FileStat[] =>
  bytes
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [added = "", deleted = "", ...path] = line.split("\t");
      return {
        path: path.join("\t"),
        added: added === "-" ? null : Number(added),
        deleted: deleted === "-" ? null : Number(deleted),
      };
    });

/**
 * Ordered event receipts. Local writers enqueue without waiting, so a handler may call back
 * into the layer. Smart HTTP waits for its receipt before acknowledging a successful push.
 * Failed receipts reject their caller, are logged without caller data, and leave later events free.
 */
export const eventPort = (options: HqGitOptions) => {
  let tail = Promise.resolve();
  return (event: GitEvent): Promise<void> => {
    const delivered = tail.then(async () => {
      await options.onEvent?.(event);
    });
    tail = delivered.catch(() =>
      Effect.runPromise(
        Effect.logWarning("hq-git event delivery failed; Core must reconcile from refs"),
      ),
    );
    return delivered;
  };
};

type Attempt = <A>(
  operation: string,
  run: (signal: AbortSignal) => Promise<A>,
) => Effect.Effect<A, GitError>;
/** A read or write inside one held repository: `not_found` for one the layer does not hold. */
export const repoReader =
  (locate: (repo: Repo) => Promise<string | null>, attempt: Attempt) =>
  <A>(operation: string, repo: Repo, run: (dir: string, signal: AbortSignal) => Promise<A>) =>
    attempt(operation, async (signal) => {
      const dir = await locate(repo);
      if (!dir)
        throw new GitError({ operation, reason: "not_found", message: "Repository not found" });
      return run(dir, signal);
    });
export type InRepo = ReturnType<typeof repoReader>;
export const makeOperations = (
  git: GitRunner,
  locate: (repo: Repo) => Promise<string | null>,
  options: HqGitOptions,
  attempt: Attempt,
  emit: (event: GitEvent) => void,
) => {
  const refLockTimeoutMs = options.refLockTimeoutMs ?? 5000;
  const inRepo = repoReader(locate, attempt);
  const run = (
    dir: string,
    args: string[],
    signal: AbortSignal,
    input?: string | Uint8Array,
    env?: Record<string, string>,
    acceptExitCodes?: number[],
  ) =>
    git.run(["-C", dir, ...args], {
      signal,
      ...(input === undefined ? {} : { input }),
      ...(env ? { env } : {}),
      ...(acceptExitCodes ? { acceptExitCodes } : {}),
    });
  const text = async (dir: string, args: string[], signal: AbortSignal) =>
    (await run(dir, args, signal)).toString().trim();
  const refHead = async (dir: string, ref: string, signal: AbortSignal) => {
    await run(dir, ["check-ref-format", ref], signal).catch(() => {
      throw error("Invalid ref");
    });
    const lines = (
      await text(dir, ["for-each-ref", "--format=%(refname) %(objectname)", ref], signal)
    ).split("\n");
    return lines.find((line) => line.startsWith(`${ref} `))?.slice(ref.length + 1) ?? null;
  };
  const bornMain = async (operation: string, dir: string, signal: AbortSignal) => {
    const main = await refHead(dir, "refs/heads/main", signal);
    if (!main) throw new GitError({ operation, reason: "no_main", message: "Main is unborn" });
    return main;
  };
  const changeRef = ({ mateId, number, branch }: ChangeBranch) => {
    const ref = `refs/heads/${branch}`;
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(mateId) ||
      !Number.isSafeInteger(number) ||
      number < 1 ||
      !validRef(ref) ||
      branch === "main"
    )
      throw error("Invalid change identity");
    return ref;
  };
  const resolve = async (dir: string, rev: string, signal: AbortSignal) => {
    // --end-of-options already stops option parsing; a leading dash is never a revision Core means.
    if (!rev || rev.startsWith("-") || rev.includes("\0") || rev.length > 1024)
      throw error("Invalid revision");
    return text(dir, ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`], signal);
  };
  const prefix = (dir: string, args: string[], signal: AbortSignal, max: number) =>
    git.prefix(["-C", dir, ...args], signal, max);
  const records = async (dir: string, args: string[], signal: AbortSignal, delimiter = "\0") => {
    const result = await prefix(dir, args, signal, readLimits.bytes);
    const parts = result.bytes.toString().split(delimiter);
    if (result.truncated) parts.pop(); // Never expose a cut record as complete.
    const entries = parts.filter(Boolean);
    return {
      items: entries.slice(0, readLimits.entries),
      truncated: result.truncated || entries.length > readLimits.entries,
    };
  };
  const inspect = async (
    dir: string,
    repo: Repo,
    { mateId, number, branch }: ChangeBranch,
    main: string,
    head: string,
    signal: AbortSignal,
  ): Promise<Mergeability & { tree?: string }> => {
    const metadata = await options.lookupChange(repo, branch);
    if (
      metadata?.appId === repo.appId &&
      metadata.mateId === mateId &&
      metadata.number === number &&
      metadata.merged
    )
      return { kind: "already_merged" };
    const base = (await run(dir, ["merge-base", main, head], signal, undefined, undefined, [1]))
      .toString()
      .trim();
    if (!base) {
      // Onto a main that holds nothing, another repository's history is joined, never refused.
      if (!(await keepsHistory(dir, main, head, signal))) return { kind: "unrelated" };
      const tree = await text(dir, ["rev-parse", `${head}^{tree}`], signal);
      if (tree === (await text(dir, ["rev-parse", `${main}^{tree}`], signal)))
        return { kind: "empty" };
      return { kind: "clean", keepsHistory: true, tree };
    }
    if (base === head) return { kind: "already_merged" };
    // Change refs only fast-forward, so an earlier squash of this change lies on main past the base.
    const history = await prefix(
      dir,
      [
        "log",
        "--first-parent",
        `-n${readLimits.history + 1}`,
        "--format=%H%x00%(trailers:key=Mate-Change,valueonly)%x00",
        main,
        `^${base}`,
        "--",
      ],
      signal,
      readLimits.bytes,
    );
    const entries = history.bytes.toString().split("\0\n").filter(Boolean);
    if (
      entries.some((record) =>
        record
          .split("\0")[1]
          ?.split("\n")
          .some((value) => value.trim() === `${mateId}/${number}`),
      )
    )
      return { kind: "already_merged" };
    if (history.truncated || entries.length > readLimits.history)
      throw error("Merge history exceeds safety bound; Core must reconcile");
    const merged = await git.exec(
      ["-C", dir, "merge-tree", "--write-tree", "--name-only", "-z", main, head],
      { signal, acceptExitCodes: [1] },
    );
    const fields = merged.stdout.toString().split("\0");
    const tree = fields.shift()!;
    const paths: string[] = [];
    for (const field of fields) {
      if (!field) break;
      paths.push(field);
    }
    // Exit 1 is git's verdict of a conflict, whether or not it names a conflicted path.
    if (merged.code === 1) return { kind: "conflict", paths };
    if (tree === (await text(dir, ["rev-parse", `${main}^{tree}`], signal)))
      return { kind: "empty" };
    return (await keepsHistory(dir, main, head, signal))
      ? { kind: "clean", keepsHistory: true, tree }
      : { kind: "clean", tree };
  };
  /**
   * Whether `head` lands on `main` as it is: `main` never held a file (HQ's empty first commit,
   * nothing merged onto it yet) and `head` carries another repository's history — a root commit
   * `main` does not hold. A main whose own tree holds a file answers at once.
   */
  const keepsHistory = async (dir: string, main: string, head: string, signal: AbortSignal) =>
    (await text(dir, ["ls-tree", "--name-only", main], signal)) === "" &&
    (await emptyHistory(dir, main, signal)) &&
    (await text(dir, ["rev-list", "--max-parents=0", head, `^${main}`, "--"], signal)) !== "";
  // macOS and Windows checkouts fold case and Unicode form, so such names clash in one directory.
  const collides = async (dir: string, tree: string, paths: string[], signal: AbortSignal) => {
    const fold = (name: string) => name.normalize("NFC").toLowerCase();
    const written = new Map<string, Set<string>>();
    for (const path of paths) {
      const parts = path.split("/");
      parts.forEach((name, i) => {
        const parent = parts.slice(0, i).join("/");
        written.set(parent, (written.get(parent) ?? new Set()).add(name));
      });
    }
    const subdirs = [...written.keys()].filter(Boolean).map((parent) => `${parent}/`);
    for (const pathspecs of subdirs.length ? [[], subdirs] : [[]]) {
      const listed = await run(
        dir,
        ["ls-tree", "-z", "--name-only", tree, "--", ...pathspecs],
        signal,
      );
      for (const entry of listed.toString().split("\0").filter(Boolean)) {
        const mark = entry.lastIndexOf("/");
        const name = entry.slice(mark + 1);
        for (const other of written.get(entry.slice(0, Math.max(mark, 0))) ?? [])
          if (other !== name && fold(other) === fold(name)) return true;
      }
    }
    return false;
  };
  // The re-merge guard reads exactly what git parses, so every new commit is checked the same way.
  const changeTrailer = (dir: string, sha: string, signal: AbortSignal) =>
    text(dir, ["log", "-1", "--format=%(trailers:key=Mate-Change,valueonly)", sha, "--"], signal);
  const cas = async (
    dir: string,
    ref: string,
    sha: string,
    old: string | null,
    signal: AbortSignal,
  ) => {
    try {
      await run(
        dir,
        [
          "-c",
          `core.filesRefLockTimeout=${String(refLockTimeoutMs)}`,
          "update-ref",
          ref,
          sha,
          old ?? "0".repeat(sha.length),
        ],
        signal,
      );
      return true;
    } catch {
      if ((await refHead(dir, ref, signal)) !== old) return false;
      // Nothing moved: another writer held the ref lock past the wait.
      throw new GitError({ operation: "update-ref", reason: "busy", message: "Ref is locked" });
    }
  };
  const adoptionSource = async (
    dir: string,
    source: Parameters<HqGit["previewAdoption"]>[1],
    signal: AbortSignal,
  ) => {
    // Public admission is HTTPS-only; the internal layer also serves local fixture repositories.
    if (!source.url || source.url.startsWith("-") || source.url.includes("\0"))
      throw error("Invalid remote");
    if (!NodePath.isAbsolute(source.url)) {
      const url = new URL(source.url);
      if (
        (url.protocol !== "https:" &&
          !(url.protocol === "http:" && url.hostname === "127.0.0.1")) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw error("Invalid remote");
    }
    const ref = `refs/heads/${source.branch}`;
    await run(dir, ["check-ref-format", ref], signal);
    const result = (
      await git.remote(
        ["-C", dir, "ls-remote", "--refs", source.url, ref],
        source.url,
        source.token,
        signal,
      )
    )
      .toString()
      .trim();
    if (!result) return null;
    const lines = result.split("\n");
    const [sha, found] = lines[0]!.split("\t");
    if (lines.length !== 1 || found !== ref || !sha || !validSha(sha))
      throw error("Invalid remote tip");
    return sha;
  };
  const adoptionTree = async (
    dir: string,
    main: string,
    remoteTip: string | null,
    signal: AbortSignal,
  ) => {
    const tree = await text(dir, ["rev-parse", `${main}^{tree}`], signal);
    const parents = await text(dir, ["show", "-s", "--format=%P", main], signal);
    const emptyTree = (await run(dir, ["hash-object", "-t", "tree", "--stdin"], signal, ""))
      .toString()
      .trim();
    const seed = parents === "" && tree === emptyTree;
    const remoteTree =
      remoteTip === null
        ? emptyTree
        : await text(dir, ["rev-parse", `${remoteTip}^{tree}`], signal);
    if (seed) return { seed, changedFiles: 0, tree: remoteTree };
    // Count NUL-delimited paths as a stream: exact even beyond bounded UI tree listings.
    const process = git.start(
      [
        "-C",
        dir,
        "diff-tree",
        "--no-commit-id",
        "--no-renames",
        "--name-only",
        "-r",
        "-z",
        remoteTree,
        tree,
      ],
      { signal },
    );
    process.child.stdin.end();
    let changedFiles = 0;
    try {
      for await (const chunk of process.child.stdout) {
        for (const byte of chunk as Uint8Array) if (byte === 0) changedFiles++;
      }
      await process.done;
    } finally {
      terminate(process.child);
      await process.done.catch(() => {});
    }
    return { seed, changedFiles, tree };
  };
  const fetchAdoption = async (
    dir: string,
    source: Parameters<HqGit["previewAdoption"]>[1],
    sha: string,
    signal: AbortSignal,
  ) => {
    await git.remote(
      [
        "-C",
        dir,
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "--no-recurse-submodules",
        source.url,
        sha,
      ],
      source.url,
      source.token,
      signal,
    );
    await resolve(dir, sha, signal);
  };
  const previewAdoption: HqGit["previewAdoption"] = (repo, source) =>
    inRepo("previewAdoption", repo, async (dir, signal) => {
      const main = await bornMain("previewAdoption", dir, signal);
      const remoteTip = await adoptionSource(dir, source, signal);
      if (remoteTip !== null) await fetchAdoption(dir, source, remoteTip, signal);
      const { seed, changedFiles } = await adoptionTree(dir, main, remoteTip, signal);
      return { main, remoteTip, seed, changedFiles };
    }).pipe(
      Effect.timeout(Duration.seconds(30)),
      Effect.mapError((cause) =>
        isGitError(cause)
          ? cause
          : new GitError({
              operation: "previewAdoption",
              reason: "git_failed",
              message: "Remote review timed out",
            }),
      ),
    );
  const acceptAdoption: HqGit["acceptAdoption"] = (repo, source, preview, author, recorded) =>
    inRepo("acceptAdoption", repo, async (dir, signal) => {
      const env = identity(author);
      const main = await bornMain("acceptAdoption", dir, signal);
      const remoteTip = await adoptionSource(dir, source, signal);
      if (main !== preview.main || remoteTip !== preview.remoteTip)
        return { kind: "stale" } as const;
      if (remoteTip === null) return { kind: "unchanged" } as const;
      await fetchAdoption(dir, source, remoteTip, signal);
      const projected = await adoptionTree(dir, main, remoteTip, signal);
      if (projected.seed !== preview.seed || projected.changedFiles !== preview.changedFiles)
        return { kind: "stale" } as const;
      const ancestor = await git.exec(["-C", dir, "merge-base", "--is-ancestor", remoteTip, main], {
        signal,
        acceptExitCodes: [1],
      });
      if (ancestor.code === 0) return { kind: "unchanged" } as const;
      // An untouched seed nothing else holds gives way: the remote's history gains no HQ commit.
      // Only Mate's own branches and tags hold it; a GitHub branch under `refs/github/` does not.
      const untouched =
        projected.seed &&
        !recorded &&
        (
          await text(
            dir,
            [
              "for-each-ref",
              "--contains",
              main,
              "--format=%(refname)",
              "refs/heads/",
              "refs/tags/",
            ],
            signal,
          )
        )
          .split("\n")
          .every((ref) => ref === "" || ref === "refs/heads/main");
      const sha = untouched
        ? remoteTip
        : (
            await run(
              dir,
              ["commit-tree", projected.tree, "-p", main, "-p", remoteTip],
              signal,
              "Adopt remote history\n",
              env,
            )
          )
            .toString()
            .trim();
      if (!(await cas(dir, "refs/heads/main", sha, main, signal)))
        return { kind: "stale" } as const;
      emit({ kind: "main_moved", repo, old: main, new: sha, by: "commit" });
      return { kind: "adopted", sha } as const;
    }).pipe(
      Effect.timeout(Duration.seconds(30)),
      Effect.mapError((cause) =>
        isGitError(cause)
          ? cause
          : new GitError({
              operation: "acceptAdoption",
              reason: "git_failed",
              message: "Remote adoption timed out",
            }),
      ),
    );
  /** A mirror's remote as git may be handed it: HTTPS, or a local fixture's absolute path. */
  const mirrorUrl = (url: string) => {
    if (!url || url.startsWith("-") || url.includes("\0")) throw error("Invalid remote");
    if (NodePath.isAbsolute(url)) return url;
    const parsed = new URL(url);
    if (
      (parsed.protocol !== "https:" &&
        !(parsed.protocol === "http:" && parsed.hostname === "127.0.0.1")) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw error("Invalid remote");
    return url;
  };
  const branchRef = async (dir: string, branch: string, signal: AbortSignal) => {
    const ref = `refs/heads/${branch}`;
    await run(dir, ["check-ref-format", ref], signal).catch(() => {
      throw error("Invalid branch");
    });
    return ref;
  };
  /** The remote's tip of `ref`, read with ls-remote; none while it does not exist. */
  const remoteTip = async (
    dir: string,
    remote: Parameters<HqGit["fetchTip"]>[1],
    ref: string,
    signal: AbortSignal,
  ) => {
    const url = mirrorUrl(remote.url);
    const lines = (
      await git.remoteAskpass(
        ["-C", dir, "ls-remote", "--refs", url, ref],
        url,
        remote.token,
        signal,
      )
    ).stdout
      .toString()
      .trim()
      .split("\n")
      .filter((line) => line !== "");
    const found = lines.find((line) => line.split("\t")[1] === ref)?.split("\t")[0];
    if (found !== undefined && !validSha(found)) throw error("Invalid remote tip");
    return found ?? null;
  };
  const ancestorIn = async (
    dir: string,
    ancestor: string,
    descendant: string,
    signal: AbortSignal,
  ) =>
    (
      await git.exec(["-C", dir, "merge-base", "--is-ancestor", ancestor, descendant], {
        signal,
        acceptExitCodes: [1, 128],
      })
    ).code === 0;
  /** Every commit of `sha`'s history has the empty tree; false past the history ceiling. */
  const emptyHistory = async (dir: string, sha: string, signal: AbortSignal) => {
    const empty = await text(dir, ["hash-object", "-t", "tree", "--stdin"], signal);
    const trees = (
      await text(
        dir,
        ["log", `--max-count=${String(readLimits.history + 1)}`, "--format=%T", sha, "--"],
        signal,
      )
    ).split("\n");
    return trees.length <= readLimits.history && trees.every((tree) => tree === empty);
  };
  const remoteHead: HqGit["remoteHead"] = (repo, remote) =>
    inRepo("remoteHead", repo, async (dir, signal) => {
      const url = mirrorUrl(remote.url);
      const lines = (
        await git.remoteAskpass(
          ["-C", dir, "ls-remote", "--symref", url, "HEAD"],
          url,
          remote.token,
          signal,
        )
      ).stdout
        .toString()
        .split("\n");
      const symref = lines.find((line) => /^ref: refs\/heads\/[^\t]+\tHEAD$/u.test(line));
      const branch = symref?.slice("ref: refs/heads/".length, -"\tHEAD".length) ?? "main";
      await branchRef(dir, branch, signal);
      const sha = lines
        .find((line) => line.endsWith("\tHEAD") && !line.startsWith("ref: "))
        ?.split("\t")[0];
      if (sha !== undefined && !validSha(sha)) throw error("Invalid remote tip");
      return { branch, sha: sha ?? null };
    }).pipe(Effect.timeout(Duration.seconds(30)), Effect.mapError(timedOut("remoteHead")));
  const fetchTip: HqGit["fetchTip"] = (repo, remote, branch) =>
    inRepo("fetchTip", repo, async (dir, signal) => {
      const url = mirrorUrl(remote.url);
      const tip = await remoteTip(dir, remote, await branchRef(dir, branch, signal), signal);
      if (tip === null) return null;
      await sweepPartialPacks(dir);
      await git.remoteAskpass(
        [
          "-C",
          dir,
          "fetch",
          "--no-tags",
          "--no-write-fetch-head",
          "--no-recurse-submodules",
          url,
          tip,
        ],
        url,
        remote.token,
        signal,
      );
      await resolve(dir, tip, signal);
      return tip;
    }).pipe(
      Effect.timeout(Duration.millis(fetchDeadlineMs)),
      Effect.mapError(timedOut("fetchTip")),
    );
  const followRefs: HqGit["followRefs"] = (repo, remote) =>
    inRepo("followRefs", repo, async (dir, signal) => {
      await sweepPartialPacks(dir);
      return followRemoteRefs(git, dir, mirrorUrl(remote.url), remote.token, signal);
    }).pipe(
      Effect.timeout(Duration.millis(fetchDeadlineMs)),
      Effect.mapError(timedOut("followRefs")),
    );
  const unfollowRefs: HqGit["unfollowRefs"] = (repo) =>
    inRepo("unfollowRefs", repo, (dir, signal) => unfollowRemoteRefs(git, dir, signal));
  const isAncestor: HqGit["isAncestor"] = (repo, ancestor, descendant) =>
    inRepo("isAncestor", repo, async (dir, signal) => {
      if (!validSha(ancestor) || !validSha(descendant)) throw error("Invalid commit");
      return ancestorIn(dir, ancestor, descendant, signal);
    });
  const fastForwardMain: HqGit["fastForwardMain"] = (repo, sha, expected) =>
    inRepo("fastForwardMain", repo, async (dir, signal) => {
      if (!validSha(sha) || (expected !== null && !validSha(expected)))
        throw error("Invalid commit");
      await resolve(dir, sha, signal);
      const main = await refHead(dir, "refs/heads/main", signal);
      if (main !== expected) return { kind: "stale" } as const;
      if (main === sha) return { kind: "moved" } as const;
      if (
        main !== null &&
        !(await ancestorIn(dir, main, sha, signal)) &&
        !(await emptyHistory(dir, main, signal))
      )
        return { kind: "not_fast_forward" } as const;
      if (!(await cas(dir, "refs/heads/main", sha, main, signal)))
        return { kind: "stale" } as const;
      emit({ kind: "main_moved", repo, old: main, new: sha, by: "import" });
      return { kind: "moved" } as const;
    });
  const holdsNothing: HqGit["holdsNothing"] = (repo, sha) =>
    inRepo("holdsNothing", repo, async (dir, signal) => {
      if (!validSha(sha)) throw error("Invalid commit");
      return emptyHistory(dir, sha, signal);
    });
  const fastForwardChange: HqGit["fastForwardChange"] = (repo, change, sha, expected) =>
    inRepo("fastForwardChange", repo, async (dir, signal) => {
      if (!validSha(sha) || (expected !== null && !validSha(expected)))
        throw error("Invalid commit");
      const ref = changeRef(change);
      await resolve(dir, sha, signal);
      const head = await refHead(dir, ref, signal);
      if (head !== expected) return { kind: "stale" } as const;
      if (head === sha) return { kind: "moved" } as const;
      if (head !== null && !(await ancestorIn(dir, head, sha, signal)))
        return { kind: "not_fast_forward" } as const;
      if (!(await cas(dir, ref, sha, head, signal))) return { kind: "stale" } as const;
      const oldSha = head ?? "0".repeat(sha.length);
      emit({ kind: "pushed", repo, updates: [{ ref, oldSha, newSha: sha }] });
      return { kind: "moved" } as const;
    });
  const pushRef: HqGit["pushRef"] = (repo, remote, branch, sha, expected) =>
    inRepo("pushRef", repo, async (dir, signal) => {
      if (!validSha(sha) || (expected !== null && !validSha(expected)))
        throw error("Invalid commit");
      const url = mirrorUrl(remote.url);
      const ref = await branchRef(dir, branch, signal);
      await resolve(dir, sha, signal);
      if (expected !== null && expected !== sha && !(await ancestorIn(dir, expected, sha, signal)))
        return { kind: "rejected", reason: "not_fast_forward" } as const;
      // The remote must still hold what HQ expects (null: no branch). The push carries no force
      // form, so a remote moving after this read can only be fast-forwarded, never overwritten.
      if ((await remoteTip(dir, remote, ref, signal)) !== expected)
        return { kind: "rejected", reason: "stale" } as const;
      const pushed = await git.remoteAskpass(
        ["-C", dir, "push", "--porcelain", "--no-verify", url, `${sha}:${ref}`],
        url,
        remote.token,
        signal,
        [1],
      );
      if (pushed.code === 0) return { kind: "pushed" } as const;
      const line = pushed.stdout
        .toString()
        .split("\n")
        .find((entry) => entry.startsWith("!\t"));
      if (line === undefined) throw error("Push failed");
      return {
        kind: "rejected",
        reason: /fetch first|non-fast-forward/u.test(line) ? "stale" : "refused",
      } as const;
    }).pipe(Effect.timeout(Duration.seconds(60)), Effect.mapError(timedOut("pushRef")));
  const changeHead: HqGit["changeHead"] = (repo, change) =>
    inRepo("changeHead", repo, (dir, signal) => refHead(dir, changeRef(change), signal));
  const mergeability: HqGit["mergeability"] = (repo, change, captured) =>
    inRepo("mergeability", repo, async (dir, signal) => {
      const snapshot = checkedSnapshot(captured);
      const head =
        snapshot === undefined ? await refHead(dir, changeRef(change), signal) : snapshot.head;
      if (!head) return { kind: "no_change" };
      const main =
        snapshot === undefined ? await bornMain("mergeability", dir, signal) : snapshot.main;
      if (main === null)
        throw new GitError({
          operation: "mergeability",
          reason: "no_main",
          message: "Main has no commit",
        });
      const { tree: _tree, ...result } = await inspect(dir, repo, change, main, head, signal);
      return result;
    });
  const squashMerge: HqGit["squashMerge"] = (repo, opts) =>
    inRepo("squashMerge", repo, async (dir, signal) => {
      if (!validSha(opts.expectedMain) || !validSha(opts.expectedHead))
        throw error("Invalid expected main or change head");
      // An empty title makes git read the trailer block as the title; a scissors line hides it.
      if (
        !opts.message.split("\n")[0]!.trim() ||
        opts.message.includes("\0") ||
        /^# -{24} >8 -{24}$/m.test(opts.message)
      )
        throw error("Invalid merge message");
      const trailers: ReadonlyArray<readonly [string, string]> = [
        ...Object.entries(opts.trailers).flatMap(([key, values]) =>
          (typeof values === "string" ? [values] : values).map((val) => [key, val] as const),
        ),
        ["Mate-Change", `${opts.mateId}/${opts.number}`],
      ];
      for (const [key, val] of trailers) {
        if (
          !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(key) ||
          /[\0\r\n]/.test(val) ||
          (key.toLowerCase() === "mate-change" && key !== "Mate-Change")
        )
          throw error("Invalid trailer");
      }
      const main = await refHead(dir, "refs/heads/main", signal);
      if (main !== opts.expectedMain) return { kind: "main_moved" } as const;
      const head = await refHead(dir, changeRef(opts), signal);
      if (!head) return { kind: "no_change" } as const;
      if (head !== opts.expectedHead) return { kind: "head_moved" } as const;
      const result = await inspect(dir, repo, opts, main, head, signal);
      if (result.kind !== "clean") return result;
      // A change that keeps its history and builds on main is main's next commits as they are.
      if (result.keepsHistory === true && (await ancestorIn(dir, main, head, signal))) {
        if (!(await cas(dir, "refs/heads/main", head, main, signal)))
          return { kind: "main_moved" } as const;
        emit({ kind: "main_moved", repo, old: main, new: head, by: "merge" });
        return { merged: head };
      }
      // Git reads trailers only from the last paragraph, so the trusted block always ends the message.
      const message = `${opts.message.trimEnd()}\n\n${trailers
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")}\n`;
      // One squash; a change keeping its history is joined, its head the merge's second parent.
      const parents = result.keepsHistory === true ? ["-p", main, "-p", head] : ["-p", main];
      const sha = (
        await run(
          dir,
          ["commit-tree", result.tree!, ...parents],
          signal,
          message,
          identity(opts.author),
        )
      )
        .toString()
        .trim();
      if ((await changeTrailer(dir, sha, signal)) !== `${opts.mateId}/${opts.number}`)
        throw error("Merge message hides the Mate-Change trailer");
      if (!(await cas(dir, "refs/heads/main", sha, main, signal)))
        return { kind: "main_moved" } as const;
      emit({ kind: "main_moved", repo, old: main, new: sha, by: "merge" });
      return { merged: sha };
    });
  /** `from`'s tree (empty for null) with `files` over it, written; the path rules of every Core write. */
  const treeWith = async (
    dir: string,
    from: string | null,
    files: Readonly<Record<string, string | Uint8Array | null>>,
    env: Record<string, string>,
    signal: AbortSignal,
  ) => {
    const temp = await NodeFSP.mkdtemp(NodePath.join(dir, ".index-"));
    try {
      const indexed = { ...env, GIT_INDEX_FILE: NodePath.join(temp, "index") };
      await run(
        dir,
        from ? ["read-tree", from] : ["read-tree", "--empty"],
        signal,
        undefined,
        indexed,
      );
      const entries = Object.entries(files);
      if (entries.length > readLimits.entries) throw error("Too many files");
      for (const [path, content] of entries) {
        pathName(path);
        // A Windows checkout reads a backslash as a directory separator.
        if (path.includes("\\")) throw pathError("Invalid git path");
        if (content !== null && Buffer.byteLength(content) > readLimits.bytes)
          throw error("File exceeds write limit");
        // A literal pathspec names exactly this entry: a directory lists as a tree, never its files.
        const [mode = "", type] = from
          ? (await text(dir, ["ls-tree", "-z", from, "--", path], signal)).split(" ")
          : [];
        if (content === null) {
          if (type !== "blob") throw pathError("Only an existing file can be deleted");
          await run(
            dir,
            ["update-index", "-z", "--index-info"],
            signal,
            `0 ${"0".repeat(from?.length ?? 40)}\t${path}\0`,
            indexed,
          );
          continue;
        }
        if (mode && !["100644", "100755"].includes(mode))
          throw pathError("Only regular files may be replaced");
        const sha = (await run(dir, ["hash-object", "-w", "--stdin"], signal, content, indexed))
          .toString()
          .trim();
        // Past hash-object, git refuses only the path: protectHFS/NTFS or a file/directory clash.
        await run(
          dir,
          ["update-index", "--add", "--cacheinfo", mode || "100644", sha, path],
          signal,
          undefined,
          indexed,
        ).catch(() => {
          throw pathError("Git refuses this path");
        });
      }
      const tree = (await run(dir, ["write-tree"], signal, undefined, indexed)).toString().trim();
      const written = entries.flatMap(([path, content]) => (content === null ? [] : [path]));
      if (await collides(dir, tree, written, signal))
        throw pathError("Names collide by case or Unicode form");
      return tree;
    } finally {
      await NodeFSP.rm(temp, { recursive: true, force: true });
    }
  };
  const commitFiles: HqGit["commitFiles"] = (repo, ref, opts) =>
    inRepo("commitFiles", repo, async (dir, signal) => {
      if (
        !ref.startsWith("refs/heads/") ||
        ref === "refs/heads/mate" ||
        ref.startsWith("refs/heads/mate/")
      )
        throw error("Core file writes require a Core-owned branch");
      if (opts.expectedHead !== null && !validSha(opts.expectedHead))
        throw error("Invalid expected head");
      const old = await refHead(dir, ref, signal);
      if (old !== opts.expectedHead) return { kind: "head_moved" } as const;
      const env = identity(opts.author);
      const tree = await treeWith(dir, old, opts.files, env, signal);
      const sha = (
        await run(
          dir,
          ["commit-tree", tree, ...(old ? ["-p", old] : [])],
          signal,
          opts.message,
          env,
        )
      )
        .toString()
        .trim();
      // A Core commit carrying the trailer would mark a change merged once it reaches main.
      if (await changeTrailer(dir, sha, signal))
        throw error("Core commits cannot carry a Mate-Change trailer");
      if (!(await cas(dir, ref, sha, old, signal))) return { kind: "head_moved" } as const;
      if (ref === "refs/heads/main")
        emit({ kind: "main_moved", repo, old, new: sha, by: "commit" });
      return { sha };
    });
  const createTag: HqGit["createTag"] = (repo, name, sha, message) =>
    inRepo("createTag", repo, async (dir, signal) => {
      if (!validSha(sha) || /[\0\r\n]/.test(name)) throw error("Invalid tag");
      const ref = `refs/tags/${name}`;
      const target = await resolve(dir, sha, signal);
      const existing = async () =>
        (await resolve(dir, ref, signal).catch(() => null)) === target
          ? ({ kind: "exists_same" } as const)
          : ({ kind: "conflict" } as const);
      if (await refHead(dir, ref, signal)) return existing();
      const date = Math.floor(Date.now() / 1000);
      const object = `object ${target}\ntype commit\ntag ${name}\ntagger Core <core@hq.invalid> ${date} +0000\n\n${message}\n`;
      const tag = (await run(dir, ["mktag"], signal, object)).toString().trim();
      if (!(await cas(dir, ref, tag, null, signal))) return existing();
      emit({ kind: "tagged", repo, name, sha: target });
      return { kind: "created" } as const;
    });
  const bundle: HqGit["bundle"] = (repo, file) =>
    inRepo("bundle", repo, async (dir, signal) => {
      // GitHub's branches and tags are fetched again from GitHub, never made again from a bundle.
      const own = await text(
        dir,
        ["for-each-ref", "--count=1", "--format=%(refname)", `--exclude=${GITHUB_REFS}`],
        signal,
      );
      if (!own) return { refs: [] };
      await run(
        dir,
        ["bundle", "create", "--quiet", file, `--exclude=${GITHUB_REFS}*`, "--all"],
        signal,
      );
      // What the bundle itself holds: the refs a restore makes again.
      const heads = await text(dir, ["bundle", "list-heads", file], signal);
      return {
        refs: heads.split("\n").flatMap((line) => {
          const [sha = "", ref = ""] = line.split(" ");
          return ref.startsWith("refs/") ? [{ ref, sha }] : [];
        }),
      };
    });
  const tags: HqGit["tags"] = (repo) =>
    inRepo("tags", repo, async (dir, signal) => {
      const result = await records(
        dir,
        [
          "for-each-ref",
          "--sort=refname",
          `--count=${readLimits.entries + 1}`,
          "--format=%(refname:strip=2)%1f%(objecttype)%1f%(objectname)%1f%(*objectname)%1f%(taggerdate:iso-strict)%1f%(contents)%1e",
          "refs/tags/",
        ],
        signal,
        "\x1e",
      );
      return {
        ...result,
        items: result.items.flatMap((record) => {
          // Each record but the first follows the newline that ends the one before.
          const line = record.replace(/^\n/u, "");
          if (line === "") return [];
          const [name = "", type = "", object = "", peeled = "", taggedAt = "", message = ""] =
            line.split("\x1f");
          // A lightweight tag names a commit and carries no message nor date of its own.
          return type === "tag"
            ? [{ name, sha: peeled, message: message.trimEnd(), taggedAt }]
            : [{ name, sha: object, message: "", taggedAt: "" }];
        }),
      };
    });
  const changeRefs: HqGit["changeRefs"] = (repo) =>
    inRepo("changeRefs", repo, async (dir, signal) => {
      const read = await prefix(
        dir,
        [
          "for-each-ref",
          `--count=${readLimits.history + 1}`,
          "--format=%(refname) %(objectname)",
          "refs/heads/mate/",
        ],
        signal,
        readLimits.bytes,
      );
      const lines = read.bytes.toString().split("\n").filter(Boolean);
      if (read.truncated || lines.length > readLimits.history)
        throw error("Change branches exceed safety bound");
      return lines.flatMap((line) => {
        const [ref = "", sha = ""] = line.split(" ");
        const match = /^refs\/heads\/mate\/([^/]+)\/([1-9][0-9]*)$/u.exec(ref);
        return match === null
          ? []
          : [{ mateId: match[1]!, number: Number(match[2]), branch: ref.slice(11), sha }];
      });
    });
  const missingCommits: HqGit["missingCommits"] = (repo, shas) =>
    inRepo("missingCommits", repo, async (dir, signal) => {
      if (shas.some((sha) => !validSha(sha))) throw error("Invalid commit");
      if (shas.length === 0) return [];
      const answers = (
        await run(
          dir,
          ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
          signal,
          `${shas.join("\n")}\n`,
        )
      )
        .toString()
        .split("\n");
      return shas.filter((sha, i) => answers[i] !== `${sha} commit`);
    });
  const branches: HqGit["branches"] = (repo) =>
    inRepo("branches", repo, async (dir, signal) => {
      const result = await records(
        dir,
        [
          "for-each-ref",
          "--sort=refname",
          `--count=${readLimits.entries + 1}`,
          "--format=%(refname) %(objectname)",
          "refs/heads/",
        ],
        signal,
        "\n",
      );
      return {
        ...result,
        items: result.items.map((line) => {
          const [ref = "", sha = ""] = line.split(" ");
          return { ref, sha };
        }),
      };
    });
  const tree: HqGit["tree"] = (repo, rev, path) =>
    inRepo("tree", repo, async (dir, signal) => {
      pathName(path, true);
      const sha = await resolve(dir, rev, signal);
      const result = await records(dir, ["ls-tree", "-z", path ? `${sha}:${path}` : sha], signal);
      return {
        ...result,
        items: result.items.map((line) => {
          const mark = line.indexOf("\t");
          const [mode = "", type = "", sha = ""] = line.slice(0, mark).split(" ");
          return { mode, type, sha, path: line.slice(mark + 1) };
        }),
      };
    });
  const file: HqGit["file"] = (repo, rev, path, maxBytes) =>
    inRepo("file", repo, async (dir, signal) => {
      pathName(path);
      const max = bound(maxBytes, readLimits.bytes);
      const sha = await resolve(dir, rev, signal);
      const result = await prefix(
        dir,
        ["cat-file", "blob", `${sha}:${path}`],
        signal,
        Math.max(max, 8192),
      );
      return {
        content: result.bytes.subarray(0, max),
        binary: result.bytes.subarray(0, 8192).includes(0),
        truncated: result.truncated || result.bytes.length > max,
      };
    });
  /** The commits `rev-list` names, each read with its bounded message. */
  const summaries = async (dir: string, shas: ReadonlyArray<string>, signal: AbortSignal) => {
    const items: CommitSummary[] = [];
    let cut = false;
    for (const id of shas) {
      const record = await prefix(
        dir,
        ["show", "-s", `--format=${format}`, id, "--"],
        signal,
        readLimits.messageBytes,
      );
      const parsed = summary(record.bytes.toString());
      items.push({
        ...parsed,
        message: record.truncated ? parsed.message : parsed.message.replace(/\n$/, ""),
      });
      cut ||= record.truncated;
    }
    return { items, cut };
  };
  const onMain: HqGit["onMain"] = (repo, sha) =>
    inRepo("onMain", repo, async (dir, signal) => {
      if (!validSha(sha)) throw error("Invalid commit");
      const main = await refHead(dir, "refs/heads/main", signal);
      if (!main) return false;
      const commit = await git.exec(["-C", dir, "cat-file", "-e", `${sha}^{commit}`], {
        signal,
        acceptExitCodes: [1, 128],
      });
      if (commit.code !== 0) return false;
      const ancestor = await git.exec(["-C", dir, "merge-base", "--is-ancestor", sha, main], {
        signal,
        acceptExitCodes: [1],
      });
      return ancestor.code === 0;
    });
  const treeId: HqGit["treeId"] = (repo, sha) =>
    inRepo("treeId", repo, async (dir, signal) => {
      if (!validSha(sha)) throw error("Invalid commit");
      return text(dir, ["rev-parse", "--verify", `${sha}^{tree}`], signal);
    });
  const mergeBase: HqGit["mergeBase"] = (repo, change, captured) =>
    inRepo("mergeBase", repo, async (dir, signal) => {
      const snapshot = checkedSnapshot(captured);
      const head =
        snapshot === undefined ? await refHead(dir, changeRef(change), signal) : snapshot.head;
      const main =
        snapshot === undefined ? await refHead(dir, "refs/heads/main", signal) : snapshot.main;
      if (!head || !main) return null;
      const base = (await run(dir, ["merge-base", main, head], signal, undefined, undefined, [1]))
        .toString()
        .trim();
      return base || null;
    });
  const range: HqGit["range"] = (repo, base, head, opts) =>
    inRepo("range", repo, async (dir, signal) => {
      const limit = bound(opts.limit, readLimits.log);
      const ends = base === null ? [head] : [base, head];
      if (!ends.every(validSha)) throw error("Invalid commit");
      for (const sha of ends) {
        const commit = await git.exec(
          ["-C", dir, "cat-file", "-e", "--end-of-options", `${sha}^{commit}`],
          { signal, acceptExitCodes: [1, 128] },
        );
        if (commit.code !== 0)
          throw new GitError({
            operation: "range",
            reason: "not_found",
            message: "Commit not found",
          });
      }
      const revisions = ["--end-of-options", head, ...(base === null ? [] : [`^${base}`]), "--"];
      const shas = (
        await text(
          dir,
          ["rev-list", "--topo-order", `--max-count=${limit + 1}`, ...revisions],
          signal,
        )
      )
        .split("\n")
        .filter(Boolean);
      const counted = Number(
        await text(
          dir,
          ["rev-list", "--count", `--max-count=${readLimits.history + 1}`, ...revisions],
          signal,
        ),
      );
      const { items, cut } = await summaries(dir, shas.slice(0, limit), signal);
      return {
        items,
        truncated: shas.length > limit || cut,
        total: Math.min(counted, readLimits.history),
      };
    });
  const changeLog: HqGit["changeLog"] = (repo, change, opts) =>
    inRepo("changeLog", repo, async (dir, signal) => {
      const limit = bound(opts.limit, readLimits.log);
      const landed = opts.landed ?? [];
      if (!landed.every(validSha)) throw error("Invalid landed head");
      const snapshot = checkedSnapshot(opts.snapshot);
      const head =
        snapshot === undefined ? await refHead(dir, changeRef(change), signal) : snapshot.head;
      if (!head) return { items: [], truncated: false };
      const main =
        snapshot === undefined ? await refHead(dir, "refs/heads/main", signal) : snapshot.main;
      const shas = (
        await text(
          dir,
          [
            "rev-list",
            // A landed head the repository lacks excludes nothing, rather than failing the read.
            ...(landed.length === 0 ? [] : ["--ignore-missing"]),
            "--topo-order",
            `--max-count=${limit + 1}`,
            head,
            ...(main ? [`^${main}`] : []),
            ...landed.map((sha) => `^${sha}`),
            "--",
          ],
          signal,
        )
      )
        .split("\n")
        .filter(Boolean);
      const { items, cut } = await summaries(dir, shas.slice(0, limit), signal);
      return { items, truncated: shas.length > limit || cut };
    });
  const squashNames: HqGit["squashNames"] = (repo, change) =>
    inRepo("squashNames", repo, async (dir, signal) => {
      const head = await refHead(dir, changeRef(change), signal);
      if (!head) return { kind: "no_change" } as const;
      const main = await bornMain("squashNames", dir, signal);
      const none = { main, head, files: { items: [], truncated: false } };
      // A head main has already would squash nothing onto it.
      const onMain = await git.exec(["-C", dir, "merge-base", "--is-ancestor", head, main], {
        signal,
        acceptExitCodes: [1],
      });
      if (onMain.code === 0) return none;
      const result = await inspect(dir, repo, change, main, head, signal);
      if (result.kind === "empty") return none;
      if (result.kind !== "clean") return result;
      // `-z` alternates the letter and the path, each ended by NUL: never a cut pair.
      const read = await prefix(
        dir,
        ["diff", "--no-renames", "--name-status", "-z", main, result.tree!, "--"],
        signal,
        readLimits.bytes,
      );
      const fields = read.bytes.toString().split("\0");
      const items: Array<{ path: string; status: string }> = [];
      for (let i = 0; i + 1 < fields.length && fields[i]; i += 2) {
        items.push({ status: fields[i]!, path: fields[i + 1]! });
      }
      if (read.truncated) items.pop();
      return {
        main,
        head,
        files: {
          items: items.slice(0, readLimits.entries),
          truncated: read.truncated || items.length > readLimits.entries,
        },
      };
    });
  const changeTrailers: HqGit["changeTrailers"] = (repo, change, keys) =>
    inRepo("changeTrailers", repo, async (dir, signal) => {
      if (keys.length === 0 || keys.some((key) => !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(key)))
        throw error("Invalid trailer key");
      const head = await refHead(dir, changeRef(change), signal);
      if (!head) return [];
      const main = await refHead(dir, "refs/heads/main", signal);
      const range = [head, ...(main ? [`^${main}`] : []), "--"];
      const count = Number(await text(dir, ["rev-list", "--count", ...range], signal));
      if (count > readLimits.history) throw error("Change history exceeds safety bound");
      // One record per commit (0x1e), one trailer per field (0x1f), each `Key: value` unfolded.
      const read = await prefix(
        dir,
        [
          "log",
          "--reverse",
          "--topo-order",
          `--format=%(trailers:${keys.map((key) => `key=${key}`).join(",")},unfold,separator=%x1f)%x1e`,
          ...range,
        ],
        signal,
        readLimits.diffBytes,
      );
      if (read.truncated) throw error("Change trailers exceed read bound");
      const asked = new Map(keys.map((key) => [key.toLowerCase(), key]));
      return read.bytes
        .toString()
        .split("\x1e")
        .flatMap((record) => record.replace(/^\n/, "").split("\x1f"))
        .flatMap((field) => {
          const mark = field.indexOf(":");
          const key = asked.get(field.slice(0, mark).trim().toLowerCase());
          return mark < 0 || key === undefined
            ? []
            : [{ key, value: field.slice(mark + 1).trim() }];
        });
    });
  const log: HqGit["log"] = (repo, rev, opts) =>
    inRepo("log", repo, async (dir, signal) => {
      const limit = bound(opts.limit, readLimits.log);
      const parts = opts.cursor?.split(":");
      if (parts && (parts.length !== 2 || !validSha(parts[0]!) || !/^\d+$/.test(parts[1]!)))
        throw error("Invalid log cursor");
      const sha = parts ? await resolve(dir, parts[0]!, signal) : await resolve(dir, rev, signal);
      const offset = parts ? Number(parts[1]) : 0;
      if (!Number.isSafeInteger(offset) || offset > readLimits.history)
        throw error("Log cursor exceeds bound");
      const shas = (
        await text(
          dir,
          ["rev-list", `--skip=${offset}`, `--max-count=${limit + 1}`, sha, "--"],
          signal,
        )
      )
        .split("\n")
        .filter(Boolean);
      const { items, cut } = await summaries(dir, shas.slice(0, limit), signal);
      const more = shas.length > limit;
      return {
        items,
        truncated: more || cut,
        cursor: more ? `${sha}:${offset + items.length}` : null,
      };
    });
  const commit: HqGit["commit"] = (repo, rev) =>
    inRepo("commit", repo, async (dir, signal) => {
      const sha = await resolve(dir, rev, signal);
      const message = await prefix(
        dir,
        ["show", "-s", `--format=${format}`, sha, "--"],
        signal,
        readLimits.messageBytes,
      );
      const files = await prefix(
        dir,
        [
          "diff-tree",
          "--root",
          "--first-parent",
          "-m",
          "--no-commit-id",
          "--no-renames",
          "--numstat",
          "-r",
          "-z",
          sha,
          "--",
        ],
        signal,
        readLimits.bytes,
      );
      const complete = files.truncated
        ? files.bytes.subarray(0, files.bytes.lastIndexOf(0) + 1)
        : files.bytes;
      const items = stats(complete);
      const record = summary(message.bytes.toString());
      // show adds one separator newline beyond %B.
      return {
        ...record,
        message: record.message.replace(/\n$/, ""),
        files: items.slice(0, readLimits.entries),
        truncated: message.truncated || files.truncated || items.length > readLimits.entries,
      };
    });
  const changeDiff: HqGit["changeDiff"] = (repo, change, opts) =>
    inRepo("changeDiff", repo, async (dir, signal) => {
      const maxFiles = bound(opts.maxFiles, readLimits.entries);
      const maxBytes = bound(opts.maxBytesPerFile, readLimits.bytes);
      const snapshot = checkedSnapshot(opts.snapshot);
      const head =
        snapshot === undefined ? await refHead(dir, changeRef(change), signal) : snapshot.head;
      if (!head) return { items: [], truncated: false };
      const main =
        snapshot === undefined ? await bornMain("changeDiff", dir, signal) : snapshot.main;
      if (main === null)
        throw new GitError({
          operation: "changeDiff",
          reason: "no_main",
          message: "Main has no commit",
        });
      // A change sharing no history with main reads against main: all it would make main hold.
      const base =
        (await run(dir, ["merge-base", main, head], signal, undefined, undefined, [1]))
          .toString()
          .trim() || main;
      const result = await prefix(
        dir,
        ["diff", "--no-renames", "--numstat", "-z", base, head, "--"],
        signal,
        readLimits.bytes,
      );
      const complete = result.truncated
        ? result.bytes.subarray(0, result.bytes.lastIndexOf(0) + 1)
        : result.bytes;
      const all = stats(complete);
      const items = [];
      // Per-file bounds alone would allow a thousand full patches: one budget bounds the whole read.
      let budget = readLimits.diffBytes;
      for (const stat of all.slice(0, maxFiles)) {
        const binary = stat.added === null;
        if (budget <= 0) {
          items.push({ ...stat, hunks: "", binary, truncated: true });
          continue;
        }
        const patch = await prefix(
          dir,
          [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--unified=3",
            base,
            head,
            "--",
            stat.path,
          ],
          signal,
          Math.min(maxBytes, budget),
        );
        budget -= patch.bytes.length;
        items.push({ ...stat, hunks: patch.bytes.toString(), binary, truncated: patch.truncated });
      }
      return {
        items,
        truncated:
          result.truncated || all.length > maxFiles || items.some((item) => item.truncated),
      };
    });
  const archive: HqGit["archive"] = (repo, rev) =>
    inRepo("archive", repo, async (dir, signal) =>
      streamArchive(git, dir, await resolve(dir, rev, signal), "tar.gz", signal),
    );
  return {
    changeHead,
    bundle,
    tags,
    changeRefs,
    missingCommits,
    onMain,
    treeId,
    mergeBase,
    range,
    changeLog,
    squashNames,
    changeTrailers,
    mergeability,
    squashMerge,
    commitFiles,
    previewAdoption,
    acceptAdoption,
    remoteHead,
    fetchTip,
    followRefs,
    unfollowRefs,
    isAncestor,
    fastForwardMain,
    holdsNothing,
    fastForwardChange,
    pushRef,
    createTag,
    branches,
    tree,
    file,
    log,
    commit,
    changeDiff,
    archive,
  };
};
