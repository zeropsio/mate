import { describe, expect, it } from "@effect/vitest";
import type { GitCredential } from "@t3tools/shared/hqGit";
import { makeGitCredentialStore } from "./gitCredentialStore.ts";
const issued: GitCredential = {
  id: "id",
  appId: "app",
  createdAt: "now",
  expiresAt: "later",
  token: "test-password",
};
describe("Git credential attempts", () => {
  it("shares one issue attempt, exposes its failure, and allows a manual new attempt with metadata to revoke", async () => {
    let resolve!: (value: GitCredential) => void;
    let attempts = 0;
    let lost = true;
    const store = makeGitCredentialStore({
      list: async () => [],
      issue: async () => {
        attempts++;
        if (lost) throw new Error("lost");
        return new Promise((done) => {
          resolve = done;
        });
      },
      revoke: async () => undefined,
      now: () => 1,
    });
    await store.load();
    await store.issue();
    expect(store.snapshot().action).toMatchObject({ kind: "failed", words: "lost" });
    expect(attempts).toBe(1);
    lost = false;
    const pending = store.issue();
    const duplicate = store.issue();
    expect(attempts).toBe(2);
    resolve(issued);
    await Promise.all([pending, duplicate]);
    expect(store.snapshot().action).toMatchObject({ kind: "issued", credential: issued });
    expect(store.snapshot().credentials).toMatchObject({
      state: "known",
      value: [expect.objectContaining({ id: "id" })],
    });
    await store.revoke("id");
    expect(store.snapshot().action.kind).toBe("idle");
    expect(store.snapshot().credentials).toMatchObject({ state: "known", value: [] });
  });
  it("erases a password on access loss and drops a late issue after account close", async () => {
    let resolve!: (value: GitCredential) => void;
    const store = makeGitCredentialStore({
      list: async () => [],
      issue: () =>
        new Promise((done) => {
          resolve = done;
        }),
      revoke: async () => undefined,
      now: () => 1,
    });
    const pending = store.issue();
    store.close();
    resolve(issued);
    await pending;
    expect(store.snapshot().action.kind).toBe("idle");
    const fresh = makeGitCredentialStore({
      list: async () => [],
      issue: async () => issued,
      revoke: async () => undefined,
      now: () => 1,
    });
    await fresh.issue();
    fresh.forgetPassword();
    expect(fresh.snapshot().action.kind).toBe("idle");
  });
});
