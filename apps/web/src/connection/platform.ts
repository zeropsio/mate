import {
  ClientPresentation,
  EnvironmentOwnedDataCleanup,
  PlatformConnectionSource,
  PrimaryEnvironmentAuth,
  RelayDeviceIdentity,
  SshEnvironmentGateway,
} from "@t3tools/client-runtime/platform";
import {
  ConnectionBlockedError,
  Connectivity,
  CredentialRenewal,
  mapRemoteEnvironmentError,
  type PlatformConnectionRegistration,
  PrimaryConnectionRegistration,
  PrimaryConnectionTarget,
  renewZeropsIdentityCredential,
  Wakeups,
} from "@t3tools/client-runtime/connection";
import { fetchRemoteEnvironmentDescriptor } from "@t3tools/client-runtime/environment";
import { EnvironmentRpcRequestObserver } from "@t3tools/client-runtime/rpc";
import { AuthStandardClientScopes, PRIMARY_LOCAL_ENVIRONMENT_ID } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/unstable/http";

import { APP_VERSION } from "../branding";
import { resolveInitialServerAuthGateState } from "../environments/primary";
import type { AuthGateState } from "../environments/primary/auth";
import { primaryEnvironmentHttpLayer } from "../environments/primary/httpLayer";
import {
  readPrimaryEnvironmentTarget,
  type PrimaryEnvironmentTarget,
} from "../environments/primary/target";
import { clearComposerDraftsEnvironment } from "../composerDraftStore";
import { isHostedStaticApp } from "../hostedPairing";
import { acknowledgeRpcRequest, trackRpcRequestSent } from "../rpc/requestLatencyState";
import { loadZeropsSession } from "@t3tools/client-runtime/zerops/session";
import { browserZeropsStorage } from "../zerops/storage";
import { connectionStorageLayer } from "./storage";
import { clientPresentationMetadata } from "./clientMetadata";

let nextObservedRpcRequestId = 0;

function currentNetworkStatus(): "unknown" | "offline" | "online" {
  if (typeof navigator === "undefined") {
    return "unknown";
  }
  return navigator.onLine ? "online" : "offline";
}

const connectivityLayer = Connectivity.layer({
  status: Effect.sync(currentNetworkStatus),
  changes: Stream.callback((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const online = () => Queue.offerUnsafe(queue, "online");
        const offline = () => Queue.offerUnsafe(queue, "offline");
        window.addEventListener("online", online);
        window.addEventListener("offline", offline);
        return { online, offline };
      }),
      ({ online, offline }) =>
        Effect.sync(() => {
          window.removeEventListener("online", online);
          window.removeEventListener("offline", offline);
        }),
    ).pipe(Effect.asVoid),
  ),
});

/**
 * The wakeup a browser lifecycle event stands for, or `null` when it means
 * nothing to the connection layer.
 *
 * `visibilitychange` alone is too weak for this client. It does not fire when
 * the user switches back from another APPLICATION — the document stays
 * "visible" throughout — so returning to mate that way produced no signal at
 * all, and it cannot distinguish an ordinary tab switch from a back/forward
 * cache restore, where the browser has already killed the socket.
 */
export function connectionWakeupForDocumentEvent(event: {
  readonly type: string;
  readonly persisted?: boolean;
  readonly visibilityState?: DocumentVisibilityState;
}): Wakeups.ConnectionWakeup | null {
  switch (event.type) {
    case "pageshow":
      // Only a bfcache restore; a cold load connects on its own. The socket is
      // already gone, so replace the lease instead of probing it.
      return event.persisted === true ? "application-active-reconnect" : null;
    case "focus":
      return "application-active";
    case "visibilitychange":
      return event.visibilityState === "visible" ? "application-active" : null;
    default:
      return null;
  }
}

const WAKEUP_EVENT_TYPES = ["visibilitychange", "focus", "pageshow"] as const;

