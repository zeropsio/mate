/**
 * Registration records (DESIGN §2.C C1): the account's personal context of which Mate targets
 * it registered, under one account-scoped key. A record is never authority for existence or
 * access; absent means "not remembered here", never "not yours".
 */
import type { EnvironmentId } from "@t3tools/contracts";

import type { TargetKey } from "./exchangeDriver.ts";

export const REGISTRATION_RECORDS_KEY = "zerops-mate.registration-records.v1";

/**
 * The keys records replace. The third, the door list `zerops-mate.zerops-environments.v1`, adds
 * nothing to a record: every record comes from a door exchange, and an environment the targets
 * list lacks has no target key.
 */
export const LEGACY_REGISTRATION_KEYS = {
  /** `[{ key, environmentId }]`. */
  targets: "environment-targets:v1",
  /** `{ [environmentId]: { projectId, orgId, … } }`. */
  projectRefs: "zerops-mate.zerops-environment-project-ref.v1",
} as const;

export interface RecordProjectRef {
  readonly projectId: string;
  readonly orgId: string;
}

export interface RegistrationRecord {
  readonly targetKey: TargetKey;
  readonly environmentId: EnvironmentId;
  /** The Mate container's origin the exchange ran at; null for a record from before the switch. */
  readonly origin: string | null;
  readonly projectRef: RecordProjectRef | null;
  readonly name: string | null;
}

/** One account's storage, synchronous: the first prompt reads it inside a route effect. */
export interface RecordsStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

export interface RegistrationRecords {
  /** Every record this account keeps; the same array until the stored records change. */
  readonly list: () => ReadonlyArray<RegistrationRecord>;
  /**
   * Stores the record in place of its target's older one, keeping what the older one knew and
   * this one does not; false when nothing changed.
   */
  readonly remember: (record: RegistrationRecord) => boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value !== "";

const parseJson = (raw: string | null): unknown => {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const projectRefOf = (value: unknown): RecordProjectRef | null =>
  isObject(value) && nonEmpty(value.projectId) && nonEmpty(value.orgId)
    ? { projectId: value.projectId, orgId: value.orgId }
    : null;

/** Records from what a build before the switch stored: the targets, joined to their project refs. */
export function importLegacyRecords(legacy: {
  readonly targets: string | null;
  readonly projectRefs: string | null;
}): ReadonlyArray<RegistrationRecord> {
  const targets = parseJson(legacy.targets);
  const refs = parseJson(legacy.projectRefs);
  if (!Array.isArray(targets)) return [];
  return targets.flatMap((target: unknown): ReadonlyArray<RegistrationRecord> => {
    if (!isObject(target) || !nonEmpty(target.key) || !nonEmpty(target.environmentId)) return [];
    return [
      {
        targetKey: target.key,
        environmentId: target.environmentId as EnvironmentId,
        origin: null,
        projectRef: isObject(refs) ? projectRefOf(refs[target.environmentId]) : null,
        name: null,
      },
    ];
  });
}

const isRecord = (value: unknown): value is RegistrationRecord =>
  isObject(value) &&
  nonEmpty(value.targetKey) &&
  nonEmpty(value.environmentId) &&
  (value.origin === null || nonEmpty(value.origin)) &&
  (value.projectRef === null || projectRefOf(value.projectRef) !== null) &&
  (value.name === null || nonEmpty(value.name));

/** The stored records; anything unreadable is dropped, never re-imported. */
export function parseRegistrationRecords(raw: string): ReadonlyArray<RegistrationRecord> {
  const parsed = parseJson(raw);
  return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
}

const sameRecord = (left: RegistrationRecord, right: RegistrationRecord): boolean =>
  left.targetKey === right.targetKey &&
  left.environmentId === right.environmentId &&
  left.origin === right.origin &&
  left.name === right.name &&
  left.projectRef?.projectId === right.projectRef?.projectId &&
  left.projectRef?.orgId === right.projectRef?.orgId;

/**
 * The records over one account's storage. The first read that finds no records imports the
 * legacy keys and stores the result, so they are read once; they are never written or deleted
 * here (5.4 deletes them), and a build from before the switch still finds them.
 */
export function makeRegistrationRecords(storage: RecordsStorage): RegistrationRecords {
  /** The last list, by its stored text: the same array until that text changes. */
  let held: { readonly raw: string; readonly records: ReadonlyArray<RegistrationRecord> } | null =
    null;
  const hold = (raw: string, records: () => ReadonlyArray<RegistrationRecord>) => {
    if (held?.raw !== raw) held = { raw, records: records() };
    return held.records;
  };
  const importOnce = (): ReadonlyArray<RegistrationRecord> => {
    const imported = importLegacyRecords({
      targets: storage.getItem(LEGACY_REGISTRATION_KEYS.targets),
      projectRefs: storage.getItem(LEGACY_REGISTRATION_KEYS.projectRefs),
    });
    const raw = JSON.stringify(imported);
    storage.setItem(REGISTRATION_RECORDS_KEY, raw);
    return hold(raw, () => imported);
  };
  const list = () => {
    const raw = storage.getItem(REGISTRATION_RECORDS_KEY);
    return raw === null ? importOnce() : hold(raw, () => parseRegistrationRecords(raw));
  };
  return {
    list,
    remember: (record) => {
      const current = list();
      const older = current.find((entry) => entry.targetKey === record.targetKey);
      // A target's project never changes (its key names it): what this exchange could not learn
      // keeps what the record knew.
      const next: RegistrationRecord =
        older === undefined
          ? record
          : {
              ...record,
              origin: record.origin ?? older.origin,
              projectRef: record.projectRef ?? older.projectRef,
              name: record.name ?? older.name,
            };
      if (older !== undefined && sameRecord(older, next)) return false;
      storage.setItem(
        REGISTRATION_RECORDS_KEY,
        JSON.stringify([...current.filter((entry) => entry !== older), next]),
      );
      return true;
    },
  };
}
