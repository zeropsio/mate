import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import { useCallback } from "react";

import { confirmTerminalClose } from "../lib/terminalCloseConfirm";
import {
  useRightPanelStore,
  type RightPanelSurface,
  type ThreadRightPanelState,
} from "../rightPanelStore";

/** Closing the right panel's tabs for the conversation on screen (`ConversationView`); a closed terminal tab stops its terminals, after the person confirms. */
export function useRightPanelSurfaceClosers({
  activeThreadRef,
  rightPanelState,
  storeCloseTerminal,
  closeTerminalMutation,
  activeTerminalLabelsById,
}: {
  activeThreadRef: ScopedThreadRef | null;
  rightPanelState: ThreadRightPanelState;
  storeCloseTerminal: (threadRef: ScopedThreadRef, terminalId: string) => void;
  closeTerminalMutation: (value: {
    readonly environmentId: EnvironmentId;
    readonly input: {
      readonly threadId: string;
      readonly terminalId?: string | undefined;
      readonly deleteHistory?: boolean | undefined;
    };
  }) => Promise<AtomCommandResult<unknown, unknown>>;
  activeTerminalLabelsById: Map<string, string>;
}) {
  const cleanupRightPanelSurfaces = useCallback(
    (surfaces: readonly RightPanelSurface[]) => {
      if (!activeThreadRef) return;
      for (const surface of surfaces) {
        if (surface.kind === "terminal") {
          for (const terminalId of surface.terminalIds) {
            storeCloseTerminal(activeThreadRef, terminalId);
            void closeTerminalMutation({
              environmentId: activeThreadRef.environmentId,
              input: { threadId: activeThreadRef.threadId, terminalId, deleteHistory: true },
            });
          }
        }
      }
    },
    [activeThreadRef, closeTerminalMutation, storeCloseTerminal],
  );
  const closeRightPanelSurface = useCallback(
    (surface: RightPanelSurface) => {
      if (!activeThreadRef) return;
      const finishClose = () => {
        cleanupRightPanelSurfaces([surface]);
        useRightPanelStore.getState().closeSurface(activeThreadRef, surface.id);
      };
      if (surface.kind !== "terminal") {
        finishClose();
        return;
      }
      const activeLabel =
        activeTerminalLabelsById.get(surface.activeTerminalId) ??
        getTerminalLabel(surface.activeTerminalId);
      const otherLabels = surface.terminalIds
        .filter((terminalId) => terminalId !== surface.activeTerminalId)
        .map(
          (terminalId) => activeTerminalLabelsById.get(terminalId) ?? getTerminalLabel(terminalId),
        );
      void confirmTerminalClose([activeLabel, ...otherLabels]).then((confirmed) => {
        if (confirmed) finishClose();
      });
    },
    [activeThreadRef, activeTerminalLabelsById, cleanupRightPanelSurfaces],
  );
  const closeOtherRightPanelSurfaces = useCallback(
    (surface: RightPanelSurface) => {
      if (!activeThreadRef) return;
      const surfaces = rightPanelState.surfaces.filter((entry) => entry.id !== surface.id);
      cleanupRightPanelSurfaces(surfaces);
      useRightPanelStore.getState().closeOtherSurfaces(activeThreadRef, surface.id);
    },
    [activeThreadRef, cleanupRightPanelSurfaces, rightPanelState.surfaces],
  );
  const closeRightPanelSurfacesToRight = useCallback(
    (surface: RightPanelSurface) => {
      if (!activeThreadRef) return;
      const surfaceIndex = rightPanelState.surfaces.findIndex((entry) => entry.id === surface.id);
      if (surfaceIndex < 0) return;
      const surfaces = rightPanelState.surfaces.slice(surfaceIndex + 1);
      cleanupRightPanelSurfaces(surfaces);
      useRightPanelStore.getState().closeSurfacesToRight(activeThreadRef, surface.id);
    },
    [activeThreadRef, cleanupRightPanelSurfaces, rightPanelState.surfaces],
  );
  const closeAllRightPanelSurfaces = useCallback(() => {
    if (!activeThreadRef) return;
    cleanupRightPanelSurfaces(rightPanelState.surfaces);
    useRightPanelStore.getState().closeAllSurfaces(activeThreadRef);
  }, [activeThreadRef, cleanupRightPanelSurfaces, rightPanelState.surfaces]);
  return {
    closeRightPanelSurface,
    closeOtherRightPanelSurfaces,
    closeRightPanelSurfacesToRight,
    closeAllRightPanelSurfaces,
  };
}
