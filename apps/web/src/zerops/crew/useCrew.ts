import { environmentActivitiesAtom } from "../mateActivityAtoms";
/**
 * The crew of one environment, as every crew surface of an open Mate reads it: the feed's
 * status and snapshot (`crewFeedRead`) and the view joined to this
 * environment's thread shells (`deriveCrewView`), each crewmate's thread read
 * by the one status resolver and its phrase producer (R5, `readCrewThread`).
 * The left menu reads a Mate's crew from HQ instead (`useMateCrew`), open or not.
 *
 * `status` drives whether a crew surface exists at all (seam 21): only `none`
 * and `applied` have one; `off` — crew mode off, or a Mate without the feed —
 * and `null` — not read yet, or the read failed — show nothing.
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  crewFeedRead,
  deriveCrewView,
  type CrewThreadRead,
  type CrewView,
} from "@t3tools/client-runtime/zerops/projections/crew";
import { statusLabel } from "@t3tools/client-runtime/zerops/statusPresentation";
import type { CrewSnapshot, CrewStatus, EnvironmentId } from "@t3tools/contracts";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import type { CrewDigest, OverviewLogins } from "@t3tools/shared/mateLink";
import {
  mateMarkStateForThreadStatus,
  resolveThreadStatus,
  type ThreadStatusInput,
} from "@t3tools/shared/threadStatus";
import { hqMateOverviewAtom, hqMatePresenceAtom } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";
import { shareEqual } from "@t3tools/shared/structuralSharing";

import { useThreadShells } from "../../state/entities";
import { zeropsFeeds } from "../../state/zerops";

const NO_CREW_ATOM = Atom.make(undefined).pipe(Atom.withLabel("zerops:crew-empty"));

export interface CrewRead {
  readonly status: CrewStatus | null;
  readonly snapshot: CrewSnapshot | null;
  /** `null` exactly when `snapshot` is. */
  readonly view: CrewView<EnvironmentThreadShell> | null;
  /** The snapshot is current: a press acts on what is shown. */
  readonly current: boolean;
}

/** A crew thread's live state: the one resolver, its phrase producer and its face. */
export function readCrewThread(
  shell: ThreadStatusInput,
  limit: "limited" | "expired" | "none" = "none",
): CrewThreadRead {
  const status = resolveThreadStatus(shell, limit);
  return {
    status,
    word: statusLabel(status.kind),
    working: mateMarkStateForThreadStatus(status.kind) === "working",
  };
}

export function useCrew(environmentId: EnvironmentId | null): CrewRead {
  const read = useAtomValue(
    environmentId === null ? NO_CREW_ATOM : zeropsFeeds.crew({ environmentId, input: {} }),
  );
  const shells = useThreadShells();
  const activities = useAtomValue(environmentActivitiesAtom(environmentId));
  const { status, snapshot, current } = useMemo(() => crewFeedRead(read), [read]);
  const view = useMemo(
    () =>
      snapshot === null
        ? null
        : deriveCrewView(
            snapshot,
            shells.filter((shell) => shell.environmentId === environmentId),
            (shell) => readCrewThread(shell, activities.get(shell.id)?.limit?.kind),
          ),
    [environmentId, shells, snapshot, activities],
  );
  return { status, snapshot, view, current };
}

/** Whether the environment has a crew surface: a crew applied, or none yet to set up. */
export function hasCrewSurface(status: CrewStatus | null): status is "none" | "applied" {
  return status === "none" || status === "applied";
}

/** A Mate's crew as HQ holds it in the Mate's overview (`@t3tools/shared/mateLink`). */
export interface MateCrewRead {
  /**
   * Its crew's status — crew mode off, on with no crew yet, or a crew applied — for its menu's door
   * to it (`mateCrewItem`); `null` where HQ holds no overview of the Mate.
   */
  readonly status: CrewStatus | null;
  /** Its applied crew; `null` where none is applied, or HQ holds no overview of it. */
  readonly crew: (CrewDigest & { readonly status: "applied" }) | null;
  /** Whose each of its logins is, for what a crewmate's login lets the viewer do. */
  readonly logins: OverviewLogins;
  /**
   * HQ's answer now, of a Mate whose overview is live: what its crew does is true now. Otherwise
   * the crew is as last known, at rest — HQ not answering, or the Mate asleep.
   */
  readonly current: boolean;
  /** The Mate's environment, as its overview names it: where a crewmate's chat opens. */
  readonly environmentId: EnvironmentId | undefined;
}

const NO_LOGINS: OverviewLogins = {};

/** A Mate's crew in HQ's view of it, `current` whether that view is HQ's answer now. */
export function mateCrewOf(mate: MateLiveView | undefined, current: boolean): MateCrewRead {
  const crew = mate?.crew;
  return {
    status: crew?.status ?? null,
    crew: crew?.status === "applied" ? crew : null,
    logins: mate?.logins ?? NO_LOGINS,
    current: current && mate?.presence.overview === "live",
    environmentId: mate?.identity?.environmentId,
  };
}

/**
 * The crew of the Mate in `projectId`, as the organization in view's HQ last told this tab of it;
 * none for no project.
 */
const NO_MATE_CREW = Atom.make(mateCrewOf(undefined, false));
const mateCrewAtom = Atom.family((projectId: string) =>
  Atom.make((get) =>
    mateCrewOf(
      get(hqMateOverviewAtom(projectId)) ?? undefined,
      get(hqMatePresenceAtom(projectId)).live,
    ),
  ).pipe(Atom.withEquality((a, b) => shareEqual(a, b) === a)),
);
export function useMateCrew(projectId: string | null): MateCrewRead {
  return useAtomValue(projectId === null ? NO_MATE_CREW : mateCrewAtom(projectId));
}
