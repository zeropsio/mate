/**
 * How the left menu reads each Mate it draws: what its row says (`mateRowActivity` — its
 * conversation while its socket stands, blinking included, this browser's memory otherwise). The
 * menu's rows and its folded headings read the same answer.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { useCallback, useMemo } from "react";

import { mateRowActivity } from "../components/zerops/SidebarMateRow.logic";
import { zeropsEnvironmentsAtom } from "../state/zerops";
import type { ZeropsAgentActivity } from "./agentActivity";
import { rememberedActivity } from "./menuMemory";

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
