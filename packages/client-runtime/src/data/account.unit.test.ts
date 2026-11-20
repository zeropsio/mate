import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { seedHqNavigation } from "./__fixtures__/hqNavigation.ts";
import { placedMenuRows, placedNames, placementsOf } from "../zerops/hq/placement.ts";
import { hqNavigation } from "./projections/hqNavigation.ts";
import { listedProject, projectGone } from "./projections/projects.ts";
import { hqFixtureWire } from "./__fixtures__/hqWire.ts";
import { fixtureWire, settle } from "./__fixtures__/zeropsWire.ts";
import { observeAccount } from "./account.ts";
import { hqPressesScope } from "./families/hqNavigation.ts";
import { historyScope } from "./families/process.ts";
import { linkKeys, type OperationIntent } from "./model.ts";
import type { RegisteredOperationKind } from "./operations/kind.ts";
import { autoUpdatePolicySettings } from "./projections/hqAutoUpdatePolicy.ts";
import { streamOf } from "./reducer.ts";
import { makeAccountStore, readsOfState } from "./store.ts";
import type { StreamEvent } from "./streamMachine.ts";

const emptyZerops = () =>
  fixtureWire((request) =>
    Effect.succeed(request.body?.wsOutputType === "listStream" ? { items: [] } : {}),
  );

// witness: packages/client-runtime/src/data/account.ts | stopStanding ??= holdStandingDemands({ → stopStanding &&= holdStandingDemands({
it.effect("ST25: An open operation's detail stays read without any screen holding it", () =>
  Effect.gen(function* () {
    const store = makeAccountStore(AtomRegistry.make());
    const fixture = fixtureWire((request) =>
      Effect.succeed(
        request.method === "GET"
          ? { status: 200, body: { list: [] } }
          : request.body?.wsOutputType === "listStream"
            ? { items: [] }
            : {},
      ),
    );
    const restart = {
      kind: "restart-service",
      executor: "zerops",
      reflected: () => false,
      observedIn: () => ({ family: "process", listing: "history", ownerId: "p1" }),
    } as RegisteredOperationKind;
    const account = observeAccount({
      store,
      wire: fixture.wire,
      repairSession: Effect.void,
      kinds: [restart],
    });
    yield* Effect.addFinalizer(() => Effect.sync(() => account.close()));
    account.show("org");
    const intent = { kind: "restart-service" } as unknown as OperationIntent;
    store.dispatch({ kind: "operation-recorded", requestId: "request-1", intent });
    store.dispatch({
      kind: "operation-receipt",
      receipt: {
        requestId: "request-1",
        operationId: "proc-1",
        executor: "zerops",
        affected: [],
        handles: ["proc-1"],
        acceptance: { kind: "accepted" },
        outcome: { kind: "pending" },
      },
    });
    yield* settle;
    expect(streamOf(store.state(), historyScope("org", "p1")).phase).toBe("live");
  }),
);

