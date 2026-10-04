// @effect-diagnostics nodeBuiltinImport:off - native streams and isolated git index files.
// @effect-diagnostics globalDate:off -- a tag records the wall-clock time it was made.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeStream from "node:stream";
import * as Effect from "effect/Effect";
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
  type ChangeSnapshot,
} from "./api.ts";
import { GitRunner, terminate } from "./git.ts";

// Hard ceilings bound memory even when refs, messages, paths, or blobs are hostile.
const readLimits = {
  entries: 1000,
  bytes: 1024 * 1024,
  messageBytes: 64 * 1024,
  diffBytes: 8 * 1024 * 1024,
  log: 100,
  history: 10000,
} as const;
const error = (message: string) =>
  new GitError({ operation: "operations", reason: "invalid_config", message });
const pathError = (message: string) =>
  new GitError({ operation: "operations", reason: "invalid_path", message });
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
 * Serialize delivery, swallow port failures, and never include caller data in failure logs.
 * Writers only enqueue: a handler that calls back into the layer must not wait on itself.
 */
export const eventPort = (options: HqGitOptions) => {
  let tail = Promise.resolve();
  return (event: GitEvent): void => {
    tail = tail.then(async () => {
      try {
        await options.onEvent?.(event);
      } catch {
        await Effect.runPromise(
          Effect.logWarning("hq-git event delivery failed; Core must reconcile from refs"),
        );
      }
    });
  };
};

