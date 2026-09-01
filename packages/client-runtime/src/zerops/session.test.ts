import { afterEach, describe, expect, it, vi } from "@effect/vitest";

import {
  ZEROPS_SELECTION_STORAGE_KEY,
  ZEROPS_SESSION_STORAGE_KEY,
  clearZeropsSession,
  loadZeropsSelection,
  loadZeropsSession,
  parseZeropsSession,
  saveZeropsSelection,
  saveZeropsSession,
  type ZeropsStorageAdapter,
} from "./session.ts";

function memoryStorage(seed: Record<string, string> = {}): ZeropsStorageAdapter & {
  readonly entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(seed));
  return {
    entries,
    get: (key) => Promise.resolve(entries.get(key) ?? null),
    set: (key, value) => {
      entries.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
  };
}

describe("Zerops session storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts storage explicitly", async () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("the global localStorage must not be used");
      },
    });
    const storage = memoryStorage({
      [ZEROPS_SESSION_STORAGE_KEY]: JSON.stringify({ accessToken: "access-1" }),
    });

    await expect(loadZeropsSession(storage)).resolves.toEqual({ accessToken: "access-1" });
  });

  it("keeps the session and the selection under separate versioned keys", async () => {
    const storage = memoryStorage();

    await saveZeropsSession(storage, { accessToken: "access-1", refreshToken: "refresh-1" });
    await saveZeropsSelection(storage, {
      userId: "user-1",
      clientUserId: "cu-1",
      clientId: "org-1",
      projectId: "p1",
    });

    expect([...storage.entries.keys()].sort()).toEqual(
      [ZEROPS_SELECTION_STORAGE_KEY, ZEROPS_SESSION_STORAGE_KEY].sort(),
    );
    expect(ZEROPS_SESSION_STORAGE_KEY).toMatch(/\.v\d+$/);
    expect(ZEROPS_SELECTION_STORAGE_KEY).toMatch(/\.v\d+$/);
  });

  it("refuses to persist a session that has not passed its second factor", async () => {
    const storage = memoryStorage();

    await saveZeropsSession(storage, { accessToken: "half-1", twoFAMethods: ["TOTP"] });

    expect(storage.entries.has(ZEROPS_SESSION_STORAGE_KEY)).toBe(false);
    await expect(loadZeropsSession(storage)).resolves.toBeNull();
  });

  it("strips a one-time recovery token before writing", async () => {
    const storage = memoryStorage();

    await saveZeropsSession(storage, {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      newRecoveryToken: "one-time-secret",
    });

    const raw = storage.entries.get(ZEROPS_SESSION_STORAGE_KEY) ?? "";
    expect(raw).not.toContain("one-time-secret");
    await expect(loadZeropsSession(storage)).resolves.toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });
  });

  it("drops a corrupt or half-2FA record on load instead of booting an authorized UI", async () => {
    const corrupt = memoryStorage({ [ZEROPS_SESSION_STORAGE_KEY]: "{not json" });
    await expect(loadZeropsSession(corrupt)).resolves.toBeNull();
    expect(corrupt.entries.has(ZEROPS_SESSION_STORAGE_KEY)).toBe(false);

    const half = memoryStorage({
      [ZEROPS_SESSION_STORAGE_KEY]: JSON.stringify({ accessToken: "half", twoFAMethods: ["TOTP"] }),
    });
    await expect(loadZeropsSession(half)).resolves.toBeNull();
    expect(half.entries.has(ZEROPS_SESSION_STORAGE_KEY)).toBe(false);
  });

  it("parses a raw value synchronously for storage backends that are synchronous", () => {
    expect(parseZeropsSession(null)).toBeNull();
    expect(parseZeropsSession('{"accessToken":""}')).toBeNull();
    expect(parseZeropsSession('{"accessToken":"access-1"}')).toEqual({ accessToken: "access-1" });
  });

  it("clears the session without touching the selection", async () => {
    const storage = memoryStorage();
    await saveZeropsSession(storage, { accessToken: "access-1" });
    await saveZeropsSelection(storage, {
      userId: "user-1",
      clientUserId: "cu-1",
      clientId: "org-1",
      projectId: "p1",
    });

    await clearZeropsSession(storage);

    expect(storage.entries.has(ZEROPS_SESSION_STORAGE_KEY)).toBe(false);
    expect(storage.entries.has(ZEROPS_SELECTION_STORAGE_KEY)).toBe(true);
  });

  it("ignores a selection remembered for a different account", async () => {
    const storage = memoryStorage();
    await saveZeropsSelection(storage, {
      userId: "user-1",
      clientUserId: "cu-1",
      clientId: "org-1",
      projectId: "p1",
    });

    await expect(loadZeropsSelection(storage, "user-1")).resolves.toEqual({
      userId: "user-1",
      clientUserId: "cu-1",
      clientId: "org-1",
      projectId: "p1",
    });
    await expect(loadZeropsSelection(storage, "user-2")).resolves.toEqual({
      userId: "user-2",
      clientUserId: null,
      clientId: null,
      projectId: null,
    });
  });

  it("migrates a remembered v1 selection that predates clientUserId", async () => {
    const storage = memoryStorage({
      [ZEROPS_SELECTION_STORAGE_KEY]: JSON.stringify({
        userId: "user-1",
        clientId: "org-1",
        projectId: "p1",
      }),
    });

    await expect(loadZeropsSelection(storage, "user-1")).resolves.toEqual({
      userId: "user-1",
      clientUserId: null,
      clientId: "org-1",
      projectId: "p1",
    });
  });
});
