import { accountLocalStorage } from "./accountLifetime";

export interface DraftStorage {
  getItem(key: string): string | null;
  /** Whether the value landed. */
  setItem(key: string, value: string): boolean;
  removeItem(key: string): void;
  keys(): string[];
}

export interface PersistedValue {
  state: Record<string, unknown>;
  version: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A persisted state kept one key per entry: `name` holds the version, `name:field` a field that is
 * not a record and `name:field:key` one entry of a record field. A tab writes only the keys whose
 * value changed since it last read or wrote them and removes only keys it knew, so tabs editing
 * different entries never overwrite each other; on the same entry the last writer wins.
 */
export function createEntryStorage(storage: DraftStorage) {
  /** Each key's value as this tab last read or wrote it. */
  const known = new Map<string, string>();
  const owns = (name: string, key: string) => key === name || key.startsWith(`${name}:`);
  const forget = (name: string) => {
    for (const key of known.keys()) if (owns(name, key)) known.delete(key);
  };
  /** Whether every changed entry landed; one that did not is written again next time. */
  const setItem = (name: string, value: PersistedValue): boolean => {
    const next = new Map([[name, String(value.version)]]);
    for (const [field, fieldValue] of Object.entries(value.state)) {
      if (fieldValue === undefined) continue;
      if (!isRecord(fieldValue)) {
        next.set(`${name}:${field}`, JSON.stringify(fieldValue));
        continue;
      }
      for (const [key, entry] of Object.entries(fieldValue)) {
        next.set(`${name}:${field}:${key}`, JSON.stringify(entry));
      }
    }
    let landed = true;
    for (const [key, json] of next) {
      if (known.get(key) === json) continue;
      if (storage.setItem(key, json)) known.set(key, json);
      else landed = false;
    }
    for (const key of known.keys()) {
      if (!owns(name, key) || next.has(key)) continue;
      storage.removeItem(key);
      known.delete(key);
    }
    return landed;
  };
  return {
    getItem(name: string): PersistedValue | null {
      forget(name);
      const version = storage.getItem(name);
      if (version === null) return null;
      known.set(name, version);
      const state: Record<string, unknown> = {};
      for (const key of storage.keys()) {
        if (!key.startsWith(`${name}:`)) continue;
        const json = storage.getItem(key);
        if (json === null) continue;
        known.set(key, json);
        const path = key.slice(name.length + 1);
        const colon = path.indexOf(":");
        const value: unknown = JSON.parse(json);
        if (colon === -1) {
          state[path] = value;
          continue;
        }
        const field = path.slice(0, colon);
        const record = isRecord(state[field]) ? state[field] : (state[field] = {});
        record[path.slice(colon + 1)] = value;
      }
      return { state, version: Number(version) };
    },
    setItem,
    /** Writes a value taken from elsewhere whole, over what this tab knew; removes nothing. */
    adopt(name: string, value: PersistedValue): boolean {
      forget(name);
      return setItem(name, value);
    },
    removeItem(name: string): void {
      forget(name);
      for (const key of storage.keys()) if (owns(name, key)) storage.removeItem(key);
    },
    /** One entry of a record field as stored now. */
    readEntry(name: string, field: string, key: string): unknown {
      const json = storage.getItem(`${name}:${field}:${key}`);
      return json === null ? null : JSON.parse(json);
    },
  };
}

/**
 * Until October 2026 every page load kept a whole copy of a key under `key:tab:<id>`, with
 * `key:latest` naming the copy written last. `land` takes that copy's value; every copy goes once it
 * landed (or when there is none to keep).
 */
export function foldDraftBranches(
  storage: DraftStorage,
  key: string,
  land: (value: string) => boolean,
): void {
  const prefix = `${key}:tab:`;
  const pointer = storage.getItem(`${key}:latest`);
  const latest = pointer === null ? null : `${prefix}${pointer}`;
  // The other copies go first: on a full origin they are the room the latest needs to land.
  for (const stored of storage.keys()) {
    if (stored.startsWith(prefix) && stored !== latest) storage.removeItem(stored);
  }
  if (latest === null) return;
  const value = storage.getItem(latest);
  if (value !== null && value !== "" && !land(value)) return;
  storage.removeItem(latest);
  storage.removeItem(`${key}:latest`);
}

export const accountEntryStorage = createEntryStorage(accountLocalStorage);

/**
 * *Set up a crew*'s draft for one Mate (`crew/crewSetupDraft.ts`), under the signed-in account:
 * what the person typed, as raw JSON for its owner to judge; `null` for none or an unreadable one.
 * Storage can throw outright (a private window, blocked site data): a read that throws is none,
 * a write that throws leaves the setup working without its draft kept.
 */
const crewSetupDraftKey = (environmentId: string) => `t3code:crew-setup-draft:v1:${environmentId}`;

export function readCrewSetupDraft(environmentId: string): unknown {
  try {
    const raw = accountLocalStorage.getItem(crewSetupDraftKey(environmentId));
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Keeps `draft` for the Mate, or forgets it with `null`. */
export function writeCrewSetupDraft(environmentId: string, draft: unknown): void {
  try {
    if (draft === null) accountLocalStorage.removeItem(crewSetupDraftKey(environmentId));
    else accountLocalStorage.setItem(crewSetupDraftKey(environmentId), JSON.stringify(draft));
  } catch {
    // The setup still works without its draft kept.
  }
}
