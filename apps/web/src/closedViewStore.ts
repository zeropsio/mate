/**
 * The right-panel tabs a person closed, newest first, so Mod+Shift+T can put
 * them back. Held for the session only and dropped with the account: a tab is
 * a descriptor of something the account could see.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

import { randomUUID } from "./lib/utils";
import type { RightPanelSurface } from "./rightPanelStore";
import { onAccountLifetimeClose } from "./zerops/accountLifetime";

/** A terminal's shell ends with its tab, so it is never reopened. */
export type ReopenableSurface = Exclude<RightPanelSurface, { kind: "terminal" }>;

export interface ClosedView {
  readonly threadRef: ScopedThreadRef;
  readonly surface: ReopenableSurface;
}

export type ClosedViewEntry = ClosedView & { readonly id: string };

const CLOSED_VIEW_LIMIT = 20;

interface ClosedViewStoreState {
  entries: ClosedViewEntry[];
  /** Puts a closed tab on top of the history; returns its entry id. */
  remember: (view: ClosedView) => string;
  /** Sends an entry that could not reopen now to the back of the line. */
  defer: (id: string) => void;
  remove: (id: string) => void;
}

const sameTab = (entry: ClosedViewEntry, view: ClosedView): boolean =>
  entry.surface.id === view.surface.id &&
  scopedThreadKey(entry.threadRef) === scopedThreadKey(view.threadRef);

export const useClosedViewStore = create<ClosedViewStoreState>()((set) => ({
  entries: [],
  remember: (view) => {
    const id = randomUUID();
    set((state) => ({
      entries: [{ ...view, id }, ...state.entries.filter((entry) => !sameTab(entry, view))].slice(
        0,
        CLOSED_VIEW_LIMIT,
      ),
    }));
    return id;
  },
  defer: (id) =>
    set((state) => {
      const entry = state.entries.find((candidate) => candidate.id === id);
      return entry
        ? { entries: [...state.entries.filter((candidate) => candidate.id !== id), entry] }
        : state;
    }),
  remove: (id) => set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) })),
}));

onAccountLifetimeClose(() => {
  useClosedViewStore.setState({ entries: [] });
});
