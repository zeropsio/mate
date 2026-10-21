/** One Git browser read's answer, scoped to its repository, read and parameters. */
import {
  gitBrowseSearch,
  type GitBrowseParams,
  type GitBrowseRead,
  type GitBrowseValue,
} from "../../zerops/gitBrowse/reads.ts";
import type { LinkKey, ScopeKey } from "../model.ts";
import type { FamilySpec } from "./spec.ts";

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqGitBrowse: GitBrowseValue;
  }
}

export interface GitBrowseKey<R extends GitBrowseRead = GitBrowseRead> {
  readonly orgId: string;
  readonly appId: string;
  readonly repo: string;
  readonly read: R;
  readonly params: GitBrowseParams<R>;
}

export const gitBrowseId = ({ orgId, appId, repo, read, params }: GitBrowseKey): string => {
  // Parameters HQ refuses still name one read: its refusal is shown where it was asked.
  const search = gitBrowseSearch(read, params);
  return JSON.stringify([orgId, appId, repo, read, search?.toString() ?? { refused: params }]);
};
export const gitBrowseScope = (key: GitBrowseKey): ScopeKey =>
  `hq:${key.orgId}:git-browse:${gitBrowseId(key)}`;
/** The read's own connection: where a failed read that is tried again keeps its fault. */
export const gitBrowseLink = (key: GitBrowseKey): LinkKey =>
  `hq:git-browse-${encodeURIComponent(gitBrowseId(key))}`;

export const hqGitBrowseFamily: FamilySpec<"hqGitBrowse"> = {
  family: "hqGitBrowse",
  authority: "hq",
  scope: {
    source: "hq",
    suffix: "git-browse",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};
