/**
 * The creations this tab holds: what the person asked at Create or Add (`CreationAsk`), by the
 * creation's id, and where each stands — read off the operations its steps were recorded under
 * (`creationSteps`), never kept here. The ask is the person's input: held in this tab's memory
 * alone, forgotten with its account or a reload.
 */
import {
  creationsSteps,
  type CreationRead,
  type CreationStepRead,
} from "@t3tools/client-runtime/data";
import type { HqEndpoint } from "@t3tools/client-runtime/zerops/hq";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";
import { create } from "zustand";

import { onAccountLifetimeClose } from "./accountLifetime";
import { useNewMateDialog } from "./newMate";
import {
  creationEnds,
  creationOf,
  creationRunId,
  type CreationAsk,
  type NewProjectAsk,
  type NewProjectBirth,
} from "./newProjectBirth";
import { useProjection } from "./ZeropsAccountData";

interface CreationAsksState {
  readonly asks: Readonly<Record<string, CreationAsk>>;
}

const useCreationAsks = create<CreationAsksState>(() => ({ asks: {} }));

/** The creations a run of this tab is at: a second press never sends a step twice. */
const running = new Set<string>();

/** How each creation is run, by its id: from the press, and again on the person's *Try again*. */
const runners = new Map<string, (held: CreationAsk) => void>();

// What this tab was asked lives in its memory alone: a reload, or another account, starts with none.
onAccountLifetimeClose(() => {
  running.clear();
  runners.clear();
  useCreationAsks.setState({ asks: {} });
});

/**
 * Create or Add was pressed: the ask is held from now, by the creation's id — where its view is
 * (`newProjectView`) — and run.
 */
export function beginCreation(input: {
  readonly ask: NewProjectAsk;
  /** The official HQ held by the account. */
  readonly hq: HqEndpoint;
  /** Wall ms. */
  readonly now: number;
  readonly run: (held: CreationAsk) => void;
}): void {
  const held: CreationAsk = {
    ask: input.ask,
    startedAt: input.now,
    hq: input.hq,
    presses: 1,
    refusedHere: null,
  };
  useCreationAsks.setState((state) => ({ asks: { ...state.asks, [input.ask.birthId]: held } }));
  runners.set(input.ask.birthId, input.run);
  input.run(held);
}

/**
 * *Try again* on a creation a step stopped for certain: a New project resumes from that step, with
 * the same project; an Add is pressed whole again. One the platform may have taken is never tried
 * again: it could be made twice.
 */
export function tryCreationAgain(creation: NewProjectBirth): void {
  if (creation.failed === null || creation.failed.uncertain) return;
  const run = runners.get(creation.birthId);
  const held =
    creation.adds === undefined
      ? readCreationAsk(creation.birthId)
      : pressAddAgain(creation.birthId);
  if (run !== undefined && held !== undefined) run(held);
}

/** The ask this tab holds by the creation's id. */
function readCreationAsk(birthId: string): CreationAsk | undefined {
  return useCreationAsks.getState().asks[birthId];
}

function patchAsk(
  birthId: string,
  patch: (held: CreationAsk) => CreationAsk,
): CreationAsk | undefined {
  const held = readCreationAsk(birthId);
  if (held === undefined) return undefined;
  const next = patch(held);
  useCreationAsks.setState((state) => ({ asks: { ...state.asks, [birthId]: next } }));
  return next;
}

/** *Dismiss*: the creation is let go of, and its row leaves the menu. */
export function dismissCreation(birthId: string): void {
  runners.delete(birthId);
  useCreationAsks.setState((state) => {
    if (state.asks[birthId] === undefined) return state;
    const { [birthId]: _gone, ...rest } = state.asks;
    return { asks: rest };
  });
}

/** *Start over*: an Add refused for certain (`creationEnds`) is let go of, and asked for again, prefilled. */
export function startAddOver(creation: NewProjectBirth): void {
  const startOver = creationEnds(creation)?.startOver;
  if (startOver == null) return;
  dismissCreation(creation.birthId);
  useNewMateDialog.getState().ask(startOver.groupId, startOver.again);
}

/** An Add pressed whole again, under its next press's id (`creationRunId`). */
function pressAddAgain(birthId: string): CreationAsk | undefined {
  return patchAsk(birthId, (held) => ({ ...held, presses: held.presses + 1, refusedHere: null }));
}

/** This tab refused an Add's press before it sent anything: why. */
export function refuseAddHere(birthId: string, reason: string): void {
  patchAsk(birthId, (held) => ({ ...held, refusedHere: reason }));
}

/** Runs a creation's steps, one run at a time: a press while one is at it does nothing. */
export async function runOnce(birthId: string, run: () => Promise<void>): Promise<void> {
  if (running.has(birthId)) return;
  running.add(birthId);
  try {
    await run();
  } finally {
    running.delete(birthId);
  }
}

const NOT_SENT: CreationStepRead = { state: "not-sent", attempt: 0 };
/** A creation no operation of has been recorded yet, as outside an account. */
const UNSENT_READ: CreationRead = {
  steps: { app: NOT_SENT, birth: NOT_SENT, project: NOT_SENT },
  appId: null,
  birthId: null,
  projectId: null,
};
const NO_READS = Atom.make<ReadonlyArray<CreationRead>>([]);

/** Every creation this tab holds, as its surfaces draw it, in the order it was asked. */
export function useCreations(): ReadonlyArray<NewProjectBirth> {
  const asks = useCreationAsks((state) => state.asks);
  const held = useMemo(() => Object.values(asks), [asks]);
  const keys = useMemo(
    () => held.map((each) => ({ orgId: each.ask.organizationId, creationId: creationRunId(each) })),
    [held],
  );
  const reads = useProjection(creationsSteps, keys, NO_READS);
  return useMemo(
    () => held.map((each, index) => creationOf(each, reads[index] ?? UNSENT_READ)),
    [held, reads],
  );
}

/** The creation this tab holds by its id, as its surfaces draw it. */
export function useCreation(birthId: string): NewProjectBirth | undefined {
  const creations = useCreations();
  return useMemo(
    () => creations.find((creation) => creation.birthId === birthId),
    [birthId, creations],
  );
}
