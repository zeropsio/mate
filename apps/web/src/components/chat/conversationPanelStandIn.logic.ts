/**
 * The conversation's right panel while the conversation itself is on its way: where the thread's
 * panel was left open beside it (its state is kept per thread), the opening stands in the column
 * the conversation will draw and the panel waits beside it, so the page splits from its first
 * frame rather than when the conversation takes over. Pure.
 */
import type { RightPanelSurface, ThreadRightPanelState } from "~/rightPanelStore";

/** A Chief's overview opens wide enough for two of its cards side by side (380 + 16 + 380, 24 each side). */
export const CHIEF_PANEL_WIDTH = 840;

export interface ConversationPanelStandIn {
  readonly surfaces: ReadonlyArray<RightPanelSurface>;
  readonly activeSurfaceId: string | null;
  /** The panel's width before the person resizes it; undefined for the panel's own default. */
  readonly defaultWidth: number | undefined;
}

/**
 * The panel's width before the person resizes it: a Chief's at its overview's width — known from
 * the overview it holds before the directory names the Chief — else the panel's own default.
 */
export function conversationPanelWidth(input: {
  readonly chief: boolean;
  readonly surfaces: ReadonlyArray<RightPanelSurface>;
}): number | undefined {
  return input.chief || input.surfaces.some((surface) => surface.kind === "overview")
    ? CHIEF_PANEL_WIDTH
    : undefined;
}

export function conversationPanelStandIn(input: {
  readonly panel: ThreadRightPanelState;
  /** A narrow window draws the panel as a sheet over the page, not beside it. */
  readonly sheet: boolean;
  readonly chief: boolean;
}): ConversationPanelStandIn | null {
  if (!input.panel.isOpen || input.sheet) return null;
  return {
    surfaces: input.panel.surfaces,
    activeSurfaceId: input.panel.activeSurfaceId,
    defaultWidth: conversationPanelWidth({ chief: input.chief, surfaces: input.panel.surfaces }),
  };
}
