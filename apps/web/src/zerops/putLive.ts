/**
 * *Put it live* across the app (`putLive.logic.ts`): the sheet asked for, and each project's run
 * in the air. The sheet opens over whatever is on screen — the conversation, a review — and the
 * run outlives it: its host drives it (`PutLiveHost`), and the conversation draws it as its one
 * wait row, then as the live card, until the person puts the card away.
 *
 * Kept in memory for the tab: what a run made stays in HQ and on the platform, and the menu and the
 * project say it from there after a reload.
 */
import { useCallback } from "react";
import { create } from "zustand";

import {
  putLiveStep,
  startPutLive,
  type PutLiveChange,
  type PutLiveEvent,
  type PutLiveRun,
} from "./putLive.logic";

/**
 * The sheet, asked for a project: from a change, the change it carries live, read when it was
 * asked; from the project itself, none — what is merged goes live.
 */
export interface PutLiveAsk {
  readonly groupId: string;
  readonly change?: (PutLiveChange & { readonly description?: string | undefined }) | undefined;
}

interface PutLiveState {
  readonly asked: PutLiveAsk | null;
  readonly runs: ReadonlyMap<string, PutLiveRun>;
  readonly ask: (ask: PutLiveAsk) => void;
  readonly close: () => void;
  /** Pressed: the sheet closes and the run starts, one per project. */
  readonly start: (input: {
    readonly groupId: string;
    readonly project: string;
    readonly change: PutLiveChange | undefined;
  }) => void;
  readonly step: (groupId: string, event: PutLiveEvent) => void;
  /** The live card, put away. */
  readonly forget: (groupId: string) => void;
}

export const usePutLive = create<PutLiveState>((set, get) => ({
  asked: null,
  runs: new Map(),
  ask: (ask) => set({ asked: ask }),
  close: () => set({ asked: null }),
  start: (input) => {
    const current = get().runs.get(input.groupId);
    if (current !== undefined && current.phase !== "live" && current.phase !== "failed") return;
    set({ asked: null, runs: new Map(get().runs).set(input.groupId, startPutLive(input)) });
  },
  step: (groupId, event) => {
    const current = get().runs.get(groupId);
    if (current === undefined) return;
    const next = putLiveStep(current, event);
    if (next !== current) set({ runs: new Map(get().runs).set(groupId, next) });
  },
  forget: (groupId) => {
    const runs = new Map(get().runs);
    if (runs.delete(groupId)) set({ runs });
  },
}));

/** Opens the sheet from a project's own door: what is merged goes live. */
export function useOpenPutLive(): (groupId: string) => void {
  const ask = usePutLive((state) => state.ask);
  return useCallback((groupId) => ask({ groupId }), [ask]);
}

/** A project's run, while there is one. */
export function usePutLiveRun(groupId: string | undefined): PutLiveRun | undefined {
  return usePutLive((state) => (groupId === undefined ? undefined : state.runs.get(groupId)));
}
