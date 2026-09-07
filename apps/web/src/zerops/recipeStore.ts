/**
 * The web app's recipe store.
 *
 * zcp writes the real one; it does not exist yet, and where it will live is
 * still open — a working tree, the account's git host, or a platform store
 * built for it. Until that is settled this is the mock, seeded with the
 * showcase group, and a live group has whatever has been written for it here.
 *
 * ## Why this one remembers
 *
 * The in-memory mock loses every write on reload, which makes it a poor
 * stand-in for the thing it stands in for: a store whose writes vanish cannot
 * be used to try the flow it exists to enable. Backing it with `localStorage`
 * costs a few lines and makes it behave like a store — a record written stays
 * written, per browser.
 *
 * That is the whole extent of the promise. It is not shared between devices,
 * it is not what zcp will write to, and a reader who clears site data is back
 * to the seed. The interface is the seam that matters (`recipeStore.ts`), and
 * every one of those properties changes when the real store lands.
 */

import {
  GO_HELLO_WORLD_GROUP,
  makeMockZeropsRecipeStore,
  type ZeropsGroupRecord,
  type ZeropsRecipeStore,
} from "@t3tools/client-runtime/zerops";

/** Where written records live. Seeded groups are not written here. */
const STORAGE_KEY = "zerops.recipeStore.groups";

const seeded = makeMockZeropsRecipeStore([GO_HELLO_WORLD_GROUP]);

function readWritten(): ReadonlyArray<ZeropsGroupRecord> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ReadonlyArray<ZeropsGroupRecord>) : [];
  } catch {
    // A corrupt or unavailable store reads as empty: the seed still works, and
    // a recipe nobody can read is a missing recipe, which the caller handles.
    return [];
  }
}

function writeAll(records: ReadonlyArray<ZeropsGroupRecord>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Out of quota or blocked. Losing the record costs a re-write, and
    // surfacing it here would put an error on a screen the user did not ask
    // anything of.
  }
}

export const zeropsRecipeStore: ZeropsRecipeStore = {
  listGroups: async () => {
    const written = readWritten();
    const ids = new Set(written.map((record) => record.groupId));
    // A written record wins over the seed for the same group: it is the newer
    // answer, and the seed is only there so an empty store is not an empty
    // product.
    return [...written, ...(await seeded.listGroups()).filter((r) => !ids.has(r.groupId))];
  },
  readGroup: async (groupId) =>
    readWritten().find((record) => record.groupId === groupId) ?? seeded.readGroup(groupId),
  writeGroup: async (record) => {
    writeAll([record, ...readWritten().filter((existing) => existing.groupId !== record.groupId)]);
  },
  deleteGroup: async (groupId) => {
    writeAll(readWritten().filter((record) => record.groupId !== groupId));
  },
};
