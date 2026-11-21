import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";

import type { ZeropsMateDirectory } from "../../zerops/mateIdentities";

export interface OpenableMate {
  readonly projectId: string;
  readonly name: string;
  readonly project: string | undefined;
}

/** What a page that reads one Mate says while no Mate is open: the way on is to open one. */
export type MatesWithoutOpenMate =
  | { readonly kind: "finding" }
  | { readonly kind: "connecting" }
  | { readonly kind: "open"; readonly mates: ReadonlyArray<OpenableMate> };

export function matesWithoutOpenMate(input: {
  readonly isReady: boolean;
  readonly phases: ReadonlyArray<EnvironmentConnectionPhase>;
  readonly directory: ZeropsMateDirectory;
}): MatesWithoutOpenMate {
  if (!input.isReady) return { kind: "finding" };
  if (input.phases.some((phase) => phase === "connecting" || phase === "reconnecting")) {
    return { kind: "connecting" };
  }
  const mates = new Map<string, OpenableMate>();
  for (const mate of input.directory.values()) {
    if (mate === null || mate.projectId === undefined || mates.has(mate.projectId)) continue;
    mates.set(mate.projectId, {
      projectId: mate.projectId,
      name: mate.name,
      project: mate.project,
    });
  }
  return {
    kind: "open",
    mates: [...mates.values()].toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}
