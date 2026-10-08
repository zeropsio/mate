import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { makeAccountStore, readsOfState } from "../store.ts";
import { databaseSession } from "../projections/database.ts";
import { databaseSessionScope } from "../families/database.ts";
import { makeDatabaseSessionSink } from "./databaseSession.ts";

const environmentId = EnvironmentId.make("session-test");
function fixture() {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const sink = makeDatabaseSessionSink(store, environmentId);
  const read = () => databaseSession.derive(readsOfState(store.state()), environmentId);
  return { store, sink, read, close: () => registry.dispose() };
}

describe("database session source", () => {
  it("keeps an unobserved session unknown and preserves the owner's starting steps", () => {
    const f = fixture();
    expect(f.read()).toBeUndefined();
    f.sink.session(0);
    f.sink.value({ status: "idle" }, 1);
    expect(f.read()).toEqual({ status: "idle" });
    f.sink.value({ status: "starting" }, 2);
    expect(f.read()).toEqual({ status: "starting" });
    f.sink.value({ status: "ready", allowWrites: true }, 3);
    expect(f.read()).toEqual({ status: "ready" });
    f.close();
  });

  it.each([
    ["outage", { outcome: "transient", message: "offline" }, { status: "ready" }],
    [
      "denial",
      { outcome: "authoritative-denial", message: "denied" },
      { status: "unavailable", reason: "The Mate refused the data console." },
    ],
  ] as const)("reports %s without inventing a console status", (_name, fault, expected) => {
    const f = fixture();
    f.sink.session(0);
    f.sink.value({ status: "ready" }, 1);
    f.sink.lost(fault, 2);
    expect(f.read()).toEqual(expected);
    f.close();
  });

  it("drops the old unavailable reason when a new session proves idle", () => {
    const f = fixture();
    f.sink.session(0);
    f.sink.value({ status: "unavailable", reason: "zcp is not available" }, 1);
    f.sink.session(2);
    f.sink.value({ status: "idle" }, 3);
    expect(f.read()).toEqual({ status: "idle" });
    f.close();
  });

  it("does not let remount or late frames revive a refused scope", () => {
    const f = fixture();
    f.sink.session(0);
    f.sink.lost({ outcome: "definitive-refusal", message: "unsupported" }, 1);
    const remounted = makeDatabaseSessionSink(f.store, environmentId);
    remounted.session(2);
    remounted.value({ status: "ready" }, 3);
    expect(f.read()).toEqual({ status: "unavailable", reason: "unsupported" });
    f.close();
  });

  it("fences old attempts and accepts a rebuilt source's next revision", () => {
    const f = fixture();
    f.sink.session(0);
    f.sink.value({ status: "starting" }, 1);
    const replacement = makeDatabaseSessionSink(f.store, environmentId);
    replacement.session(2);
    f.sink.value({ status: "unavailable", reason: "old frame" }, 3);
    expect(f.read()).toEqual({ status: "starting" });
    replacement.value({ status: "ready" }, 4);
    expect(f.read()).toEqual({ status: "ready" });
    expect(f.store.state().streams.get(databaseSessionScope(environmentId))?.phase).toBe("live");
    f.close();
  });
});

it("shares idle observation between consumers without starting the console", async () => {
  const { Stream } = await import("effect");
  const { makeDatabaseReads } = await import("./database.ts");
  const f = fixture();
  let subscriptions = 0;
  let calls = 0;
  const observed = new Promise<void>((resolve) => {
    const stop = f.store.subscribe(() => {
      if (f.read()?.status === "idle") {
        stop();
        resolve();
      }
    });
  });
  const reads = makeDatabaseReads({
    store: f.store,
    wire: {
      call: () => {
        calls += 1;
        return Promise.reject(new Error("not called"));
      },
      session: {
        open: () => {
          subscriptions += 1;
          return Stream.concat(
            Stream.make(
              { kind: "session" as const },
              { kind: "value" as const, value: { status: "idle" as const } },
            ),
            Stream.never,
          );
        },
      },
    },
  });
  const first = reads.demandSession(environmentId);
  const second = reads.demandSession(environmentId);
  await observed;
  expect(subscriptions).toBe(1);
  expect(calls).toBe(0);
  first();
  expect(f.store.state().streams.get(databaseSessionScope(environmentId))?.phase).toBe("live");
  const paused = new Promise<void>((resolve) => {
    const stop = f.store.subscribe(() => {
      if (f.store.state().streams.get(databaseSessionScope(environmentId))?.phase === "paused") {
        stop();
        resolve();
      }
    });
  });
  second();
  await paused;
  reads.close();
  f.close();
});

it("keeps a definitive wire refusal terminal across released and rebuilt session demand", async () => {
  const { Stream } = await import("effect");
  const { makeDatabaseReads } = await import("./database.ts");
  const f = fixture();
  let subscriptions = 0;
  const wire = {
    call: () => Promise.reject(new Error("not called")),
    session: {
      open: () => {
        subscriptions += 1;
        return Stream.fail({ outcome: "definitive-refusal" as const, message: "source denied" });
      },
    },
  };
  const refused = new Promise<void>((resolve) => {
    const stop = f.store.subscribe(() => {
      if (f.store.state().streams.get(databaseSessionScope(environmentId))?.phase === "refused") {
        stop();
        resolve();
      }
    });
  });
  const reads = makeDatabaseReads({ store: f.store, wire });
  const release = reads.demandSession(environmentId);
  await refused;
  expect(f.read()).toEqual({ status: "unavailable", reason: "source denied" });
  release();
  reads.close();
  const rebuilt = makeDatabaseReads({ store: f.store, wire });
  const end = rebuilt.demandSession(environmentId);
  expect(subscriptions).toBe(1);
  end();
  rebuilt.close();
  f.close();
});
