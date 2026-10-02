/**
 * What each application's recipe on `main` offers — the tiers a person can add, and the repository
 * each runtime builds from (`appRecipeOf`) — read through the organization's official HQ as the
 * person, for every application the flows show.
 *
 * Two reads per application, its stage's tier and its production's: when it is first shown, and
 * again once a change of its recipe lands (`revision`). A read that fails says nothing of the
 * recipe: what was read before stands, and the next landing reads it again. Until one answers, the
 * application has no recipe here, and nothing asks for a tier it may not offer.
 */
import { appRecipeOf, type AppRecipe } from "@t3tools/client-runtime/zerops";
import type { RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import { useEffect, useRef, useState } from "react";

import { useOfficialHq } from "./accountHq";

/** A tier's import file as `main` holds it; `null` where it holds none. */
const fileOf = (read: RecipeTierResponse): string | null =>
  read.state === "present" ? read.importYaml : null;

export function useZeropsAppRecipes(input: {
  /** Each application shown, by id, with its recipe's newest landed change while it is known. */
  readonly apps: ReadonlyMap<string, string | undefined>;
  readonly enabled: boolean;
}): ReadonlyMap<string, AppRecipe> {
  const hq = useOfficialHq();
  const [recipes, setRecipes] = useState<ReadonlyMap<string, AppRecipe>>(() => new Map());
  /** The read each application has out, by the key it was read for. */
  const reading = useRef(
    new Map<string, { readonly key: string; readonly stop: AbortController }>(),
  );
  const apps = JSON.stringify([...input.apps]);

  useEffect(() => {
    if (!input.enabled || hq === null) return;
    for (const [appId, revision] of JSON.parse(apps) as ReadonlyArray<
      readonly [string, string | null]
    >) {
      const key = `${hq.address}|${revision ?? ""}`;
      const out = reading.current.get(appId);
      if (out?.key === key) continue;
      out?.stop.abort();
      const stop = new AbortController();
      reading.current.set(appId, { key, stop });
      void (async () => {
        try {
          const [stage, production] = await Promise.all([
            hq.api.recipeTier(appId, "stage", stop.signal),
            hq.api.recipeTier(appId, "production", stop.signal),
          ]);
          if (stop.signal.aborted) return;
          const recipe = appRecipeOf({ stage: fileOf(stage), production: fileOf(production) });
          setRecipes((current) => new Map(current).set(appId, recipe));
        } catch {
          // Not read: the key goes, so the application is read again on the next pass.
          if (reading.current.get(appId)?.stop === stop) reading.current.delete(appId);
        }
      })();
    }
  }, [apps, hq, input.enabled]);

  useEffect(() => {
    const out = reading.current;
    return () => {
      for (const { stop } of out.values()) stop.abort();
      out.clear();
    };
  }, []);

  return recipes;
}
