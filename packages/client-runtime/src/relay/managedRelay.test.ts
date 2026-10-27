import { RelayMobileRegistrationScope } from "@t3tools/contracts/relay";
import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";
import * as TestClock from "effect/testing/TestClock";

import * as ManagedRelay from "./managedRelay.ts";
import { remoteHttpClientLayer } from "../rpc/http.ts";

function managedRelayTestLayer(
  fetchFn: typeof globalThis.fetch,
  relayUrl = "https://relay.example.test",
  accessTokenStore?: ManagedRelay.ManagedRelayAccessTokenStore,
) {
  const httpClientLayer = remoteHttpClientLayer(fetchFn);
  const signerLayer = Layer.succeed(
    ManagedRelay.ManagedRelayDpopSigner,
    ManagedRelay.ManagedRelayDpopSigner.of({
      thumbprint: Effect.succeed("client-thumbprint"),
      createProof: (input: ManagedRelay.ManagedRelayDpopProofInput) =>
        Effect.succeed(`proof:${input.url}`),
    }),
  );
  return ManagedRelay.layer({
    relayUrl,
    clientId: "t3-mobile",
    ...(accessTokenStore ? { accessTokenStore } : {}),
  }).pipe(Layer.provide(signerLayer), Layer.provide(httpClientLayer));
}

