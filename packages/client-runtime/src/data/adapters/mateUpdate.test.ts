import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import { AtomRegistry } from "effect/reactivity";
import { EnvironmentId, ZeropsMateUpdateError } from "@t3tools/contracts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { mateUpdate, mateUpdateStates } from "../projections/mateUpdate.ts";
import { makeMateUpdates } from "./mateUpdate.ts";

const env = EnvironmentId.make("one");
const other = EnvironmentId.make("two");
const server = { serverVersion: "1", bootId: "old" };
const updated = { action: "updated" as const, restarted: true, serverVersion: "1", to: "2" };
const available = { installed: "1", latest: "2", available: true, checkedAt: "source" };
const setup = (overrides: Partial<Parameters<typeof makeMateUpdates>[0]> = {}) => {
  const store = makeAccountStore(AtomRegistry.make());
  let ids = 0;
  const host = makeMateUpdates({
    store,
    wire: { update: () => Effect.succeed(updated), check: () => Effect.succeed(available) },
    isCurrent: () => true,
    makeId: () => `request-${++ids}`,
    ...overrides,
  });
  return { store, host, read: (id = env) => mateUpdate.derive(readsOfState(store.state()), id) };
};
describe("account update receipts", () => {
  it("an unread update check is unknown, not up to date", () => {
    const { read, host } = setup();
    expect(read()).toEqual({ state: { phase: "idle" }, checked: undefined });
    host.close();
  });
  it("check resolves with the server's answer, so the caller can offer what it found", async () => {
    const { host, read } = setup();
    expect(await host.check(env)).toEqual(available);
    expect(read()).toEqual({ state: { phase: "idle" }, checked: available });
    host.close();
  });
  it("an authoritative null check overrides a previous offered version", async () => {
    const { host, read } = setup({
      wire: { update: () => Effect.succeed(updated), check: () => Effect.succeed(null) },
    });
    expect(await host.check(env)).toBeNull();
    expect(read()).toEqual({ state: { phase: "already-current" }, checked: null });
    host.close();
  });
  it("the update belongs to the Mate it was started on, including while its socket is down", async () => {
    const { host, store, read } = setup();
    await host.update(env, server, "2", "container");
    expect(read().state).toEqual({ phase: "updating", to: "2" });
    expect(read(other).state).toEqual({ phase: "idle" });
    expect(mateUpdateStates.derive(readsOfState(store.state()), null).get(env)?.containerKey).toBe(
      "container",
    );
    host.observe(env, null);
    expect(read().state.phase).toBe("updating");
    host.close();
  });
  it("a socket that blinked and came back to the same boot is still updating", async () => {
    const { host, read } = setup();
    await host.update(env, server, "2", null);
    host.observe(env, server);
    expect(read().state.phase).toBe("updating");
    host.close();
  });
  it("a Mate that comes back late has still updated; completion survives surface remount", async () => {
    const { host, read, store } = setup();
    await host.update(env, server, "2", null);
    host.observe(env, { serverVersion: "2", bootId: "new" });
    expect(read().state).toEqual({ phase: "updated", to: "2" });
    host.close();
    expect(mateUpdate.derive(readsOfState(store.state()), env).state).toEqual({
      phase: "updated",
      to: "2",
    });
  });
  it("the RPC's own error fails with that message and remains visible after remount", async () => {
    const { host, read } = setup({
      wire: {
        update: () => Effect.succeed({ ...updated, error: "No credit" }),
        check: () => Effect.succeed(available),
      },
    });
    await host.update(env, server, "2", null);
    host.observe(env, { serverVersion: "2" });
    host.close();
    expect(read().state).toEqual({ phase: "failed", message: "No credit" });
  });
  it("a lost answer is never re-sent and later owner evidence settles it", async () => {
    let sends = 0;
    const { host, read } = setup({
      wire: {
        update: () =>
          Effect.suspend(() => {
            sends++;
            return Effect.fail(
              new ZeropsMateUpdateError({ reason: "timed-out", message: "Timed out" }),
            );
          }),
        check: () => Effect.succeed(available),
      },
    });
    await host.update(env, server, "2", null);
    expect(read().state.phase).toBe("updating");
    expect(read().notice).toContain("answer was lost");
    await host.update(env, server, "2", null);
    expect(sends).toBe(1);
    host.observe(env, { serverVersion: "2", bootId: "new" });
    expect(read().state).toEqual({ phase: "updated", to: "2" });
    host.close();
  });
  it.effect("an account change fences a late check answer", () =>
    Effect.gen(function* () {
      const pending = yield* Deferred.make<typeof available>();
      let current = true;
      const { host, read } = setup({
        isCurrent: () => current,
        wire: { update: () => Effect.succeed(updated), check: () => Deferred.await(pending) },
      });
      const check = host.check(env);
      current = false;
      yield* Deferred.succeed(pending, available);
      expect(yield* Effect.promise(() => check)).toBeUndefined();
      expect(read().checked).toBeUndefined();
      host.close();
    }),
  );
});

