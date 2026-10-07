import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { EnvironmentId, type OrchestrationShellSnapshot } from "@t3tools/contracts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { makeArchiveReads } from "./mateArchive.ts";
import { mateArchive } from "../projections/mateArchive.ts";

const env = EnvironmentId.make("open");
const other = EnvironmentId.make("other");
const empty: OrchestrationShellSnapshot = {
  snapshotSequence: 0,
  updatedAt: "2026-10-07T00:00:00Z",
  projects: [],
  threads: [],
};
const shown = (store: AccountStore, ids = [env], connected = ids) =>
  mateArchive.derive(readsOfState(store.state()), { environmentIds: ids, connectedIds: connected });
const until = (store: AccountStore, predicate: () => boolean) =>
  new Promise<void>((resolve) => {
    const stop = store.subscribe(() => check());
    const check = () => {
      if (predicate()) {
        stop();
        resolve();
      }
    };
    check();
  });

describe("account archive evidence", () => {
  it("keeps unread distinct from the owner's empty archive and shares demand", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let calls = 0;
    const reads = makeArchiveReads(store, {
      read: () =>
        Effect.sync(() => {
          calls++;
          return empty;
        }),
    });
    expect(shown(store)).toMatchObject({ snapshots: [], isLoading: true });
    expect(shown(store, [env], [])).toMatchObject({
      snapshots: [],
      isLoading: false,
      error: "Connect to the remaining Mates to read their archived chats.",
    });
    const done = until(store, () => shown(store).snapshots.length === 1);
    const a = reads.demand(env);
    const b = reads.demand(env);
    await done;
    expect(shown(store)).toMatchObject({
      snapshots: [{ environmentId: env, snapshot: empty }],
      isLoading: false,
    });
    expect(calls).toBe(1);
    a();
    b();
    const c = reads.demand(env);
    expect(shown(store).snapshots).toHaveLength(1);
    expect(calls).toBe(1);
    c();
    reads.close();
    registry.dispose();
  });
  it("retains known archives through refusal and disconnected remount, with each Mate's error", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let calls = 0;
    const reads = makeArchiveReads(store, {
      read: (id) =>
        id === other || ++calls > 1
          ? Effect.fail({ outcome: "definitive-refusal", message: `Refused ${id}.` })
          : Effect.succeed(empty),
    });
    const done = until(store, () => shown(store).snapshots.length === 1);
    const release = reads.demand(env);
    await done;
    const refused = until(store, () => shown(store).failures.length === 1);
    reads.again(env);
    await refused;
    release();
    const remount = reads.demand(env);
    expect(calls).toBe(2);
    expect(shown(store, [env], []).snapshots).toHaveLength(1);
    const failed = until(store, () => shown(store, [env, other]).failures.length === 2);
    const stopOther = reads.demand(other);
    await failed;
    expect(shown(store, [env, other]).failures.map((failure) => failure.environmentId)).toEqual([
      env,
      other,
    ]);
    expect(shown(store, [env, other]).isLoading).toBe(false);
    remount();
    stopOther();
    reads.close();
    registry.dispose();
  });
  it("marks a changed archive for owner reread even while its surface is closed", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let calls = 0;
    const reads = makeArchiveReads(store, {
      read: () => Effect.sync(() => ({ ...empty, snapshotSequence: ++calls })),
    });
    const first = until(store, () => shown(store).snapshots.length === 1);
    const release = reads.demand(env);
    await first;
    release();
    reads.again(env);
    const second = until(store, () => shown(store).snapshots[0]?.snapshot.snapshotSequence === 2);
    const remount = reads.demand(env);
    await second;
    expect(calls).toBe(2);
    remount();
    reads.close();
    registry.dispose();
  });
  it("account close fences a late answer", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let answer!: (snapshot: OrchestrationShellSnapshot) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const reads = makeArchiveReads(store, {
      read: () =>
        Effect.promise(() => {
          entered();
          return new Promise((resolve) => {
            answer = resolve;
          });
        }),
    });
    reads.demand(env);
    await started;
    reads.close();
    answer(empty);
    await Promise.resolve();
    expect(shown(store).snapshots).toEqual([]);
    registry.dispose();
  });
});

it("a changed archive clears a retained refusal even when the archive surface is closed", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let calls = 0;
  const reads = makeArchiveReads(store, {
    read: () =>
      ++calls === 1
        ? Effect.fail({ outcome: "definitive-refusal", message: "Not available yet." })
        : Effect.succeed(empty),
  });
  const failed = until(store, () => shown(store).failures.length === 1);
  const release = reads.demand(env);
  await failed;
  release();
  reads.again(env);
  const ready = until(
    store,
    () => shown(store).snapshots.length === 1 && shown(store).failures.length === 0,
  );
  const remount = reads.demand(env);
  await ready;
  expect(calls).toBe(2);
  remount();
  reads.close();
  registry.dispose();
});

it("denial withholds the prior archive without claiming it was deleted", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let calls = 0;
  const reads = makeArchiveReads(store, {
    read: () =>
      ++calls === 1
        ? Effect.succeed(empty)
        : Effect.fail({ outcome: "authoritative-denial", message: "No longer allowed." }),
  });
  const first = until(store, () => shown(store).snapshots.length === 1);
  const release = reads.demand(env);
  await first;
  const denied = until(store, () => shown(store).failures.length === 1);
  reads.again(env);
  await denied;
  expect(shown(store).snapshots).toEqual([]);
  expect(readsOfState(store.state()).fact("mateArchive", env)).toMatchObject({
    kind: "withheld",
    reason: "denied",
  });
  release();
  reads.close();
  registry.dispose();
});

it("a superseded archive answer cannot clear or overwrite the newer read", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let reply!: (snapshot: OrchestrationShellSnapshot) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  const newer = { ...empty, snapshotSequence: 2 };
  const reads = makeArchiveReads(store, {
    read: () =>
      ++calls === 1
        ? Effect.promise(() => {
            entered();
            return new Promise((resolve) => {
              reply = resolve;
            });
          })
        : Effect.succeed(newer),
  });
  const release = reads.demand(env);
  await started;
  const ready = until(store, () => shown(store).snapshots[0]?.snapshot.snapshotSequence === 2);
  reads.again(env);
  reply(empty);
  await ready;
  expect(shown(store).snapshots[0]?.snapshot).toEqual(newer);
  expect(calls).toBe(2);
  release();
  reads.close();
  registry.dispose();
});
