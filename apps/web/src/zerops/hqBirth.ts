/**
 * *Set up HQ* — an organization's HQ born on its own, from the projects page's Tools row: for an
 * owner or an admin of an organization with none, before any project (New project brings one
 * along too, `newProjectBirth.ts`).
 *
 * This tab holds the birth — what it made so far, and where it stopped and why — and nothing else
 * does: a reload forgets it, as it forgets a New project the platform has not taken. *Try again*
 * resumes from what it made (`runHqBirth`); never a birth whose project the platform may have
 * made though its answer was lost, which a second try could make twice.
 */
import {
  HQ_BIRTH_DOING,
  HQ_BIRTH_START,
  type HqBirthOutcome,
  type HqBirthRecord,
} from "@t3tools/client-runtime/zerops/hq";
import { create } from "zustand";

import type { HqBirthView } from "../components/zerops/ZeropsHqTool.logic";
import { captureAccountLifetime, onAccountLifetimeClose } from "./accountLifetime";

export interface HeldHqBirth {
  readonly record: HqBirthRecord;
  readonly running: boolean;
  readonly failed: { readonly reason: string; readonly uncertain: boolean } | null;
}

/** By organization: one HQ each. */
export const useHqBirths = create<{ readonly byOrg: Readonly<Record<string, HeldHqBirth>> }>(
  () => ({ byOrg: {} }),
);

onAccountLifetimeClose(() => useHqBirths.setState({ byOrg: {} }));

function patch(clientId: string, next: Partial<HeldHqBirth> | null): void {
  useHqBirths.setState((state) => {
    const { [clientId]: held, ...rest } = state.byOrg;
    if (next === null) return { byOrg: rest };
    if (held === undefined) return state;
    return { byOrg: { ...rest, [clientId]: { ...held, ...next } } };
  });
}

/**
 * Runs the organization's HQ birth from what it made so far: begins it, or — *Try again* — goes
 * on from the step that stopped it. Nothing while it runs, or after a stop that may have made its
 * project anyway.
 */
export function bearHq(input: {
  readonly clientId: string;
  /** `runHqBirth` over this tab's platform, from a record. */
  readonly run: (
    record: HqBirthRecord,
    moved: (patch: Partial<HqBirthRecord>) => void,
  ) => Promise<HqBirthOutcome>;
  /** The HQ stands: its anchor is in the member list for every surface to read. */
  readonly onBorn: () => void;
}): void {
  const { clientId } = input;
  const held = useHqBirths.getState().byOrg[clientId];
  if (held?.running === true || held?.failed?.uncertain === true) return;
  let record = held?.record ?? HQ_BIRTH_START;
  useHqBirths.setState((state) => ({
    byOrg: { ...state.byOrg, [clientId]: { record, running: true, failed: null } },
  }));
  const isCurrent = captureAccountLifetime();
  void input
    .run(record, (moved) => {
      record = { ...record, ...moved };
      if (isCurrent()) patch(clientId, { record });
    })
    .then((outcome) => {
      if (!isCurrent()) return;
      if (outcome.ok) {
        patch(clientId, null);
        input.onBorn();
        return;
      }
      patch(clientId, {
        running: false,
        failed: {
          reason: `${HQ_BIRTH_DOING[outcome.step]}: ${outcome.reason}`,
          uncertain: outcome.uncertain,
        },
      });
    });
}

/** A held birth as the Tools row draws it; none where this tab holds no birth. */
export function hqBirthView(held: HeldHqBirth | undefined): HqBirthView | undefined {
  if (held === undefined) return undefined;
  if (held.failed !== null) {
    return { kind: "failed", reason: held.failed.reason, tryAgain: !held.failed.uncertain };
  }
  const step = held.record.step;
  return { kind: "running", doing: step === "done" ? "Setting up HQ" : HQ_BIRTH_DOING[step] };
}
