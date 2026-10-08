/** Route identities are HQ navigation joined to HQ overview, just as the menu names them. */
import { useAtomValue } from "@effect/atom-react";
import { shownHqMateIdentitiesAtom } from "@t3tools/client-runtime/data";
import { mateArrivingUntil } from "@t3tools/client-runtime/zerops";
import { candidateContainerRuns } from "@t3tools/client-runtime/zerops/candidates";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { heldCandidateRowsAtom } from "./useZeropsCandidates";
import { sameValue } from "../lib/sameValue";

import { zeropsEnvironmentsAtom } from "../state/zerops";
import {
  withEnvironmentsOutsideZerops,
  zeropsMateAt,
  type ZeropsMateAt,
  type ZeropsMateDirectory,
  type ZeropsMateIdentity,
} from "./mateIdentities";

export const zeropsMatesAtom = Atom.make((get): ZeropsMateDirectory => {
  const environments = get(zeropsEnvironmentsAtom);
  // Platform rows supply only the body, never the name, face, project or environment identity.
  const rows = get(heldCandidateRowsAtom);
  const bodies = new Map<string, Array<(typeof rows)[number]>>();
  for (const row of rows) {
    const held = bodies.get(row.project.id);
    if (held === undefined) bodies.set(row.project.id, [row]);
    else held.push(row);
  }
  const mates = new Map<EnvironmentId, ZeropsMateIdentity>();
  for (const mate of Object.values(get(shownHqMateIdentitiesAtom))) {
    if (mate.environmentId !== undefined) {
      const bodiesHere = bodies.get(mate.projectId) ?? [];
      const body =
        bodiesHere.find((row) => row.environmentId === mate.environmentId) ??
        (bodiesHere.length === 1 ? bodiesHere[0] : undefined);
      mates.set(mate.environmentId, {
        ...mate,
        ...(body === undefined
          ? {}
          : {
              serviceId: body.service?.id,
              running: candidateContainerRuns(body),
              arrivingUntil: mateArrivingUntil(body),
            }),
        connected: environments.some(
          (environment) =>
            environment.environmentId === mate.environmentId &&
            environment.connection.phase === "connected",
        ),
      });
    }
  }
  return withEnvironmentsOutsideZerops(mates, environments);
}).pipe(
  Atom.withEquality<ZeropsMateDirectory>((left, right) => sameValue([...left], [...right])),
  Atom.withLabel("zerops:mates"),
);

/** Every environment's answer, for a surface that names several (a picker). */
export function useZeropsMateDirectory(): ZeropsMateDirectory {
  return useAtomValue(zeropsMatesAtom);
}

export function useZeropsMate(environmentId: EnvironmentId): ZeropsMateAt {
  return zeropsMateAt(useZeropsMateDirectory(), environmentId);
}

/**
 * The Mate a page draws in `environmentId` now: undefined until the directory names one there,
 * so a page holds its place and never wears a guessed face.
 */
export function useKnownMate(environmentId: EnvironmentId): ZeropsMateIdentity | undefined {
  const at = useZeropsMate(environmentId);
  return at.kind === "mate" ? at.mate : undefined;
}

/**
 * Whether a Mate lives in `environmentId`: null while that is not known, for
 * a surface that must not guess either way meanwhile.
 */
export function useZeropsMateEnvironment(environmentId: EnvironmentId): boolean | null {
  const mate = useZeropsMate(environmentId);
  return mate.kind === "unknown" ? null : mate.kind === "mate";
}
