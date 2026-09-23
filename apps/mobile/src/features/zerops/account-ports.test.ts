import { describe, expect, it } from "vite-plus/test";
import type { ZeropsStorageAdapter } from "@t3tools/client-runtime/zerops";
import { REGISTRATION_RECORDS_KEY } from "@t3tools/client-runtime/zerops/environments";

import { loadAccountRecords, memoryIntents } from "./account-ports";

/** The device's keychain: what it holds, and whether it takes writes. */
const deviceStorage = (options: { readonly refuses?: boolean } = {}) => {
  const held = new Map<string, string>();
  const storage: ZeropsStorageAdapter = {
    get: async (key) => held.get(key) ?? null,
    set: async (key, value) => {
      if (options.refuses) throw new Error("The keychain is locked.");
      held.set(key, value);
    },
    remove: async (key) => void held.delete(key),
  };
  return { storage, held };
};

const settle = async () => {
  for (let hop = 0; hop < 10; hop += 1) await Promise.resolve();
};

describe("loadAccountRecords", () => {
  it("keeps each account's records across a restart of the app, and apart from another account's", async () => {
    const { storage, held } = deviceStorage();
    const first = await loadAccountRecords(storage, "user-a");
    first.setItem(REGISTRATION_RECORDS_KEY, '[{"targetKey":"p:s"}]');
    await settle();

    const restarted = await loadAccountRecords(storage, "user-a");
    const other = await loadAccountRecords(storage, "user-b");

    expect(restarted.getItem(REGISTRATION_RECORDS_KEY)).toBe('[{"targetKey":"p:s"}]');
    expect(other.getItem(REGISTRATION_RECORDS_KEY)).toBeNull();
    // Every key is one the device's keychain takes.
    expect([...held.keys()].every((key) => /^[A-Za-z0-9._-]+$/u.test(key))).toBe(true);
  });

  it("holds a write the device refused for as long as the app runs", async () => {
    const { storage } = deviceStorage({ refuses: true });
    const records = await loadAccountRecords(storage, "user-a");

    records.setItem(REGISTRATION_RECORDS_KEY, "[]");
    await settle();

    expect(records.getItem(REGISTRATION_RECORDS_KEY)).toBe("[]");
    expect((await loadAccountRecords(storage, "user-a")).getItem(REGISTRATION_RECORDS_KEY)).toBe(
      null,
    );
  });
});

describe("memoryIntents", () => {
  it("holds the container intents until they are forgotten", () => {
    const intents = memoryIntents();
    expect(intents.read()).toBeNull();

    intents.write('[{"target":"p:s"}]');
    expect(intents.read()).toBe('[{"target":"p:s"}]');

    intents.write(null);
    expect(intents.read()).toBeNull();
  });
});
