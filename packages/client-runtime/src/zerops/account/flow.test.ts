import { it as effectIt } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { project, service } from "../data/__fixtures__/index.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import type { LeaseAdmissionError } from "../data/types.ts";
import { deploymentStorePorts } from "./flow.ts";

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

  it("a visible stop owns its service and process demand, and hears its versions and variables", () => {
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
    expect(acquired).toEqual(["project-topology"]);
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
