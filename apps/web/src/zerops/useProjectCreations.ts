/**
 * The platform's verdict on every project still on its way up.
 *
 * A project in NEW or CREATING is a boot until its `project.create` process says otherwise — and
 * when that process has FAILED the project never leaves NEW (measured 2026-09-16). Its project's
 * process history is held while it is on its way, and the account's store says how its creation
 * went (`projectCreations`); the organization's running work carries every later change of that
 * process, so a creation that fails late turns "Coming up." into "Could not be created." on its
 * own — nothing asks again on a timer.
 */
import { projectCreations } from "@t3tools/client-runtime/data";
import { projectCreationOutcome, type ZeropsProjectCreation } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useMemo } from "react";

import { useAccountDataOptional, useProjection } from "./ZeropsAccountData";

const ON_ITS_WAY = new Set(["NEW", "CREATING"]);

/** The projects whose creation is worth asking about: on their way up, each once. */
export function creationVerdictTargets(
  candidates: ReadonlyArray<Pick<ZeropsCandidate, "project">>,
): ReadonlyArray<string> {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ON_ITS_WAY.has(candidate.project.status)) ids.add(candidate.project.id);
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

export function useProjectCreations(
  candidates: ReadonlyArray<ZeropsCandidate>,
): ReadonlyMap<string, ZeropsProjectCreation> {
  const account = useAccountDataOptional();
  const targets = creationVerdictTargets(candidates);
  const key = targets.join(",");
  const demandDetail = account?.demandDetail;
  // Each project on its way has its process history held: where its creation process is read.
  useEffect(() => {
    if (demandDetail === undefined || key === "") return;
    const releases = key
      .split(",")
      .map((ownerId) => demandDetail({ family: "process", listing: "history", ownerId }));
    return () => {
      for (const release of releases) release();
    };
  }, [demandDetail, key]);
  const orgId = account?.orgId ?? null;
  const creations = useProjection(
    projectCreations,
    orgId === null || key === "" ? null : { orgId, projectIds: key.split(",") },
    NO_CREATIONS,
  );
  return useMemo(() => settledCreations(creations), [creations]);
}
