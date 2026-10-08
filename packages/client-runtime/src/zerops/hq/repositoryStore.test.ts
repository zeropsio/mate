import { describe, expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { makeAccountStore, readsOfState } from "../../data/store.ts";
import { makeRepositorySourceReads } from "../../data/adapters/hqRepositorySource.ts";
import { repositorySource } from "../../data/projections/repositorySource.ts";
import { HqError } from "./client.ts";
import type { RepositorySource } from "@t3tools/shared/hqGit";

const target = {
  orgId: "org",
  target: { appId: "app", repo: "repo", query: { kind: "file" as const, path: "a", rev: "head" } },
};
const value: RepositorySource = {
  kind: "file",
  revision: "a".repeat(40),
  path: "a",
  branches: [],
  binary: false,
  content: "hello",
  truncated: false,
  branchesTruncated: false,
};
function waitFor(store: ReturnType<typeof makeAccountStore>, predicate: () => boolean) {
  return new Promise<void>((resolve) => {
    const check = () => {
      if (predicate()) {
        stop();
        resolve();
      }
    };
    const stop = store.subscribe(check);
    check();
  });
}
describe("HQ repository source", () => {
  it("deduplicates demand, retains commit-pinned facts, and only retries a failure on an explicit again", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let reads = 0;
    const reader = makeRepositorySourceReads(store, {
      repositorySource: async () => {
        reads++;
        return value;
      },
    });
    const projected = store.data.project(repositorySource, { ...target, allowed: true });
    const done = waitFor(store, () => registry.get(projected).state === "known");
    const release = reader.demand(target);
    await done;
    expect(registry.get(projected)).toMatchObject({ state: "known", source: value });
    expect(
      registry.get(store.data.project(repositorySource, { ...target, allowed: undefined })),
    ).toMatchObject({ state: "unread" });
    release();
    const releaseAgain = reader.demand(target);
    expect(reads).toBe(1);
    releaseAgain();
    reader.close();
    registry.dispose();
  });
  it("keeps a refused read final on remount and retries only on Again", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let reads = 0;
    const reader = makeRepositorySourceReads(store, {
      repositorySource: async () => {
        reads++;
        throw new HqError({ kind: "refused", code: "not_found", message: "No such repository." });
      },
    });
    const projected = store.data.project(repositorySource, { ...target, allowed: true });
    const done = waitFor(store, () => registry.get(projected).state === "failed");
    const release = reader.demand(target);
    await done;
    release();
    const again = reader.demand(target);
    expect(reads).toBe(1);
    const retried = waitFor(store, () => reads === 2 && registry.get(projected).state === "failed");
    reader.again(target);
    await retried;
    again();
    reader.close();
    registry.dispose();
  });
  it("drops a read that completes after the account closes", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let resolve!: (value: RepositorySource) => void;
    let started!: () => void;
    const entered = new Promise<void>((r) => {
      started = r;
    });
    const reader = makeRepositorySourceReads(store, {
      repositorySource: () => {
        started();
        return new Promise((r) => {
          resolve = r;
        });
      },
    });
    reader.demand(target);
    await entered;
    reader.close();
    resolve(value);
    expect(store.state().facts.size).toBe(0);
    registry.dispose();
  });
});

it("projects retained source and its reread state, withholding content when access is denied", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let fail = false;
  const reader = makeRepositorySourceReads(store, {
    repositorySource: async () => {
      if (fail) throw new HqError({ kind: "refused", code: "not_found", message: "No." });
      return value;
    },
  });
  const projected = store.data.project(repositorySource, { ...target, allowed: true });
  const ready = waitFor(store, () => registry.get(projected).state === "known");
  const release = reader.demand(target);
  await ready;
  fail = true;
  const stale = waitFor(store, () => {
    const v = registry.get(projected);
    return v.state === "known" && v.failed;
  });
  reader.again(target);
  await stale;
  expect(registry.get(projected)).toMatchObject({ state: "known", source: value, failed: true });
  expect(
    registry.get(store.data.project(repositorySource, { ...target, allowed: false })),
  ).toMatchObject({ state: "withheld" });
  release();
  reader.close();
  registry.dispose();
});
it("withholds retained content when the source refuses access, and forgets it when the account closes", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let deny = false;
  const reader = makeRepositorySourceReads(store, {
    repositorySource: async () => {
      if (deny) throw new HqError({ kind: "refused", code: "forbidden", message: "No access." });
      return value;
    },
  });
  const projected = store.data.project(repositorySource, { ...target, allowed: true });
  const ready = waitFor(store, () => registry.get(projected).state === "known");
  const release = reader.demand(target);
  await ready;
  deny = true;
  const withheld = waitFor(store, () => registry.get(projected).state === "withheld");
  reader.again(target);
  await withheld;
  expect(registry.get(projected)).toMatchObject({ state: "withheld" });
  release();
  reader.close();
  registry.dispose();
});
it("withholds cached source synchronously when the current grant is denied or unread", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const reader = makeRepositorySourceReads(store, { repositorySource: async () => value });
  const projected = store.data.project(repositorySource, { ...target, allowed: true });
  const ready = waitFor(store, () => registry.get(projected).state === "known");
  const release = reader.demand(target);
  await ready;
  expect(
    registry.get(store.data.project(repositorySource, { ...target, allowed: undefined })),
  ).toMatchObject({ state: "unread" });
  expect(
    registry.get(store.data.project(repositorySource, { ...target, allowed: false })),
  ).toMatchObject({ state: "withheld" });
  release();
  reader.close();
  registry.dispose();
});

it("a retry reads the new grant even when the obsolete repository request is denied", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let entered!: () => void;
  let denied!: (cause: unknown) => void;
  const first = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  const reads = makeRepositorySourceReads(store, {
    repositorySource: () =>
      ++calls === 1
        ? new Promise((_resolve, reject) => {
            entered();
            denied = reject;
          })
        : Promise.resolve(value),
  });
  const release = reads.demand(target);
  await first;
  const done = waitFor(
    store,
    () =>
      repositorySource.derive(readsOfState(store.state()), { ...target, allowed: true }).state ===
      "known",
  );
  reads.again(target);
  denied(new HqError({ kind: "refused", code: "forbidden", message: "Old grant denied." }));
  await done;
  expect(calls).toBe(2);
  release();
  reads.close();
  registry.dispose();
});
