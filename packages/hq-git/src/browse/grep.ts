/**
 * The lines of a commit's text files that hold a text: `git grep` at the commit, no index, bounded
 * in matches, per file, per line and by a deadline past which it answers with what it found.
 *
 * Where a line matches comes from git itself — each match wrapped in a colour it is asked for —
 * so a pattern is only ever run by git's matcher, never by HQ's JavaScript.
 *
 * @module browse/grep
 */
import { GitError } from "../api.ts";
import { terminate, type GitRunner } from "../git.ts";
import { pathText } from "../pathText.ts";

export interface GrepRequest {
  readonly q: string;
  /** A folder or file the search stays in; absent, the whole commit. */
  readonly path?: string | undefined;
  /** `fixed` reads `q` as text, `regex` as an extended regular expression. */
  readonly mode: "fixed" | "regex";
  readonly caseSensitive: boolean;
}

export interface GrepLimits {
  readonly matches: number;
  readonly perFile: number;
  /** Characters of a line kept. */
  readonly lineChars: number;
}

export interface GrepMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
  readonly ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>;
}

export interface GrepFound {
  readonly matches: ReadonlyArray<GrepMatch>;
  /** More matches than the limit. */
  readonly truncated: boolean;
  /** Stopped at its deadline: `matches` is what it found until then. */
  readonly deadlineHit: boolean;
}

export type GrepResult =
  | ({ readonly kind: "found" } & GrepFound)
  /** The repository holds no such commit. */
  | { readonly kind: "missing" }
  /** Git does not read `q` as a regular expression. */
  | { readonly kind: "invalid" };

/** The colour git wraps each match in (`reverse`), and the end of it. */
const MATCH_ON = "\x1b[7m";
const MATCH_OFF = "\x1b[m";
/** Every other part of a line git may colour, asked for in no colour. */
const PLAIN = ["filename", "lineNumber", "column", "separator", "selected", "context", "function"];
/** Bytes of one line read; the rest of a longer line is skipped. */
const LINE_BYTES = 16 * 1024;

/** A line as git coloured it: its text, cut to `chars`, and where it matched. */
const lineOf = (coloured: string, chars: number) => {
  let text = "";
  const ranges: Array<{ start: number; end: number }> = [];
  let start: number | null = null;
  for (let at = 0; at < coloured.length;) {
    const escape = coloured.indexOf("\x1b[", at);
    text += coloured.slice(at, escape === -1 ? coloured.length : escape);
    if (escape === -1) break;
    at = escape;
    if (coloured.startsWith(MATCH_ON, at)) {
      start = text.length;
      at += MATCH_ON.length;
    } else if (coloured.startsWith(MATCH_OFF, at)) {
      if (start !== null && text.length > start) ranges.push({ start, end: text.length });
      start = null;
      at += MATCH_OFF.length;
    } else {
      // An escape of the file's own text, kept as it is.
      text += "\x1b";
      at += 1;
    }
  }
  if (start !== null && text.length > start) ranges.push({ start, end: text.length });
  const cut = text.slice(0, chars);
  return {
    text: cut,
    ranges: ranges
      .filter((range) => range.start < cut.length)
      .map((range) => ({ start: range.start, end: Math.min(range.end, cut.length) })),
  };
};

const STOP = Symbol("stop");

/**
 * Matches as `git grep -n -z --color=always` writes them at a tree-ish (`<treeish>:<path>\0<line>\0
 * <line text>\n`), read until the output ends, the limit is passed or `until` aborts.
 */
export const readMatches = async (
  output: AsyncIterable<Uint8Array>,
  treeish: string,
  limits: GrepLimits,
  until: AbortSignal,
): Promise<GrepFound> => {
  const matches: GrepMatch[] = [];
  const prefix = `${treeish}:`;
  const stopped = new Promise<typeof STOP>((resolve) => {
    if (until.aborted) resolve(STOP);
    else until.addEventListener("abort", () => resolve(STOP), { once: true });
  });
  const iterator = output[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  // A line longer than `LINE_BYTES`, kept that far, its rest skipped up to its end.
  let skipping = false;
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), stopped]);
      if (next === STOP) return { matches, truncated: false, deadlineHit: true };
      if (next.done === true) return { matches, truncated: false, deadlineHit: false };
      pending = Buffer.concat([pending, next.value]);
      let at = 0;
      while (at < pending.length) {
        if (skipping) {
          const end = pending.indexOf(0x0a, at);
          if (end === -1) at = pending.length;
          else {
            skipping = false;
            at = end + 1;
          }
          continue;
        }
        const pathEnd = pending.indexOf(0, at);
        const lineEnd = pathEnd === -1 ? -1 : pending.indexOf(0, pathEnd + 1);
        if (lineEnd === -1) break;
        const end = pending.indexOf(0x0a, lineEnd + 1);
        const textEnd = Math.min(end === -1 ? pending.length : end, lineEnd + 1 + LINE_BYTES);
        if (end === -1 && textEnd - lineEnd - 1 < LINE_BYTES) break;
        if (matches.length === limits.matches)
          return { matches, truncated: true, deadlineHit: false };
        const named = pathText(pending.subarray(at, pathEnd));
        matches.push({
          path: named.startsWith(prefix) ? named.slice(prefix.length) : named,
          line: Number(pending.subarray(pathEnd + 1, lineEnd).toString()),
          ...lineOf(pending.subarray(lineEnd + 1, textEnd).toString(), limits.lineChars),
        });
        if (end === -1) {
          skipping = true;
          at = pending.length;
        } else at = end + 1;
      }
      pending = pending.subarray(at);
    }
  } finally {
    // Never waits on the output: the caller stops the process that writes it.
    iterator.return?.().catch(() => {});
  }
};

/** The lines at `sha` that match `request`, read until `until` aborts. */
export const grepAt = async (
  git: GitRunner,
  dir: string,
  sha: string,
  request: GrepRequest,
  limits: GrepLimits,
  signal: AbortSignal,
  until: AbortSignal,
): Promise<GrepResult> => {
  const commit = await git.exec(
    ["-C", dir, "rev-parse", "--verify", "--quiet", "--end-of-options", `${sha}^{commit}`],
    { signal, acceptExitCodes: [1, 128] },
  );
  if (commit.code !== 0) return { kind: "missing" };
  const process = git.start(
    [
      "-C",
      dir,
      ...PLAIN.flatMap((slot) => ["-c", `color.grep.${slot}=normal`]),
      "-c",
      "color.grep.match=reverse",
      "grep",
      "--color=always",
      "-I",
      "-n",
      "-z",
      "--full-name",
      request.mode === "regex" ? "-E" : "-F",
      ...(request.caseSensitive ? [] : ["-i"]),
      `--max-count=${limits.perFile}`,
      "-e",
      request.q,
      sha,
      "--",
      ...(request.path === undefined || request.path === "" ? [] : [request.path]),
    ],
    // 1: no line matches; 128: git could not read the pattern.
    { signal, acceptExitCodes: [1, 128] },
  );
  process.child.stdin.end();
  try {
    const found = await readMatches(process.child.stdout, sha, limits, until);
    if (found.truncated || found.deadlineHit) return { kind: "found", ...found };
    await process.done;
    if (process.child.exitCode !== 128) return { kind: "found", ...found };
    if (request.mode === "regex" && found.matches.length === 0) return { kind: "invalid" };
    throw new GitError({
      operation: "browse.grep",
      reason: "git_failed",
      message: "Git grep failed",
    });
  } finally {
    terminate(process.child);
    await process.done.catch(() => {});
  }
};
