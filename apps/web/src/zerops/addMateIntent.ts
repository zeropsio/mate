import { create } from "zustand";

/**
 * "Add a Mate to this project", asked from somewhere that cannot answer it.
 *
 * The left menu's add button carries a project's name and a verb, and the
 * dialog that performs the verb belongs to the projects screen. The button
 * used to navigate there and stop, which reads as a control that does nothing
 * at all when the projects screen is already open (measured 2026-09-20).
 *
 * So the ask travels: the menu records which group it was made for and
 * navigates, and the screen answers it once on arrival. One shot — `take`
 * clears it, so a later visit to the projects screen does not reopen a dialog
 * nobody asked for.
 */
interface AddMateIntent {
  readonly groupId: string | null;
  readonly request: (groupId: string) => void;
  readonly take: () => string | null;
}

export const useAddMateIntent = create<AddMateIntent>((set, get) => ({
  groupId: null,
  request: (groupId: string) => {
    set({ groupId });
  },
  take: () => {
    const { groupId } = get();
    if (groupId !== null) set({ groupId: null });
    return groupId;
  },
}));
