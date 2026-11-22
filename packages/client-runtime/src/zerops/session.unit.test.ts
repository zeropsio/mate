import { expect, it } from "vite-plus/test";

import {
  loadZeropsSession,
  saveZeropsSession,
  ZEROPS_SESSION_STORAGE_KEY,
  type ZeropsStorageAdapter,
} from "./session.ts";

function memoryStorage(initial: Readonly<Record<string, string>> = {}) {
  const items = new Map(Object.entries(initial));
  const storage: ZeropsStorageAdapter = {
    get: async (key) => items.get(key) ?? null,
    set: async (key, value) => void items.set(key, value),
    remove: async (key) => void items.delete(key),
  };
  return { items, storage };
}

// witness: packages/client-runtime/src/zerops/session.ts | JSON.stringify(withoutRecoveryToken(session)) → JSON.stringify(session)
it("ZV116: A session is stored only after the second factor and without the one-time recovery token; a corrupt or half-two-factor record is dropped on load", async () => {
  const verified = memoryStorage();
  await saveZeropsSession(verified.storage, {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    twoFAMethods: ["TOTP"],
    twoFAVerified: true,
    newRecoveryToken: "recovery-1",
  });
  expect(await loadZeropsSession(verified.storage)).toEqual({
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    twoFAMethods: ["TOTP"],
    twoFAVerified: true,
  });

  const halfway = memoryStorage();
  await saveZeropsSession(halfway.storage, {
    accessToken: "access-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    twoFAMethods: ["TOTP"],
  });
  expect(halfway.items.has(ZEROPS_SESSION_STORAGE_KEY)).toBe(false);

  for (const record of [
    "{not json",
    JSON.stringify({ accessToken: "access-1", twoFAMethods: ["TOTP"], twoFAVerified: false }),
  ]) {
    const stored = memoryStorage({ [ZEROPS_SESSION_STORAGE_KEY]: record });
    expect(await loadZeropsSession(stored.storage)).toBeNull();
    expect(stored.items.has(ZEROPS_SESSION_STORAGE_KEY)).toBe(false);
  }
});
