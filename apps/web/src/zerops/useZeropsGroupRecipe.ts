/**
 * The tier a new environment starts from, read out of the group repo **as the
 * person** (guide 4.3).
 *
 * The recipe is not a Zerops object and never was: it is `import.yaml` in the
 * group repo, proposed by a Mate and merged by somebody with production rights
 * (D13). So this reads `{slug}/group` on `main` with the person's own Gitea
 * token — Gitea enforces their mirrored rights, and a person who cannot see the
 * repository sees no recipe rather than somebody else's.
 *
 * What comes back is already import-ready (`importReadyTier`): every
 * `buildFromGit` + `zeropsSetup` converted to `startWithoutCode`, with the map
 * of which repository each service's code lives in carried alongside for zcp's
 * adoption.
 *
 * Three honest answers, and the dialog says a different thing for each:
 * `loading` while the repository is being read, a tier, or `undefined` — no
 * Gitea session, no group org yet, no `main`, or no recipe merged.
 */

import {
  importReadyTier,
  RECIPE_TIER_PATHS,
  type EnvironmentRecipeChoice,
  type RecipeTier,
} from "@t3tools/client-runtime/zerops";
import { useEffect, useState } from "react";

import { giteaClientFor } from "./giteaSession";

export type GroupRecipeTier = Extract<EnvironmentRecipeChoice, { kind: "tier" }>;

export interface GroupRecipe {
  readonly tier: GroupRecipeTier | undefined;
  readonly services: ReadonlyArray<string>;
  readonly loading: boolean;
}

const NOTHING: GroupRecipe = { tier: undefined, services: [], loading: false };

/** The group repo of a group, by its slug. */
export const GROUP_REPOSITORY_NAME = "group";

export function useZeropsGroupRecipe(input: {
  /** Gitea's public origin, or `undefined` while the account has none. */
  readonly giteaOrigin: string | undefined;
  /** The group's Gitea org — its registry slug. */
  readonly slug: string | undefined;
  readonly tier: RecipeTier;
  readonly enabled: boolean;
}): GroupRecipe {
  const { enabled, giteaOrigin, slug, tier } = input;
  const [answer, setAnswer] = useState<{ readonly key: string; readonly recipe: GroupRecipe }>({
    key: "",
    recipe: NOTHING,
  });
  const key =
    enabled && giteaOrigin !== undefined && slug !== undefined
      ? `${giteaOrigin}|${slug}|${tier}`
      : "";

  useEffect(() => {
    if (key === "" || giteaOrigin === undefined || slug === undefined) return;
    const client = giteaClientFor(giteaOrigin);
    // Not signed in to Gitea in this tab: not a failure to report here — the
    // dialog offers an empty environment, and the recipe appears once they are.
    if (client === null) {
      setAnswer({ key, recipe: NOTHING });
      return;
    }
    let cancelled = false;
    setAnswer({ key, recipe: { ...NOTHING, loading: true } });
    void client
      .readFile(slug, GROUP_REPOSITORY_NAME, RECIPE_TIER_PATHS[tier], "main")
      .then((file) => {
        if (cancelled) return;
        const ready = file === undefined ? undefined : importReadyTier(file.content);
        setAnswer({
          key,
          recipe:
            ready === undefined
              ? NOTHING
              : {
                  tier: { kind: "tier", tier, yaml: ready.yaml, sources: ready.sources },
                  services: ready.services,
                  loading: false,
                },
        });
      })
      .catch(() => {
        if (!cancelled) setAnswer({ key, recipe: NOTHING });
      });
    return () => {
      cancelled = true;
    };
  }, [giteaOrigin, key, slug, tier]);

  if (key === "") return NOTHING;
  return answer.key === key ? answer.recipe : { ...NOTHING, loading: true };
}
