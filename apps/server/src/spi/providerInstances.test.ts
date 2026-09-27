import { describe, expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderAuthStatus,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import {
  agentDefaultInstanceId,
  layer as providerInstancesLayer,
  ProviderInstances,
  providerAuthDisagrees,
} from "./providerInstances.ts";

describe("agentDefaultInstanceId", () => {
  it("maps claude-code to the claudeAgent driver's default instance", () => {
    expect(agentDefaultInstanceId("claude-code")).toBe("claudeAgent");
  });

  it("maps codex to the codex driver's default instance", () => {
    expect(agentDefaultInstanceId("codex")).toBe("codex");
  });
});

describe("providerAuthDisagrees", () => {
  const codex = agentDefaultInstanceId("codex");
  const snapshot = (status: ServerProviderAuthStatus) => [{ instanceId: codex, auth: { status } }];

  it.each([
    {
      name: "picker still says signed out after a verified sign-in",
      providers: snapshot("unauthenticated"),
      verified: "authenticated",
      expected: true,
    },
    {
      name: "picker still says signed in after a verified sign-out",
      providers: snapshot("authenticated"),
      verified: "unauthenticated",
      expected: true,
    },
    {
      name: "picker already agrees",
      providers: snapshot("authenticated"),
      verified: "authenticated",
      expected: false,
    },
    {
      name: "picker snapshot is still pending its own probe",
      providers: snapshot("unknown"),
      verified: "authenticated",
      expected: false,
    },
    {
      name: "the agent's own check could not answer",
      providers: snapshot("unauthenticated"),
      verified: "unknown",
      expected: false,
    },
    {
      name: "no instance of that driver is configured",
      providers: [],
      verified: "authenticated",
      expected: false,
    },
  ] as const)("$name", ({ providers, verified, expected }) => {
    expect(providerAuthDisagrees(providers, codex, verified)).toBe(expected);
  });
});

describe("driverKindOf", () => {
  const provider = (instanceId: string, driver: string) =>
    ({
      instanceId: ProviderInstanceId.make(instanceId),
      driver: ProviderDriverKind.make(driver),
    }) as ServerProvider;
  const instances = ProviderInstances.pipe(
    Effect.provide(
      providerInstancesLayer.pipe(
        Layer.provide(
          Layer.mock(ProviderRegistry)({
            getProviders: Effect.succeed([
              provider("claudeAgent", "claudeAgent"),
              provider("claudeAgent_work", "claudeAgent"),
            ]),
          }),
        ),
      ),
    ),
  );

  it.effect.each([
    { instanceId: "claudeAgent", expected: "claudeAgent" },
    { instanceId: "claudeAgent_work", expected: "claudeAgent" },
    { instanceId: "codex", expected: undefined },
  ] as const)("reads the driver of $instanceId from the registry", ({ instanceId, expected }) =>
    Effect.gen(function* () {
      const { driverKindOf } = yield* instances;
      const driver = yield* driverKindOf(instanceId);
      expect(driver).toBe(expected);
    }),
  );
});

describe("reconcileInstanceAuth", () => {
  const work = ProviderInstanceId.make("claudeAgent-work");
  const run = (status: ServerProviderAuthStatus, verified: ServerProviderAuthStatus) =>
    Effect.gen(function* () {
      const refreshed: Array<string> = [];
      const { reconcileInstanceAuth } = yield* ProviderInstances.pipe(
        Effect.provide(
          providerInstancesLayer.pipe(
            Layer.provide(
              Layer.mock(ProviderRegistry)({
                getProviders: Effect.succeed([
                  { instanceId: work, auth: { status } } as ServerProvider,
                ]),
                refreshInstance: (instanceId) =>
                  Effect.sync(() => {
                    refreshed.push(instanceId);
                    return [];
                  }),
              }),
            ),
          ),
        ),
      );
      yield* reconcileInstanceAuth(work, verified);
      return refreshed;
    });

  it.effect("re-probes a login's own instance when its snapshot contradicts the check", () =>
    Effect.gen(function* () {
      expect(yield* run("unauthenticated", "authenticated")).toEqual([work]);
      expect(yield* run("authenticated", "authenticated")).toEqual([]);
    }),
  );
});
