/**
 * An organization's HQ, born at an owner's or an admin's first visit (ADR 0001): the gate
 * (`hqGate.ts`) runs it the moment it shows, and shows how far it has got.
 *
 * - **Kept across reloads:** what it has made so far is kept in this browser for the account
 *   (`accountLocalStorage`), so a reload — or the next sign-in — goes on from the step it reached,
 *   never from the start over a project it made already. It is forgotten once HQ stands.
 * - **One tab at a time:** a birth holds the browser's lock for its organization; a second tab
 *   waits its turn, then finds HQ born, or goes on from what the first one kept.
 * - **A stop** names its step, and *Try again* goes on from it. After a stop where Zerops may have
 *   made HQ's project unseen (`importTag`), *Try again* looks for the project carrying the birth's
 *   tag and never imports (`runHqBirth`); *Start over* begins anew, its words sending the person to
 *   Zerops first. No project is ever taken for HQ's by its name or the `mate:hq` tag alone.
 */
import {
  HQ_BIRTH_START,
  HQ_BIRTH_STEPS,
  type HqBirthOutcome,
  type HqBirthRecord,
  type HqBirthStep,
} from "@t3tools/client-runtime/zerops/hq";
import * as Schema from "effect/Schema";
import { create } from "zustand";

import {
  accountLocalStorage,
  captureAccountLifetime,
  onAccountLifetimeClose,
} from "./accountLifetime";
import { browserLocks, withExclusiveLock, type LockManagerLike } from "./mateLocks";

/** What this browser keeps of each organization's birth. */
export interface HqBirthStorage {
  readonly read: (clientId: string) => HqBirthRecord | undefined;
  readonly write: (clientId: string, record: HqBirthRecord) => void;
  readonly forget: (clientId: string) => void;
}

const HQ_BIRTHS_STORAGE_KEY = "mate:zerops:hq-births";

const RecordSchema = Schema.Struct({
  step: Schema.Literals([...HQ_BIRTH_STEPS, "done"]),
  importTag: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
  serviceId: Schema.NullOr(Schema.String),
  address: Schema.NullOr(Schema.String),
  deployProcessId: Schema.NullOr(Schema.String),
});
const KeptSchema = Schema.fromJsonString(Schema.Record(Schema.String, RecordSchema));
const readKept = Schema.decodeUnknownSync(KeptSchema);
const writeKept = Schema.encodeSync(KeptSchema);

function kept(): Readonly<Record<string, HqBirthRecord>> {
  try {
    const stored = accountLocalStorage.getItem(HQ_BIRTHS_STORAGE_KEY);
    return stored === null ? {} : readKept(stored);
  } catch {
    // Unreadable: nothing kept, and the birth reads the member list before it makes anything.
    return {};
  }
}

function keep(births: Readonly<Record<string, HqBirthRecord>>): void {
  try {
    accountLocalStorage.setItem(HQ_BIRTHS_STORAGE_KEY, writeKept(births));
  } catch {
    // Storage refused: the birth goes on, and a reload goes on from the member list's word.
  }
}

/**
 * The account's births, in this browser. Not forgotten at sign-out: a project HQ's birth made
 * stays made, and the next sign-in goes on from it.
 */
export const accountHqBirthStorage: HqBirthStorage = {
  read: (clientId) => kept()[clientId],
  write: (clientId, record) => keep({ ...kept(), [clientId]: record }),
  forget: (clientId) => {
    const { [clientId]: _gone, ...rest } = kept();
    keep(rest);
  },
};

/** How a birth ended: HQ stands, or the step that stopped it. */
export type HqBirthEnd = { readonly ok: true } | Extract<HqBirthOutcome, { readonly ok: false }>;

/**
 * One birth, holding the organization's lock: HQ found born already, or a run from what this
 * browser kept — from nothing where asked to start over — keeping each step it reaches.
 */