const wakeupsLayer = Wakeups.layer({
  changes: Stream.callback<Wakeups.ConnectionWakeup>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const listener = (event: Event) => {
          const wakeup = connectionWakeupForDocumentEvent({
            type: event.type,
            ...("persisted" in event ? { persisted: Boolean(event.persisted) } : {}),
            visibilityState: document.visibilityState,
          });
          if (wakeup !== null) {
            Queue.offerUnsafe(queue, wakeup);
          }
        };
        for (const type of WAKEUP_EVENT_TYPES) {
          window.addEventListener(type, listener);
        }
        return listener;
      }),
      (listener) =>
        Effect.sync(() => {
          for (const type of WAKEUP_EVENT_TYPES) {
            window.removeEventListener(type, listener);
          }
        }),
    ).pipe(Effect.asVoid),
  ),
});

function clientMetadata() {
  return clientPresentationMetadata({
    appVersion: APP_VERSION,
    hosted: isHostedStaticApp(),
    identity: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    },
    desktopBridge: window.desktopBridge,
  });
}

const SSH_UNSUPPORTED_DETAIL =
  "SSH environments are not available in this client — connect to a Zerops environment instead.";

const capabilitiesLayer = Layer.effectContext(
  Effect.sync(() => {
    const presentation = ClientPresentation.of({
      metadata: clientMetadata(),
      scopes: AuthStandardClientScopes,
    });
    const identity = RelayDeviceIdentity.of({
      deviceId: Effect.succeed(Option.none()),
    });
    // No client-side source ever mints a bearer credential for the primary
    // environment (the desktop app's local backend, the sole former source,
    // is gone); its auth, if any, is handled by the connection/pairing flow.
    const primaryAuth = PrimaryEnvironmentAuth.of({
      bearerToken: Effect.succeed(Option.none()),
    });
    const ssh = SshEnvironmentGateway.of({
      provision: () =>
        Effect.fail(
          new ConnectionBlockedError({ reason: "unsupported", detail: SSH_UNSUPPORTED_DETAIL }),
        ),
      prepare: () =>
        Effect.fail(
          new ConnectionBlockedError({ reason: "unsupported", detail: SSH_UNSUPPORTED_DETAIL }),
        ),
      disconnect: () => Effect.void,
    });

    return Context.make(PrimaryEnvironmentAuth, primaryAuth).pipe(
      Context.add(RelayDeviceIdentity, identity),
      Context.add(ClientPresentation, presentation),
      Context.add(SshEnvironmentGateway, ssh),
    );
  }),
);

const loadPrimaryConnectionRegistration = Effect.fn(
  "web.connectionPlatform.loadPrimaryConnectionRegistration",
)(function* (resolved: PrimaryEnvironmentTarget) {
  const descriptor = yield* fetchRemoteEnvironmentDescriptor({
    httpBaseUrl: resolved.target.httpBaseUrl,
  }).pipe(Effect.provide(primaryEnvironmentHttpLayer), Effect.mapError(mapRemoteEnvironmentError));
  return new PrimaryConnectionRegistration({
    target: new PrimaryConnectionTarget({
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      httpBaseUrl: resolved.target.httpBaseUrl,
      wsBaseUrl: resolved.target.wsBaseUrl,
    }),
  });
});

// Poll cadence for the primary environment topology.
const PLATFORM_POLL_INTERVAL = "3 seconds";

interface CachedPlatformRegistration {
  readonly signature: string;
  readonly registration: PlatformConnectionRegistration;
  readonly refreshAtEpochMs?: number;
}

export type PrimaryEnvironmentTargetRead =
  | {
      readonly _tag: "Success";
      readonly target: PrimaryEnvironmentTarget | null;
    }
  | {
      readonly _tag: "Failure";
      readonly cause: unknown;
    };

export function readPrimaryEnvironmentTargetResult(
  readTarget: () => PrimaryEnvironmentTarget | null = readPrimaryEnvironmentTarget,
): PrimaryEnvironmentTargetRead {
  try {
    return { _tag: "Success", target: readTarget() };
  } catch (cause) {
    return { _tag: "Failure", cause };
  }
}

