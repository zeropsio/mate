import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  BearerConnectionTarget,
  Connection,
  Connectivity,
  CredentialStore,
  EnvironmentRegistry,
  type PlatformConnectionRegistration,
  ProfileStore,
  PrimaryConnectionRegistration,
  PrimaryConnectionTarget,
  Wakeups,
} from "@t3tools/client-runtime/connection";
import { TokenStore } from "@t3tools/client-runtime/authorization";
import {
  ClientPresentation,
  EnvironmentCacheStore,
  EnvironmentOwnedDataCleanup,
  ConnectionRegistrationStore,
  ConnectionTargetStore,
  PlatformConnectionSource,
  PrimaryEnvironmentAuth,
  SshEnvironmentGateway,
} from "@t3tools/client-runtime/platform";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import {
  AuthStandardClientScopes,
  EnvironmentId,
  PRIMARY_LOCAL_ENVIRONMENT_ID,
  type OrchestrationShellSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Socket from "effect/unstable/socket/Socket";
import { FetchHttpClient } from "effect/unstable/http";

import type { AuthGateState } from "../environments/primary/auth";
import {
  canReuseCachedPlatformRegistration,
  primaryPlatformRegistrationStream,
  primaryRegistrationToRetainAfterTopologyRead,
  readPrimaryPlatformAuthGate,
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
  const storedTargets = yield* Ref.make(new Map<EnvironmentId, BearerConnectionTarget>());
  const storedCredentials = yield* Ref.make(new Map<string, BearerConnectionCredential>());
  const storedProfiles = yield* Ref.make(new Map<string, BearerConnectionProfile>());
  const registrationStore = ConnectionRegistrationStore.of({
    register: (registration) =>
      Effect.gen(function* () {
        if (registration._tag !== "BearerConnectionRegistration") return;
        yield* Ref.update(storedTargets, (current) => {
          const next = new Map(current);
          next.set(registration.target.environmentId, registration.target);
          return next;
        });
        yield* Ref.update(storedCredentials, (current) => {
          const next = new Map(current);
          next.set(registration.target.connectionId, registration.credential);
          return next;
        });
        yield* Ref.update(storedProfiles, (current) => {
          const next = new Map(current);
          next.set(registration.target.connectionId, registration.profile);
          return next;
        });
      }),
    remove: (target) =>
      Effect.gen(function* () {
        yield* Ref.update(storedTargets, (current) => {
          const next = new Map(current);
          next.delete(target.environmentId);
          return next;
        });
        if (target._tag !== "BearerConnectionTarget") return;
        yield* Ref.update(storedCredentials, (current) => {
          const next = new Map(current);
          next.delete(target.connectionId);
          return next;
        });
        yield* Ref.update(storedProfiles, (current) => {
          const next = new Map(current);
          next.delete(target.connectionId);
          return next;
        });
      }),
  });
  const layer = Connection.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ConnectionTargetStore, {
          list: Effect.succeed([]),
        }),
        Layer.succeed(ConnectionRegistrationStore, registrationStore),
        Layer.succeed(EnvironmentCacheStore, {
          loadShell: () => Effect.succeed(Option.none<OrchestrationShellSnapshot>()),
          saveShell: () => Effect.void,
          loadThread: () => Effect.succeed(Option.none()),
          saveThread: () => Effect.void,
          removeThread: () => Effect.void,
          loadServerConfig: () => Effect.succeed(Option.none()),
          saveServerConfig: () => Effect.void,
          loadVcsRefs: () => Effect.succeed(Option.none()),
          saveVcsRefs: () => Effect.void,
          removeVcsRefs: () => Effect.void,
          clearVcsRefs: () => Effect.void,
          clear: () => Effect.void,
        }),
        Layer.succeed(EnvironmentOwnedDataCleanup, { clear: () => Effect.void }),
        Layer.succeed(ProfileStore.ConnectionProfileStore, {
          get: (connectionId) =>
            Ref.get(storedProfiles).pipe(
              Effect.map((profiles) => Option.fromUndefinedOr(profiles.get(connectionId))),
            ),
          put: (profile) =>
            profile._tag === "BearerConnectionProfile"
              ? Ref.update(storedProfiles, (current) =>
                  new Map(current).set(profile.connectionId, profile),
                )
              : Effect.void,
          remove: (connectionId) =>
            Ref.update(storedProfiles, (current) => {
              const next = new Map(current);
              next.delete(connectionId);
              return next;
            }),
        }),
        Layer.succeed(CredentialStore.ConnectionCredentialStore, {
          get: (connectionId) =>
            Ref.get(storedCredentials).pipe(
              Effect.map((credentials) => Option.fromUndefinedOr(credentials.get(connectionId))),
            ),
          put: (connectionId, credential) =>
            credential._tag === "BearerConnectionCredential"
              ? Ref.update(storedCredentials, (current) =>
                  new Map(current).set(connectionId, credential),
                )
              : Effect.void,
          remove: (connectionId) =>
            Ref.update(storedCredentials, (current) => {
              const next = new Map(current);
              next.delete(connectionId);
              return next;
            }),
        }),
        Layer.succeed(Connectivity.Connectivity, {
          status: Effect.succeed("online" as const),
          changes: Stream.never,
        }),
        Layer.succeed(Wakeups.ConnectionWakeups, { changes: Stream.never }),
        Layer.succeed(ClientPresentation, {
          metadata: { label: "Platform collision test", deviceType: "desktop" },
          scopes: AuthStandardClientScopes,
        }),
        Layer.succeed(PrimaryEnvironmentAuth, { bearerToken: Effect.succeed(Option.none()) }),
        Layer.succeed(TokenStore.RemoteDpopAccessTokenStore, {
          get: () => Effect.succeed(Option.none()),
          put: () => Effect.void,
          remove: () => Effect.void,
        }),
        Layer.succeed(ManagedRelay.ManagedRelayDpopSigner, {
          thumbprint: Effect.succeed("collision-test-thumbprint"),
          createProof: () => Effect.succeed("collision-test-proof"),
        }),
        Layer.succeed(SshEnvironmentGateway, {
          provision: () => Effect.die(new Error("Collision tests do not use SSH.")),
          prepare: () => Effect.die(new Error("Collision tests do not use SSH.")),
          disconnect: () => Effect.void,
        }),
        Layer.succeed(Socket.WebSocketConstructor, () => {
          throw new Error("Collision tests do not connect.");
        }),
        Layer.succeed(PlatformConnectionSource, { registrations: Stream.never }),
        FetchHttpClient.layer,
      ),
    ),
  );
  return { layer, storedCredentials };
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
          httpBaseUrl: "https://container.example/mate",
          wsBaseUrl: "wss://container.example/mate",
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
          httpBaseUrl: "https://container.example/mate",
          wsBaseUrl: "wss://container.example/mate",
        }),
        credential,
      });
      const harness = yield* makeRegistrationCollisionHarness;
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry;
        const offered = yield* primaryPlatformRegistrationStream(
          ZEROPS_DOOR_GATE,
          Stream.succeed([primary]),
        ).pipe(Stream.runCollect);

        expect(offered).toEqual([[]]);
        for (const registrations of offered) yield* registry.reconcilePlatform(registrations);
        yield* registry.register(bearer);
        expect((yield* Ref.get(harness.storedCredentials)).get(connectionId)).toEqual(credential);

        // Control: once the platform really owns the environment, the production
        // registry must keep the bearer registration from shadowing it.
        yield* registry.reconcilePlatform([primary]);
        yield* registry.register(bearer);
        expect((yield* SubscriptionRef.get(registry.entries)).get(environmentId)?.target).toEqual(
          primary.target,
        );
        expect((yield* Ref.get(harness.storedCredentials)).has(connectionId)).toBe(false);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("keeps non-primary platform registrations behind a Zerops door", () =>
    Effect.gen(function* () {
      const secondary = new BearerConnectionRegistration({
        target: new BearerConnectionTarget({
          environmentId: EnvironmentId.make("environment-secondary"),
          label: "Secondary local backend",
          connectionId: "secondary-local-backend",
        }),
        profile: new BearerConnectionProfile({
          environmentId: EnvironmentId.make("environment-secondary"),
          label: "Secondary local backend",
          connectionId: "secondary-local-backend",
          httpBaseUrl: "http://127.0.0.1:4777",
          wsBaseUrl: "ws://127.0.0.1:4777",
        }),
        credential: new BearerConnectionCredential({ token: "secondary-token" }),
      });
      const primary = new PrimaryConnectionRegistration({
        target: new PrimaryConnectionTarget({
          environmentId: EnvironmentId.make("environment-primary"),
          label: "Primary local backend",
          httpBaseUrl: "http://127.0.0.1:3777",
          wsBaseUrl: "ws://127.0.0.1:3777",
        }),
      });

      const offered = yield* primaryPlatformRegistrationStream(
        ZEROPS_DOOR_GATE,
        Stream.succeed([primary, secondary]),
      ).pipe(Stream.runCollect);

      expect(offered).toEqual([[secondary]]);
    }),
  );

  it.effect("falls back to the primary registration when the auth gate read rejects", () =>
    Effect.gen(function* () {
      const cause = new Error("auth gate unavailable");
      const gate = yield* readPrimaryPlatformAuthGate(() => Promise.reject(cause));
      const registrations = Stream.empty as Stream.Stream<
        ReadonlyArray<PlatformConnectionRegistration>
      >;

      expect(gate).toBeNull();
      expect(primaryPlatformRegistrationStream(gate, registrations)).toBe(registrations);
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