function zeropsToken(subject: string, nonce: string): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${encode({ alg: "none" })}.${encode({ sub: subject, nonce })}.signature`;
}

const registerDevicePayload = {
  deviceId: "device-1",
  label: "Julius's iPhone",
  platform: "ios",
  iosMajorVersion: 18,
  preferences: {
    liveActivitiesEnabled: true,
    notificationsEnabled: true,
    notifyOnApproval: true,
    notifyOnInput: true,
    notifyOnCompletion: true,
    notifyOnFailure: true,
  },
} as const;

describe("ManagedRelayClient", () => {
  it.effect("owns tracing at service and implementation boundaries", () => {
    const spanNames: Array<string> = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spanNames.push(span.name);
        return span;
      },
    });
    const fetchFn = ((input) => {
      const url = String(input);
      if (url.endsWith("/v1/client/dpop-token")) {
        return Promise.resolve(
          Response.json({
            access_token: "relay-token",
            issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
            token_type: "DPoP",
            expires_in: 1_800,
            scope: RelayMobileRegistrationScope,
          }),
        );
      }
      return Promise.resolve(Response.json({ ok: true }));
    }) satisfies typeof globalThis.fetch;

    return Effect.gen(function* () {
      const relayClient = yield* ManagedRelay.ManagedRelayClient;
      yield* relayClient.registerDevice({
        zeropsToken: zeropsToken("user-1", "session-1"),
        payload: registerDevicePayload,
      });

      expect(spanNames).toEqual(
        expect.arrayContaining([
          "clientRuntime.managedRelay.registerDevice",
          "clientRuntime.managedRelay.authorize",
          "clientRuntime.managedRelay.obtainAccessToken",
          "clientRuntime.managedRelay.tokenCacheCriticalSection",
          "clientRuntime.managedRelay.exchangeAccessToken",
        ]),
      );
      expect(spanNames).not.toEqual(
        expect.arrayContaining([
          "clientRuntime.managedRelay.createTokenExchangeProof",
          "clientRuntime.managedRelay.exchangeAccessTokenRequest",
          "clientRuntime.managedRelay.createRequestProof",
        ]),
      );
    }).pipe(Effect.withTracer(tracer), Effect.provide(managedRelayTestLayer(fetchFn)));
  });

  it.effect("rejects unsafe relay URLs before sending credentials", () => {
    let requestCount = 0;
    const fetchFn = (() => {
      requestCount += 1;
      return Promise.resolve(Response.json({}));
    }) satisfies typeof globalThis.fetch;

    return Effect.gen(function* () {
      const relayClient = yield* ManagedRelay.ManagedRelayClient;
      const error = yield* relayClient
        .registerDevice({ zeropsToken: "zerops-token", payload: registerDevicePayload })
        .pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "ManagedRelayUrlInvalidError",
        relayUrl: "http://relay.example.test",
        message: "Relay URL must be a secure absolute HTTPS origin.",
      });
      expect(requestCount).toBe(0);
    }).pipe(Effect.provide(managedRelayTestLayer(fetchFn, "http://relay.example.test")));
  });

  it.effect("reuses usable DPoP tokens and refreshes cleared or expiring cache entries", () => {
    let tokenExchangeCount = 0;
    const fetchFn = ((input) => {
      const url = String(input);
      if (url.endsWith("/v1/client/dpop-token")) {
        tokenExchangeCount += 1;
        return Promise.resolve(
          Response.json({
            access_token: `relay-token-${tokenExchangeCount}`,
            issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
            token_type: "DPoP",
            expires_in: 10,
            scope: RelayMobileRegistrationScope,
          }),
        );
      }
      return Promise.resolve(Response.json({ ok: true }));
    }) satisfies typeof globalThis.fetch;

    return Effect.gen(function* () {
      const relayClient = yield* ManagedRelay.ManagedRelayClient;
      const input = {
        zeropsToken: zeropsToken("user-1", "session-1"),
        payload: registerDevicePayload,
      } as const;

      yield* relayClient.registerDevice(input);
      yield* relayClient.registerDevice(input);
      expect(tokenExchangeCount).toBe(1);

      yield* TestClock.adjust(Duration.seconds(6));
      yield* relayClient.registerDevice(input);
      expect(tokenExchangeCount).toBe(2);

      yield* relayClient.resetTokenCache;
      yield* relayClient.registerDevice(input);
      expect(tokenExchangeCount).toBe(3);
    }).pipe(Effect.provide(managedRelayTestLayer(fetchFn)));
  });

  it.effect("reuses a persisted token across runtimes and Zerops session token rotation", () => {
    let tokenExchangeCount = 0;
    let persistedTokens: ReadonlyArray<ManagedRelay.ManagedRelayAccessTokenCacheEntry> = [];
    const accessTokenStore: ManagedRelay.ManagedRelayAccessTokenStore = {
      load: Effect.sync(() => persistedTokens),
      save: (entries) =>
        Effect.sync(() => {
          persistedTokens = entries;
        }),
      clear: Effect.sync(() => {
        persistedTokens = [];
      }),
    };
    const fetchFn = ((input) => {
      const url = String(input);
      if (url.endsWith("/v1/client/dpop-token")) {
        tokenExchangeCount += 1;
        return Promise.resolve(
          Response.json({
            access_token: "persisted-relay-token",
            issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
            token_type: "DPoP",
            expires_in: 1_800,
            scope: RelayMobileRegistrationScope,
          }),
        );
      }
      return Promise.resolve(Response.json({ ok: true }));
    }) satisfies typeof globalThis.fetch;
    const registerInput = (token: string) =>
      ({
        zeropsToken: token,
        payload: registerDevicePayload,
      }) as const;

    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const relayClient = yield* ManagedRelay.ManagedRelayClient;
        yield* relayClient.registerDevice(registerInput(zeropsToken("user-1", "session-1")));
      }).pipe(Effect.provide(managedRelayTestLayer(fetchFn, undefined, accessTokenStore)));

      expect(tokenExchangeCount).toBe(1);
      expect(persistedTokens).toHaveLength(1);

      yield* Effect.gen(function* () {
        const relayClient = yield* ManagedRelay.ManagedRelayClient;
        yield* relayClient.registerDevice(registerInput(zeropsToken("user-1", "session-2")));
      }).pipe(Effect.provide(managedRelayTestLayer(fetchFn, undefined, accessTokenStore)));

      expect(tokenExchangeCount).toBe(1);
    });
  });

  it.effect("refreshes a persisted DPoP token once when the relay rejects it", () => {
    let tokenExchangeCount = 0;
    const registerTokens: Array<string | null> = [];
    let persistedTokens: ReadonlyArray<ManagedRelay.ManagedRelayAccessTokenCacheEntry> = [
      {
        accountId: "user-1",
        clientId: "t3-mobile",
        relayUrl: "https://relay.example.test",
        thumbprint: "client-thumbprint",
        scopes: [RelayMobileRegistrationScope],
        accessToken: "stale-relay-token",
        expiresAtMillis: Number.MAX_SAFE_INTEGER,
      },
    ];
    const accessTokenStore: ManagedRelay.ManagedRelayAccessTokenStore = {
      load: Effect.sync(() => persistedTokens),
      save: (entries) =>
        Effect.sync(() => {
          persistedTokens = entries;
        }),
      clear: Effect.sync(() => {
        persistedTokens = [];
      }),
    };
    const fetchFn = ((input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/client/dpop-token")) {
        tokenExchangeCount += 1;
        return Promise.resolve(
          Response.json({
            access_token: "fresh-relay-token",
            issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
            token_type: "DPoP",
            expires_in: 1_800,
            scope: RelayMobileRegistrationScope,
          }),
        );
      }

      const authorization = new Headers(init?.headers).get("authorization");
      registerTokens.push(authorization);
      if (authorization === "DPoP stale-relay-token") {
        return Promise.resolve(
          Response.json(
            {
              _tag: "RelayAuthInvalidError",
              code: "auth_invalid",
              reason: "invalid_bearer",
              traceId: "trace-stale-token",
            },
            { status: 401 },
          ),
        );
      }
      return Promise.resolve(Response.json({ ok: true }));
    }) satisfies typeof globalThis.fetch;

    return Effect.gen(function* () {
      const relayClient = yield* ManagedRelay.ManagedRelayClient;
      const result = yield* relayClient.registerDevice({
        zeropsToken: zeropsToken("user-1", "session-1"),
        payload: registerDevicePayload,
      });

      expect(result.ok).toBe(true);
      expect(registerTokens).toEqual(["DPoP stale-relay-token", "DPoP fresh-relay-token"]);
      expect(tokenExchangeCount).toBe(1);
      expect(persistedTokens).toMatchObject([
        {
          accessToken: "fresh-relay-token",
        },
      ]);
    }).pipe(Effect.provide(managedRelayTestLayer(fetchFn, undefined, accessTokenStore)));
  });

  it.effect("does not persist tokens when the Zerops token subject cannot be decoded", () => {
    let persistedTokens: ReadonlyArray<ManagedRelay.ManagedRelayAccessTokenCacheEntry> = [];
    const accessTokenStore: ManagedRelay.ManagedRelayAccessTokenStore = {
      load: Effect.succeed([]),
      save: (entries) =>
        Effect.sync(() => {
          persistedTokens = entries;
        }),
      clear: Effect.void,
    };
    const fetchFn = ((input) => {
      const url = String(input);
      if (url.endsWith("/v1/client/dpop-token")) {
        return Promise.resolve(
          Response.json({
            access_token: "relay-token",
            issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
            token_type: "DPoP",
            expires_in: 1_800,
            scope: RelayMobileRegistrationScope,
          }),
        );
      }
      return Promise.resolve(Response.json({ ok: true }));
    }) satisfies typeof globalThis.fetch;

    return Effect.gen(function* () {
      const relayClient = yield* ManagedRelay.ManagedRelayClient;
      yield* relayClient.registerDevice({
        zeropsToken: "not-a-jwt",
        payload: registerDevicePayload,
      });

      expect(persistedTokens).toEqual([]);
    }).pipe(Effect.provide(managedRelayTestLayer(fetchFn, undefined, accessTokenStore)));
  });

  it.effect("times out a stalled environment link challenge request", () => {
    const fetchFn = (() =>
      new Promise<Response>(() => undefined)) satisfies typeof globalThis.fetch;

    return Effect.gen(function* () {
      const relayClient = yield* ManagedRelay.ManagedRelayClient;
      const errorFiber = yield* relayClient
        .createEnvironmentLinkChallenge({
          zeropsToken: "zerops-token",
          payload: { notificationsEnabled: true, liveActivitiesEnabled: true },
        })
        .pipe(Effect.flip, Effect.forkScoped);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(ManagedRelay.MANAGED_RELAY_REQUEST_TIMEOUT_MS));
      const error = yield* Fiber.join(errorFiber);

      expect(error).toMatchObject({
        _tag: "ManagedRelayRequestTimeoutError",
        activity: "Relay environment link challenge",
        timeoutMs: ManagedRelay.MANAGED_RELAY_REQUEST_TIMEOUT_MS,
        message: "Relay environment link challenge timed out.",
      });
    }).pipe(Effect.provide(Layer.merge(TestClock.layer(), managedRelayTestLayer(fetchFn))));
  });

  it.effect("preserves typed relay trace IDs on client errors", () => {
    const fetchFn = (() =>
      Promise.resolve(
        Response.json(
          {
            _tag: "RelayAuthInvalidError",
            code: "auth_invalid",
            reason: "invalid_bearer",
            traceId: "trace-managed-relay",
          },
          { status: 401 },
        ),
      )) satisfies typeof globalThis.fetch;

    return Effect.gen(function* () {
      const relayClient = yield* ManagedRelay.ManagedRelayClient;
      const error = yield* relayClient
        .registerDevice({ zeropsToken: "zerops-token", payload: registerDevicePayload })
        .pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "ManagedRelayRequestFailedError",
        traceId: "trace-managed-relay",
      });
    }).pipe(Effect.provide(managedRelayTestLayer(fetchFn)));
  });

  it.effect("creates an environment link challenge through the bearer client endpoint", () => {
    const fetchFn = ((input, init) => {
      expect(String(input)).toBe(
        "https://relay.example.test/v1/client/environment-link-challenges",
      );
      expect(init?.headers).toMatchObject({
        authorization: "Bearer zerops-token",
      });
      return Promise.resolve(
        Response.json({
          challenge: "challenge-1",
          expiresAt: "2026-06-01T00:05:00.000Z",
        }),
      );
    }) satisfies typeof globalThis.fetch;

    return Effect.gen(function* () {
      const relayClient = yield* ManagedRelay.ManagedRelayClient;
      const challenge = yield* relayClient.createEnvironmentLinkChallenge({
        zeropsToken: "zerops-token",
        payload: { notificationsEnabled: true, liveActivitiesEnabled: true },
      });
      expect(challenge).toMatchObject({ challenge: "challenge-1" });
    }).pipe(Effect.provide(managedRelayTestLayer(fetchFn)));
  });

  it.effect("links an environment through the bearer client endpoint", () => {
    const fetchFn = ((input, init) => {
      expect(String(input)).toBe("https://relay.example.test/v1/client/environment-links");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer zerops-token",
      });
      return Promise.resolve(
        Response.json({
          ok: true,
          cloudUserId: "user-1",
          environmentId: "env-1",
          endpoint: {
            httpBaseUrl: "https://zcp-26a7-8080.prg1.zerops.app",
            wsBaseUrl: "wss://zcp-26a7-8080.prg1.zerops.app",
            providerKind: "manual",
          },
          relayIssuer: "https://relay.example.test",
          environmentCredential: "credential",
          cloudMintPublicKey: "public-key",
        }),
      );
    }) satisfies typeof globalThis.fetch;

    return Effect.gen(function* () {
      const relayClient = yield* ManagedRelay.ManagedRelayClient;
      const link = yield* relayClient.linkEnvironment({
        zeropsToken: "zerops-token",
        payload: {
          proof: "proof-jwt",
          notificationsEnabled: true,
          liveActivitiesEnabled: true,
        },
      });
      expect(link).toMatchObject({ ok: true, environmentId: "env-1" });
    }).pipe(Effect.provide(managedRelayTestLayer(fetchFn)));
  });
});
