/**
 * How the left menu reads each Mate it draws: what its row says (`mateRowActivity` — its
 * conversation while its socket stands, blinking included, this browser's memory otherwise) and
 * whether it is still in its first minutes (`mateComing` — its birth, its project on the way up,
 * the platform's verdict on its creation, this tab's creation). The menu, the folded headings and
 * the waiting faces read the same answers; the projects page reads the same words.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  applyProjectCreationVerdict,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import { useCallback, useMemo } from "react";

import { mateRowActivity } from "../components/zerops/SidebarMateRow.logic";
import { environmentsWithSnapshotAtom } from "../state/shell";
import { zeropsEnvironmentsAtom } from "../state/zerops";
import type { ZeropsAgentActivity } from "./agentActivity";
import { mateComing, type MateComing } from "./mateComing";
import { rememberedActivity } from "./menuMemory";
import { useNewMate } from "./newMate";
import { useZeropsCreationVerdicts } from "./useZeropsCreationVerdicts";
import { pressComingInput, useMatePresses } from "./matePress";

/**
 * What a Mate's row says: its conversation's reading while its socket is up or only blinking,
 * found by the project its server says it runs — a reconnecting socket leaves the candidate
 * `ready` — and until then what this browser remembers the row saying.
 */
export function useMateRowActivity(
  activity: ReadonlyMap<EnvironmentId, ZeropsAgentActivity>,
): (candidate: ZeropsCandidate) => ZeropsAgentActivity | undefined {
  const environments = useAtomValue(zeropsEnvironmentsAtom);
  const sockets = useMemo(
    () =>
      new Map(
        environments.flatMap((environment) =>
          typeof environment.zeropsProjectId === "string"
            ? [[environment.zeropsProjectId, environment] as const]
            : [],
        ),
      ),
    [environments],
  );
  return useCallback(
    (candidate: ZeropsCandidate) => {
      const socket =
        candidate.group === "connected" && candidate.environmentId !== undefined
          ? { environmentId: candidate.environmentId, phase: "connected" as const }
          : (() => {
              const found = sockets.get(candidate.project.id);
              return found === undefined
                ? undefined
                : { environmentId: found.environmentId, phase: found.connection.phase };
            })();
      return mateRowActivity({
        live: socket === undefined ? undefined : activity.get(socket.environmentId),
        phase: socket?.phase,
        remembered: rememberedActivity(candidate.project.id),
      });
    },
    [activity, sockets],
  );
}

/**
 * Whether a Mate's conversations have been read — its connected environment's shell arrived — so
 * a Mate with none has nothing asked yet, and its row may say so without taking it back.
 */
export function useMateConversationsRead(): (candidate: ZeropsCandidate) => boolean {
  const read = useAtomValue(environmentsWithSnapshotAtom);
  return useCallback(
    (candidate: ZeropsCandidate) =>
      candidate.group === "connected" &&
      candidate.environmentId !== undefined &&
      read.has(candidate.environmentId),
    [read],
  );
}

/**
 * Whether a Mate the menu lists is still in its first minutes, as its row says it: its press made
 * in this browser, its project on the way up, the platform's verdict on its creation (read as the
 * projects page reads it), or a step of this tab's creation that failed.
 */
export function useMateComingOf(
  candidates: ReadonlyArray<ZeropsCandidate>,
): (candidate: ZeropsCandidate) => MateComing | undefined {
  const presses = useMatePresses();
  const creations = useNewMate((state) => state.creations);
  const verdicts = useZeropsCreationVerdicts(
    candidates,
    presses.find((press) => press.container && press.state.kind === "pressing")?.projectId ?? null,
  );
  return useCallback(
    (candidate: ZeropsCandidate) => {
      const { press, setUpFailed } = pressComingInput(presses, candidate.project.id);
      return mateComing({
        press,
        candidate: applyProjectCreationVerdict(candidate, verdicts.get(candidate.project.id)),
        setUpFailed: setUpFailed ?? creations[candidate.project.id]?.failed,
        nowMs: Date.now(),
        created: creations[candidate.project.id] !== undefined,
      });
    },
    [presses, creations, verdicts],
  );
}
