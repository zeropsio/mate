import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/reactivity";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { linkKeys, type OperationReceipt } from "../model.ts";
import { ZeropsApiError, ZeropsWriteNotSent } from "../../zerops/api.ts";
import { runningScope } from "../families/process.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { makeOperations } from "./coordinator.ts";
import { type MateRestartPlatform, mateRestartOwner } from "./executors/mateRestart.ts";
import { mateRestart, restartWay } from "./mateRestart.ts";

const RESTART = {
  kind: "mate-restart",
  orgId: ORG,
  projectId: "p1",
  serviceId: "s1",
  way: "restart",
} as const;
const REVIVE = { ...RESTART, way: "stop-then-start" } as const;

function account() {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({ running: [] }).forEach(store.dispatch);
  return { store, registry };
}

const processRow = (
  store: AccountStore,
  id: string,
  status: string,
  version: number,
  actionName = "stack.restart",
  serviceId = "s1",
) =>
  store.dispatch({
    kind: "rows",
    scope: runningScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "process",
        id,
        value: {
          id,
          projectId: "p1",
          serviceStackIds: [serviceId],
          status,
          actionName,
          created: "2026-10-06T00:00:00Z",
        },
        revision: { kind: "zerops", version },
      },
    ],
  });

function platformOf(
  options: {
    readonly restart?: () => Promise<{ processId: string }>;
    readonly stop?: () => Promise<{ processId: string }>;
    readonly start?: () => Promise<{ processId: string }>;
  } = {},
) {
  const calls: string[] = [];
  const platform: MateRestartPlatform = {
    restartService: async (serviceId) => {
      calls.push(`restart ${serviceId}`);
      return options.restart === undefined ? { processId: "proc-restart" } : options.restart();
    },
    stopService: async (serviceId) => {
      calls.push(`stop ${serviceId}`);
      return options.stop === undefined ? { processId: "proc-stop" } : options.stop();
    },
    startService: async (serviceId) => {
      calls.push(`start ${serviceId}`);
      return options.start === undefined ? { processId: "proc-start" } : options.start();
    },
  };
  return { platform, calls };
}

function operationsOf(
  store: AccountStore,
  registry: AtomRegistry.AtomRegistry,
  platform: MateRestartPlatform,
  holds: string[] = [],
) {
  const owner = mateRestartOwner({
    platform,
    store,
    registry,
    holdHistory: (projectId) => {
      holds.push(`hold ${projectId}`);
      return () => holds.push(`release ${projectId}`);
    },
  });
  return makeOperations({
    store,
    executors: {
      zerops: {
        submit: (requestId, intent) =>
          intent.kind === "mate-restart" ? owner.submit(requestId, intent) : Effect.die("no"),
      },
    },
    makeId: () => "r1",
  });
}

const progress = (store: AccountStore) =>
  operationProgress.derive(readsOfState(store.state()), "r1");

