/**
 * The Git browser's reads, one line each: what each asks (its query, encoded into the URL's search
 * parameters) and what it answers. `HqApi.gitBrowse`, the `hqGitBrowse` family and the web hook
 * read this table, so a new read touches none of them.
 *
 * @module zerops/gitBrowse/reads
 */
import * as Schema from "effect/Schema";
import { grepRead } from "./grep.ts";
import { homeRead } from "./home.ts";
import { logRead } from "./log.ts";
import { pathsRead } from "./paths.ts";
import { refsRead } from "./refs.ts";

export const GIT_BROWSE_READS = {
  home: homeRead,
  refs: refsRead,
  log: logRead,
  paths: pathsRead,
  grep: grepRead,
} as const;

export type GitBrowseRead = keyof typeof GIT_BROWSE_READS;
export type GitBrowseParams<R extends GitBrowseRead> =
  (typeof GIT_BROWSE_READS)[R]["query"]["Type"];
export type GitBrowseValue<R extends GitBrowseRead = GitBrowseRead> =
  (typeof GIT_BROWSE_READS)[R]["value"]["Type"];

/** A read's parameters as its URL carries them, in one order whatever order they were given in. */
export const gitBrowseSearch = <R extends GitBrowseRead>(read: R, params: GitBrowseParams<R>) => {
  const query = GIT_BROWSE_READS[read].query as Schema.Codec<
    GitBrowseParams<R>,
    Readonly<Record<string, string | undefined>>
  >;
  const encoded = Schema.encodeSync(query)(params);
  return new URLSearchParams(
    Object.entries(encoded)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
};

export const gitBrowsePath = <R extends GitBrowseRead>(
  read: R,
  appId: string,
  repo: string,
  params: GitBrowseParams<R>,
) =>
  `/api/apps/${encodeURIComponent(appId)}/repos/${encodeURIComponent(repo)}/browse/${read}?${gitBrowseSearch(read, params)}`;
