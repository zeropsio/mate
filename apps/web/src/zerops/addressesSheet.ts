/**
 * Which place's addresses sheet is open: one sheet at a time, opened from the globe's popover,
 * the project's ··· menu, Chief's card or the release review, and closed by the person. A place
 * is one Zerops project — production, a stage or a Mate's own — and the sheet's switch moves
 * between the places of the same application.
 */
import { create } from "zustand";

export interface AddressesSheetTarget {
  readonly orgId: string;
  readonly projectId: string;
  /** The application whose places the switch offers; absent for a project outside one. */
  readonly groupId?: string;
  /** Opened to add a domain: the sheet starts in its field. */
  readonly intent?: "add-domain";
}

interface AddressesSheetState {
  readonly target: AddressesSheetTarget | null;
  readonly open: (target: AddressesSheetTarget) => void;
  readonly close: () => void;
}

export const useAddressesSheet = create<AddressesSheetState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));
