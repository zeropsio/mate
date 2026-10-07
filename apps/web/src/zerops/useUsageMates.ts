/**
 * The Mates the Usage page counts: every one HQ names for the organization in view. While the page
 * stands it wants each connected (`AccountEnvironments.setDrawn`, background demand: paced, no
 * project detail) and lets them go when it closes, so no other surface connects to a Mate it does
 * not draw (A9). Each Mate is counted once its socket answers, on its way while it connects, and
 * missing — named on the page — when it cannot connect or HQ names no environment for it.
 */
import { useAtomValue } from "@effect/atom-react";
import { projectNameInApp } from "@t3tools/client-runtime/zerops";
import {
  environmentTarget,
  selectReachability,
  targetProject,
  type Reachability,
} from "@t3tools/client-runtime/zerops/environments";
import type { HqMates } from "@t3tools/client-runtime/zerops/hq";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import { hqMatesAtom } from "../state/zerops";
import { useAccountEnvironments, useEnvironmentMachines } from "./accountEnvironments";
import { candidateListingAtom } from "./useZeropsCandidates";

export type UsageMateState = "counted" | "connecting" | "missing";

export interface UsageMate {
  readonly projectId: string;
  readonly environmentId?: EnvironmentId | undefined;
  /** The Mate's name as the left menu shows it: its project's. */
  readonly name: string;
  readonly state: UsageMateState;
}

/** The verdicts a Mate still connects through: the page waits on it rather than call it missing. */
const ON_ITS_WAY: ReadonlySet<Reachability["kind"]> = new Set([
  "resolving",
  "connecting",
  "reconnecting",
  "ready",
]);

/** The environment each Mate HQ names serves, sorted: what the page wants connected. */
function drawnEnvironments(mates: HqMates | null): ReadonlyArray<EnvironmentId> {
  return [...(mates?.values() ?? [])]
    .flatMap((mate) => (mate.identity === undefined ? [] : [mate.identity.environmentId]))
    .toSorted();
}

export function usageMates(input: {
  readonly mates: HqMates | null;
  /** Each project's name, by project id. */
  readonly names: ReadonlyMap<string, string>;
  /** The environments whose usage is read: connected ones. */
  readonly connected: ReadonlySet<EnvironmentId>;
  /** The verdict on a Mate's target; null while no target is listed for its project. */
  readonly verdictOf: (projectId: string, environmentId: EnvironmentId) => Reachability | null;
  /** No Mate is still to be listed or registered (`useMatesSettled`). */
  readonly listed: boolean;
  /**
   * The projects already read missing since the page opened: a retry reads connecting again on
   * each attempt, so one stays missing until it is counted rather than hold the totals each time.
   */
  readonly missingBefore: ReadonlySet<string>;
}): ReadonlyArray<UsageMate> {
  const read: UsageMate[] = [];
  for (const [projectId, mate] of input.mates ?? []) {
    const environmentId = mate.identity?.environmentId;
    const verdict = environmentId === undefined ? null : input.verdictOf(projectId, environmentId);
    const state: UsageMateState =
      environmentId === undefined
        ? "missing"
        : input.connected.has(environmentId)
          ? "counted"
          : verdict === null
            ? input.listed
              ? "missing"
              : "connecting"
            : ON_ITS_WAY.has(verdict.kind) && !input.missingBefore.has(projectId)
              ? "connecting"
              : "missing";
    read.push({ projectId, environmentId, name: input.names.get(projectId) ?? projectId, state });
  }
  return read.toSorted((left, right) => left.name.localeCompare(right.name));
}

export function useUsageMates(
  connected: ReadonlySet<EnvironmentId>,
  listed: boolean,
): ReadonlyArray<UsageMate> {
  const mates = useAtomValue(hqMatesAtom)?.mates ?? null;
  const listing = useAtomValue(candidateListingAtom);
  const environments = useAccountEnvironments();
  const machines = useEnvironmentMachines();

  // Keyed by the ids, so HQ's every word on a Mate it already named moves no demand.
  const drawnKey = drawnEnvironments(mates).join("\n");
  useEffect(() => {
    if (environments === null) return;
    environments.setDrawn(
      drawnKey === "" ? [] : drawnKey.split("\n").map((id) => EnvironmentId.make(id)),
    );
    return () => environments.setDrawn([]);
  }, [environments, drawnKey]);

  // The projects read missing on the last render, as one key: kept from render to render.
  const [missingKey, setMissingKey] = useState("");
  const missingBefore = useMemo(
    () => new Set(missingKey === "" ? [] : missingKey.split("\n")),
    [missingKey],
  );
  const names = useMemo(
    () =>
      new Map(
        heldCandidates(listing).rows.map((row) => [row.project.id, projectNameInApp(row.project)]),
      ),
    [listing],
  );
  const read = useMemo(
    () =>
      usageMates({
        mates,
        names,
        connected,
        listed,
        missingBefore,
        verdictOf: (projectId, environmentId) => {
          const target =
            environmentTarget(machines, environmentId) ??
            [...machines]
              .map(([key, machine]) => ({ key, machine }))
              .find(({ key }) => targetProject(key) === projectId);
          return target === undefined ? null : selectReachability(target.machine, environmentId);
        },
      }),
    [mates, names, connected, listed, missingBefore, machines],
  );
  const missingNow = read
    .flatMap((mate) => (mate.state === "missing" ? [mate.projectId] : []))
    .join("\n");
  if (missingNow !== missingKey) setMissingKey(missingNow);
  return read;
}
