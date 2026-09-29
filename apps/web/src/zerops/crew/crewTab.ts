/**
 * The Crew tab's one piece of state kept outside it: whether a Mate's
 * *Set up a crew* sheet is open. The left menu's ⋯ asks for the sheet before
 * the tab has drawn, and the tab opens it as it draws that Mate's crew
 * (`CrewSectionHost`); closing the sheet puts the ask away. In memory only: a
 * reload closes it.
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useCallback } from "react";
import { create } from "zustand";

import { useRightPanelStore } from "~/rightPanelStore";

interface CrewSetupSheetState {
  /** The Mates whose setup sheet is open, by environment. */
  readonly open: ReadonlySet<EnvironmentId>;
  readonly setOpen: (environmentId: EnvironmentId, open: boolean) => void;
}

export const useCrewSetupSheetStore = create<CrewSetupSheetState>()((set) => ({
  open: new Set(),
  setOpen: (environmentId, open) =>
    set((state) => {
      if (state.open.has(environmentId) === open) return state;
      const next = new Set(state.open);
      if (open) next.add(environmentId);
      else next.delete(environmentId);
      return { open: next };
    }),
}));

/** One Mate's setup sheet, open or not, handed to the tab the way `useState` would. */
export function useCrewSetupSheet(
  environmentId: EnvironmentId,
): readonly [boolean, (open: boolean) => void] {
  const open = useCrewSetupSheetStore((state) => state.open.has(environmentId));
  const setOpen = useCrewSetupSheetStore((state) => state.setOpen);
  const setThisOpen = useCallback(
    (next: boolean) => {
      setOpen(environmentId, next);
    },
    [environmentId, setOpen],
  );
  return [open, setThisOpen];
}

/**
 * A Mate's conversation opened on its Crew tab, as its menu's *Crew* does —
 * and for *Set up a crew*, with the setup sheet over it.
 */
export function openCrewTab(ref: ScopedThreadRef, options: { readonly setUp: boolean }): void {
  useRightPanelStore.getState().open(ref, "crew");
  if (options.setUp) useCrewSetupSheetStore.getState().setOpen(ref.environmentId, true);
}
