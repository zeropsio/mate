/**
 * *Put it live* across the app (`putLive.logic.ts`): which application's sheet is open. The sheet
 * opens over whatever is on screen — the conversation, a review — and its press is one start at
 * HQ; how that run stands is the application's navigation operation (`usePutLiveStanding`), on
 * every device, and nothing of it is kept in the tab or the browser. None outlives its account:
 * another account on the tab starts with no sheet open.
 */
import { useAtomValue } from "@effect/atom-react";
import { useCallback } from "react";
import { create } from "zustand";

import { onAccountLifetimeClose } from "./accountLifetime";
import { putLiveOf, type PutLiveStanding } from "./putLive.logic";
import { applicationOperationAtom } from "./useEnvironmentOperation";

/**
 * The sheet, asked for a project from its own doors: what is merged goes live. A change never asks
 * for it: its door is its review's Merge (the owner, 2026-10-18).
 */
export interface PutLiveAsk {
  readonly groupId: string;
}

interface PutLiveState {
  readonly asked: PutLiveAsk | null;
  readonly ask: (ask: PutLiveAsk) => void;
  readonly close: () => void;
}

export const usePutLive = create<PutLiveState>((set) => ({
  asked: null,
  ask: (ask) => set({ asked: ask }),
  close: () => set({ asked: null }),
}));

onAccountLifetimeClose(() => {
  usePutLive.setState({ asked: null });
});

/** Opens the sheet from a project's own door: what is merged goes live. */
export function useOpenPutLive(): (groupId: string) => void {
  const ask = usePutLive((state) => state.ask);
  return useCallback((groupId) => ask({ groupId }), [ask]);
}

/** How a project's *Put it live* stands at HQ, for the person signed in (`putLiveOf`). */
export function usePutLiveStanding(groupId: string): PutLiveStanding {
  return putLiveOf(useAtomValue(applicationOperationAtom(groupId)));
}
