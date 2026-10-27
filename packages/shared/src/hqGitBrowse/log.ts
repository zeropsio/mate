/**
 * `log?sha=&path=&cursor=&limit=`: the commits reachable from one commit, newest first, a page at
 * a time — of the whole repository, or only those that touched `path`. Every page continues from
 * the commit the first page started at, so a branch that moves meanwhile never reorders a list.
 *
 * @module hqGitBrowse/log
 */
import * as Schema from "effect/Schema";
import { Sha } from "../hqChanges.ts";
import { GitPath } from "./common.ts";

/** Commits a page holds at most. */
export const LOG_PAGE_LIMIT = 100;
/** Commits a list reads at most, all its pages together. */
export const LOG_HISTORY_LIMIT = 10_000;

/** `<tip>:<offset>`: where the next page starts, in the list the first page started at `tip`. */
const LogCursor = Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64}):\d{1,5}$/u));

export const GitLogQuery = Schema.Struct({
  sha: Sha,
  path: Schema.optionalKey(GitPath),
  cursor: Schema.optionalKey(LogCursor),
  limit: Schema.optionalKey(
    Schema.FiniteFromString.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(LOG_PAGE_LIMIT),
    ),
  ),
}).check(
  Schema.makeFilter((query) =>
    query.cursor !== undefined && !query.cursor.startsWith(`${query.sha}:`)
      ? "Expected a cursor of the list this commit starts"
      : undefined,
  ),
);
export type GitLogQuery = typeof GitLogQuery.Type;

export const GitLogItem = Schema.Struct({
  sha: Sha,
  parents: Schema.Array(Sha),
  subject: Schema.String,
  authorName: Schema.String,
  authoredAt: Schema.String,
  committedAt: Schema.String,
  /** The change whose merge wrote this commit, from the `Mate-Change` trailer HQ writes. */
  change: Schema.optionalKey(Schema.Struct({ mateId: Schema.String, number: Schema.Int })),
});
export type GitLogItem = typeof GitLogItem.Type;

export const GitLog = Schema.Struct({
  items: Schema.Array(GitLogItem),
  /** The cursor of the next page; none after the last. */
  next: Schema.NullOr(LogCursor),
  /** The last commit of a path's whole history added the path: what came before is not followed. */
  addsPath: Schema.Boolean,
  /** The list stopped at {@link LOG_HISTORY_LIMIT} commits with older ones left unread. */
  stopped: Schema.Boolean,
});
export type GitLog = typeof GitLog.Type;
