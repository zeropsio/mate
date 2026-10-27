// @effect-diagnostics globalDate:off -- a commit's time is git's, written as an instant.
/**
 * The commits reachable from one commit, newest first, a page at a time: of the whole repository,
 * or only those that touched a path (no rename following). A cursor names the commit the list
 * started at and how far it got, so every page continues that one list.
 *
 * @module browse/log
 */
import type { GitRunner } from "../git.ts";

/** Commits a page holds at most. */
export const LOG_PAGE_LIMIT = 100;
/** Commits a list reads at most, all its pages together. */
export const LOG_HISTORY_LIMIT = 10_000;
/** A subject longer than a line is cut to this many characters, never a reason to drop the commit. */
const SUBJECT_LIMIT = 500;
/** Bytes a page reads: each record is bounded by its cut subject, so only a pathological name nears it. */
const BYTES_LIMIT = 1024 * 1024;

export interface LogRequest {
  readonly sha: string;
  /** Only commits that touched it; absent or empty, every commit. */
  readonly path?: string | undefined;
  /** `<sha>:<offset>`, as a page answered it. */
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface LogItem {
  readonly sha: string;
  readonly parents: ReadonlyArray<string>;
  readonly subject: string;
  readonly authorName: string;
  readonly authoredAt: string;
  readonly committedAt: string;
  /** The change whose merge wrote this commit (`Mate-Change: <mateId>/<number>`). */
  readonly change?: { readonly mateId: string; readonly number: number };
}

export interface LogPage {
  readonly items: ReadonlyArray<LogItem>;
  readonly next: string | null;
  /** The last commit of a path's whole history added the path. */
  readonly addsPath: boolean;
  /** Stopped at {@link LOG_HISTORY_LIMIT} with older commits left unread. */
  readonly stopped: boolean;
}

/** One commit as a list reads it: a record of `\x1f`-separated fields (`logItemOf`). */
export const LOG_FORMAT = [
  "%H",
  "%P",
  "%at",
  "%ct",
  "%(trailers:key=Mate-Change,valueonly,separator=%x2c)",
  "%an",
  `%<(${SUBJECT_LIMIT},trunc)%s`,
].join("%x1f");

const CHANGE = /^([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/([1-9][0-9]*)$/u;
const instant = (seconds: string) => new Date(Number(seconds) * 1000).toISOString();

export const logItemOf = (record: string): LogItem => {
  const [sha = "", parents = "", authored = "", committed = "", trailers = "", ...rest] =
    record.split("\x1f");
  // HQ writes its own trailer last, after any a message carried.
  const change = trailers
    .split(",")
    .map((value) => CHANGE.exec(value.trim()))
    .findLast((match) => match !== null);
  const authorName = rest.length > 1 ? rest.slice(0, -1).join("\x1f") : "";
  return {
    sha,
    parents: parents === "" ? [] : parents.split(" "),
    subject: (rest.at(-1) ?? "").trimEnd(),
    authorName,
    authoredAt: instant(authored),
    committedAt: instant(committed),
    ...(change == null ? {} : { change: { mateId: change[1]!, number: Number(change[2]) } }),
  };
};

/** The page `request` asks for; none where the repository does not hold its commit. */
export const listLog = async (
  git: GitRunner,
  dir: string,
  request: LogRequest,
  signal: AbortSignal,
): Promise<LogPage | null> => {
  const { sha } = request;
  const held = await git.exec(
    ["-C", dir, "cat-file", "-e", "--end-of-options", `${sha}^{commit}`],
    {
      signal,
      acceptExitCodes: [1, 128],
    },
  );
  if (held.code !== 0) return null;
  const offset = request.cursor === undefined ? 0 : Number(request.cursor.split(":")[1]);
  const want = Math.min(
    Math.max(1, Math.floor(request.limit ?? LOG_PAGE_LIMIT)),
    LOG_PAGE_LIMIT,
    LOG_HISTORY_LIMIT - offset,
  );
  if (want <= 0) return { items: [], next: null, addsPath: false, stopped: true };
  const path = request.path ?? "";
  const read = await git.prefix(
    [
      // A path is a path, never a pattern or `:(magic)`.
      "--literal-pathspecs",
      "-C",
      dir,
      "log",
      "-z",
      "--no-color",
      `--format=${LOG_FORMAT}`,
      `--skip=${offset}`,
      `--max-count=${want + 1}`,
      "--end-of-options",
      sha,
      "--",
      ...(path === "" ? [] : [path]),
    ],
    signal,
    BYTES_LIMIT,
  );
  const records = read.bytes.toString().split("\0");
  if (read.truncated) records.pop(); // Never a cut record as a whole one.
  const complete = records.filter(Boolean);
  const items = complete.slice(0, want).map(logItemOf);
  const more = read.truncated || complete.length > want;
  const reached = offset + items.length;
  const stopped = more && reached >= LOG_HISTORY_LIMIT;
  const next = more && !stopped && items.length > 0 ? `${sha}:${reached}` : null;
  const oldest = items.at(-1);
  let addsPath = false;
  if (path !== "" && !more && oldest !== undefined) {
    const [parent] = oldest.parents;
    addsPath =
      parent === undefined ||
      (
        await git.exec(["-C", dir, "cat-file", "-e", "--end-of-options", `${parent}:${path}`], {
          signal,
          acceptExitCodes: [1, 128],
        })
      ).code !== 0;
  }
  return { items, next, addsPath, stopped };
};
