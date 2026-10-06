/** Recipe projections from the account's HQ stream, with an explicit manual reread on failure. */
import { useAtomValue } from "@effect/atom-react";
import { appRecipeOf, type AppRecipe } from "@t3tools/client-runtime/zerops";
import type { AppReadValue } from "@t3tools/shared/hqAppReads";
import { hqRefusalWords } from "@t3tools/client-runtime/zerops/hq";
import { useMemo } from "react";

import { hqAppReadsAtom } from "../state/zerops";
import { useAccountDataOptional } from "./ZeropsAccountData";

/** Cache only the pure projection: an unrelated app's move preserves this recipe's identity. */
const projections = new WeakMap<AppReadValue, AppRecipe>();

export function useZeropsAppRecipes(): ReadonlyMap<string, AppRecipe> {
  const reads = useAtomValue(hqAppReadsAtom);
  return useMemo(() => {
    const recipes = new Map<string, AppRecipe>();
    // Missing keys mean unread; only HQ's explicit absent tiers earn a negative.
    if (reads === null) return recipes;
    for (const [appId, { value }] of reads) {
      if (value === null) continue;
      let recipe = projections.get(value);
      if (recipe === undefined) {
        const { stage, production } = value.recipes;
        recipe = appRecipeOf({
          stage: stage.state === "present" ? stage.importYaml : null,
          production: production.state === "present" ? production.importYaml : null,
        });
        projections.set(value, recipe);
      }
      recipes.set(appId, recipe);
    }
    return recipes;
  }, [reads]);
}

/** A failed streamed recipe remains unavailable, with one reader-owned snapshot request. */
export function useZeropsRecipeFailure(
  appId: string,
): { readonly reason: string; readonly again: () => void } | undefined {
  const read = useAtomValue(hqAppReadsAtom)?.get(appId);
  const retry = useAccountDataOptional()?.retry;
  if (read === undefined || read.failure === null || retry === undefined) return undefined;
  return {
    reason: hqRefusalWords({ code: read.failure.code, reason: read.failure.reason ?? undefined }),
    again: retry,
  };
}
