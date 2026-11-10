/**
 * Which of a place's doors a line that names it offers (an overview card, the project page): its
 * Sites where it serves at an address, as its Vault is offered by `placeVaultOf`. A Git target, a
 * tier not added yet and a place nothing is deployed to have no Sites: a door to nothing is not
 * shown.
 *
 * Pure: no React.
 */
import type { GroupFlow } from "@t3tools/client-runtime/zerops";

import type { PlaceLine } from "../projects/projectCard.logic";
import { placeLineAddress } from "../system/PlaceLine.logic";

/** A place whose Sites a door opens: which of its project's places, by its Zerops project. */
export interface PlaceSitesDoor {
  readonly groupId: string;
  readonly kind: PlaceLine["kind"];
  readonly projectId: string;
}

/** A Mate whose Sites a door opens: its own previews, by its Zerops project. */
export interface MateSitesDoor {
  readonly groupId: string;
  readonly mateProjectId: string;
}

/** A place line's Sites, where it has any. */
export function placeSitesOf(
  line: Pick<PlaceLine, "projectId" | "git" | "kind" | "addresses" | "nothingDeployed">,
  groupId: string,
): PlaceSitesDoor | undefined {
  return line.projectId === undefined ||
    line.git !== undefined ||
    placeLineAddress(line) === undefined
    ? undefined
    : { groupId, kind: line.kind, projectId: line.projectId };
}

/**
 * Whether a project answers anywhere: a place of it serves at an address, or a Mate of it has a
 * part with a preview or a workspace to open. Without one its page offers no Sites.
 */
export function projectAnswers(
  lines: ReadonlyArray<Pick<PlaceLine, "kind" | "addresses" | "nothingDeployed">>,
  mates: GroupFlow["mates"],
): boolean {
  return (
    lines.some((line) => placeLineAddress(line) !== undefined) ||
    mates.some((mate) =>
      (mate.parts ?? []).some(
        (part) =>
          part.preview?.url !== undefined || part.dev.some((entry) => entry.url !== undefined),
      ),
    )
  );
}
