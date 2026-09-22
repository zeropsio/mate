/**
 * The platform's verdict on every project still on its way up.
 *
 * A project in NEW or CREATING is a boot until its `project.create` process
 * says otherwise — and when that process has FAILED the project never leaves
 * NEW (measured 2026-09-16), so the page has to ask. One process search per
 * such project, only while it is on its way up; a terminal verdict is kept
 * per project id for the page's lifetime and read again only on a refresh,
 * because the platform does not change its mind about a finished process.
 *
 * H20: a `running` verdict is never stored (`settledRef` only ever holds a
 * terminal one), so a project a wait is actively watching is re-asked on
 * every `activeWaitProjectId` tick as well as on a refresh — otherwise a
 * creation that fails late, after the page's one read of it came back
 * `running`, never turns the row's "Coming up." into "Could not be
 * created." until somebody happens to refresh.
 */

import { projectCreationOutcome, type ZeropsProjectCreation } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { useEffect, useRef, useState } from "react";

import { useZeropsCandidatesVersion } from "./candidatesRefresh";
import { useZeropsSession } from "./ZeropsSessionProvider";

const ON_ITS_WAY = new Set(["NEW", "CREATING"]);
/** Same cadence as `useZeropsProvisioning`'s poll — "every poll tick is fine". */
const ACTIVE_WAIT_REVERDICT_MS = 2000;

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

export function useZeropsCreationVerdicts(
  candidates: ReadonlyArray<ZeropsCandidate>,
  /** The project id a provisioning wait is currently alive for, if any (H20). */
  activeWaitProjectId: string | null = null,
): ReadonlyMap<string, ZeropsProjectCreation> {
  const { activeOrganization, client } = useZeropsSession();
  const clientId = activeOrganization?.id;
  const version = useZeropsCandidatesVersion();
  const settledRef = useRef(new Map<string, ZeropsProjectCreation>());
  const readVersionRef = useRef(version);
  const [verdicts, setVerdicts] = useState<ReadonlyMap<string, ZeropsProjectCreation>>(
    () => new Map(),
  );
  const targets = creationVerdictTargets(candidates).join(",");

  // A wait watches one project; its own poll cadence is reason enough to ask
  // again, independent of a refresh or a candidate-list change.
  const [activeWaitTick, setActiveWaitTick] = useState(0);
  useEffect(() => {
    if (activeWaitProjectId === null) return;
    const timer = setInterval(() => {
      setActiveWaitTick((current) => current + 1);
    }, ACTIVE_WAIT_REVERDICT_MS);
    return () => {
      clearInterval(timer);
    };
  }, [activeWaitProjectId]);

  useEffect(() => {
    if (clientId === undefined || targets === "") return;
    // A refresh asks again about everything; a change in what is on its way
    // asks only about what has no settled answer yet.
    const again = readVersionRef.current !== version;
    readVersionRef.current = version;
    const wanted = targets
      .split(",")
      .filter((projectId) => again || !settledRef.current.has(projectId));
    if (wanted.length === 0) return;

    const controller = new AbortController();
    void Promise.all(
      wanted.map(async (projectId) => {
        try {
          const creation = await client.readProjectCreation(
            { clientId, projectId },
            controller.signal,
          );
          if (creation === undefined) return;
          if (projectCreationOutcome(creation).kind === "running") return;
          settledRef.current.set(projectId, creation);
        } catch {
          // A read that failed is no verdict; the row stays a boot until one is in.
        }
      }),
    ).then(() => {
      if (controller.signal.aborted) return;
      setVerdicts(new Map(settledRef.current));
    });
    return () => {
      controller.abort();
    };
  }, [client, clientId, targets, version, activeWaitTick]);

  return verdicts;
}
