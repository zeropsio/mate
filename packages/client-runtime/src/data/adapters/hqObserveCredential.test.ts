import type { ObserveCredential } from "../../zerops/hq/observeCredential.ts";
import { describe, expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { HqError } from "../../zerops/hq/client.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { observeCredential } from "../projections/observeCredential.ts";
import { makeObserveCredential } from "./hqObserveCredential.ts";
const KEY = { orgId: "org", projectId: "mate" };
const NONE = { authorized: false, userId: null, expiresAt: null };
const AUTH = { authorized: true, userId: "person", expiresAt: "2026-11-28T10:00:00Z" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function rig(api: Parameters<typeof makeObserveCredential>[0]["api"]) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let id = 0;
  const host = makeObserveCredential({ store, api, makeId: () => `observe-${++id}` });
  return {
    store,
    host,
    view: () => observeCredential.derive(readsOfState(store.state()), KEY),
    close: () => {
      host.close();
      registry.dispose();
    },
  };
}
function waitFor(r: ReturnType<typeof rig>, predicate: () => boolean) {
  return new Promise<void>((resolve) => {
    const stop = r.store.subscribe(() => check());
    const check = () => {
      if (predicate()) {
        stop();
        resolve();
      }
    };
    check();
  });
}
describe("personal observe authorization data", () => {
  it("opening and reopening reads metadata without issuing or revoking a credential", async () => {
    const calls: string[] = [];
    const r = rig({
      observeCredential: async () => {
        calls.push("read");
        return AUTH;
      },
      authorizeObserveCredential: async () => {
        calls.push("authorize");
        return AUTH;
      },
      revokeObserveCredential: async () => {
        calls.push("revoke");
        return NONE;
      },
    });
    const read = waitFor(r, () => r.view().metadata.state === "known");
    const release = r.host.demand(KEY);
    await read;
    expect(r.view().metadata).toEqual({ state: "known", value: AUTH, stale: false });
    release();
    const reread = waitFor(r, () => calls.length === 2 && r.view().metadata.state === "known");
    const releaseAgain = r.host.demand(KEY);
    await reread;
    expect(calls).toEqual(["read", "read"]);
    releaseAgain();
    r.close();
  });
  it("explicit authorize and revoke expose HQ metadata through the real projection", async () => {
    let value: ObserveCredential = NONE;
    const calls: string[] = [];
    const r = rig({
      observeCredential: async () => value,
      authorizeObserveCredential: async () => {
        calls.push("authorize");
        return (value = AUTH);
      },
      revokeObserveCredential: async () => {
        calls.push("revoke");
        return (value = NONE);
      },
    });
    const read = waitFor(r, () => r.view().metadata.state === "known");
    const release = r.host.demand(KEY);
    await read;
    await r.host.authorize(KEY);
    expect(r.view().metadata).toMatchObject({ state: "known", value: AUTH });
    await r.host.revoke(KEY);
    expect(r.view().metadata).toMatchObject({ state: "known", value: NONE });
    expect(calls).toEqual(["authorize", "revoke"]);
    release();
    r.close();
  });
  it("an older metadata read cannot overwrite an acknowledged authorization", async () => {
    const first = deferred<typeof NONE>();
    const later = deferred<typeof NONE>();
    const secondStarted = deferred<void>();
    let count = 0;
    const r = rig({
      observeCredential: () => {
        if (++count === 1) return first.promise;
        secondStarted.resolve();
        return later.promise;
      },
      authorizeObserveCredential: async () => AUTH,
    });
    const release = r.host.demand(KEY);
    const started = waitFor(r, () => count === 1);
    await started;
    await r.host.authorize(KEY);
    expect(r.view().metadata).toMatchObject({ state: "known", value: AUTH });
    first.resolve(NONE);
    await secondStarted.promise;
    expect(r.view().metadata).toMatchObject({ state: "known", value: AUTH });
    later.resolve(NONE);
    await waitFor(
      r,
      () =>
        r.view().metadata.state === "known" &&
        JSON.stringify(r.view().metadata).includes('"authorized":false'),
    );
    expect(r.view().metadata).toMatchObject({ state: "known", value: NONE });
    release();
    r.close();
  });
  it("a metadata read begun during authorization cannot replace its later acknowledged authority", async () => {
    const answer = deferred<typeof AUTH>();
    const asked = deferred<void>();
    const thirdStarted = deferred<void>();
    const third = deferred<typeof AUTH>();
    let count = 0;
    const r = rig({
      observeCredential: () => {
        count++;
        if (count < 3) return Promise.resolve(NONE);
        thirdStarted.resolve();
        return third.promise;
      },
      authorizeObserveCredential: () => {
        asked.resolve();
        return answer.promise;
      },
    });
    const read = waitFor(r, () => r.view().metadata.state === "known");
    const release = r.host.demand(KEY);
    await read;
    const writing = r.host.authorize(KEY);
    await asked.promise;
    const during = waitFor(r, () => {
      const fact = readsOfState(r.store.state()).fact(
        "hqObserveCredential",
        JSON.stringify([KEY.orgId, KEY.projectId]),
      );
      return (
        fact.kind === "known" && fact.revision.kind === "mate-link" && fact.revision.sequence === 2
      );
    });
    r.host.again(KEY);
    await during;
    const acknowledged: Array<ReturnType<typeof r.view>["metadata"]> = [];
    const stop = r.store.subscribe(() => {
      const view = r.view();
      if (view.action.kind === "done" && view.action.verb === "authorize")
        acknowledged.push(view.metadata);
    });
    answer.resolve(AUTH);
    await writing;
    await thirdStarted.promise;
    stop();
    expect(acknowledged.length).toBeGreaterThan(0);
    expect(acknowledged).not.toContainEqual({ state: "known", value: NONE, stale: false });
    expect(r.view().metadata).toEqual({ state: "known", value: AUTH, stale: false });
    third.resolve(AUTH);
    release();
    r.close();
  });
  it("a delayed explicit authorization is busy and a second press sends no second request", async () => {
    const answer = deferred<typeof AUTH>();
    const asked = deferred<void>();
    let calls = 0;
    const r = rig({
      observeCredential: async () => NONE,
      authorizeObserveCredential: () => {
        calls++;
        asked.resolve();
        return answer.promise;
      },
    });
    const release = r.host.demand(KEY);
    const writing = r.host.authorize(KEY);
    await asked.promise;
    expect(r.view().action).toEqual({ kind: "working", verb: "authorize" });
    await r.host.authorize(KEY);
    expect(calls).toBe(1);
    answer.resolve(AUTH);
    await writing;
    expect(r.view().action).toEqual({ kind: "done", verb: "authorize" });
    release();
    r.close();
  });
  it("an HQ without observe metadata is unavailable instead of unauthorized", async () => {
    const r = rig({});
    const failed = waitFor(r, () => r.view().metadata.state === "failed");
    const release = r.host.demand(KEY);
    await failed;
    expect(r.view().metadata).toEqual({
      state: "failed",
      words: "Update HQ to manage observe authorization.",
    });
    release();
    r.close();
  });
  it("a lost authorization answer stays unresolved and cannot automatically issue again", async () => {
    let calls = 0;
    const r = rig({
      observeCredential: async () => NONE,
      authorizeObserveCredential: async () => {
        calls++;
        throw new TypeError("offline");
      },
      revokeObserveCredential: async () => NONE,
    });
    const release = r.host.demand(KEY);
    await r.host.authorize(KEY);
    expect(r.view().action.kind).toBe("unresolved");
    await r.host.authorize(KEY);
    expect(calls).toBe(1);
    await r.host.revoke(KEY);
    expect(r.view().action).toEqual({ kind: "done", verb: "revoke" });
    release();
    r.close();
  });
  it("definitive refusal remains an error and account close fences delayed answers", async () => {
    const answer = deferred<typeof AUTH>();
    const r = rig({
      observeCredential: () => answer.promise,
      authorizeObserveCredential: async () => {
        throw new HqError({ kind: "refused", code: "forbidden", message: "Not allowed" });
      },
    });
    const release = r.host.demand(KEY);
    await r.host.authorize(KEY);
    expect(r.view().action).toEqual({ kind: "failed", words: "Not allowed" });
    r.host.close();
    const before = JSON.stringify([...r.store.state().facts]);
    answer.resolve(AUTH);
    await answer.promise;
    expect(JSON.stringify([...r.store.state().facts])).toBe(before);
    release();
    r.close();
  });
});
