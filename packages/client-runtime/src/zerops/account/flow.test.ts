import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { process, project, service } from "../data/__fixtures__/index.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import type { LeaseAdmissionError } from "../data/types.ts";
import { liveZerops, ORG } from "../../data/__fixtures__/account.ts";
import { accountReadsAtom } from "../../data/reads.ts";
import { makeAccountStore } from "../../data/store.ts";
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
      reads: { servicesOf: () => listing },
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
      reads: { servicesOf: () => listing },
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
    { name: "a build Zerops ended failed", row: "FAILED", status: "FAILED" },
    { name: "a build still running", row: "RUNNING", status: "RUNNING" },
    { name: "a process the account does not hold", row: undefined, status: undefined },
  ])("reads $name's status off the account's store", ({ row, status }) => {
    const build = process("build-1", project("project-stage"));
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({
      running:
        row === undefined ? [] : [{ id: "build-1", projectId: "project-stage", status: row }],
    }).forEach(store.dispatch);
    registry.set(accountReadsAtom, { data: store.data, orgId: ORG, demandDetail: () => () => {} });
    const ports = deploymentStorePorts(
      {} as unknown as ManagedZeropsDataRuntime,
      registry,
      Context.empty(),
    );
    expect(ports.buildStatus(build)).toBe(status);
  });

  it("knows no status without a mounted account", () => {
    const ports = deploymentStorePorts(
      {} as unknown as ManagedZeropsDataRuntime,
      AtomRegistry.make(),
      Context.empty(),
    );
    expect(ports.buildStatus(process("build-1", project("project-stage")))).toBeUndefined();
  });
});
