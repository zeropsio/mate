import { createContext } from "react";

/**
 * A conversation's list the pane keeps (`KeptTimelines`): out of sight while
 * the person is elsewhere, shown again when they come back. The keeper folds
 * its runs once it lets the list go, not the list as it hides, and hears when
 * the open one stands where it stays; null for a list nobody keeps.
 */
export interface KeptTimelineState {
  readonly shown: boolean;
  /** The open list's word on whether it stands where it stays, by its conversation. */
  readonly onStanding?: (threadKey: string, standing: boolean) => void;
}

export const KeptTimelineContext = createContext<KeptTimelineState | null>(null);

export const KEPT_OUT_OF_SIGHT: KeptTimelineState = { shown: false };
