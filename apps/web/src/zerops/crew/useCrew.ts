/**
 * The crew of one environment, as every crew surface reads it: the feed's
 * status and snapshot (`crewFeedRead`) and the view joined to this
 * environment's thread shells (`deriveCrewView`), each crewmate's thread read
 * by the one status resolver and its phrase producer (R5, `readCrewThread`).
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
import {
  mateMarkStateForThreadStatus,
  resolveThreadStatus,
  type ThreadStatusInput,
} from "@t3tools/shared/threadStatus";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

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
 * The crew feed's status alone — whether crew mode is on, and whether a crew is
 * applied — for a surface that needs no view of the crew: a Mate's menu in the
 * left menu. `null` for no environment, or a feed not read yet.
 */
export function useCrewStatus(environmentId: EnvironmentId | null): CrewStatus | null {
  const read = useAtomValue(
    environmentId === null ? NO_CREW_ATOM : zeropsFeeds.crew({ environmentId, input: {} }),
  );
  return crewFeedRead(read).status;
}

/** Whether the environment has a crew surface: a crew applied, or none yet to set up. */
export function hasCrewSurface(status: CrewStatus | null): status is "none" | "applied" {
  return status === "none" || status === "applied";
}