export function primaryRegistrationToRetainAfterTopologyRead(
  previous: ReadonlyMap<string, CachedPlatformRegistration>,
  topologyRead: PrimaryEnvironmentTargetRead,
): CachedPlatformRegistration | undefined {
  return topologyRead._tag === "Failure" ? previous.get(PRIMARY_LOCAL_ENVIRONMENT_ID) : undefined;
}

export function canReuseCachedPlatformRegistration(
  cached: CachedPlatformRegistration,
  signature: string,
  nowEpochMs: number,
): boolean {
  return (
    cached.signature === signature &&
    (cached.refreshAtEpochMs === undefined || nowEpochMs < cached.refreshAtEpochMs)
  );
}

/** A Zerops door authenticates its own origin with the bearer registration it mints. */
export function primaryPlatformRegistrationStream(
  gate: AuthGateState | null,
  registrations: Stream.Stream<ReadonlyArray<PlatformConnectionRegistration>>,
): Stream.Stream<ReadonlyArray<PlatformConnectionRegistration>> {
  return gate !== null &&
    gate.status === "requires-auth" &&
    gate.auth.bootstrapMethods.includes("zerops-identity")
    ? registrations.pipe(
        Stream.map((current) =>
          current.filter((registration) => registration._tag !== "PrimaryConnectionRegistration"),
        ),
      )
    : registrations;
}

class PrimaryPlatformAuthGateReadError extends Data.TaggedError(
  "PrimaryPlatformAuthGateReadError",
)<{
  readonly cause: unknown;
}> {}

export function readPrimaryPlatformAuthGate(
  readGate: () => Promise<AuthGateState> = resolveInitialServerAuthGateState,
): Effect.Effect<AuthGateState | null> {
  return Effect.tryPromise({
    try: readGate,
    catch: (cause) => new PrimaryPlatformAuthGateReadError({ cause }),
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Could not read the primary environment auth gate.", {
        cause: error.cause,
      }).pipe(Effect.as(null)),
    ),
  );
}

const platformConnectionSourceLayer = Layer.effect(
  PlatformConnectionSource,
  Effect.gen(function* () {
    if (isHostedStaticApp()) {
      return PlatformConnectionSource.of({
        registrations: Stream.empty,
      });
    }
    const authGate = yield* readPrimaryPlatformAuthGate();
    const cacheRef = yield* Ref.make(new Map<string, CachedPlatformRegistration>());

    // Resolve the primary (same-origin cookie auth) environment. The cached
    // registration is reused across polls; a failed load is retried on the
    // next poll.
    const buildPlatformRegistrations = Effect.gen(function* () {
      const previous = yield* Ref.get(cacheRef);
      const nowEpochMs = yield* Clock.currentTimeMillis;
      const next = new Map<string, CachedPlatformRegistration>();
      const registrations: Array<PlatformConnectionRegistration> = [];

      const primaryTopologyRead = readPrimaryEnvironmentTargetResult();
      const retainedPrimary = primaryRegistrationToRetainAfterTopologyRead(
        previous,
        primaryTopologyRead,
      );
      if (retainedPrimary !== undefined) {
        next.set(PRIMARY_LOCAL_ENVIRONMENT_ID, retainedPrimary);
        registrations.push(retainedPrimary.registration);
      }

      if (primaryTopologyRead._tag === "Failure") {
        yield* Effect.logWarning("Could not read the primary environment topology.", {
          cause: primaryTopologyRead.cause,
        });
      } else if (primaryTopologyRead.target !== null) {
        const primaryTarget = primaryTopologyRead.target;
        const signature = `primary|${primaryTarget.target.httpBaseUrl}|${primaryTarget.target.wsBaseUrl}`;
        const cached = previous.get(PRIMARY_LOCAL_ENVIRONMENT_ID);
        if (
          cached !== undefined &&
          canReuseCachedPlatformRegistration(cached, signature, nowEpochMs)
        ) {
          next.set(PRIMARY_LOCAL_ENVIRONMENT_ID, cached);
          registrations.push(cached.registration);
        } else {
          const built = yield* loadPrimaryConnectionRegistration(primaryTarget).pipe(
            Effect.tapError((error) =>
              Effect.logWarning("Could not discover the primary environment.", { error }),
            ),
            Effect.option,
          );
          if (Option.isSome(built)) {
            const cacheEntry = { signature, registration: built.value };
            next.set(PRIMARY_LOCAL_ENVIRONMENT_ID, cacheEntry);
            registrations.push(built.value);
          }
        }
      }

      yield* Ref.set(cacheRef, next);
      return registrations as ReadonlyArray<PlatformConnectionRegistration>;
    }).pipe(Effect.provide(FetchHttpClient.layer));

    return PlatformConnectionSource.of({
      registrations: primaryPlatformRegistrationStream(
        authGate,
        Stream.tick(PLATFORM_POLL_INTERVAL).pipe(
          Stream.mapEffect(() => buildPlatformRegistrations),
        ),
      ),
    });
  }),
);