// witness: packages/client-runtime/src/data/account.ts | next.ownerId === running.ownerId → next.orgId === orgId
it.effect(
  "ST26: When HQ is replaced, a late answer from the HQ just removed never restores its value",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const account = observeAccount({
        store,
        wire: emptyZerops().wire,
        repairSession: Effect.void,
      });
      const old = hqFixtureWire();
      const fresh = hqFixtureWire();
      const current = () =>
        autoUpdatePolicySettings.derive(readsOfState(store.state()), {
          orgId: "org-a",
          admin: true,
        });
      const deliver = (
        wire: ReturnType<typeof hqFixtureWire>,
        incarnation: string,
        revision: number,
        enabled: boolean,
      ) =>
        Effect.andThen(
          wire.send({
            type: "scope-reset",
            scope: { kind: "navigation" },
            incarnation,
            revision,
            values: [{ key: "auto-update-policy", value: { orgId: "org-a", enabled, revision } }],
            removals: [],
          }),
          wire.send({
            type: "scope-ready",
            core: { protocol: 1, autoUpdatePolicy: 1 },
            scope: { kind: "navigation" },
            incarnation,
            revision,
          }),
        );
      yield* Effect.addFinalizer(() => Effect.sync(() => account.close()));
      account.show("org-a");
      account.showHq({ orgId: "org-a", ownerId: "old-project", wire: old.wire });
      yield* settle;
      yield* deliver(old, "old-core", 8, false);
      yield* settle;
      expect(current()).toMatchObject({
        policy: { kind: "known", enabled: false },
        editable: true,
      });
      account.showHq({ orgId: "org-a", ownerId: "new-project", wire: fresh.wire });
      yield* deliver(old, "old-core", 9, false);
      yield* settle;
      expect(current().editable).toBe(false);
      yield* deliver(fresh, "new-core", 0, true);
      yield* settle;
      expect(current()).toMatchObject({
        policy: { kind: "known", enabled: true },
        editable: true,
      });
      yield* deliver(old, "old-core", 10, false);
      yield* settle;
      expect(current()).toMatchObject({
        policy: { kind: "known", enabled: true },
        editable: true,
      });
    }),
);

// witness: packages/client-runtime/src/data/account.ts | pressing.set(press, orgId); → pressing.set(press, projectId);
it.effect(
  "ST27: A running press keeps its organization's HQ open while another organization is shown, until it lets it go",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const account = observeAccount({
        store,
        wire: emptyZerops().wire,
        repairSession: Effect.void,
      });
      const a = hqFixtureWire();
      const b = hqFixtureWire();
      yield* Effect.addFinalizer(() => Effect.sync(() => account.close()));
      account.show("org-a");
      account.showHq({ orgId: "org-a", wire: a.wire });
      yield* settle;
      const release = account.keepPress("org-a", "p-1", () => undefined);
      account.show("org-b");
      account.showHq({ orgId: "org-b", wire: b.wire });
      yield* settle;
      expect(streamOf(store.state(), linkKeys.hq("org-a")).demanded).toBe(true);
      release();
      yield* settle;
      expect(streamOf(store.state(), linkKeys.hq("org-a")).demanded).toBe(false);
      expect(streamOf(store.state(), linkKeys.hq("org-b")).demanded).toBe(true);
    }),
);

// witness: packages/client-runtime/src/data/account.ts | return watch === "dropped" ? "lapsed" : watch; → return watch === "held" || watch === "dropped" ? "lapsed" : watch;
it("ST28: A running press lapses only when HQ, back after its grace, no longer holds it: a return within HQ's grace or an end on a stream that stayed keeps it", () => {
  const store = makeAccountStore(AtomRegistry.make());
  const account = observeAccount({ store, wire: emptyZerops().wire, repairSession: Effect.void });
  const scope = hqPressesScope("org-a");
  const press = { kind: "mate" as const, held: true };
  seedHqNavigation(store, "org-a", {
    presses: { "p-1": press, "p-2": { ...press, kind: "stage" } },
  });
  const lapsed: Array<string> = [];
  account.keepPress("org-a", "p-1", () => lapsed.push("p-1"));
  const stage = account.keepPress("org-a", "p-2", () => lapsed.push("p-2"));
  /** HQ's word on its presses: what it removed, on the socket it is said on. */
  const said = (removed: ReadonlyArray<string>) => {
    const scopes = [{ scope, generation: streamOf(store.state(), scope).generation }];
    store.dispatch({
      kind: "delivery",
      via: "hq-stream",
      scopes,
      reset: false,
      rows: [],
      removals: removed.map((id) => ({ family: "hqPress" as const, id })),
    });
    store.dispatch({ kind: "hq-ready", scopes });
  };
  const event = (event: StreamEvent) =>
    store.dispatch({ kind: "stream", key: scope, now: 0, event });
  /** HQ's stream went away; on its next socket, HQ says what it removed meanwhile. */
  const back = (removed: ReadonlyArray<string>) => {
    event({ kind: "parent-lost" });
    event({ kind: "attempt" });
    event({ kind: "handshake" });
    said(removed);
    event({ kind: "baseline-committed" });
  };
  // HQ ended a stage's hold at its registration, on a stream that stayed: no lapse.
  said(["p-2"]);
  stage();
  // Its stream went away and came back within HQ's grace: still held.
  back([]);
  expect(lapsed).toEqual([]);
  // Back past HQ's grace: HQ holds it no more.
  back(["p-1"]);
  expect(lapsed).toEqual(["p-1"]);
  back([]);
  expect(lapsed).toEqual(["p-1"]);
  account.close();
});

