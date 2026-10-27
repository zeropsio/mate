/**
 * What HQ names an app version (main B16): the label a person reads it by — a stage's branch, a
 * production's release tag — and the commit's short sha, "main 7e2d4c1". What a service runs is
 * the version HQ made for a commit, as HQ recorded it (`deploys.ts`, audit N7), never what a name
 * spells.
 *
 * @module versionNames
 */

/** The seven hex a new name carries, as git and the client show them. */
const SHORT = 7;

export const versionName = (label: string, sha: string): string =>
  `${label} ${sha.slice(0, SHORT)}`;
