/**
 * The menu's folds, lent to the closed menu's rail (`SidebarRail`): the tree holds which groups
 * stand open (`collapsedProjects.ts`) and writes them here as they change, with its own fold, so a
 * group opened on the rail stands open in the menu and the other way round. While no tree is drawn,
 * every group stands folded, as the menu starts them, and nothing folds.
 */
import { create } from "zustand";

import type { ProjectFolds } from "./collapsedProjects";

export interface MenuFoldsState {
  readonly folds: ProjectFolds;
  /** The tree's own fold: `open` a group, or fold it. */
  readonly fold: ((groupId: string, open: boolean) => void) | null;
  readonly lend: (folds: ProjectFolds, fold: (groupId: string, open: boolean) => void) => void;
  readonly withdraw: () => void;
}

const NO_FOLDS: ProjectFolds = { closed: new Set(), opened: new Set() };

export const useMenuFolds = create<MenuFoldsState>((set, get) => ({
  folds: NO_FOLDS,
  fold: null,
  lend: (folds, fold) => {
    const current = get();
    if (current.folds !== folds || current.fold !== fold) set({ folds, fold });
  },
  withdraw: () => {
    set({ folds: NO_FOLDS, fold: null });
  },
}));
