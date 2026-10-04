/** Human release names and optional suggestions; HQ decides again under its release lock. */
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { compareReleaseTags, releaseTagOfVersion } from "@t3tools/shared/hqRelease";

export function releaseVersionField(
  value: string,
  tags: ReadonlyArray<string>,
): {
  readonly tag: string | undefined;
  readonly error: string | undefined;
} {
  const tag = releaseTagOfVersion(value);
  if (tag === undefined)
    return {
      tag,
      error: value.trim() === "" ? "Enter a version." : "Use major.minor.patch, for example 1.0.0.",
    };
  const newest = [...tags].sort((a, b) => compareReleaseTags(b, a))[0];
  return {
    tag,
    error:
      newest !== undefined && compareReleaseTags(tag, newest) <= 0
        ? `Choose a version newer than ${newest}.`
        : undefined,
  };
}

export interface ReleaseVersionSuggestion {
  readonly tag: string;
  readonly source: string;
}

export function releaseVersionSuggestions(input: {
  readonly repos: ReadonlyArray<RepoListEntry>;
  readonly repositories: ReadonlyMap<string, string>;
  readonly tags: ReadonlyArray<string>;
}): ReadonlyArray<ReleaseVersionSuggestion> {
  const relevant = new Set([RECIPE_REPO, ...input.repositories.values()]);
  return input.repos.flatMap((repo) => {
    const declared = repo.releaseVersion;
    if (!relevant.has(repo.name) || repo.mainHead === null || declared === undefined) return [];
    const checked = releaseVersionField(declared.tag, input.tags);
    return checked.tag === undefined || checked.error !== undefined
      ? []
      : [
          {
            tag: checked.tag,
            source: `${repo.name}/${declared.path}`,
          },
        ];
  });
}
