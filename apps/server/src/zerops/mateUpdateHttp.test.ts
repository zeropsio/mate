import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpRouter, HttpServerRequest } from "effect/http";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { make, ZeropsMateUpdate } from "./ZeropsMateUpdate.ts";
import { mateOverviewFeed } from "./ZeropsHqLink.ts";
import { CREW_OFF_SNAPSHOT } from "./crew/crewSnapshot.ts";
import type { MateStatusResult } from "./zeropsMateUpdateParse.ts";
import * as Layer from "effect/Layer";
import { MateEngine } from "../engine/MateEngine.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { RpcUpdateAdmission } from "../RpcUpdateAdmission.ts";
import { ProjectCloneTracker } from "../project/ProjectCloneTracker.ts";
import { CrewEngine } from "./crew/CrewEngine.ts";
import { ZeropsAgentLogin } from "./ZeropsAgentLogin.ts";
import { ProviderUpdateSafety } from "../spi/ProviderUpdateSafety.ts";
import { isLocalUpdateRequest, mateUpdateRouteLayer } from "./mateUpdateHttp.ts";
import { readMateUpdateIdleFacts } from "./mateUpdateDrainLive.ts";
import { inertMateEngine } from "../engine/testing/inertEngine.ts";
describe("zcp's update control door", () => {
  it.each([
    ["127.0.0.1", {}, true],
    ["::1", {}, true],
    ["::ffff:127.0.0.1", {}, true],
    ["192.168.1.1", {}, false],
    [undefined, {}, false],
    ["127.0.0.1", { "x-real-ip": "127.0.0.1" }, false],
    ["127.0.0.1", { "x-forwarded-for": "8.8.8.8" }, false],
    ["127.0.0.1", { origin: "https://mate.example" }, false],
  ] as const)("%s with %j is admitted: %s", (address, headers, expected) =>
    expect(isLocalUpdateRequest(address, headers)).toBe(expected),
  );
});

describe("update readiness reads every owner", () => {
  it.effect.each([
    { name: "all owners prove idle", provider: true, engine: true, expected: true },
    {
      name: "native authentication still owns work",
      provider: false,
      engine: true,
      expected: false,
    },
    {
      name: "provider activity is unavailable",
      provider: undefined,
      engine: true,
      expected: false,
    },
    {
      name: "an owner refuses idle without a reason",
      provider: true,
      engine: false,
      expected: false,
    },
  ])("$name", ({ provider, engine, expected }) =>
    readMateUpdateIdleFacts.pipe(
      Effect.map((facts) => {
        expect(facts.idle).toBe(expected);
        if (provider === undefined) expect(facts.blockers).toContain("provider state unknown");
        if (provider === false) expect(facts.blockers).toContain("native authentication");
      }),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(MateEngine, {
            ...inertMateEngine,
            updateDrain: { facts: Effect.succeed({ idle: engine, blockers: [] }) } as never,
          }),
          Layer.mock(TerminalManager)({
            updateDrain: {
              begin: Effect.void,
              cancel: Effect.void,
              quiesce: Effect.void,
              facts: Effect.succeed({ idle: true, blockers: [] }),
            },
          }),
          Layer.mock(RpcUpdateAdmission)({ facts: Effect.succeed({ idle: true, blockers: [] }) }),
          Layer.mock(ProjectCloneTracker)({
            updateFacts: Effect.succeed({ idle: true, blockers: [] }),
          }),
          Layer.mock(CrewEngine)({ updateFacts: Effect.succeed({ idle: true, blockers: [] }) }),
          Layer.mock(ZeropsAgentLogin)({ latest: Effect.succeed({}) }),
          provider === undefined
            ? Layer.empty
            : Layer.mock(ProviderUpdateSafety)({
                facts: Effect.succeed({
                  idle: provider,
                  blockers: provider ? [] : ["native authentication"],
                }),
              }),
        ),
      ),
    ),
  );
});

const statusAt = (phase: NonNullable<MateStatusResult["updater"]>["phase"]): MateStatusResult => ({
  installed: "0.16.18",
  latest: "0.16.18",
  contract: 1,
  updateAvailable: false,
  checkedAt: "2026-10-28T13:23:10Z",
  updater: {
    protocol: 1,
    rollbackCompatible: true,
    phase,
    runningVersion: phase === "switching" ? "0.16.17" : "0.16.18",
  },
});

