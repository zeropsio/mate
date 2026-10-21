/**
 * `home`: a repository's home at the commit `rev` names now (`@t3tools/shared/hqGitBrowse/home`).
 * It moves with its ref: read again on an explicit ask or a new visit, never on a timer.
 *
 * @module zerops/gitBrowse/home
 */
import { GitHome, GitHomeQuery } from "@t3tools/shared/hqGitBrowse/home";

export const homeRead = { query: GitHomeQuery, value: GitHome, moving: true } as const;

/** The GitHub page of a mounted repository, from the remote HQ follows. */
export const githubRepositoryUrl = (remote: { readonly url: string }) =>
  remote.url.replace(/\.git$/u, "");
