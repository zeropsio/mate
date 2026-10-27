/**
 * What the left menu holds, for the jump box to find (`JumpBox.logic.ts`).
 *
 * The tree publishes it after every draw — its Mates, projects, changes and
 * stops, in its own order and scope — so the box finds exactly what the menu
 * shows and nothing it hides. Data only: what the box does with a find is its
 * own, read fresh when it acts.
 *
 * `showable` says whether the menu can show what is found in it: on every
 * page but the settings, whose menu is their own. A phone's menu is put away
 * while the box is open and comes back to show the find
 * (`SidebarRevealBridge`); where it cannot come back, the box opens the
 * thing's own page instead. The index goes with the account it was drawn for.
 */
import { create } from "zustand";

import type { SidebarJumpIndex } from "../components/zerops/JumpBox.logic";
import { onAccountLifetimeClose } from "./accountLifetime";

export interface SidebarJumpState {
  /** Null until a menu drew once for this account. */
  readonly index: SidebarJumpIndex | null;
  /** The menu can show a find: it is on screen, or comes back to show it. */
  readonly showable: boolean;
  readonly publish: (index: SidebarJumpIndex) => void;
  readonly setShowable: (showable: boolean) => void;
}

export const useSidebarJump = create<SidebarJumpState>((set, get) => ({
  index: null,
  showable: false,
  publish: (index) => {
    if (get().index !== index) set({ index });
  },
  setShowable: (showable) => {
    if (get().showable !== showable) set({ showable });
  },
}));

onAccountLifetimeClose(() => {
  useSidebarJump.setState({ index: null, showable: false });
});
