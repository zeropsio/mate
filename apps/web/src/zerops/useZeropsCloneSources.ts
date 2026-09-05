/**
 * The siblings a new environment could be cloned from, with what each one
 * would give it.
 *
 * Reads every sibling's export once per dialog and keeps only the ones that
 * turn into a recipe: an environment that was only ever a container has
 * nothing to clone (`recipeExport.ts`). Secrets never reach this hook's
 * state — the transform strips them before anything is kept.
 */

import { useEffect, useState } from "react";

import { recipeFromProjectExport, type ExportedRecipe } from "@t3tools/client-runtime/zerops";

import { useZeropsSession } from "./ZeropsSessionProvider";

export interface ZeropsCloneSource {
  readonly projectId: string;
  readonly name: string;
  readonly agentName: string | undefined;
  readonly recipe: ExportedRecipe;
}

export interface ZeropsCloneSibling {
  readonly projectId: string;
  readonly name: string;
  readonly agentName: string | undefined;
}

export function useZeropsCloneSources(siblings: ReadonlyArray<ZeropsCloneSibling> | null): {
  readonly sources: ReadonlyArray<ZeropsCloneSource>;
  readonly loading: boolean;
} {
  const { client } = useZeropsSession();
  // The answer for one set of siblings; a different set is simply "not yet".
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly sources: ReadonlyArray<ZeropsCloneSource>;
  } | null>(null);
  const key = siblings === null ? "" : siblings.map((sibling) => sibling.projectId).join(",");

  // The caller memoizes `siblings` for the life of one dialog, so the array
  // is a fine dependency; `key` is what the answer is filed under.
  useEffect(() => {
    if (siblings === null || siblings.length === 0) return;
    let cancelled = false;
    void Promise.allSettled(
      siblings.map(async (sibling): Promise<ZeropsCloneSource | undefined> => {
        const recipe = recipeFromProjectExport(await client.exportProject(sibling.projectId));
        return recipe === undefined ? undefined : { ...sibling, recipe };
      }),
    ).then((results) => {
      if (cancelled) return;
      const sources = results.flatMap((result) =>
        result.status === "fulfilled" && result.value !== undefined ? [result.value] : [],
      );
      setAnswer({ key, sources });
    });
    return () => {
      cancelled = true;
    };
  }, [client, key, siblings]);

  if (siblings === null || siblings.length === 0) return { sources: [], loading: false };
  return answer !== null && answer.key === key
    ? { sources: answer.sources, loading: false }
    : { sources: [], loading: true };
}
