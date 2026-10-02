import { it as effectIt } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { project, service } from "../data/__fixtures__/index.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import type { LeaseAdmissionError } from "../data/types.ts";
import type { GiteaSessions } from "../forge/giteaSession.ts";
import type { PlatformSignal, PlatformSignals } from "../knowledge/signals.ts";
import { deploymentStorePorts, makeForgeWiring } from "./flow.ts";

/** The Gitea sessions, as spies. */
function forge() {
  const sessions = {
    resume: vi.fn(),
    wake: vi.fn(),
    online: vi.fn(),
    close: vi.fn(),
  };
  return { sessions, stores: { sessions: sessions as unknown as GiteaSessions } };
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
  });

describe("the post-grant stage's Gitea sessions and the tab (DESIGN §6.4)", () => {
  it.each([
    ["a visible wake tries every wait", { type: "wake", visible: true, cause: "shown" }, ["wake"]],
    [
      "a hidden wake evaluates what came due",
      { type: "wake", visible: false, cause: "resume" },
      ["resume"],
    ],
    ["shown again runs what came due", { type: "visibility", hidden: false }, ["resume"]],
    ["hidden starts nothing more", { type: "visibility", hidden: true }, []],
    ["online tries the sessions again", { type: "network", online: true }, ["online"]],
  ] as const)("%s", (_case, signal: PlatformSignal, expected) => {
    const { sessions, stores } = forge();
    const stage = wiring(false).start(stores);

    stage.hear(signal);

    expect(
      Object.entries(sessions)
        .filter(([, spy]) => spy.mock.calls.length > 0)
        .map(([method]) => method),
    ).toEqual(expected);
  });

  it("forgets the Gitea tokens when it ends (§5 L9)", () => {
    const { sessions, stores } = forge();
    wiring(false).start(stores).dispose();
    expect(sessions.close).toHaveBeenCalledTimes(1);
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
      stateAtom: Atom.make({ table: {} }),
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

  it("states a service's version from the account's store, reading nothing for it", () => {
    const shown = Atom.make({ state: "reading", sinceMs: 0, attempt: 1 });
    const asked: Array<unknown> = [];
    const data = {
      reads: {
        deployedVersion: (target: unknown) => {
          asked.push(target);
          return shown;
        },
      },
    } as unknown as ManagedZeropsDataRuntime;
    const registry = AtomRegistry.make();
    const ports = deploymentStorePorts(data, registry, Context.empty());
    const target = service("app-id", project("project-stage"));

    expect(ports.deployedVersion(target).state).toBe("reading");
    registry.set(shown, { state: "reading", sinceMs: 0, attempt: 2 });
    expect(ports.deployedVersion(target)).toMatchObject({ attempt: 2 });
    expect(asked).toEqual([target, target]);
  });

  it("follows a stop, and hears what its organization's versions and variables say", () => {
    const listing = Atom.make(null);
    const state = Atom.make({ table: { rows: 1 } });
    const acquired: Array<string> = [];
    const data = {
      reads: { servicesOf: () => listing, runningProcessesOf: () => listing },
      stateAtom: state,
      acquire: (descriptor: { readonly kind: string }) => {
        acquired.push(descriptor.kind);
        return Effect.never;
      },
    } as unknown as ManagedZeropsDataRuntime;
    const registry = AtomRegistry.make();
    const ports = deploymentStorePorts(data, registry, Context.empty());
    let changes = 0;

    const unfollow = ports.follow(
      project("project-stage"),
      () => (changes += 1),
      () => undefined,
    );

    // The organization's versions and variables are the account's, streamed for its session.
    expect(acquired).toEqual(["project-activity"]);
    registry.set(state, { table: { rows: 2 } });
    expect(changes).toBe(1);
    unfollow();
    registry.set(state, { table: { rows: 3 } });
    expect(changes).toBe(1);
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
