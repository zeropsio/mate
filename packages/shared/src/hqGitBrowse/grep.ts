/**
 * `grep?sha=&q=&path=&mode=&case=`: the lines of files at a commit that hold a text, read by
 * `git grep` with no index — bounded in matches, per file, per line and in time.
 *
 * @module hqGitBrowse/grep
 */
import * as Schema from "effect/Schema";
import { Sha } from "../hqChanges.ts";
import { GitPath } from "./common.ts";

/** Matches an answer holds at most; past them it says it is cut. */
export const GREP_MATCH_LIMIT = 500;
/** Matches one file gives at most. */
export const GREP_FILE_MATCH_LIMIT = 20;
/** Characters of a matching line an answer carries. */
export const GREP_LINE_CHARS = 500;
/** How long a search reads before it answers with what it found. */
export const GREP_DEADLINE_MS = 10_000;
export const GREP_QUERY_MIN = 2;
export const GREP_QUERY_MAX = 200;

export const GitGrepQuery = Schema.Struct({
  sha: Sha,
  q: Schema.String.check(
    Schema.isMinLength(GREP_QUERY_MIN),
    Schema.isMaxLength(GREP_QUERY_MAX),
    Schema.makeFilter((q: string) =>
      /[\n\r\0]/u.test(q) ? "Expected one line of text" : undefined,
    ),
  ),
  /** A folder or file the search stays in; absent, the whole repository. */
  path: Schema.optionalKey(GitPath),
  /** `fixed` (absent) reads `q` as text, `regex` as an extended regular expression. */
  mode: Schema.optionalKey(Schema.Literals(["fixed", "regex"])),
  /** `1` matches case exactly; absent or `0` ignores it. */
  case: Schema.optionalKey(Schema.Literals(["0", "1"])),
});
export type GitGrepQuery = typeof GitGrepQuery.Type;

const Offset = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const GitGrepMatch = Schema.Struct({
  path: Schema.String,
  /** 1-based. */
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  /** The line's first {@link GREP_LINE_CHARS} characters. */
  text: Schema.String,
  /** Where `text` matches, in its UTF-16 offsets; empty where the pattern is git's alone. */
  ranges: Schema.Array(Schema.Struct({ start: Offset, end: Offset })),
});
export type GitGrepMatch = typeof GitGrepMatch.Type;

export const GitGrep = Schema.Struct({
  /** In path order, then line order. */
  matches: Schema.Array(GitGrepMatch),
  /** More matches than {@link GREP_MATCH_LIMIT}. */
  truncated: Schema.Boolean,
  /** The search stopped at its deadline: `matches` is what it found until then. */
  deadlineHit: Schema.Boolean,
});
export type GitGrep = typeof GitGrep.Type;
