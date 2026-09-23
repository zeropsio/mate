import { it as effectIt } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { project } from "../data/__fixtures__/index.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import type { LeaseAdmissionError } from "../data/types.ts";
import type { FlowCommands } from "../flow/flowCommands.ts";
import type { ForgeStore } from "../forge/forgeStore.ts";
import type { GiteaSessions } from "../forge/giteaSession.ts";
import type { InvalidationBus } from "../knowledge/invalidation.ts";
import type { PlatformSignal, PlatformSignals } from "../knowledge/signals.ts";
import { deploymentStorePorts, makeForgeWiring } from "./flow.ts";

/** The forge's stores, as spies. */
function forge() {
  const sessions = {
    resume: vi.fn(),
    wake: vi.fn(),
    online: vi.fn(),
    close: vi.fn(),
  };
  const store = { setVisible: vi.fn(), wake: vi.fn(), dispose: vi.fn() };
  const commands = { dispose: vi.fn() };
  return {
    sessions,
    store,
    commands,
    stores: {
      sessions: sessions as unknown as GiteaSessions,
      store: store as unknown as ForgeStore,
      commands: commands as unknown as FlowCommands,
    },
  };
}

const tab = (hidden: boolean): PlatformSignals => ({
  hidden: () => hidden,
  online: () => true,
  listen: () => () => undefined,
});

const wiring = (hidden: boolean) =>
  makeForgeWiring({
    ports: {
      fetch: globalThis.fetch,
      now: () => ({ wall: 0, mono: 0 }),
      random: () => 0.5,
      nonce: () => "nonce",
      setTimer: () => () => undefined,
    },
    signals: tab(hidden),
    invalidations: {} as InvalidationBus,
    services: undefined as never,
  });

describe("the post-grant stage's forge and the tab (DESIGN §6.4)", () => {
  it("starts as visible as the tab is", () => {
    const hiddenTab = forge();
    wiring(true).start(hiddenTab.stores);
    expect(hiddenTab.store.setVisible.mock.calls).toEqual([[false]]);
  });

  it.each([
    [
      "a visible wake tries every wait and re-reads what is old",
      { type: "wake", visible: true, cause: "shown" },
      { sessions: ["wake"], store: ["wake"] },
    ],
    [
      "a hidden wake evaluates what came due",
      { type: "wake", visible: false, cause: "resume" },
      { sessions: ["resume"], store: [] },
    ],
    [
      "shown again runs what came due",
      { type: "visibility", hidden: false },
      { sessions: ["resume"], store: ["setVisible"] },
    ],
    [
      "hidden starts nothing more",
      { type: "visibility", hidden: true },
      { sessions: [], store: ["setVisible"] },
    ],
    [
      "online tries the sessions again",
      { type: "network", online: true },
      { sessions: ["online"], store: [] },
    ],
  ] as const)("%s", (_case, signal: PlatformSignal, expected) => {
    const { sessions, store, stores } = forge();
    const stage = wiring(false).start(stores);
    store.setVisible.mockClear();

    stage.hear(signal);

    const called = (spies: Record<string, { readonly mock: { readonly calls: unknown[] } }>) =>
      Object.entries(spies)
        .filter(([, spy]) => spy.mock.calls.length > 0)
        .map(([method]) => method);
    expect({ sessions: called(sessions), store: called(store) }).toEqual(expected);
  });

  it("forgets the Gitea tokens before it ends the stores (§5 L9)", () => {
    const { sessions, store, commands, stores } = forge();
    const order: Array<string> = [];
    sessions.close.mockImplementation(() => order.push("sessions"));
    commands.dispose.mockImplementation(() => order.push("commands"));
    store.dispose.mockImplementation(() => order.push("store"));

    wiring(false).start(stores).dispose();

    expect(order).toEqual(["sessions", "commands", "store"]);
  });
});

describe("the deployment store's ports (DESIGN §2.D D6)", () => {
  it("tells the store why the platform took no demand for a stop's processes", () => {
    const refusal: LeaseAdmissionError = {
      _tag: "ZeropsLeaseAdmissionError",
      reason: "account-capacity",
      message: "too many interests",
    };
    const listing = Atom.make(null);
    const data = {
      reads: { servicesOf: () => listing, runningProcessesOf: () => listing },
      acquire: () => Effect.fail(refusal),
    } as unknown as ManagedZeropsDataRuntime;
    const ports = deploymentStorePorts(data, AtomRegistry.make(), Context.empty());
    const refused: Array<string> = [];

    const unfollow = ports.follow(
      project("project-stage"),
      () => undefined,
      (reason) => refused.push(reason),
    );

    expect(refused).toEqual(["account-capacity"]);
    unfollow();
  });

  effectIt.effect("arms the store's timers on the account's clock, and disarms them", () =>
    Effect.gen(function* () {
      const listing = Atom.make(null);
      const data = {
        reads: { servicesOf: () => listing, runningProcessesOf: () => listing },
      } as unknown as ManagedZeropsDataRuntime;
      const ports = deploymentStorePorts(data, AtomRegistry.make(), yield* Effect.context<never>());
      const fired: Array<string> = [];
      ports.setTimer(2_000, () => fired.push("kept"));
      const disarm = ports.setTimer(2_000, () => fired.push("disarmed"));

      disarm();
      yield* TestClock.adjust(1_999);
      expect(fired).toEqual([]);
      yield* TestClock.adjust(1);
      expect(fired).toEqual(["kept"]);
    }),
  );
});
