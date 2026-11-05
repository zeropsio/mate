/**
 * Whether a Zerops project is one of an application's shared environments, Stage or Production,
 * as HQ's structure lists them: what an ask's chip names, and what makes its press red.
 */
import { useAtomValue } from "@effect/atom-react";
import type { CanonicalHqStructure } from "@t3tools/client-runtime/zerops/hq";

import { hqNavigationAtom } from "../state/zerops";

export type EnvironmentTier = "stage" | "production";

/** The tier of the environment `projectId` is; `null` for any other project, or before HQ says. */
export function environmentTierOf(
  structure: CanonicalHqStructure | null,
  projectId: string,
): EnvironmentTier | null {
  for (const app of structure?.apps ?? []) {
    const environments = app.environments;
    if (environments === undefined || "refused" in environments) continue;
    const found = environments.find(
      (environment) =>
        environment.target.kind === "zerops" && environment.target.projectId === projectId,
    );
    if (found !== undefined) return found.tier;
  }
  return null;
}

/** `environmentTierOf` over the organization in view. */
export function useEnvironmentTier(projectId: string | undefined): EnvironmentTier | null {
  const structure = useAtomValue(hqNavigationAtom).structure;
  return projectId === undefined ? null : environmentTierOf(structure, projectId);
}
