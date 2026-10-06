/**
 * Presentation of the automatic admin gate. Zerops project env owns progress and claims; the
 * birth's writes are the account's operations and its waits Zerops's facts in the account's store
 * (`runHqBirth`). This tab keeps only what its screen shows, in the account's registry — memory
 * that goes with the account. Again never discards the birth id.
 */
import {
  HQ_BIRTH_START,
  type HqBirthOutcome,
  type HqBirthRecord,
  type HqBirthStep,
} from "@t3tools/client-runtime/zerops/hq";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import { captureAccountLifetime } from "./accountLifetime";

export interface HeldHqBirth {
  readonly record: HqBirthRecord;
  readonly running: boolean;
  readonly failed: Extract<HqBirthOutcome, { readonly ok: false }> | null;
}

/** The organization's birth as this tab shows it; `undefined` before it started here. */
export const hqBirthAtom = Atom.family((clientId: string) =>
  Atom.make<HeldHqBirth | undefined>(undefined).pipe(
    Atom.keepAlive,
    Atom.withLabel(`zerops:hq-birth:${clientId}`),
  ),
);

export function bearHq(input: {
  readonly registry: AtomRegistry.AtomRegistry;
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
  const { registry } = input;
  const atom = hqBirthAtom(input.clientId);
  const held = registry.get(atom);
  if (held?.running || held?.record.step === "done") return;
  let record = held?.record ?? HQ_BIRTH_START;
  const isCurrent = captureAccountLifetime();
  const show = (next: HeldHqBirth) => {
    if (isCurrent()) registry.set(atom, next);
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
