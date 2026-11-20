import type { ScopedThreadRef } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useCallback } from "react";

import { useDiffPanelStore } from "../diffPanelStore";
import { useRightPanelStore } from "../rightPanelStore";

/** The right panel's tab openers for the conversation on screen (`ConversationView`'s launcher, header and composer). */
export function useRightPanelSurfaceOpeners({
  activeThreadRef,
  activeProject,
}: {
  activeThreadRef: ScopedThreadRef | null;
  activeProject: EnvironmentProject | null;
}) {
  const addFilesSurface = useCallback(() => {
    if (!activeThreadRef || !activeProject) return;
    useRightPanelStore.getState().open(activeThreadRef, "files");
  }, [activeProject, activeThreadRef]);
  const addAgentsSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "agents");
  }, [activeThreadRef]);
  const addZeropsSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "zerops");
  }, [activeThreadRef]);

  const addDataSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "data");
  }, [activeThreadRef]);
  const addGitSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "git");
  }, [activeThreadRef]);
  /** Code at "What changed" (the launcher's D). */
  const addCodeChangesSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useDiffPanelStore.getState().askChanges(activeThreadRef);
    useRightPanelStore.getState().open(activeThreadRef, "git");
  }, [activeThreadRef]);
  const addCrewSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "crew");
  }, [activeThreadRef]);
  const addMcpSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "mcp");
  }, [activeThreadRef]);
  const addVaultSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "vault");
  }, [activeThreadRef]);
  const addPersonaSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "persona");
  }, [activeThreadRef]);
  const addExpressSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "express");
  }, [activeThreadRef]);
  return {
    addFilesSurface,
    addAgentsSurface,
    addZeropsSurface,
    addDataSurface,
    addGitSurface,
    addCodeChangesSurface,
    addCrewSurface,
    addMcpSurface,
    addVaultSurface,
    addPersonaSurface,
    addExpressSurface,
  };
}
