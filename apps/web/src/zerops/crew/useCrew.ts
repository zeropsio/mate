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
import type { CrewDigest, OverviewLogins } from "@t3tools/shared/mateLink";
import {
  mateMarkStateForThreadStatus,
  resolveThreadStatus,
  type ThreadStatusInput,
} from "@t3tools/shared/threadStatus";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { useThreadShells } from "../../state/entities";
import { hqMatesViewAtom, zeropsFeeds } from "../../state/zerops";

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
export function readCrewThread(shell: ThreadStatusInput): CrewThreadRead {
  const status = resolveThreadStatus(shell);
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
  const { status, snapshot, current } = useMemo(() => crewFeedRead(read), [read]);
  const view = useMemo(
    () =>
      snapshot === null
        ? null
        : deriveCrewView(
            snapshot,
            shells.filter((shell) => shell.environmentId === environmentId),
            readCrewThread,
          ),
    [environmentId, shells, snapshot],
  );
  return { status, snapshot, view, current };
}

/**
 * A Mate's door to its crew, for its menu: an applied crew from its overview in HQ, for any Mate;
 * crew mode on with no crew yet (`none`), or off, only from the open Mate's own feed — HQ's
 * overview carries a crew once one is applied and says nothing of crew mode. `null` where neither
 * says.
 */
export function crewStatusOf(crew: CrewDigest | null, feed: CrewStatus | null): CrewStatus | null {
  return crew === null ? feed : "applied";
}

/**
 * The crew status of the Mate in `projectId` for its menu (`crewStatusOf`): HQ's, and the feed of
 * `environmentId` — its open Mate's — where HQ holds no crew. `null` for no project.
 */
export function useCrewStatus(
  projectId: string | null,
  environmentId: EnvironmentId | null,
): CrewStatus | null {
  const { crew } = useMateCrew(projectId);
  const read = useAtomValue(
    environmentId === null || crew !== null
      ? NO_CREW_ATOM
      : zeropsFeeds.crew({ environmentId, input: {} }),
  );
  return crewStatusOf(crew, crewFeedRead(read).status);
}

/** Whether the environment has a crew surface: a crew applied, or none yet to set up. */
export function hasCrewSurface(status: CrewStatus | null): status is "none" | "applied" {
  return status === "none" || status === "applied";
}

/** A Mate's crew as HQ holds it in the Mate's overview (`@t3tools/shared/mateLink`). */
export interface MateCrewRead {
  /** Its applied crew; `null` where none is applied, or HQ holds no overview of it. */
  readonly crew: CrewDigest | null;
  /** Whose each of its logins is, for what a crewmate's login lets the viewer do. */
  readonly logins: OverviewLogins;
  /**
   * HQ's answer now, of a Mate that is up: what its crew does is true now. Otherwise the crew is
   * as last known, at rest — HQ not answering, or the Mate asleep.
   */
  readonly current: boolean;
  /** The Mate's environment, as its overview names it: where a crewmate's chat opens. */
  readonly environmentId: EnvironmentId | undefined;
}

const NO_LOGINS: OverviewLogins = {};

/** The crew of the Mate in `projectId`, as HQ last told this tab of it; none for no project. */
export function useMateCrew(projectId: string | null): MateCrewRead {
  const view = useAtomValue(hqMatesViewAtom);
  const mate = projectId === null ? undefined : view?.mates?.get(projectId);
  const current = view?.current === true && mate?.presence.online === true;
  return useMemo(
    () => ({
      crew: mate?.crew?.status === "applied" ? mate.crew : null,
      logins: mate?.logins ?? NO_LOGINS,
      current,
      environmentId: mate?.identity?.environmentId,
    }),
    [current, mate],
  );
}
