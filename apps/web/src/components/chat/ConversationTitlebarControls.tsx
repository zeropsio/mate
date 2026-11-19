import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { RightPanelMaximizeControl } from "./PanelLayoutControls";

export function ConversationTitlebarControls({
  rightPanelOpen,
  shouldUseRightPanelSheet,
  rightPanelMaximized,
  toggleRightPanelMaximized,
  panelToggleControls,
}: {
  rightPanelOpen: boolean;
  shouldUseRightPanelSheet: boolean;
  rightPanelMaximized: boolean;
  toggleRightPanelMaximized: () => void;
  panelToggleControls: ReactNode;
}) {
  return (
    <div
      className={cn(
        // One inset in both states: the controls move between containers when
        // the right panel opens, and a different right offset made them jump
        // sideways on every toggle.
        "absolute top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] z-50 mr-px flex h-[var(--workspace-topbar-height)] items-center gap-1 [-webkit-app-region:no-drag]",
      )}
      data-workspace-titlebar-controls
      // The header's own controls stand from the first frame of a load (`HeaderControlsStandIn`
      // before this view draws): the opening never takes them away to bring them back.
    >
      {rightPanelOpen && !shouldUseRightPanelSheet ? (
        <RightPanelMaximizeControl
          maximized={rightPanelMaximized}
          onToggle={toggleRightPanelMaximized}
        />
      ) : null}
      {panelToggleControls}
    </div>
  );
}