const commitRig = Effect.gen(function* () {
  let status = statusAt("switching");
  const reads: Array<{ readonly refresh?: boolean; readonly local?: boolean } | undefined> = [];
  let reopened = 0;
  const update = yield* make({
    isZeropsEnvironment: true,
    refreshInterval: Duration.hours(1),
    cli: {
      mateStatus: (options) =>
        Effect.sync(() => {
          reads.push(options);
          return status;
        }),
      mateUpdate: () => Effect.die("not used"),
      version: Effect.die("not used"),
      leaseRelease: () => Effect.die("not used"),
      selfRestart: Effect.die("not used"),
    },
  });
  const feed = yield* mateOverviewFeed({
    environmentId: EnvironmentId.make("env-1"),
    serverVersion: "0.16.18",
    threads: Effect.succeed([]),
    crew: { snapshot: Stream.make(CREW_OFF_SNAPSHOT) },
    agentAuth: { latest: Effect.succeed({ available: true, agents: [] }), changes: Stream.never },
    agentLogin: { latest: Effect.succeed({}), changes: Stream.never },
    logins: { latest: Effect.succeed([]), changes: Stream.never },
    update,
    domainEvents: Stream.never,
  });
  const handler = yield* HttpRouter.toHttpEffect(mateUpdateRouteLayer);
  const receipt = (path: "commit" | "cancel") =>
    handler.pipe(
      Effect.provideService(ZeropsMateUpdate, update),
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(ServerEnvironment)({}),
          Layer.succeed(MateEngine, {
            ...inertMateEngine,
            updateDrain: {
              cancel: Effect.sync(() => {
                reopened += 1;
              }),
            } as never,
          }),
          Layer.mock(TerminalManager)({}),
        ),
      ),
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(
          new Request(`http://localhost/api/mate/update/${path}`, { method: "POST" }),
        ).modify({ remoteAddress: Option.some("127.0.0.1") }),
      ),
    );
  return {
    update,
    feed,
    reads,
    receipt,
    reopened: () => reopened,
    settle: (phase: Parameters<typeof statusAt>[0]) => {
      status = statusAt(phase);
    },
  };
});

describe("zcp's settled update receipt", () => {
  it.effect(
    "On zcp's commit receipt, the Mate rereads zcp's settled update status and publishes it to HQ.",
    () =>
      Effect.gen(function* () {
        const rig = yield* commitRig;
        const before = yield* rig.feed.overview;
        expect(Option.isSome(before) && before.value.identity.update?.automatic).toEqual(
          statusAt("switching").updater,
        );
        const published = yield* rig.feed.changes.pipe(
          Stream.mapEffect(() => rig.feed.overview),
          Stream.filter(
            (overview) =>
              Option.isSome(overview) &&
              overview.value.identity.update?.automatic?.phase === "updated",
          ),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        rig.settle("updated");
        expect((yield* rig.receipt("commit")).status).toBe(200);
        expect((yield* rig.update.current)?.automatic).toEqual(statusAt("updated").updater);
        expect(rig.reads).toEqual([{ local: true }, { local: true }]);
        expect(rig.reopened()).toBe(1);
        expect(Option.isSome(yield* Fiber.join(published))).toBe(true);
      }).pipe(Effect.scoped),
  );

  it.effect("The Mate never invents an update phase and adds no polling timer for it.", () =>
    Effect.gen(function* () {
      const rig = yield* commitRig;
      yield* rig.receipt("cancel");
      expect(rig.reads).toEqual([{ local: true }]);
      for (const phase of ["switching", "postponed", "failed", "updated"] as const) {
        rig.settle(phase);
        yield* rig.receipt("commit");
        expect((yield* rig.update.current)?.automatic).toEqual(statusAt(phase).updater);
      }
      expect(rig.reads).toEqual(Array.from({ length: 5 }, () => ({ local: true })));
      yield* TestClock.adjust(Duration.minutes(30));
      expect(rig.reads).toHaveLength(5);
    }).pipe(Effect.scoped),
  );
});
