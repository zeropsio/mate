import { describe, expect, it, vi } from "vite-plus/test";
import type { EnvironmentId } from "@t3tools/contracts";
import { lookupEnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";
import type { ZeropsStorageAdapter } from "@t3tools/client-runtime/zerops";

import { rememberExchangedProjectRef } from "./useZeropsIdentityExchange";

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

const ENV = "env-1" as EnvironmentId;
const CANDIDATE = { project: { id: "project-1" } };

// `rememberExchangedProjectRef` is the one call `useZeropsIdentityExchange`'s
// successful branch makes (`useZeropsIdentityExchange.ts`) — the same hook
// every path that can land an environment uses: `ZeropsProjectsPage.tsx`'s
// `connectContainer` and auto-connect, `ZeropsEnvironmentLifetime.tsx`'s
// restore effect, and `ZeropsIdentityRepair.ts`'s repair. Proving this
// function writes the ref correctly proves every one of those paths does,
// since none of them can reach a `Success` result without going through it.
describe("rememberExchangedProjectRef (H12: connect, restore and repair share one write)", () => {
  it("a restored or repaired environment remembers its project", async () => {
    const storage = fakeStorage();

    await rememberExchangedProjectRef(storage, ENV, CANDIDATE, "org-1");

    expect(await lookupEnvironmentProjectRef(storage, ENV)).toMatchObject({
      projectId: "project-1",
      orgId: "org-1",
      source: "connect",
    });
  });

  it("writes nothing when the organization is not yet known", async () => {
    const storage = fakeStorage();

    await rememberExchangedProjectRef(storage, ENV, CANDIDATE, undefined);

    expect(await lookupEnvironmentProjectRef(storage, ENV)).toBeUndefined();
    expect(storage.raw.size).toBe(0);
  });

  it("a failed write is swallowed — the environment is connected either way", async () => {
    const storage: ZeropsStorageAdapter = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error("storage blocked")),
      remove: () => Promise.resolve(),
    };
    const onRejection = vi.fn();

    await expect(
      rememberExchangedProjectRef(storage, ENV, CANDIDATE, "org-1").catch(onRejection),
    ).resolves.toBeUndefined();
    expect(onRejection).not.toHaveBeenCalled();
  });
});
