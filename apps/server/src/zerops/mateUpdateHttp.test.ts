import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { MateEngine, inertMateEngine } from "../engine/MateEngine.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { V1UpdateDrain } from "../update/V1UpdateDrain.ts";
import { RpcUpdateAdmission } from "../RpcUpdateAdmission.ts";
import { ProjectCloneTracker } from "../project/ProjectCloneTracker.ts";
import { CrewEngine } from "./crew/CrewEngine.ts";
import { ZeropsAgentLogin } from "./ZeropsAgentLogin.ts";
import { ProviderUpdateSafety } from "../spi/ProviderUpdateSafety.ts";
import { isLocalUpdateRequest, readMateUpdateIdleFacts } from "./mateUpdateHttp.ts";
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
          Layer.succeed(MateEngine, inertMateEngine),
          Layer.mock(TerminalManager)({
            updateDrain: {
              begin: Effect.void,
              cancel: Effect.void,
              quiesce: Effect.void,
              facts: Effect.succeed({ idle: true, blockers: [] }),
            },
          }),
          Layer.mock(V1UpdateDrain)({ facts: Effect.succeed({ idle: engine, blockers: [] }) }),
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
