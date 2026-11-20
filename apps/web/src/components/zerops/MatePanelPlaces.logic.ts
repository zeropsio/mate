import { ENVIRONMENT_NOT_ADDED } from "@t3tools/client-runtime/zerops/groupEnvironments";

import type { PlaceLine } from "./projects/projectCard.logic";

/** "Dana's services", "Acme Notes' page": a name's own thing, as English writes it. */
export function possessive(name: string, thing: string): string {
  return `${name}${/s$/iu.test(name) ? "'" : "'s"} ${thing}`;
}

/**
 * The places a Mate's panels list in their project card, with a line where a stage would stand
 * when the project has none: production first, as the project's pages do, the same in every panel.
 */
export function panelPlaces(places: ReadonlyArray<PlaceLine>): ReadonlyArray<PlaceLine> {
  const stages = places.filter((line) => line.kind === "stage");
  const production = places.filter((line) => line.kind === "production");
  const shown: ReadonlyArray<PlaceLine> =
    stages.length > 0
      ? stages
      : [
          {
            kind: "stage",
            name: "stage",
            projectId: undefined,
            addresses: [],
            dot: "none",
            words: [ENVIRONMENT_NOT_ADDED],
            trouble: false,
            nothingDeployed: true,
          },
        ];
  return [...production, ...shown];
}
