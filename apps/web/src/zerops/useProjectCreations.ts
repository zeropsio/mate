/**
 * Setup verdicts follow HQ's recorded import process while the project comes up or lacks its
 * container. A missing identity or unread process stays pending; neither project age nor a
 * different project.create result settles this accepted setup.
 */
import { creationImports, projectCreations } from "@t3tools/client-runtime/data";
import { projectCreationOutcome, type ZeropsProjectCreation } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo } from "react";

import { useAccountDataOptional, useProjection } from "./ZeropsAccountData";

const ON_ITS_WAY = new Set(["NEW", "CREATING"]);

/** The projects whose creation is worth asking about: on their way up, each once. */
export function creationVerdictTargets(
  candidates: ReadonlyArray<
    Pick<ZeropsCandidate, "project"> & Partial<Pick<ZeropsCandidate, "missingContainer">>
  >,
): ReadonlyArray<string> {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ON_ITS_WAY.has(candidate.project.status) || candidate.missingContainer === true)
      ids.add(candidate.project.id);
  }
  return [...ids].sort();
}

/** The creations the platform settled, by project: one still on its way is no verdict. */
export function settledCreations(
  creations: Readonly<Record<string, ZeropsProjectCreation>>,
): ReadonlyMap<string, ZeropsProjectCreation> {
  return new Map(
    Object.entries(creations).filter(
      ([, creation]) => projectCreationOutcome(creation).kind !== "running",
    ),
  );
}

const NO_CREATIONS = Atom.make<Readonly<Record<string, ZeropsProjectCreation>>>({});
const NO_IMPORTS = Atom.make<Readonly<Record<string, string | null>>>({});

export function useProjectCreations(
  candidates: ReadonlyArray<ZeropsCandidate>,
): ReadonlyMap<string, ZeropsProjectCreation> {
  const account = useAccountDataOptional();
  const imports = useProjection(creationImports, account?.orgId ?? null, NO_IMPORTS);
  const targets = creationVerdictTargets(candidates);
  const key = targets.join(",");
  const demandDetail = account?.demandDetail;
  const processIds = useMemo(
    () =>
      key === ""
        ? []
        : key.split(",").flatMap((projectId) => {
            const id = imports[projectId];
            return id == null ? [] : [id];
          }),
    [imports, key],
  );
  // HQ setup follows its exact import; an unrecorded identity cannot be guessed from history.
  useEffect(() => {
    if (demandDetail === undefined) return;
    const releases = processIds.map((ownerId) =>
      demandDetail({ family: "process", listing: "process", ownerId }),
    );
    return () => {
      for (const release of releases) release();
    };
  }, [demandDetail, processIds]);
  const orgId = account?.orgId ?? null;
  const creations = useProjection(
    projectCreations,
    orgId === null || key === "" ? null : { orgId, projectIds: key.split(",") },
    NO_CREATIONS,
  );
  return useMemo(() => settledCreations(creations), [creations]);
}
