import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { process, project, service } from "../data/__fixtures__/index.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import { processKeyOf, type LeaseAdmissionError } from "../data/types.ts";
import { deploymentStorePorts } from "./flow.ts";

const observed = (status: string) => ({ knowledge: "observed", fields: { status } });
const UNREAD = { knowledge: "unresolved", fields: {} };

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
      "summary",
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

  it("a visible stop owns only its service demand and hears detail facts when another surface reads them", () => {
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
      "summary",
    );

    // The organization's versions and variables are the account's, streamed for its session.
    expect(acquired).toEqual(["project-inventory"]);
    registry.set(state, { table: { rows: 2 } });
    expect(changes).toBe(1);
    unfollow();
    registry.set(state, { table: { rows: 3 } });
    expect(changes).toBe(1);
  });

  it.each([
    { name: "a build Zerops ended failed", lifecycle: observed("FAILED"), status: "FAILED" },
    { name: "a build still running", lifecycle: observed("RUNNING"), status: "RUNNING" },
    { name: "a process whose status was never read", lifecycle: UNREAD, status: undefined },
    { name: "a process the account does not hold", lifecycle: undefined, status: undefined },
  ])("reads $name's status off the account's store", ({ lifecycle, status }) => {
    const build = process("build-1", project("project-stage"));
    const data = {
      stateAtom: Atom.make({
        activity: {
          processes: new Map(
            lifecycle === undefined ? [] : [[processKeyOf(build), { ref: build, lifecycle }]],
          ),
        },
      }),
    } as unknown as ManagedZeropsDataRuntime;
    const ports = deploymentStorePorts(data, AtomRegistry.make(), Context.empty());
    expect(ports.buildStatus(build)).toBe(status);
  });
});
