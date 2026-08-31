import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  BearerConnectionTarget,
  type PlatformConnectionRegistration,
  PrimaryConnectionRegistration,
  PrimaryConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId, PRIMARY_LOCAL_ENVIRONMENT_ID } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type { AuthGateState } from "../environments/primary/auth";
import {
  canReuseCachedPlatformRegistration,
  primaryPlatformRegistrationStream,
  primaryRegistrationToRetainAfterTopologyRead,
  readPrimaryEnvironmentTargetResult,
} from "./platform.ts";

const ZEROPS_DOOR_GATE = {
  status: "requires-auth",
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: ["zerops-identity", "one-time-token"],
    sessionMethods: ["bearer-access-token", "dpop-access-token"],
    sessionCookieName: "t3_session",
  },
} as const;

const NON_ZEROPS_GATES = [
  { status: "hosted-pairing" },
  { status: "hosted-static" },
  { status: "authenticated" },
  {
    status: "requires-auth",
    auth: {
      policy: "remote-reachable",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["bearer-access-token", "dpop-access-token"],
      sessionCookieName: "t3_session",
    },
  },
] satisfies ReadonlyArray<AuthGateState>;

const makeRegistrationCollisionHarness = Effect.gen(function* () {
  const platformEnvironmentIds = yield* Ref.make<ReadonlySet<EnvironmentId>>(new Set());
  const storedCredentials = yield* Ref.make(new Map<string, BearerConnectionCredential>());
  return {
    reconcilePlatform: (registrations: ReadonlyArray<PlatformConnectionRegistration>) =>
      Ref.set(
        platformEnvironmentIds,
        new Set(registrations.map((registration) => registration.target.environmentId)),
      ),
    register: (registration: BearerConnectionRegistration) =>
      Effect.gen(function* () {
        if ((yield* Ref.get(platformEnvironmentIds)).has(registration.target.environmentId)) {
          return;
        }
        yield* Ref.update(storedCredentials, (current) => {
          const next = new Map(current);
          next.set(registration.target.connectionId, registration.credential);
          return next;
        });
      }),
    storedCredentials,
  };
});

describe("primary platform registration auth gate", () => {
  it.each(NON_ZEROPS_GATES)("keeps the $status source unchanged", (gate) => {
    const registrations = Stream.empty as Stream.Stream<
      ReadonlyArray<PlatformConnectionRegistration>
    >;

    expect(primaryPlatformRegistrationStream(gate, registrations)).toBe(registrations);
  });

  it.effect("leaves a Zerops door origin available for its bearer registration", () =>
    Effect.gen(function* () {
      const environmentId = EnvironmentId.make("environment-1");
      const primary = new PrimaryConnectionRegistration({
        target: new PrimaryConnectionTarget({
          environmentId,
          label: "Zerops container",
          httpBaseUrl: "https://container.example/z3",
          wsBaseUrl: "wss://container.example/z3",
        }),
      });
      const connectionId = "zerops-door-environment-1";
      const credential = new BearerConnectionCredential({ token: "minted-door-token" });
      const bearer = new BearerConnectionRegistration({
        target: new BearerConnectionTarget({
          environmentId,
          label: "Zerops container",
          connectionId,
        }),
        profile: new BearerConnectionProfile({
          environmentId,
          label: "Zerops container",
          connectionId,
          httpBaseUrl: "https://container.example/z3",
          wsBaseUrl: "wss://container.example/z3",
        }),
        credential,
      });
      const harness = yield* makeRegistrationCollisionHarness;
      const offered = yield* primaryPlatformRegistrationStream(
        ZEROPS_DOOR_GATE,
        Stream.succeed([primary]),
      ).pipe(Stream.runCollect);

      expect(offered).toEqual([]);
      for (const registrations of offered) yield* harness.reconcilePlatform(registrations);
      yield* harness.register(bearer);

      expect((yield* Ref.get(harness.storedCredentials)).get(connectionId)).toEqual(credential);
    }),
  );
});

describe("primary registration cache", () => {
  const registration = {} as never;

  it("reuses a cached registration only while its signature matches and it has not aged past refresh", () => {
    const cached = {
      signature: "primary|http://127.0.0.1:3773/|ws://127.0.0.1:3773/",
      registration,
      refreshAtEpochMs: 65_000,
    };

    expect(canReuseCachedPlatformRegistration(cached, cached.signature, 64_999)).toBe(true);
    expect(canReuseCachedPlatformRegistration(cached, cached.signature, 65_000)).toBe(false);
    expect(canReuseCachedPlatformRegistration(cached, "different-signature", 0)).toBe(false);
  });
});

describe("primary topology cache", () => {
  const registration = {} as never;
  const cached = {
    signature: "primary|http://127.0.0.1:3773/|ws://127.0.0.1:3773/",
    registration,
  };
  const previous = new Map([[PRIMARY_LOCAL_ENVIRONMENT_ID, cached]]);

  it("captures synchronous primary target read failures", () => {
    const cause = new Error("invalid primary target");

    expect(
      readPrimaryEnvironmentTargetResult(() => {
        throw cause;
      }),
    ).toEqual({ _tag: "Failure", cause });
  });

  it("retains the cached primary after a transient topology read failure", () => {
    expect(
      primaryRegistrationToRetainAfterTopologyRead(previous, {
        _tag: "Failure",
        cause: new Error("IPC unavailable"),
      }),
    ).toBe(cached);
  });

  it("treats a successful primary absence as authoritative removal", () => {
    expect(
      primaryRegistrationToRetainAfterTopologyRead(previous, {
        _tag: "Success",
        target: null,
      }),
    ).toBeUndefined();
  });
});
