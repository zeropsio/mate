/**
 * Folding every project in the left menu at once, from its top row (the owner, 2026-10-12: "how
 * about fold / unfold all here?"). The tree says whether any project with Mates stands open, and
 * answers each ask to fold or open them all once (`withProjectsFolded`).
 */
import { create } from "zustand";

export interface MenuFoldsState {
  /** Some project with Mates stands open; `null` while the menu draws none to fold. */
  readonly anyOpen: boolean | null;
  /** The latest ask: fold them all, or open them all. */
  readonly asked: { readonly fold: boolean; readonly seq: number } | null;
  readonly setAnyOpen: (anyOpen: boolean | null) => void;
  readonly foldAll: (fold: boolean) => void;
}

export const useMenuFolds = create<MenuFoldsState>((set) => ({
  anyOpen: null,
  asked: null,
  setAnyOpen: (anyOpen) => {
    set((state) => (state.anyOpen === anyOpen ? state : { anyOpen }));
  },
  foldAll: (fold) => {
    set((state) => ({ asked: { fold, seq: (state.asked?.seq ?? 0) + 1 } }));
  },
}));
