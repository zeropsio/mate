/**
 * *Put it live* across the app (`putLive.logic.ts`): the sheet asked for, and each project's run
 * in the air. The sheet opens over whatever is on screen — the conversation, a review — and the
 * run outlives it: its host drives it (`PutLiveHost`), and the conversation draws it as its one
 * wait row, then as the live card, until the person puts the card away.
 *
 * Kept in memory for the tab: what a run made stays in HQ and on the platform, and the menu and the
 * project say it from there after a reload. The browser keeps one fact of it, the production the
 * person's run made (`putLiveMemory.ts`), so a reload says how that attempt ended
 * (`putLiveResumed`) until it goes live or its card is put away. A run is its organization's, driven
 * only while that one is shown, and none outlives its account: another account on the tab starts
 * with none.
 */
import { useCallback } from "react";
import { create } from "zustand";

import { onAccountLifetimeClose, onAccountLifetimeOpen } from "./accountLifetime";
import {
  putLiveStep,
  startPutLive,
  type PutLiveChange,
  type PutLiveEvent,
  type PutLiveRun,
} from "./putLive.logic";
import {
  forgetPutLiveProduction,
  keepPutLiveProduction,
  keptPutLiveProductions,
} from "./putLiveMemory";

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
  /** The production the person's own run made, by project, until it went live or was put away. */
  readonly kept: ReadonlyMap<string, string>;
  readonly ask: (ask: PutLiveAsk) => void;
  readonly close: () => void;
  /** Pressed: the sheet closes and the run starts, one per project. */
  readonly start: (input: {
    readonly orgId: string;
    readonly groupId: string;
    readonly project: string;
    readonly change: PutLiveChange | undefined;
  }) => void;
  readonly step: (groupId: string, event: PutLiveEvent) => void;
  /** A run said from the project's flow (`putLiveResumed`), kept from here; never one under way. */
  readonly restore: (run: PutLiveRun) => void;
  /** The live card, put away — or the attempt, no longer the person's. */
  readonly forget: (groupId: string) => void;
}

function keptOf(kept: ReadonlyMap<string, string>, groupId: string, productionId?: string) {
  const next = new Map(kept);
  if (productionId === undefined) {
    next.delete(groupId);
    forgetPutLiveProduction(groupId);
  } else {
    next.set(groupId, productionId);
    keepPutLiveProduction(groupId, productionId);
  }
  return next;
}

export const usePutLive = create<PutLiveState>((set, get) => ({
  asked: null,
  runs: new Map(),
  // An account opened before this module loaded has its memory read here.
  kept: new Map(Object.entries(keptPutLiveProductions())),
  ask: (ask) => set({ asked: ask }),
  close: () => set({ asked: null }),
  start: (input) => {
    const current = get().runs.get(input.groupId);
    if (current !== undefined && current.phase !== "live" && current.phase !== "failed") return;
    set({
      asked: null,
      runs: new Map(get().runs).set(input.groupId, startPutLive({ ...input, at: Date.now() })),
    });
  },
  step: (groupId, event) => {
    const current = get().runs.get(groupId);
    if (current === undefined) return;
    const next = putLiveStep(current, event, Date.now());
    if (next === current) return;
    const runs = new Map(get().runs).set(groupId, next);
    // Production the run made is the person's from the moment the platform took it.
    const made = event.kind === "accepted" || event.kind === "created";
    set(
      made && next.productionId !== undefined
        ? { runs, kept: keptOf(get().kept, groupId, next.productionId) }
        : next.phase === "live"
          ? { runs, kept: keptOf(get().kept, groupId) }
          : { runs },
    );
  },
  restore: (run) => {
    const current = get().runs.get(run.groupId);
    if (current !== undefined && current.phase !== "live" && current.phase !== "failed") return;
    const runs = new Map(get().runs).set(run.groupId, run);
    set(run.phase === "live" ? { runs, kept: keptOf(get().kept, run.groupId) } : { runs });
  },
  forget: (groupId) => {
    const runs = new Map(get().runs);
    const had = runs.delete(groupId);
    if (get().kept.has(groupId)) set({ runs, kept: keptOf(get().kept, groupId) });
    else if (had) set({ runs });
  },
}));

onAccountLifetimeOpen(() => {
  usePutLive.setState({ kept: new Map(Object.entries(keptPutLiveProductions())) });
});

onAccountLifetimeClose(() => {
  usePutLive.setState({ asked: null, runs: new Map(), kept: new Map() });
});

/** The runs of the organization shown: the only ones driven. */
export function putLiveRunsIn(
  runs: ReadonlyMap<string, PutLiveRun>,
  orgId: string | undefined,
): ReadonlyArray<PutLiveRun> {
  return [...runs.values()].filter((run) => orgId !== undefined && run.orgId === orgId);
}

/** Opens the sheet from a project's own door: what is merged goes live. */
export function useOpenPutLive(): (groupId: string) => void {
  const ask = usePutLive((state) => state.ask);
  return useCallback((groupId) => ask({ groupId }), [ask]);
}

/** A project's run, while there is one. */
export function usePutLiveRun(groupId: string | undefined): PutLiveRun | undefined {
  return usePutLive((state) => (groupId === undefined ? undefined : state.runs.get(groupId)));
}