export async function bearHqOnce(input: {
  readonly clientId: string;
  readonly locks: LockManagerLike | undefined;
  readonly storage: HqBirthStorage;
  readonly startOver: boolean;
  /** Whether the member list names this organization's HQ now. */
  readonly alreadyBorn: () => Promise<boolean>;
  /** `runHqBirth` over this tab's platform, from a record. */
  readonly run: (
    record: HqBirthRecord,
    moved: (patch: Partial<HqBirthRecord>) => void,
  ) => Promise<HqBirthOutcome>;
  /** Told of the record as it moves. */
  readonly moved: (record: HqBirthRecord) => void;
}): Promise<HqBirthEnd> {
  const { clientId, storage } = input;
  return withExclusiveLock(input.locks, `mate:hq-birth:${clientId}`, async () => {
    let record = input.startOver ? HQ_BIRTH_START : (storage.read(clientId) ?? HQ_BIRTH_START);
    try {
      if (await input.alreadyBorn()) {
        storage.forget(clientId);
        return { ok: true };
      }
    } catch (cause) {
      return {
        ok: false,
        step: record.step === "done" ? "ready" : record.step,
        reason: cause instanceof Error ? cause.message : "Zerops could not be reached.",
        uncertain: false,
      };
    }
    storage.write(clientId, record);
    input.moved(record);
    const outcome = await input.run(record, (patch) => {
      record = { ...record, ...patch };
      storage.write(clientId, record);
      input.moved(record);
    });
    if (!outcome.ok) return outcome;
    storage.forget(clientId);
    return { ok: true };
  });
}

export interface HeldHqBirth {
  readonly record: HqBirthRecord;
  readonly running: boolean;
  readonly failed: {
    readonly step: HqBirthStep;
    readonly reason: string;
    readonly uncertain: boolean;
  } | null;
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
 * Runs the organization's HQ birth — on the gate's first showing, on *Try again*, or from nothing
 * on *Start over*. Nothing while it runs. A birth that ended with HQ standing is held as done.
 */
export function bearHq(input: {
  readonly clientId: string;
  readonly run: (
    record: HqBirthRecord,
    moved: (patch: Partial<HqBirthRecord>) => void,
  ) => Promise<HqBirthOutcome>;
  readonly alreadyBorn: () => Promise<boolean>;
  /** HQ stands: its anchor is in the member list for every surface to read. */
  readonly onBorn: () => void;
  readonly storage?: HqBirthStorage;
  readonly locks?: LockManagerLike | undefined;
  readonly startOver?: boolean;
}): void {
  const { clientId } = input;
  const storage = input.storage ?? accountHqBirthStorage;
  const startOver = input.startOver === true;
  if (useHqBirths.getState().byOrg[clientId]?.running === true) return;
  const record = startOver ? HQ_BIRTH_START : (storage.read(clientId) ?? HQ_BIRTH_START);
  useHqBirths.setState((state) => ({
    byOrg: { ...state.byOrg, [clientId]: { record, running: true, failed: null } },
  }));
  const isCurrent = captureAccountLifetime();
  void bearHqOnce({
    clientId,
    locks: "locks" in input ? input.locks : browserLocks(),
    storage,
    startOver,
    alreadyBorn: input.alreadyBorn,
    run: input.run,
    moved: (moved) => {
      if (isCurrent()) patch(clientId, { record: moved });
    },
  }).then((ended) => {
    if (!isCurrent()) return;
    if (ended.ok) {
      // Held as done until the member list names HQ and the gate opens: never borne twice.
      useHqBirths.setState((state) => {
        const done = state.byOrg[clientId];
        return done === undefined
          ? state
          : {
              byOrg: {
                ...state.byOrg,
                [clientId]: { ...done, record: { ...done.record, step: "done" }, running: false },
              },
            };
      });
      input.onBorn();
      return;
    }
    patch(clientId, {
      running: false,
      failed: { step: ended.step, reason: ended.reason, uncertain: ended.uncertain },
    });
  });
}

/** A held birth as the gate draws it: the step it is on, or the one that stopped it. */
export type HqBirthView =
  | { readonly kind: "running"; readonly step: HqBirthStep | "done" }
  | {
      readonly kind: "failed";
      readonly step: HqBirthStep;
      readonly reason: string;
      /** Zerops may have made HQ's project unseen: beginning anew is offered beside going on. */
      readonly startOver: boolean;
    };

export function hqBirthView(held: HeldHqBirth | undefined): HqBirthView | undefined {
  if (held === undefined) return undefined;
  if (held.failed === null) return { kind: "running", step: held.record.step };
  return {
    kind: "failed",
    step: held.failed.step,
    reason: held.failed.reason,
    startOver: held.failed.uncertain,
  };
}
