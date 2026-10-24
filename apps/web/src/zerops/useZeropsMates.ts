/** Route identities are HQ navigation joined to HQ overview, just as the menu names them. */
import { useAtomValue } from "@effect/atom-react";
import {
  shownHqMateIdentitiesAtom,
  shownHqMenuNavigationAtom,
  shownHqMateDirectoryAtom,
  isListedMateProject,
} from "@t3tools/client-runtime/data";
import { mateArrivingUntil } from "@t3tools/client-runtime/zerops";
import { candidateContainerRuns } from "@t3tools/client-runtime/zerops/candidates";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";

import { allCandidateListingAtom } from "./useZeropsCandidates";
import {
  readMateMemory,
  rememberMates,
  seededIdentities,
  writeMateMemory,
} from "./mateIdentityMemory";
import { sameValue } from "../lib/sameValue";

import { zeropsEnvironmentsAtom } from "../state/zerops";
import {
  withEnvironmentsOutsideZerops,
  zeropsMateAt,
  type ZeropsMateAt,
  type ZeropsMateDirectory,
  type ZeropsMateIdentity,
} from "./mateIdentities";

/**
 * The one environment whose server says it serves a Zerops project — the connected one where
 * several do; none where that does not settle it.
 */
export function environmentServing(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly zeropsProjectId?: string | null | undefined;
    readonly connection: { readonly phase: string };
  }>,
  projectId: string,
): EnvironmentId | undefined {
  const serving = environments.filter((environment) => environment.zeropsProjectId === projectId);
  if (serving.length === 1) return serving[0]!.environmentId;
  const connected = serving.filter((environment) => environment.connection.phase === "connected");
  return connected.length === 1 ? connected[0]!.environmentId : undefined;
}

export const zeropsMatesAtom = Atom.make((get): ZeropsMateDirectory => {
  const environments = get(zeropsEnvironmentsAtom);
  // Platform rows supply only the body, never the name, face, project or environment identity.
  const rows = heldCandidates(get(allCandidateListingAtom)).rows;
  const directory = get(shownHqMateDirectoryAtom);
  const chiefId = directory.chief.kind === "present" ? directory.chief.projectId : undefined;
  const bodies = new Map<string, Array<(typeof rows)[number]>>();
  for (const row of rows) {
    const held = bodies.get(row.project.id);
    if (held === undefined) bodies.set(row.project.id, [row]);
    else held.push(row);
  }
  const mates = new Map<EnvironmentId, ZeropsMateIdentity>();
  const named = Object.values(get(shownHqMateIdentitiesAtom));
  const listRead = get(shownHqMenuNavigationAtom).read === "read";
  // What the account's last visit had HQ name: the first frame paints it, HQ's answer replaces it.
  const memory = readMateMemory();
  const remembered = rememberMates(memory, named, listRead);
  if (remembered !== memory) writeMateMemory(remembered);
  for (const seeded of seededIdentities(named, remembered, listRead)) {
    // HQ names the Mate; its environment is the one its overview relays. Until that reaches HQ —
    // a Mate just up, its sign-in waiting — it is the one whose own server says it lives in the
    // Mate's project (run 2, 2026-10-16: an added Mate landed on a bare conversation meanwhile).
    const mate =
      seeded.environmentId === undefined
        ? { ...seeded, environmentId: environmentServing(environments, seeded.projectId) }
        : seeded;
    if (
      mate.environmentId !== undefined &&
      (mate.projectId === chiefId || isListedMateProject(directory, { id: mate.projectId }))
    ) {
      const bodiesHere = bodies.get(mate.projectId) ?? [];
      const body =
        bodiesHere.find((row) => row.environmentId === mate.environmentId) ??
        (bodiesHere.length === 1 ? bodiesHere[0] : undefined);
      mates.set(mate.environmentId, {
        ...mate,
        ...(mate.projectId === chiefId ? { chief: true } : {}),
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

/** Identities for explicit detail and action targets, including the viewer's own Chief. */
export function useZeropsMateDirectory(): ZeropsMateDirectory {
  return useAtomValue(zeropsMatesAtom);
}

export function useZeropsMate(environmentId: EnvironmentId): ZeropsMateAt {
  return zeropsMateAt(useAtomValue(zeropsMatesAtom), environmentId);
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
