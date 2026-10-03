/**
 * Presentation of the automatic admin gate. Zerops project env owns progress and claims; this
 * store holds only what the current account's screen shows. Again never discards the birth id.
 */
import {
  HQ_BIRTH_START,
  type HqBirthOutcome,
  type HqBirthRecord,
  type HqBirthStep,
} from "@t3tools/client-runtime/zerops/hq";
import { create } from "zustand";

import { captureAccountLifetime, onAccountLifetimeClose } from "./accountLifetime";

export interface HeldHqBirth {
  readonly record: HqBirthRecord;
  readonly running: boolean;
  readonly failed: Extract<HqBirthOutcome, { readonly ok: false }> | null;
}

export const useHqBirths = create<{ readonly byOrg: Readonly<Record<string, HeldHqBirth>> }>(
  () => ({ byOrg: {} }),
);
onAccountLifetimeClose(() => useHqBirths.setState({ byOrg: {} }));

export function bearHq(input: {
  readonly clientId: string;
  readonly run: (
    record: HqBirthRecord,
    moved: (patch: Partial<HqBirthRecord>) => void,
    again: boolean,
  ) => Promise<HqBirthOutcome>;
  readonly alreadyBorn: () => Promise<boolean>;
  readonly onBorn: () => void;
  readonly again?: boolean;
}): void {
  const { clientId } = input;
  const held = useHqBirths.getState().byOrg[clientId];
  if (held?.running || held?.record.step === "done") return;
  let record = held?.record ?? HQ_BIRTH_START;
  const isCurrent = captureAccountLifetime();
  const show = (next: HeldHqBirth) => {
    if (!isCurrent()) return;
    useHqBirths.setState((state) => ({ byOrg: { ...state.byOrg, [clientId]: next } }));
  };
  show({ record, running: true, failed: null });
  void (async () => {
    try {
      if (await input.alreadyBorn()) {
        if (!isCurrent()) return;
        show({ record: { ...record, step: "done" }, running: false, failed: null });
        input.onBorn();
        return;
      }
      if (!isCurrent()) return;
      const outcome = await input.run(
        record,
        (patch) => {
          record = { ...record, ...patch };
          show({ record, running: true, failed: null });
        },
        input.again === true,
      );
      if (!isCurrent()) return;
      if (outcome.ok) {
        show({ record: { ...record, step: "done" }, running: false, failed: null });
        input.onBorn();
      } else {
        show({ record, running: false, failed: outcome });
      }
    } catch (cause) {
      show({
        record,
        running: false,
        failed: {
          ok: false,
          step: record.step === "done" ? "ready" : record.step,
          reason: cause instanceof Error ? cause.message : "Zerops could not be reached.",
          uncertain: false,
        },
      });
    }
  })();
}

export type HqBirthView =
  | { readonly kind: "running"; readonly step: HqBirthStep | "done" }
  | { readonly kind: "failed"; readonly step: HqBirthStep; readonly reason: string };

export function hqBirthView(held: HeldHqBirth | undefined): HqBirthView | undefined {
  if (held === undefined) return undefined;
  if (held.failed === null) return { kind: "running", step: held.record.step };
  return { kind: "failed", step: held.failed.step, reason: held.failed.reason };
}
