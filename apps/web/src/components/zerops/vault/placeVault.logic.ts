/**
 * Which places offer their vault from a line that names them (an overview card, the project page):
 * a place that is a Zerops project the account lists. A Git target has no vault here, and a missing
 * tier has nothing to hold one.
 *
 * Pure: no React.
 */
import type { GroupFlow } from "@t3tools/client-runtime/zerops";

import { placeLabel, placeLines, type PlaceLine } from "../projects/projectCard.logic";

export interface PlaceVault {
  /** The place's Zerops project. */
  readonly projectId: string;
  /** The place as its line names it (`Production`, `Stage`), or a Mate's name on its card. */
  readonly name: string;
  /**
   * A Mate's workspace: its conversation's environment, where it has one. Its vault is then the
   * Mate's own panel, which tells the Mate each write; a place has no Mate to tell.
   */
  readonly environmentId?: string | undefined;
}

/** A place line's vault, where it has one. */
export function placeVaultOf(
  line: Pick<PlaceLine, "projectId" | "git" | "kind" | "name">,
): PlaceVault | undefined {
  return line.projectId === undefined || line.git !== undefined
    ? undefined
    : { projectId: line.projectId, name: placeLabel(line) };
}

/** A project's place vaults, production first, then each stage in the flow's order. */
export function placeVaults(
  flow: Pick<GroupFlow, "production" | "stages">,
  nowMs: number,
): ReadonlyArray<PlaceVault> {
  const lines = placeLines({ flow, nowMs });
  return [
    ...lines.filter((line) => line.kind === "production"),
    ...lines.filter((line) => line.kind === "stage"),
  ].flatMap((line) => {
    const vault = placeVaultOf(line);
    return vault === undefined ? [] : [vault];
  });
}
