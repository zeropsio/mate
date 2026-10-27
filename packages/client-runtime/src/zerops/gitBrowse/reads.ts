/**
 * The Git browser's reads, one line each: what each asks (its query, encoded into the URL's search
 * parameters) and what it answers. `HqApi.gitBrowse`, the `hqGitBrowse` family and the web hook
 * read this table, so a new read touches none of them. A read of `bytes` answers a `Blob` of at
 * most its `limit` through `HqApi.gitBrowseBytes`; every other one JSON through `HqApi.gitBrowse`.
 *
 * @module zerops/gitBrowse/reads
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { blameRead } from "./blame.ts";
import { archiveRead } from "./archive.ts";
import { blobRead } from "./blob.ts";
import { commitFileRead, commitRead } from "./commit.ts";
import { compareFileRead, compareRead } from "./compare.ts";
import { grepRead } from "./grep.ts";
import { homeRead } from "./home.ts";
import { logRead } from "./log.ts";
import { rawRead } from "./raw.ts";
import { pathsRead } from "./paths.ts";
import { refsRead } from "./refs.ts";
import { treeRead } from "./tree.ts";

export const GIT_BROWSE_READS = {
  home: homeRead,
  refs: refsRead,
  log: logRead,
  tree: treeRead,
  blob: blobRead,
  raw: rawRead,
  commit: commitRead,
  "commit-file": commitFileRead,
  compare: compareRead,
  "compare-file": compareFileRead,
  paths: pathsRead,
  grep: grepRead,
  blame: blameRead,
  archive: archiveRead,
} as const;

export type GitBrowseRead = keyof typeof GIT_BROWSE_READS;
export type GitBrowseParams<R extends GitBrowseRead> =
  (typeof GIT_BROWSE_READS)[R]["query"]["Type"];
export type GitBrowseValue<R extends GitBrowseRead = GitBrowseRead> =
  (typeof GIT_BROWSE_READS)[R]["value"]["Type"];
/** The reads that answer bytes. */
export type GitBrowseBytesRead = {
  [R in GitBrowseRead]: (typeof GIT_BROWSE_READS)[R] extends { readonly bytes: unknown }
    ? R
    : never;
}[GitBrowseRead];

/**
 * A read's parameters as its URL carries them, in one order whatever order they were given in;
 * none for parameters HQ refuses as `invalid` (an empty `rev` or one read as an option, a filter or
 * cursor past its length), which no URL is built for.
 */
export const gitBrowseSearch = <R extends GitBrowseRead>(read: R, params: GitBrowseParams<R>) => {
  const query = GIT_BROWSE_READS[read].query as Schema.Codec<
    GitBrowseParams<R>,
    Readonly<Record<string, string | undefined>>
  >;
  const encoded = Schema.encodeOption(query)(params);
  if (Option.isNone(encoded)) return null;
  return new URLSearchParams(
    Object.entries(encoded.value)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
};

/** A read's address; none where HQ would refuse its parameters as `invalid`. */
export const gitBrowsePath = <R extends GitBrowseRead>(
  read: R,
  appId: string,
  repo: string,
  params: GitBrowseParams<R>,
) => {
  const search = gitBrowseSearch(read, params);
  return search === null
    ? null
    : `/api/apps/${encodeURIComponent(appId)}/repos/${encodeURIComponent(repo)}/browse/${read}?${search}`;
};
