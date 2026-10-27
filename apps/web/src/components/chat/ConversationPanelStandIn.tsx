/**
 * The conversation's right panel, standing in while the conversation is on its way
 * (`conversationPanelStandIn`): the same panel at the same width, its tabs and its layout controls
 * in their places and inert, its surface waiting with the one look the conversation's panel waits
 * with (`Loading`, its room held), so nothing moves when the conversation takes over.
 */
import type { ReactNode } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "~/rightPanelLayout";
import { RIGHT_PANEL_KINDS, type RightPanelAvailability } from "~/rightPanelKinds";
import { useRightPanelStore, type ThreadRightPanelState } from "~/rightPanelStore";

import { RightPanelTabs } from "../RightPanelTabs";
import { Loading } from "../ui/loading";
import { conversationPanelStandIn } from "./conversationPanelStandIn.logic";
import { PanelLayoutControls, RightPanelMaximizeControl } from "./PanelLayoutControls";

const CLOSED: ThreadRightPanelState = { isOpen: false, activeSurfaceId: null, surfaces: [] };
const NO_IDS: ReadonlySet<string> = new Set();
const NO_LABELS: ReadonlyMap<string, string> = new Map();
const NONE_OFFERED = Object.fromEntries(
  RIGHT_PANEL_KINDS.map((kind) => [kind, "hidden" satisfies RightPanelAvailability]),
) as Record<(typeof RIGHT_PANEL_KINDS)[number], RightPanelAvailability>;
const nothing = () => undefined;

/** The thread's panel standing in beside its opening, or null where the opening is full width. */
export function useConversationPanelStandIn(
  threadKey: string | undefined,
  chief: boolean,
): ReactNode {
  const panel = useRightPanelStore((state) =>
    threadKey === undefined ? CLOSED : (state.byThreadKey[threadKey] ?? CLOSED),
  );
  const sheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const standIn = conversationPanelStandIn({ panel, sheet, chief });
  if (standIn === null || threadKey === undefined) return null;
  return (
    <>
      <div
        className="absolute top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] z-50 mr-px flex h-[var(--workspace-topbar-height)] items-center gap-1 [-webkit-app-region:no-drag]"
        data-workspace-titlebar-controls
        inert
      >
        <RightPanelMaximizeControl maximized={false} onToggle={nothing} />
        <PanelLayoutControls
          liveAgentCount={0}
          onToggleRightPanel={nothing}
          onToggleTerminal={nothing}
          rightPanelAvailable
          rightPanelOpen
          rightPanelShortcutLabel={null}
          terminalAvailable
          terminalOpen={false}
          terminalShortcutLabel={null}
        />
      </div>
      <RightPanelTabs
        inert
        mode="inline"
        widthStorageKey={`t3code:preview-panel-width:${threadKey}`}
        {...(standIn.defaultWidth === undefined ? {} : { defaultWidth: standIn.defaultWidth })}
        surfaces={standIn.surfaces}
        activeSurfaceId={standIn.activeSurfaceId}
        pendingSurfaceIds={NO_IDS}
        terminalLabelsById={NO_LABELS}
        onActivate={nothing}
        onCloseSurface={nothing}
        onCloseOtherSurfaces={nothing}
        onCloseSurfacesToRight={nothing}
        onCloseAllSurfaces={nothing}
        onCopyFilePath={nothing}
        availability={NONE_OFFERED}
        onAdd={nothing}
        onAddTerminal={nothing}
        liveAgentCount={0}
      >
        <Loading label="The panel" shape="room" />
      </RightPanelTabs>
    </>
  );
}
