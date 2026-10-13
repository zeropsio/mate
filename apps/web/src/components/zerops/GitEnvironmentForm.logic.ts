import type { HqGitAdoption, RepoListEntry } from "@t3tools/shared/hqChanges";
import { HqGitBranch } from "@t3tools/shared/hqEnvironment";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import * as Schema from "effect/Schema";

/** The streamed roster owns connectivity; an operation answer never invents a repository. */
export function gitSetupRepositories(repos: ReadonlyArray<RepoListEntry> | undefined) {
  if (repos === undefined) return undefined;
  return repos
    .filter((repo) => repo.name !== RECIPE_REPO)
    .map((repo) => ({
      repo,
      leftOut:
        repo.remote == null
          ? "No verified remote connected."
          : repo.remote.invalidSince !== null
            ? "The remote refused its token. Replace it before adding this repository."
            : undefined,
    }));
}

export const gitSetupBranchValid = Schema.is(HqGitBranch);

/** Any changed tip, identity, branch or included roster needs the person's review again. */
export function gitSetupReview(
  repos: ReadonlyArray<RepoListEntry> | undefined,
  branch: string,
  adoption: ReadonlyArray<HqGitAdoption> | undefined,
): "unread" | "empty" | "needed" | "stale" | "ready" {
  const roster = gitSetupRepositories(repos);
  if (roster === undefined) return "unread";
  const included = roster.filter((entry) => entry.leftOut === undefined);
  if (included.length === 0) return "empty";
  if (adoption === undefined) return "needed";
  if (
    adoption.length !== included.length ||
    new Set(adoption.map((entry) => entry.repo)).size !== adoption.length
  )
    return "stale";
  return included.every(({ repo }) =>
    adoption.some(
      (review) =>
        review.repo === repo.name &&
        review.branch === branch &&
        review.mainHead === repo.mainHead &&
        review.remote.url === repo.remote?.url &&
        review.remote.repositoryId === repo.remote?.repositoryId,
    ),
  )
    ? "ready"
    : "stale";
}

export function gitAdoptionSentence(review: HqGitAdoption): string {
  const where = `${review.remote.url} ${review.branch}`;
  return review.changedFiles === 0
    ? `The first push changes nothing on ${where}.`
    : `The first push changes ${review.changedFiles} files on ${where}. Mate's copy wins.`;
}

export function gitSetupExpiry(expiresAt: string | null): string {
  return expiresAt === null ? "Expiry not reported" : `Token expires ${expiresAt}`;
}
