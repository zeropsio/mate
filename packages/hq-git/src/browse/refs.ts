// @effect-diagnostics globalDate:off -- a commit's time is git's, written as an instant.
/**
 * A repository's branches or tags as the picker pages them: `main` first, then the newest commit
 * first, filtered before paging, and a cursor naming the last row a page showed, so the next page
 * continues after it even when refs moved in between.
 *
 * @module browse/refs
 */
import type { GitRunner } from "../git.ts";
import { refOf, type RefKind } from "./resolve.ts";

/** Refs read per request: past it the answer says how many at least. */
export const REFS_READ_LIMIT = 10_000;
/** Rows per page. */
export const REFS_PAGE_LIMIT = 100;
/** One ref's line: a subject longer than a line is cut, never a reason to drop the ref. */
const SUBJECT_LIMIT = 500;
/** Bytes read per request: a record cut by it is dropped, and the answer says at least. */
const BYTES_LIMIT = 8 * 1024 * 1024;

export interface RefsRequest {
  readonly kind: "branch" | "tag";
  /** Case-insensitive substring of the name. */
  readonly q?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface RefItem {
  readonly name: string;
  readonly ref: string;
  readonly sha: string;
  readonly kind: Exclude<RefKind, "commit">;
  readonly committedAt: string;
  readonly subject: string;
  /** A change's branch, `refs/heads/mate/<mateId>/<number>`. */
  readonly change?: { readonly mateId: string; readonly number: number };
  /** Followed from GitHub, never written by Mate. */
  readonly outsideMate: boolean;
}

export type RefsPage = {
  readonly items: ReadonlyArray<RefItem>;
  /** The cursor of the next page; none after the last. */
  readonly next: string | null;
} & ({ readonly total: number } | { readonly totalAtLeast: number });

interface Row extends RefItem {
  readonly rank: number;
  readonly seconds: number;
}

const FORMAT = [
  "%(refname)",
  "%(objecttype)",
  "%(objectname)",
  "%(committerdate:unix)",
  "%(contents:subject)",
  "%(*objecttype)",
  "%(*objectname)",
  "%(*committerdate:unix)",
  "%(*contents:subject)",
].join("%1f");

/** The page order as one comparable key: `main` first, newest first, then by name. */
const before = (a: Row, b: Row) =>
  a.rank - b.rank || b.seconds - a.seconds || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);

const cursorOf = (row: Row) => `${row.rank}.${row.seconds}.${row.ref}`;
const afterCursor = (cursor: string) => {
  const match = /^([01])\.(\d{1,12})\.(refs\/.+)$/u.exec(cursor);
  if (match === null) return null;
  return { rank: Number(match[1]), seconds: Number(match[2]), ref: match[3]! };
};

export const listRefs = async (
  git: GitRunner,
  dir: string,
  request: RefsRequest,
  signal: AbortSignal,
): Promise<RefsPage> => {
  const limit = Math.min(
    Math.max(1, Math.floor(request.limit ?? REFS_PAGE_LIMIT)),
    REFS_PAGE_LIMIT,
  );
  const read = await git.prefix(
    [
      "-C",
      dir,
      "for-each-ref",
      // The newest are the ones kept when a repository holds more than are read.
      request.kind === "branch" ? "--sort=-committerdate" : "--sort=-creatordate",
      `--count=${REFS_READ_LIMIT + 1}`,
      `--format=${FORMAT}`,
      ...(request.kind === "branch"
        ? ["refs/heads/", "refs/github/heads/"]
        : ["refs/tags/", "refs/github/tags/"]),
    ],
    signal,
    BYTES_LIMIT,
  );
  const records = read.bytes.toString().split("\n");
  if (read.truncated) records.pop(); // Never a cut record as a whole one.
  const lines = records.filter(Boolean);
  const cut = read.truncated || lines.length > REFS_READ_LIMIT;
  const q = request.q?.toLowerCase() ?? "";
  const rows: Row[] = [];
  for (const line of lines.slice(0, REFS_READ_LIMIT)) {
    const [ref = "", type, object = "", seconds = "", subject = "", ...peeled] = line.split("\x1f");
    const [peeledType, peeledObject = "", peeledSeconds = "", peeledSubject = ""] = peeled;
    const named = refOf(ref);
    // A tag of a tree or of a blob names no commit to browse.
    const commit = type === "commit" ? true : peeledType === "commit" ? false : null;
    if (named === null || named.kind === "commit" || commit === null) continue;
    if (q !== "" && !named.name.toLowerCase().includes(q)) continue;
    const at = Number(commit ? seconds : peeledSeconds);
    rows.push({
      name: named.name,
      ref,
      sha: commit ? object : peeledObject,
      kind: named.kind,
      committedAt: new Date(at * 1000).toISOString(),
      subject: (commit ? subject : peeledSubject).slice(0, SUBJECT_LIMIT),
      outsideMate: named.kind === "github-branch" || named.kind === "github-tag",
      rank: ref === "refs/heads/main" ? 0 : 1,
      seconds: at,
    });
  }
  rows.sort(before);
  const after = request.cursor === undefined ? null : afterCursor(request.cursor);
  const following =
    after === null ? 0 : rows.findIndex((row) => before(row, { ...row, ...after }) > 0);
  const start = following === -1 ? rows.length : following;
  const page = rows.slice(start, start + limit);
  const last = page.at(-1);
  return {
    items: page.map(({ rank: _rank, seconds: _seconds, ...item }) => item),
    next: last !== undefined && start + limit < rows.length ? cursorOf(last) : null,
    ...(cut ? { totalAtLeast: rows.length } : { total: rows.length }),
  };
};

export interface RefCounts {
  readonly branches: number;
  readonly tags: number;
}

/** How many branches and tags a person can pick; a name GitHub and Mate both hold counts once. */
export const countRefs = async (
  git: GitRunner,
  dir: string,
  signal: AbortSignal,
): Promise<RefCounts> => {
  const read = await git.prefix(
    ["-C", dir, "for-each-ref", "--format=%(refname)", "refs/heads/", "refs/tags/", "refs/github/"],
    signal,
    16 * 1024 * 1024,
  );
  const branches = new Set<string>();
  const tags = new Set<string>();
  for (const ref of read.bytes.toString().split("\n")) {
    const named = refOf(ref);
    if (named === null) continue;
    (named.kind === "tag" || named.kind === "github-tag" ? tags : branches).add(named.name);
  }
  return { branches: branches.size, tags: tags.size };
};
