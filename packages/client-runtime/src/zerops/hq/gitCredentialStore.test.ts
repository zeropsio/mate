import { describe, expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import type { GitCredential } from "@t3tools/shared/hqGit";
import { HqError } from "./client.ts";
import { makeAccountStore, readsOfState } from "../../data/store.ts";
import { makeGitCredentials } from "../../data/adapters/hqGitCredentials.ts";
import { gitCredentials } from "../../data/projections/gitCredentials.ts";
const key = { orgId: "org", appId: "app" };
const credential: GitCredential = {
  id: "key",
  appId: "app",
  token: "one-time-secret",
  createdAt: "2026-10-07",
  expiresAt: "2026-10-08",
};
const { token: _token, ...metadata } = credential;
function waitFor(store: ReturnType<typeof makeAccountStore>, predicate: () => boolean) {
  return new Promise<void>((resolve) => {
    const stop = store.subscribe(() => check());
    const check = () => {
      if (predicate()) {
        stop();
        resolve();
      }
    };
    check();
  });
}
function rig(api: Parameters<typeof makeGitCredentials>[0]["api"]) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let id = 0;
  const host = makeGitCredentials({ store, api, makeId: () => `request-${++id}` });
  return {
    store,
    host,
    read: () => gitCredentials.derive(readsOfState(store.state()), key),
    close: () => {
      host.close();
      registry.dispose();
    },
  };
}
describe("HQ credential facts and receipts", () => {
  it("projects retained records and a failed reread without treating an unread list as empty", async () => {
    let failed = false;
    const r = rig({
      gitCredentials: async () => {
        if (failed) throw new HqError({ kind: "refused", code: "git_credentials", message: "No." });
        return [metadata];
      },
      issueGitCredential: async () => credential,
      revokeGitCredential: async () => {},
    });
    expect(r.read().credentials.state).toBe("unread");
    const done = waitFor(r.store, () => r.read().credentials.state === "known");
    const release = r.host.demand(key);
    await done;
    failed = true;
    const stale = waitFor(
      r.store,
      () =>
        "stale" in r.read().credentials &&
        r.read().credentials.state === "known" &&
        (r.read().credentials as { stale: boolean }).stale,
    );
    r.host.again(key);
    await stale;
    expect(r.read().credentials).toMatchObject({
      state: "known",
      stale: true,
      records: [metadata],
    });
    release();
    r.close();
  });
  it("shares one issue attempt, exposes its failure, and allows a manual new attempt with metadata to revoke", async () => {
    let calls = 0;
    let accepted = false;
    const r = rig({
      gitCredentials: async () => (accepted ? [metadata] : []),
      issueGitCredential: async () => {
        calls++;
        if (!accepted)
          throw new HqError({ kind: "refused", code: "forbidden", message: "Issue refused." });
        return credential;
      },
      revokeGitCredential: async () => {},
    });
    const release = r.host.demand(key);
    await r.host.issue(key);
    expect(r.read().action).toMatchObject({ kind: "failed", words: "Issue refused." });
    accepted = true;
    await r.host.issue(key);
    expect(calls).toBe(2);
    expect(r.read().action).toMatchObject({ kind: "issued", credential });
    // Durable receipts contain metadata; the one-time secret has a separately releasable lifetime.
    for (const record of r.store.state().operations.values())
      expect(JSON.stringify(record)).not.toContain(credential.token);
    release();
    expect(r.read().action.kind).toBe("idle");
    r.close();
  });
  it("erases a password on access loss and drops a late issue after account close", async () => {
    let denied = false;
    let resolve!: (value: GitCredential) => void;
    let started!: () => void;
    const entered = new Promise<void>((r) => {
      started = r;
    });
    const r = rig({
      gitCredentials: async () => {
        if (denied)
          throw new HqError({ kind: "refused", code: "forbidden", message: "Access denied." });
        return [metadata];
      },
      issueGitCredential: () => {
        started();
        return new Promise((r) => {
          resolve = r;
        });
      },
      revokeGitCredential: async () => {},
    });
    const release = r.host.demand(key);
    const pending = r.host.issue(key);
    await entered;
    r.host.close();
    resolve(credential);
    await pending;
    expect(r.read().action.kind).not.toBe("issued");
    release();
    r.close();
    const active = rig({
      gitCredentials: async () => {
        if (denied)
          throw new HqError({ kind: "refused", code: "forbidden", message: "Access denied." });
        return [metadata];
      },
      issueGitCredential: async () => credential,
      revokeGitCredential: async () => {},
    });
    const hold = active.host.demand(key);
    await active.host.issue(key);
    denied = true;
    const withheld = waitFor(active.store, () => active.read().credentials.state === "withheld");
    active.host.again(key);
    await withheld;
    expect(active.read().action.kind).not.toBe("issued");
    hold();
    active.close();
  });
  it("retains uncertain issuance across remount and never creates a second password blindly", async () => {
    let calls = 0;
    let revokes = 0;
    const r = rig({
      gitCredentials: async () => [metadata],
      issueGitCredential: async () => {
        calls++;
        throw new HqError({ kind: "uncertain", code: "network", message: "Lost answer." });
      },
      revokeGitCredential: async () => {
        revokes++;
      },
    });
    const release = r.host.demand(key);
    await r.host.issue(key);
    release();
    const remount = r.host.demand(key);
    await r.host.issue(key);
    expect(calls).toBe(1);
    expect(r.read().action.kind).toBe("unresolved");
    await r.host.revoke(key, metadata.id);
    expect(revokes).toBe(1);
    await r.host.issue(key);
    expect(calls).toBe(1);
    expect(r.read().action.kind).toBe("unresolved");
    remount();
    r.close();
  });
});
