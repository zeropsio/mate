import { describe, expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { HqError } from "../../zerops/hq/client.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { observeCredential } from "../projections/observeCredential.ts";
import { makeObserveCredential } from "./hqObserveCredential.ts";
const KEY = { orgId: "org", projectId: "mate" };
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
  const host = makeObserveCredential({ store, api });
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

  it("definitive refusal remains an error and account close fences delayed answers", async () => {
    const answer = deferred<typeof AUTH>();
    const started = deferred<void>();
    let calls = 0;
    const r = rig({
      observeCredential: () => {
        if (++calls === 1)
          return Promise.reject(
            new HqError({ kind: "refused", code: "forbidden", message: "Not allowed" }),
          );
        started.resolve();
        return answer.promise;
      },
    });
    const failed = waitFor(r, () => r.view().metadata.state === "failed");
    const release = r.host.demand(KEY);
    await failed;
    expect(r.view().metadata).toEqual({ state: "failed", words: "Not allowed" });
    r.host.again(KEY);
    await started.promise;
    expect(calls).toBe(2);
    r.host.close();
    const before = JSON.stringify([...r.store.state().facts]);
    answer.resolve(AUTH);
    await answer.promise;
    expect(JSON.stringify([...r.store.state().facts])).toBe(before);
    release();
    r.close();
  });
});
