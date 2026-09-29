/**
 * *Set up a crew* asked for from outside the Crew tab: the left menu's ⋯ asks
 * a Mate's tab for its setup sheet before the tab has drawn. The ask waits
 * here, one per Mate, until that Mate's tab draws and takes it up: the sheet
 * opens as the tab's own state, and the ask is spent — so a tab that goes
 * away with its sheet open never opens it again by itself. *Crew* drops an
 * ask no tab took up. In memory only: a reload forgets it.
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { useRightPanelStore } from "~/rightPanelStore";

interface CrewSetupAskState {
  /** The Mates whose tab is asked to open its setup sheet, by environment. */
  readonly asked: ReadonlySet<EnvironmentId>;
  readonly setAsked: (environmentId: EnvironmentId, asked: boolean) => void;
}

export const useCrewSetupAskStore = create<CrewSetupAskState>()((set) => ({
  asked: new Set(),
  setAsked: (environmentId, asked) =>
    set((state) => {
      if (state.asked.has(environmentId) === asked) return state;
      const next = new Set(state.asked);
      if (asked) next.add(environmentId);
      else next.delete(environmentId);
      return { asked: next };
    }),
}));

/**
 * One Mate's setup sheet in its Crew tab: the tab's own state, which the
 * menu's ask opens as the tab draws.
 */
export function useCrewSetupSheet(
  environmentId: EnvironmentId,
): readonly [boolean, (open: boolean) => void] {
  const asked = useCrewSetupAskStore((state) => state.asked.has(environmentId));
  const [open, setOpen] = useState(false);
  // Taken up while drawing, so the sheet opens with the tab rather than a
  // frame after it; spent once drawn.
  if (asked && !open) setOpen(true);
  useEffect(() => {
    if (asked) useCrewSetupAskStore.getState().setAsked(environmentId, false);
  }, [asked, environmentId]);
  return [open, setOpen];
}

/**
 * A Mate's conversation opened on its Crew tab, as its menu's *Crew* does —
 * and for *Set up a crew*, with the tab asked to open its setup sheet.
 */
export function openCrewTab(ref: ScopedThreadRef, options: { readonly setUp: boolean }): void {
  useRightPanelStore.getState().open(ref, "crew");
  useCrewSetupAskStore.getState().setAsked(ref.environmentId, options.setUp);
}
