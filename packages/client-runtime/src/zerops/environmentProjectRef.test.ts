import { describe, expect, it } from "@effect/vitest";
import type { EnvironmentId } from "@t3tools/contracts";

import {
  forgetAllEnvironmentProjectRefs,
  forgetEnvironmentProjectRef,
  lookupEnvironmentProjectRef,
  rememberEnvironmentProjectRef,
  ZEROPS_ENVIRONMENT_PROJECT_REF_STORAGE_KEY,
} from "./environmentProjectRef.ts";
import type { ZeropsStorageAdapter } from "./session.ts";

function fakeStorage(): ZeropsStorageAdapter & { readonly raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    get: (key) => Promise.resolve(raw.get(key) ?? null),
    set: (key, value) => {
      raw.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      raw.delete(key);
      return Promise.resolve();
    },
  };
}

const ENV_A = "env-a" as EnvironmentId;
const ENV_B = "env-b" as EnvironmentId;

describe("environmentProjectRef", () => {
  it("has nothing for an environment that was never remembered", async () => {
    const storage = fakeStorage();

    expect(await lookupEnvironmentProjectRef(storage, ENV_A)).toBeUndefined();
  });

  it("remembers the project ref at connect and reads it back for the hook", async () => {
    const storage = fakeStorage();

    await rememberEnvironmentProjectRef(
      storage,
      ENV_A,
      { projectId: "proj-1", orgId: "org-1", source: "connect" },
      () => 1_700_000_000_000,
    );

    expect(await lookupEnvironmentProjectRef(storage, ENV_A)).toEqual({
      projectId: "proj-1",
      orgId: "org-1",
      source: "connect",
      learnedAt: 1_700_000_000_000,
    });
  });

  it("keeps refs for different environments independent", async () => {
    const storage = fakeStorage();

    await rememberEnvironmentProjectRef(storage, ENV_A, {
      projectId: "proj-a",
      orgId: "org-a",
      source: "connect",
    });
    await rememberEnvironmentProjectRef(storage, ENV_B, {
      projectId: "proj-b",
      orgId: "org-b",
      source: "match",
    });

    expect((await lookupEnvironmentProjectRef(storage, ENV_A))?.projectId).toBe("proj-a");
    expect((await lookupEnvironmentProjectRef(storage, ENV_B))?.projectId).toBe("proj-b");
  });

  it("overwrites an earlier ref for the same environment", async () => {
    const storage = fakeStorage();

    await rememberEnvironmentProjectRef(storage, ENV_A, {
      projectId: "stale",
      orgId: "org-1",
      source: "match",
    });
    await rememberEnvironmentProjectRef(storage, ENV_A, {
      projectId: "fresh",
      orgId: "org-1",
      source: "connect",
    });

    const ref = await lookupEnvironmentProjectRef(storage, ENV_A);
    expect(ref?.projectId).toBe("fresh");
    expect(ref?.source).toBe("connect");
  });

  it("forgets one environment without touching another", async () => {
    const storage = fakeStorage();
    await rememberEnvironmentProjectRef(storage, ENV_A, {
      projectId: "proj-a",
      orgId: "org-a",
      source: "connect",
    });
    await rememberEnvironmentProjectRef(storage, ENV_B, {
      projectId: "proj-b",
      orgId: "org-b",
      source: "connect",
    });

    await forgetEnvironmentProjectRef(storage, ENV_A);

    expect(await lookupEnvironmentProjectRef(storage, ENV_A)).toBeUndefined();
    expect((await lookupEnvironmentProjectRef(storage, ENV_B))?.projectId).toBe("proj-b");
  });

  it("forgetting an environment with no ref is a no-op", async () => {
    const storage = fakeStorage();

    await expect(forgetEnvironmentProjectRef(storage, ENV_A)).resolves.toBeUndefined();
    expect(await lookupEnvironmentProjectRef(storage, ENV_A)).toBeUndefined();
  });

  it("forgets every ref at once — sign-out clears the store", async () => {
    const storage = fakeStorage();
    await rememberEnvironmentProjectRef(storage, ENV_A, {
      projectId: "proj-a",
      orgId: "org-a",
      source: "connect",
    });
    await rememberEnvironmentProjectRef(storage, ENV_B, {
      projectId: "proj-b",
      orgId: "org-b",
      source: "match",
    });

    await forgetAllEnvironmentProjectRefs(storage);

    expect(await lookupEnvironmentProjectRef(storage, ENV_A)).toBeUndefined();
    expect(await lookupEnvironmentProjectRef(storage, ENV_B)).toBeUndefined();
    expect(storage.raw.has(ZEROPS_ENVIRONMENT_PROJECT_REF_STORAGE_KEY)).toBe(false);
  });

  it("reads a corrupt stored value as empty rather than throwing", async () => {
    const storage = fakeStorage();
    await storage.set(ZEROPS_ENVIRONMENT_PROJECT_REF_STORAGE_KEY, "{not json");

    expect(await lookupEnvironmentProjectRef(storage, ENV_A)).toBeUndefined();
  });

  it("drops a malformed entry for one environment without losing the others", async () => {
    const storage = fakeStorage();
    await storage.set(
      ZEROPS_ENVIRONMENT_PROJECT_REF_STORAGE_KEY,
      JSON.stringify({
        [String(ENV_A)]: { projectId: "proj-a" }, // missing fields
        [String(ENV_B)]: {
          projectId: "proj-b",
          orgId: "org-b",
          learnedAt: 1,
          source: "connect",
        },
      }),
    );

    expect(await lookupEnvironmentProjectRef(storage, ENV_A)).toBeUndefined();
    expect((await lookupEnvironmentProjectRef(storage, ENV_B))?.projectId).toBe("proj-b");
  });
});
