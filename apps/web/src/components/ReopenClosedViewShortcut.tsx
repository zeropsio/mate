import { useAtomValue } from "@effect/atom-react";
import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

import { useClosedViewStore } from "../closedViewStore";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { useComposerDraftStore } from "../composerDraftStore";
import { resolveShortcutCommand } from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { planNextReopen, reopenClosedView } from "../reopenClosedView";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readProject, readThreadShell } from "../state/entities";
import { primaryServerKeybindingsAtom } from "../state/server";
import { environmentShell } from "../state/shell";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";
import { toastManager } from "./ui/toast";

/**
 * Mod+Shift+T puts the last closed right-panel tab back, in its own
 * conversation, opening that conversation when it is not the one on screen.
 * A browser keeps the chord for its own tabs, so it reaches the desktop app.
 */
export function ReopenClosedViewShortcut() {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const target = resolveThreadRouteTarget(params);
  const draft = useComposerDraftStore((state) =>
    target?.kind === "draft" ? state.getDraftSession(target.draftId) : null,
  );
  const currentRef =
    target?.kind === "server"
      ? target.threadRef
      : draft
        ? (draft.promotedTo ?? scopeThreadRef(draft.environmentId, draft.threadId))
        : null;
  const currentKey = currentRef ? scopedThreadKey(currentRef) : null;
  const terminalOpen = useTerminalUiStateStore(
    (state) =>
      selectThreadTerminalUiState(state.terminalUiStateByThreadKey, currentRef).terminalOpen,
  );
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const pending = useRef(Promise.resolve());

  const reopenNext = useEffectEvent(async () => {
    const panelsByThread = useRightPanelStore.getState().byThreadKey;
    const { drop, restore } = planNextReopen(useClosedViewStore.getState().entries, (entry) => {
      const ref = entry.threadRef;
      const panel = selectThreadRightPanelState(panelsByThread, ref);
      if (scopedThreadKey(ref) === currentKey) return { ownerExists: true, shellLive: true, panel };
      return {
        ownerExists: readThreadShell(ref) !== null,
        shellLive:
          appAtomRegistry.get(environmentShell.stateValueAtom(ref.environmentId)).status === "live",
        panel,
      };
    });
    for (const entry of drop) useClosedViewStore.getState().remove(entry.id);
    if (!restore) return;

    const ref = restore.threadRef;
    const isCurrent = scopedThreadKey(ref) === currentKey;
    const projectId = readThreadShell(ref)?.projectId ?? (isCurrent ? draft?.projectId : undefined);
    const workspaceAvailable =
      projectId !== undefined &&
      readProject(scopeProjectRef(ref.environmentId, projectId)) !== null;
    if (!reopenClosedView(restore, { workspaceAvailable })) {
      useClosedViewStore.getState().defer(restore.id);
      return;
    }
    useClosedViewStore.getState().remove(restore.id);
    if (!isCurrent) {
      await navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
    }
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isCommandPaletteOpen() ||
        useClosedViewStore.getState().entries.length === 0
      )
        return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      if (command !== "view.reopenClosed") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      pending.current = pending.current
        .then(() => reopenNext())
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not reopen the tab",
            description: error instanceof Error ? error.message : String(error),
          });
        });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, terminalOpen]);

  return null;
}
