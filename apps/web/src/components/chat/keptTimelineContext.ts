import { createContext } from "react";

/**
 * A conversation's list the pane keeps (`KeptTimelines`): out of sight while
 * the person is elsewhere, shown again when they come back. The keeper folds
 * its runs once it lets the list go, not the list as it hides; null for a
 * list nobody keeps.
 */
export const KeptTimelineContext = createContext<{ readonly shown: boolean } | null>(null);

export const KEPT_SHOWN = { shown: true } as const;
export const KEPT_OUT_OF_SIGHT = { shown: false } as const;