describe("update follow-up actions", () => {
  it("a new check replaces completed feedback and offers the owner's next version", async () => {
    const { host, read } = setup();
    await host.update(env, server, "2", null);
    host.observe(env, { serverVersion: "2", bootId: "new" });
    await host.check(env);
    expect(read().state).toEqual({ phase: "idle" });
    expect(read().checked).toEqual(available);
    host.close();
  });
  it("retains the actual completed version rather than the requested one", async () => {
    const { host, read } = setup();
    await host.update(env, server, "2", null);
    host.observe(env, { serverVersion: "3", bootId: "new" });
    host.observe(env, null);
    expect(read().state).toEqual({ phase: "updated", to: "3" });
    host.close();
  });
});

describe("accepted update demand", () => {
  it("observation outlives the initiating surface and releases only on owner settlement", async () => {
    let demanded = 0;
    const { host } = setup({
      demand: () => {
        demanded++;
        return () => {
          demanded--;
        };
      },
    });
    await host.update(env, server, "2", null);
    expect(demanded).toBe(1);
    host.observe(env, null);
    expect(demanded).toBe(1);
    host.observe(env, { serverVersion: "2", bootId: "new" });
    expect(demanded).toBe(0);
    host.close();
  });
});

describe("update actions across surfaces", () => {
  it("a subscribed menu sees an update started and completed by another surface", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const r = setup({ store });
    const seen: string[] = [];
    const release = registry.subscribe(
      store.data.project(mateUpdateStates, null),
      (rows) => {
        const row = rows.get(env);
        if (row !== undefined) seen.push(row.state.phase);
      },
      { immediate: true },
    );
    await r.host.update(env, server, "2", "container");
    r.host.observe(env, { serverVersion: "2", bootId: "new" });
    expect(seen).toContain("updating");
    expect(seen.at(-1)).toBe("updated");
    release();
    r.host.close();
  });
});

describe("owner acceptance precedes update completion", () => {
  it.effect(
    "a version read before the owner answers cannot turn a pending press into success",
    () =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const answer = yield* Deferred.make<typeof updated>();
        const { host, read } = setup({
          wire: {
            update: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined);
                return yield* Deferred.await(answer);
              }),
            check: () => Effect.succeed(available),
          },
        });
        const update = host.update(env, server, "2", null);
        yield* Deferred.await(started);
        host.observe(env, { serverVersion: "2", bootId: "new" });
        const beforeAnswer = read().state.phase;
        yield* Deferred.succeed(answer, updated);
        yield* Effect.promise(() => update);
        host.observe(env, { serverVersion: "2", bootId: "new" });
        const completed = read().state;
        host.close();
        expect(beforeAnswer).toBe("updating");
        expect(completed).toEqual({ phase: "updated", to: "2" });
      }),
  );
});

describe("automatic update acceptance", () => {
  it.each([
    { name: "socket unavailable", observed: null, phase: "updating" },
    { name: "same boot", observed: server, phase: "updating" },
    { name: "boot identity unavailable", observed: { serverVersion: "1" }, phase: "updating" },
    { name: "new version", observed: { serverVersion: "2", bootId: "new" }, phase: "updated" },
    {
      name: "rollback to the old version",
      observed: { serverVersion: "1", bootId: "new" },
      phase: "failed",
    },
  ])("a started acknowledgment waits for owner evidence: $name", async ({ observed, phase }) => {
    const { host, read } = setup({
      wire: {
        update: () => Effect.succeed({ ...updated, action: "none", started: true }),
        check: () => Effect.succeed(available),
      },
    });
    await host.update(env, server, "2", null);
    expect(read().state).toEqual({ phase: "updating", to: "2" });
    host.observe(env, observed);
    expect(read().state.phase).toBe(phase);
    if (phase === "updated") expect(read().state).toEqual({ phase: "updated", to: "2" });
    if (phase === "failed")
      expect(read().state).toEqual({
        phase: "failed",
        message: "The update did not take: this Mate is still on 1.",
      });
    host.close();
  });
});
