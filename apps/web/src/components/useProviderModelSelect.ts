import type { EnvironmentThread } from "@t3tools/client-runtime/state/shell";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type ModelSelection,
  ProviderInstanceId,
  type ServerProvider,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { useCallback } from "react";

import type { ComposerThreadTarget } from "../composerDraftStore";
import { resolveAppModelSelectionForInstance } from "../modelSelection";
import { toastManager } from "~/lib/toasts";
import { getStartedThreadModelChangeBlockReason } from "./ChatView.logic";

/**
 * Which model the conversation on screen may switch to, and the switch (`ConversationView`'s model
 * picker): any agent's, since another agent takes a started conversation over when the next
 * message goes.
 */
export function useProviderModelSelect({
  activeThread,
  providerStatuses,
  scheduleComposerFocus,
  settings,
  setComposerDraftModelSelection,
  setStickyComposerModelSelection,
}: {
  activeThread: EnvironmentThread | undefined;
  providerStatuses: readonly ServerProvider[];
  scheduleComposerFocus: () => void;
  settings: UnifiedSettings;
  setComposerDraftModelSelection: (
    threadRef: ComposerThreadTarget,
    modelSelection: ModelSelection | null | undefined,
    opts?: { replaceOptions?: boolean },
  ) => void;
  setStickyComposerModelSelection: (modelSelection: ModelSelection | null | undefined) => void;
}) {
  const getModelDisabledReason = useCallback(
    (instanceId: ProviderInstanceId, model: string): string | null => {
      if (!activeThread) {
        return null;
      }
      const reason = getStartedThreadModelChangeBlockReason({
        providers: providerStatuses,
        hasStartedSession: activeThread.session !== null,
        currentModelSelection: activeThread.modelSelection,
        currentProviderInstanceId: activeThread.session?.providerInstanceId ?? null,
        nextModelSelection: { instanceId, model },
      });
      return reason ? `${reason.description} Start a new thread to use this model.` : null;
    },
    [activeThread, providerStatuses],
  );

  const onProviderModelSelect = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      if (!activeThread) return;
      // Model normalization and custom model lookup stay scoped to that exact instance; an
      // unknown instance resolves no model, and the server remains authoritative too.
      const resolvedModel = resolveAppModelSelectionForInstance(
        instanceId,
        settings,
        providerStatuses,
        model,
      );
      if (!resolvedModel) {
        scheduleComposerFocus();
        return;
      }
      const nextModelSelection: ModelSelection = {
        instanceId,
        model: resolvedModel,
      };
      const modelChangeBlockReason = getStartedThreadModelChangeBlockReason({
        providers: providerStatuses,
        hasStartedSession: activeThread.session !== null,
        currentModelSelection: activeThread.modelSelection,
        currentProviderInstanceId: activeThread.session?.providerInstanceId ?? null,
        nextModelSelection,
      });
      if (modelChangeBlockReason) {
        toastManager.add({
          type: "warning",
          title: modelChangeBlockReason.title,
          description: modelChangeBlockReason.description,
        });
        scheduleComposerFocus();
        return;
      }
      setComposerDraftModelSelection(
        scopeThreadRef(activeThread.environmentId, activeThread.id),
        nextModelSelection,
      );
      setStickyComposerModelSelection(nextModelSelection);
      scheduleComposerFocus();
    },
    [
      activeThread,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
      providerStatuses,
      settings,
    ],
  );
  return { getModelDisabledReason, onProviderModelSelect };
}