type Attempt = <A>(
  operation: string,
  run: (signal: AbortSignal) => Promise<A>,
) => Effect.Effect<A, GitError>;
export const makeOperations = (
  git: GitRunner,
  locate: (repo: Repo) => Promise<string | null>,
  options: HqGitOptions,
  attempt: Attempt,
  emit: (event: GitEvent) => void,
) => {
  const refLockTimeoutMs = options.refLockTimeoutMs ?? 5000;
  const inRepo = <A>(
    operation: string,
    repo: Repo,
    run: (dir: string, signal: AbortSignal) => Promise<A>,
  ) =>
    attempt(operation, async (signal) => {
      const dir = await locate(repo);
      if (!dir)
        throw new GitError({ operation, reason: "not_found", message: "Repository not found" });
      return run(dir, signal);
    });
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
  const changeRef = (mateId: string, number: number) => {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(mateId) ||
      !Number.isSafeInteger(number) ||
      number < 1
    )
      throw error("Invalid change identity");
    return `refs/heads/mate/${mateId}/${number}`;
  };
  const resolve = async (dir: string, rev: string, signal: AbortSignal) => {
    // --end-of-options already stops option parsing; a leading dash is never a revision Core means.
    if (!rev || rev.startsWith("-") || rev.includes("\0") || rev.length > 1024)
      throw error("Invalid revision");
    return text(dir, ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`], signal);
  };
  // Collect a prefix, then stop the process instead of reading a huge blob or patch into memory.
  const prefix = async (dir: string, args: string[], signal: AbortSignal, max: number) => {
    const process = git.start(["-C", dir, ...args], { signal });
    process.child.stdin.end();
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    try {
      for await (const chunk of process.child.stdout) {
        const bytes = Buffer.from(chunk as Uint8Array);
        const remaining = max - size;
        chunks.push(bytes.subarray(0, Math.max(0, remaining)));
        size += bytes.length;
        if (size > max) {
          truncated = true;
          break;
        }
      }
      if (!truncated) await process.done;
      return { bytes: Buffer.concat(chunks), truncated };
    } finally {
      terminate(process.child);
      await process.done.catch(() => {});
    }
  };
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
    mateId: string,
    number: number,
    main: string,
    head: string,
    signal: AbortSignal,
  ): Promise<Mergeability & { tree?: string }> => {
    const metadata = await options.lookupChange(repo, mateId, number);
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
    if (!base) return { kind: "unrelated" };
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
    return { kind: "clean", tree };
  };
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
  const changeHead: HqGit["changeHead"] = (repo, mateId, number) =>
    inRepo("changeHead", repo, (dir, signal) => refHead(dir, changeRef(mateId, number), signal));
  const mergeability: HqGit["mergeability"] = (repo, mateId, number, captured) =>
    inRepo("mergeability", repo, async (dir, signal) => {
      const snapshot = checkedSnapshot(captured);
      const head =
        snapshot === undefined
          ? await refHead(dir, changeRef(mateId, number), signal)
          : snapshot.head;
      if (!head) return { kind: "no_change" };
      const main =
        snapshot === undefined ? await bornMain("mergeability", dir, signal) : snapshot.main;
      if (main === null)
        throw new GitError({
          operation: "mergeability",
          reason: "no_main",
          message: "Main has no commit",
        });
      const { tree: _tree, ...result } = await inspect(
        dir,
        repo,
        mateId,
        number,
        main,
        head,
        signal,
      );
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
      const head = await refHead(dir, changeRef(opts.mateId, opts.number), signal);
      if (!head) return { kind: "no_change" } as const;
      if (head !== opts.expectedHead) return { kind: "head_moved" } as const;
      const result = await inspect(dir, repo, opts.mateId, opts.number, main, head, signal);
      if (result.kind !== "clean") return result;
      // Git reads trailers only from the last paragraph, so the trusted block always ends the message.
      const message = `${opts.message.trimEnd()}\n\n${trailers
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")}\n`;
      const sha = (
        await run(
          dir,
          ["commit-tree", result.tree!, "-p", main],
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
  const mergeIntoChange: HqGit["mergeIntoChange"] = (repo, mateId, number, opts) =>
    inRepo("mergeIntoChange", repo, async (dir, signal) => {
      if (!validSha(opts.expectedHead) || !validSha(opts.expectedMain))
        throw error("Invalid expected head or main");
      const ref = changeRef(mateId, number);
      const head = await refHead(dir, ref, signal);
      if (!head) return { kind: "no_change" } as const;
      if (head !== opts.expectedHead) return { kind: "head_moved" } as const;
      if ((await refHead(dir, "refs/heads/main", signal)) !== opts.expectedMain)
        return { kind: "main_moved" } as const;
      if (!validSha(opts.from)) throw error("Invalid tree");
      const from = await text(
        dir,
        ["rev-parse", "--verify", "--end-of-options", `${opts.from}^{tree}`],
        signal,
      );
      const env = identity(opts.author);
      const tree = await treeWith(dir, from, opts.files, env, signal);
      const sha = (
        await run(
          dir,
          ["commit-tree", tree, "-p", head, "-p", opts.expectedMain],
          signal,
          opts.message,
          env,
        )
      )
        .toString()
        .trim();
      // On a change's branch the trailer would mark the change merged the moment it reached main.
      if (await changeTrailer(dir, sha, signal))
        throw error("Core commits cannot carry a Mate-Change trailer");
      if (!(await cas(dir, ref, sha, head, signal))) return { kind: "head_moved" } as const;
      return { sha };
    });
  const mergeTree: HqGit["mergeTree"] = (repo, ours, theirs) =>
    inRepo("mergeTree", repo, async (dir, signal) => {
      if (!validSha(ours) || !validSha(theirs)) throw error("Invalid commit");
      const merged = await git.exec(
        ["-C", dir, "merge-tree", "--write-tree", "--name-only", "-z", ours, theirs],
        { signal, acceptExitCodes: [1] },
      );
      const fields = merged.stdout.toString().split("\0");
      const tree = fields.shift()!;
      const conflicts: string[] = [];
      for (const field of fields) {
        if (!field) break;
        conflicts.push(field);
      }
      return merged.code === 1 ? { conflicts } : { tree };
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
      if (!(await text(dir, ["for-each-ref", "--count=1", "--format=%(refname)"], signal)))
        return { refs: [] };
      await run(dir, ["bundle", "create", "--quiet", file, "--all"], signal);
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
        return match === null ? [] : [{ mateId: match[1]!, number: Number(match[2]), sha }];
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
  const mergeBase: HqGit["mergeBase"] = (repo, mateId, number, captured) =>
    inRepo("mergeBase", repo, async (dir, signal) => {
      const snapshot = checkedSnapshot(captured);
      const head =
        snapshot === undefined
          ? await refHead(dir, changeRef(mateId, number), signal)
          : snapshot.head;
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
  const changeLog: HqGit["changeLog"] = (repo, mateId, number, opts) =>
    inRepo("changeLog", repo, async (dir, signal) => {
      const limit = bound(opts.limit, readLimits.log);
      if (opts.base !== undefined && !validSha(opts.base)) throw error("Invalid change base");
      const snapshot = checkedSnapshot(opts.snapshot);
      const head =
        snapshot === undefined
          ? await refHead(dir, changeRef(mateId, number), signal)
          : snapshot.head;
      if (!head) return { items: [], truncated: false };
      const main =
        snapshot === undefined ? await refHead(dir, "refs/heads/main", signal) : snapshot.main;
      const shas = (
        await text(
          dir,
          [
            "rev-list",
            "--topo-order",
            `--max-count=${limit + 1}`,
            head,
            ...(main ? [`^${main}`] : []),
            ...(opts.base === undefined ? [] : [`^${opts.base}`]),
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
  const squashNames: HqGit["squashNames"] = (repo, mateId, number) =>
    inRepo("squashNames", repo, async (dir, signal) => {
      const head = await refHead(dir, changeRef(mateId, number), signal);
      if (!head) return { kind: "no_change" } as const;
      const main = await bornMain("squashNames", dir, signal);
      const none = { main, head, files: { items: [], truncated: false } };
      // A head main has already would squash nothing onto it.
      const onMain = await git.exec(["-C", dir, "merge-base", "--is-ancestor", head, main], {
        signal,
        acceptExitCodes: [1],
      });
      if (onMain.code === 0) return none;
      const result = await inspect(dir, repo, mateId, number, main, head, signal);
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
  const changeTrailers: HqGit["changeTrailers"] = (repo, mateId, number, keys) =>
    inRepo("changeTrailers", repo, async (dir, signal) => {
      if (keys.length === 0 || keys.some((key) => !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(key)))
        throw error("Invalid trailer key");
      const head = await refHead(dir, changeRef(mateId, number), signal);
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
  const changeDiff: HqGit["changeDiff"] = (repo, mateId, number, opts) =>
    inRepo("changeDiff", repo, async (dir, signal) => {
      const maxFiles = bound(opts.maxFiles, readLimits.entries);
      const maxBytes = bound(opts.maxBytesPerFile, readLimits.bytes);
      const snapshot = checkedSnapshot(opts.snapshot);
      const head =
        snapshot === undefined
          ? await refHead(dir, changeRef(mateId, number), signal)
          : snapshot.head;
      if (!head) return { items: [], truncated: false };
      const main =
        snapshot === undefined ? await bornMain("changeDiff", dir, signal) : snapshot.main;
      if (main === null)
        throw new GitError({
          operation: "changeDiff",
          reason: "no_main",
          message: "Main has no commit",
        });
      const base = await text(dir, ["merge-base", main, head], signal);
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
    inRepo("archive", repo, async (dir, signal) => {
      const sha = await resolve(dir, rev, signal);
      // Empty worktree/index suppress export-ignore and export-subst: archive exact stored bytes.
      const temp = await NodeFSP.mkdtemp(NodePath.join(dir, ".archive-"));
      const process = git.start(
        [
          "-C",
          dir,
          "-c",
          "core.bare=false",
          "-c",
          "tar.umask=0022",
          "archive",
          "--worktree-attributes",
          "--format=tar.gz",
          sha,
        ],
        {
          signal,
          env: { GIT_WORK_TREE: temp, GIT_INDEX_FILE: NodePath.join(temp, "index") },
        },
      );
      const cleanup = process.done.finally(() =>
        NodeFSP.rm(temp, { recursive: true, force: true }),
      );
      void cleanup.catch(() => {});
      process.child.stdin.end();
      const stream = new NodeStream.PassThrough({
        flush(callback) {
          void cleanup.then(
            () => callback(),
            () => callback(new Error("Git archive failed")),
          );
        },
        destroy(cause, callback) {
          process.child.stdout.unpipe();
          process.child.stdout.resume();
          terminate(process.child);
          void cleanup.catch(() => {}).then(() => callback(cause));
        },
      });
      process.child.stdout.on("error", () => stream.destroy(new Error("Git archive failed")));
      void process.done.then(
        () => {},
        () => {
          if (!stream.destroyed) stream.destroy(new Error("Git archive failed"));
        },
      );
      process.child.stdout.pipe(stream);
      return stream;
    });
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
    mergeIntoChange,
    mergeTree,
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