describe("mate-restart", () => {
  it.effect("is accepted with its process, reflected by its row, and ended by it alone", () =>
    Effect.gen(function* () {
      for (const [status, outcome] of [
        ["FINISHED", { stage: "done", operationId: "proc-restart", outcome: "succeeded" }],
        [
          "FAILED",
          {
            stage: "done",
            operationId: "proc-restart",
            outcome: "failed",
            reason: "The restart ended FAILED.",
          },
        ],
        [
          "CANCELED",
          {
            stage: "done",
            operationId: "proc-restart",
            outcome: "failed",
            reason: "The restart ended CANCELED.",
          },
        ],
      ] as const) {
        const { store, registry } = account();
        const { platform, calls } = platformOf();
        yield* operationsOf(store, registry, platform).submit(RESTART);
        expect(calls).toEqual(["restart s1"]);
        expect(progress(store)).toEqual({ stage: "accepted", operationId: "proc-restart" });

        processRow(store, "proc-restart", "RUNNING", 1);
        expect(progress(store)).toEqual({ stage: "reflected", operationId: "proc-restart" });
        // No clock ends it.
        yield* TestClock.adjust("2 hours");
        expect(progress(store).stage).toBe("reflected");

        processRow(store, "proc-restart", status, 2);
        expect(progress(store)).toEqual(outcome);
      }
    }),
  );

  it.effect(
    "starts a failed container only once its stop's process has ended, never by a clock",
    () =>
      Effect.gen(function* () {
        const { store, registry } = account();
        const { platform, calls } = platformOf();
        const fiber = yield* Effect.forkChild(
          operationsOf(store, registry, platform).submit(REVIVE),
        );
        yield* Effect.yieldNow;
        expect(calls).toEqual(["stop s1"]);

        processRow(store, "proc-stop", "RUNNING", 1, "stack.stop");
        yield* TestClock.adjust("10 minutes");
        expect(calls).toEqual(["stop s1"]);
        expect(progress(store)).toEqual({ stage: "submitting" });

        processRow(store, "proc-stop", "FAILED", 2, "stack.stop");
        yield* Fiber.join(fiber);
        expect(calls).toEqual(["stop s1", "start s1"]);
        expect(progress(store)).toEqual({ stage: "accepted", operationId: "proc-start" });
      }),
  );

  it.effect("a lost answer is resolved by the project's running restart, never sent again", () =>
    Effect.gen(function* () {
      const { store, registry } = account();
      const { platform, calls } = platformOf({
        restart: () => Promise.reject(new Error("socket closed")),
      });
      const operations = operationsOf(store, registry, platform);
      yield* operations.submit(RESTART);
      expect(progress(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });

      processRow(store, "proc-restart", "RUNNING", 1);
      yield* operations.retry("r1");
      expect(progress(store)).toEqual({ stage: "reflected", operationId: "proc-restart" });
      expect(calls).toEqual(["restart s1"]);
    }),
  );

  it.each([
    { status: "ACTIVE", way: "restart" },
    { status: "STOPPED", way: "restart" },
    { status: "FAILED", way: "stop-then-start" },
    { status: "ACTION_FAILED", way: "stop-then-start" },
    { status: "SERVICE_CONTAINER_FAILED", way: "stop-then-start" },
    { status: undefined, way: "restart" },
  ])("brings a $status container back by $way", ({ status, way }) => {
    expect(restartWay(status)).toBe(way);
  });

  it.effect("adopts after a lost answer only a restart of its own service", () =>
    Effect.gen(function* () {
      const { store, registry } = account();
      const { platform } = platformOf({
        restart: () => Promise.reject(new Error("socket closed")),
      });
      const operations = operationsOf(store, registry, platform);
      yield* operations.submit(RESTART);

      processRow(store, "proc-other", "RUNNING", 1, "stack.restart", "s2");
      yield* operations.retry("r1");
      expect(progress(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
    }),
  );

  it("holds its project's process history until it ends, so an end during an outage is read", () => {
    const receipt = {
      handles: ["proc-restart"],
      outcome: { kind: "pending" },
    } as unknown as OperationReceipt;
    expect(mateRestart.observedIn!(RESTART, receipt)).toEqual({
      family: "process",
      listing: "history",
      ownerId: "p1",
    });
  });

  it.effect("adopts after a lost stop answer only the start, so a stop alone never succeeds", () =>
    Effect.gen(function* () {
      const { store, registry } = account();
      const { platform, calls } = platformOf({
        stop: () => Promise.reject(new Error("socket closed")),
      });
      const operations = operationsOf(store, registry, platform);
      yield* operations.submit(REVIVE);
      processRow(store, "proc-stop", "RUNNING", 1, "stack.stop");
      yield* operations.retry("r1");
      expect(progress(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      processRow(store, "proc-stop", "FINISHED", 2, "stack.stop");
      yield* operations.retry("r1");
      expect(progress(store).stage).toBe("uncertain");
      expect(calls).toEqual(["stop s1"]);
    }),
  );

  it.effect(
    "a restart its admission refused before sending stays refused, never maybe-landed",
    () =>
      Effect.gen(function* () {
        const { store, registry } = account();
        const { platform } = platformOf({
          restart: () =>
            Promise.reject(
              new ZeropsWriteNotSent({ message: "Project access could not be verified." }),
            ),
        });
        yield* operationsOf(store, registry, platform).submit(RESTART);
        expect(progress(store)).toEqual({
          stage: "refused",
          reason: "Project access could not be verified.",
        });
      }),
  );

  it.effect("a refusal says what Zerops said, not its status", () =>
    Effect.gen(function* () {
      const { store, registry } = account();
      const { platform } = platformOf({
        restart: () =>
          Promise.reject(
            new ZeropsApiError(
              "Service stack is failed.",
              "invalid-input",
              400,
              "serviceStackIsFailed",
            ),
          ),
      });
      yield* operationsOf(store, registry, platform).submit(RESTART);
      expect(progress(store)).toEqual({
        stage: "refused",
        reason: "Service stack is failed.",
        code: "serviceStackIsFailed",
      });
    }),
  );

  it.effect.each([
    [
      "Zerops refused it",
      () => Promise.reject(new ZeropsApiError("Service is busy.", "invalid-input", 400)),
      "Service is busy.",
    ],
    [
      "its admission refused it before sending",
      () =>
        Promise.reject(
          new ZeropsWriteNotSent({ message: "Project access could not be verified." }),
        ),
      "Project access could not be verified.",
    ],
  ] as const)(
    "a start not taken after the stop landed ends unresolved, starting the Mate next: %s",
    ([, start, reason]) =>
      Effect.gen(function* () {
        const { store, registry } = account();
        const { platform, calls } = platformOf({ start });
        const fiber = yield* Effect.forkChild(
          operationsOf(store, registry, platform).submit(REVIVE),
        );
        yield* Effect.yieldNow;
        processRow(store, "proc-stop", "FINISHED", 1, "stack.stop");
        yield* Fiber.join(fiber);
        expect(calls).toEqual(["stop s1", "start s1"]);
        expect(progress(store)).toEqual({
          stage: "unresolved",
          operationId: null,
          nextActor: "person",
          nextAction: "Start the Mate",
          reason,
        });
      }),
  );

  it.effect("holds its project's process history from the moment the stop is sent", () =>
    Effect.gen(function* () {
      const { store, registry } = account();
      const holds: string[] = [];
      const { platform } = platformOf({
        stop: async () => {
          holds.push("stop sent");
          return { processId: "proc-stop" };
        },
      });
      const fiber = yield* Effect.forkChild(
        operationsOf(store, registry, platform, holds).submit(REVIVE),
      );
      yield* Effect.yieldNow;
      expect(holds).toEqual(["hold p1", "stop sent"]);
      processRow(store, "proc-stop", "FINISHED", 2, "stack.stop");
      yield* Fiber.join(fiber);
      expect(holds).toEqual(["hold p1", "stop sent", "release p1"]);
    }),
  );

  it.effect.each([
    ["the organization is no longer observed", { kind: "demand", demanded: false }],
    [
      "its link is refused",
      { kind: "fault", fault: { outcome: "definitive-refusal", message: "x" }, jitter: 0 },
    ],
  ] as const)(
    "a stop whose end can no longer be observed ends unresolved, never started: %s",
    ([, event]) =>
      Effect.gen(function* () {
        const { store, registry } = account();
        const { platform, calls } = platformOf();
        const fiber = yield* Effect.forkChild(
          operationsOf(store, registry, platform).submit(REVIVE),
        );
        yield* Effect.yieldNow;
        processRow(store, "proc-stop", "RUNNING", 1, "stack.stop");
        store.dispatch({ kind: "stream", key: linkKeys.zerops(ORG), event, now: 0 });
        yield* Fiber.join(fiber);
        expect(calls).toEqual(["stop s1"]);
        expect(progress(store)).toEqual({
          stage: "unresolved",
          operationId: null,
          nextActor: "person",
          nextAction: "Start the Mate",
        });
        expect(store.state().operations.get("r1")?.handles).toEqual(["proc-stop"]);
      }),
  );
});