const environmentOwnedDataCleanupLayer = Layer.succeed(
  EnvironmentOwnedDataCleanup,
  EnvironmentOwnedDataCleanup.of({
    clear: (environmentId) =>
      Effect.sync(() => {
        clearComposerDraftsEnvironment(environmentId);
      }),
  }),
);

const rpcRequestObserverLayer = Layer.succeed(
  EnvironmentRpcRequestObserver,
  EnvironmentRpcRequestObserver.of({
    observe: ({ environmentId, method }) =>
      Effect.sync(() => {
        nextObservedRpcRequestId += 1;
        const requestId = `${environmentId}:${nextObservedRpcRequestId}`;
        trackRpcRequestSent(requestId, method, `${method} · ${environmentId}`);
        return Effect.sync(() => {
          acknowledgeRpcRequest(requestId);
        });
      }),
  }),
);

/**
 * Keeps a Zerops-door bearer ahead of its 15-minute membership window.
 *
 * The Zerops account token is read from storage on each attempt rather than
 * captured from React: the session provider holds a `useMemo`-stable client, so
 * a closure over it would keep whatever token existed when the layer was built.
 *
 * A credential minted at any other door is left alone (`Option.none`), and so is
 * one whose profile carries no origin to re-mint against.
 */
const credentialRenewerLayer = CredentialRenewal.layer({
  renew: ({ httpBaseUrl, credential }) =>
    Effect.gen(function* () {
      if (credential.origin !== "zerops-identity" || httpBaseUrl === undefined) {
        return Option.none();
      }
      const session = yield* Effect.promise(() => loadZeropsSession(browserZeropsStorage));
      const zeropsToken = session?.accessToken;
      if (!zeropsToken) {
        // Signed out of Zerops: nothing here can re-mint, and the door would
        // only answer 401. The reactive path surfaces it when it matters.
        return Option.none();
      }
      return Option.some(
        yield* renewZeropsIdentityCredential({ httpBaseUrl, zeropsToken }).pipe(
          Effect.provide(FetchHttpClient.layer),
          Effect.provideService(
            ClientPresentation,
            ClientPresentation.of({
              metadata: clientMetadata(),
              scopes: AuthStandardClientScopes,
            }),
          ),
        ),
      );
    }),
});

type ConnectionPlatformLayerSource =
  | typeof connectionStorageLayer
  | typeof connectivityLayer
  | typeof wakeupsLayer
  | typeof capabilitiesLayer
  | typeof credentialRenewerLayer
  | typeof platformConnectionSourceLayer
  | typeof environmentOwnedDataCleanupLayer
  | typeof rpcRequestObserverLayer;

export const connectionPlatformLayer: Layer.Layer<
  Layer.Success<ConnectionPlatformLayerSource>,
  Layer.Error<ConnectionPlatformLayerSource>,
  Layer.Services<ConnectionPlatformLayerSource>
> = Layer.mergeAll(
  connectionStorageLayer,
  connectivityLayer,
  wakeupsLayer,
  capabilitiesLayer,
  credentialRenewerLayer,
  platformConnectionSourceLayer,
  environmentOwnedDataCleanupLayer,
  rpcRequestObserverLayer,
);