// witness: packages/client-runtime/src/data/account.ts | if (heard === null) return; → if (!heard) return;
it.effect(
  "ST29: While the organization's link is down or refused, a detail read answers not read at once, never waiting for the link",
  () =>
    Effect.gen(function* () {
      for (const outcome of ["transient", "definitive-refusal"] as const) {
        const store = makeAccountStore(AtomRegistry.make());
        const account = observeAccount({
          store,
          wire: { open: Effect.fail({ outcome, message: outcome }) },
          repairSession: Effect.void,
        });
        yield* Effect.addFinalizer(() => Effect.sync(() => account.close()));
        account.show("org");
        yield* settle;
        expect(streamOf(store.state(), linkKeys.zerops("org")).phase).not.toBe("connecting");
        const answer = yield* Effect.promise(() =>
          Promise.race([
            account.readDetail({ family: "serviceAgents", ownerId: "s1" }),
            Promise.resolve("pending"),
          ]),
        );
        expect(answer).toBe(false);
      }
    }),
);

// witness: packages/client-runtime/src/data/account.ts | suffix === demand.listing && member === true → suffix === demand.listing && member !== true
it.effect("ST30: A deleted project HQ still places is drawn gone once access is renewed", () =>
  Effect.gen(function* () {
    const store = makeAccountStore(AtomRegistry.make());
    let deleted = false;
    const projects = ["Ada", "Bea"].map((id) => ({
      id,
      clientId: "org",
      name: id,
      status: "ACTIVE",
      lastUpdate: "2026-10-06T12:00:00Z",
    }));
    seedHqNavigation(store, "org", {
      structure: {
        apps: [],
        ungrouped: projects.map(({ id }) => ({ projectId: id, name: id, mate: { face: "" } })),
      },
    });
    const fixture = fixtureWire((request) =>
      Effect.succeed(
        request.method === "GET"
          ? {
              status: deleted && request.path === "/project/Ada" ? 404 : 200,
              body: projects.find(({ id }) => request.path === `/project/${id}`),
            }
          : request.body?.wsOutputType === "listStream"
            ? { items: [] }
            : {},
      ),
    );
    const account = observeAccount({ store, wire: fixture.wire, repairSession: Effect.void });
    yield* Effect.addFinalizer(() => Effect.sync(() => account.close()));
    account.show("org");
    account.demandDetail({ family: "project", listing: "project", ownerId: "Ada" });
    account.demandDetail({ family: "project", listing: "project", ownerId: "Bea" });
    const menu = () => {
      const read = readsOfState(store.state());
      const structure = hqNavigation.derive(read, "org").structure!;
      return placedMenuRows({
        organizationId: "org",
        placements: placementsOf(structure),
        names: placedNames(structure),
        projects: projects.flatMap(
          ({ id }) => listedProject.derive(read, { orgId: "org", projectId: id }) ?? [],
        ),
        candidates: [],
        gone: new Set(
          projects
            .filter(({ id }) => projectGone.derive(read, { orgId: "org", projectId: id }))
            .map(({ id }) => id),
        ),
      }).map((row) => `${row.project.name}${row.projectGone === true ? " (gone)" : ""}`);
    };
    yield* settle;
    expect(menu()).toEqual(["Ada", "Bea"]);
    deleted = true;
    account.renewHeld();
    yield* settle;
    expect(menu()).toEqual(["Ada (gone)", "Bea"]);
  }),
);
