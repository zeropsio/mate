/**
 * What each application's recipe on `main` offers — the tiers a person can add, and the repository
 * each runtime builds from (`appRecipeOf`) — read through the organization's official HQ as the
 * person, for every application the flows show.
 *
 * Two reads per application, its stage's tier and its production's: when it is first shown, and
 * again once a change of its recipe lands (`revision`). A read that fails says nothing of the
 * recipe: what was read before stands, and it is asked again a minute later ({@link
 * RECIPES_RETRY_MS}) — HQ refuses while a Core takes over or the door's budget is spent, and a page
 * left without a recipe offered no production for its whole life (F20). Until one answers, the
 * application has no recipe here, and nothing asks for a tier it may not offer.
 */
import { appRecipeOf, type AppRecipe } from "@t3tools/client-runtime/zerops";
import type { RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import { useEffect, useRef, useState } from "react";

import { useOfficialHq } from "./accountHq";

/** How long a recipe HQ did not answer waits before it is asked again. */
export const RECIPES_RETRY_MS = 60_000;

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
    new Map<
      string,
      {
        key: string;
        revision: string | null;
        readonly address: string;
        readonly stop: AbortController;
      }
    >(),
  );
  // Each application's attempt, moved on a minute after its read failed: the read is due again.
  const [attempts, setAttempts] = useState<ReadonlyMap<string, number>>(() => new Map());
  const retries = useRef(new Set<ReturnType<typeof setTimeout>>());
  const apps = JSON.stringify([...input.apps]);

  useEffect(() => {
    if (!input.enabled || hq === null) return;
    for (const [appId, suppliedRevision] of JSON.parse(apps) as ReadonlyArray<
      readonly [string, string | null]
    >) {
      const out = reading.current.get(appId);
      const sameHq = out?.address === hq.address;
      const revision = suppliedRevision ?? (sameHq ? out.revision : null);
      const attempt = String(attempts.get(appId) ?? 0);
      const key = `${hq.address}|${revision ?? ""}|${attempt}`;
      // The first revision tells us what the bootstrap read was for. Only a later move
      // invalidates it, whether the pair is still in flight or has already answered.
      if (
        sameHq &&
        out.revision === null &&
        revision !== null &&
        out.key === `${hq.address}||${attempt}`
      ) {
        out.revision = revision;
        out.key = key;
      }
      if (out?.key === key) continue;
      out?.stop.abort();
      const stop = new AbortController();
      reading.current.set(appId, { key, revision, address: hq.address, stop });
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
          // Not read: the key goes, and a minute later its next attempt reads the application again.
          if (reading.current.get(appId)?.stop !== stop) return;
          reading.current.delete(appId);
          const timer = setTimeout(() => {
            retries.current.delete(timer);
            setAttempts((current) => new Map(current).set(appId, (current.get(appId) ?? 0) + 1));
          }, RECIPES_RETRY_MS);
          retries.current.add(timer);
        }
      })();
    }
  }, [apps, attempts, hq, input.enabled]);

  useEffect(() => {
    const out = reading.current;
    const timers = retries.current;
    return () => {
      for (const { stop } of out.values()) stop.abort();
      out.clear();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return recipes;
}
