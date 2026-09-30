/**
 * A view of the Crew tab asked for from outside it: the left menu's ⋯ asks a
 * Mate's tab for its setup, and a crewmate's menu on the conversation's line
 * for its job or the crew's goal, before the tab has drawn. The ask waits
 * here, one per Mate, until that Mate's tab draws and takes it up: the view
 * opens as the tab's own state, and the ask is spent — so a tab that goes
 * away with a view open never opens it again by itself. *Crew* drops an ask
 * no tab took up. In memory only: a reload forgets it.
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { useRightPanelStore } from "~/rightPanelStore";

/**
 * What the Crew tab shows in place of its column: its setup, the crew's
 * goal, or one crewmate's job — `null` for a crewmate being added, the lead
 * when `lead`.
 */
export type CrewTabView =
  | { readonly kind: "setup" }
  | { readonly kind: "goal" }
  | { readonly kind: "job"; readonly handle: string | null; readonly lead?: boolean };

interface CrewViewAskState {
  /** The view each Mate's tab is asked to open, by environment. */
  readonly asked: ReadonlyMap<EnvironmentId, CrewTabView>;
  readonly ask: (environmentId: EnvironmentId, view: CrewTabView | null) => void;
}

export const useCrewViewAskStore = create<CrewViewAskState>()((set) => ({
  asked: new Map(),
  ask: (environmentId, view) =>
    set((state) => {
      if (view === null && !state.asked.has(environmentId)) return state;
      const next = new Map(state.asked);
      if (view === null) next.delete(environmentId);
      else next.set(environmentId, view);
      return { asked: next };
    }),
}));

/**
 * One Mate's Crew tab view: the tab's own state, which an ask from the left
 * menu or the conversation's line opens as the tab draws.
 */
export function useCrewView(
  environmentId: EnvironmentId,
): readonly [CrewTabView | null, (view: CrewTabView | null) => void] {
  const asked = useCrewViewAskStore((state) => state.asked.get(environmentId) ?? null);
  const [view, setView] = useState<CrewTabView | null>(null);
  const [taken, setTaken] = useState<CrewTabView | null>(null);
  // Taken up while drawing, so the view opens with the tab rather than a
  // frame after it; spent once drawn.
  if (asked !== null && asked !== taken) {
    setTaken(asked);
    setView(asked);
  }
  useEffect(() => {
    if (asked !== null) useCrewViewAskStore.getState().ask(environmentId, null);
  }, [asked, environmentId]);
  return [view, setView];
}

/**
 * A Mate's conversation opened on its Crew tab, as its menu's *Crew* does —
 * and for *Set up a crew*, with the tab asked to open its setup.
 */
export function openCrewTab(ref: ScopedThreadRef, options: { readonly setUp: boolean }): void {
  openCrewView(ref, options.setUp ? { kind: "setup" } : null);
}

/** The Crew tab opened on one of its views — a crewmate's job, the crew's goal — or on its column. */
export function openCrewView(ref: ScopedThreadRef, view: CrewTabView | null): void {
  useRightPanelStore.getState().open(ref, "crew");
  useCrewViewAskStore.getState().ask(ref.environmentId, view);
}
