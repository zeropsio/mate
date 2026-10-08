// @effect-diagnostics globalFetchInEffect:off - browser HTTP cache retains immutable byte representations and returns Blob bodies.
import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";
import { ManagedRelayDpopSigner } from "../../relay/managedRelay.ts";
import { request } from "../../rpc/client.ts";
import { buildEnvironmentAuthHeaders } from "../../state/environmentHttpAuth.ts";
import { resolveAssetUrl } from "../../state/assets.ts";
import {
  mateImageId,
  mateImageScope,
  mateImageReferenceId,
  type MateImageKey,
  type MateImageValue,
} from "../families/mateImage.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import { streamOf } from "../reducer.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";
import { superviseLink } from "../supervisor.ts";

export function classifyImageHttp(
  status: number,
  code?: string,
  retryAfterMs?: number,
): StreamFault {
  const messages: Readonly<Record<string, string>> = {
    "storage-full": "Storage full",
    "source-missing": "Image no longer available",
    "object-missing": "Image no longer available",
    "source-changed": "Screenshot source has changed",
    "preview-unavailable": "Preview unavailable",
    unsupported: "Preview unavailable",
    removed: "Image removed",
    expired: "Image expired",
    evicted: "Image evicted by the previous policy.",
  };
  return {
    ...(code === undefined ? {} : { code }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    outcome:
      status === 401
        ? "recoverable-session"
        : status === 403
          ? "authoritative-denial"
          : status === 503 && code === "access-unverified"
            ? "access-unverified"
            : status >= 500 && status !== 507
              ? "transient"
              : "definitive-refusal",
    message:
      status === 401
        ? "Sign in to read this image."
        : status === 403
          ? "You no longer have access to this Mate."
          : status === 503 && code === "access-unverified"
            ? "Access could not be verified."
            : (messages[code ?? ""] ??
              (status >= 500 ? "Mate is unreachable." : "Image unavailable")),
  };
}

export const makeMateImageWire = (
  registry: EnvironmentRegistry["Service"],
  signer: Option.Option<ManagedRelayDpopSigner["Service"]>,
) => ({
  read: (key: MateImageKey): Effect.Effect<MateImageValue, StreamFault> =>
    registry
      .run(
        key.environmentId,
        Effect.gen(function* () {
          const supervisor = yield* EnvironmentSupervisor;
          const prepared = yield* SubscriptionRef.get(supervisor.prepared);
          if (Option.isNone(prepared))
            return yield* Effect.fail<StreamFault>({
              outcome: "transient",
              message: "Mate is unreachable.",
            });
          const modern = prepared.value.contentAddressedImages === true;
          const metadata = yield* request(WS_METHODS.assetsCreateUrl, {
            resource:
              key.rendition === "original" &&
              key.resource._tag === "attachment" &&
              key.resource.originalOccurrenceId
                ? { ...key.resource, occurrenceId: key.resource.originalOccurrenceId }
                : key.resource,
            ...(modern
              ? {
                  imageMode: "reference" as const,
                  ...(key.rendition === "original" ? {} : { preview: key.rendition }),
                }
              : {}),
          }).pipe(
            Effect.catchCause((cause) => {
              const error = Option.getOrUndefined(Cause.findErrorOption(cause)) as
                | {
                    readonly _tag?: string;
                    readonly status?: number;
                    readonly code?: string;
                    readonly cause?: { readonly code?: string };
                  }
                | undefined;
              return Effect.fail(
                classifyImageHttp(
                  error?.status ??
                    (error?._tag?.includes("NotFound")
                      ? 404
                      : error?._tag?.includes("ScopeRequired")
                        ? 403
                        : error?._tag?.includes("AuthInvalid")
                          ? 401
                          : error?.cause?.code === "storage-full"
                            ? 507
                            : error?._tag?.includes("Validation")
                              ? 422
                              : 502),
                  error?.code ?? error?.cause?.code,
                ),
              );
            }),
          );
          if (metadata.occurrence?.original.status === "failed")
            return yield* Effect.fail(
              classifyImageHttp(
                metadata.occurrence.original.code === "storage-full" ? 507 : 404,
                metadata.occurrence.original.code,
              ),
            );
          if (metadata.renditionFailure)
            return {
              blob: null,
              failure: classifyImageHttp(
                metadata.renditionFailure === "storage-full" ? 507 : 422,
                metadata.renditionFailure,
              ).message,
              ...(metadata.occurrence === undefined ? {} : { occurrence: metadata.occurrence }),
            };
          const url = resolveAssetUrl(prepared.value.httpBaseUrl, metadata.relativeUrl);
          if (url === null) return yield* Effect.fail(classifyImageHttp(404));
          const headers = modern
            ? yield* buildEnvironmentAuthHeaders(
                prepared.value.httpAuthorization,
                "GET",
                url,
                signer,
              ).pipe(Effect.mapError(() => classifyImageHttp(401)))
            : {};
          const now = yield* Clock.currentTimeMillis;
          return yield* Effect.tryPromise({
            try: async (signal) => {
              const response = await fetch(url, {
                headers: { ...headers },
                credentials: "omit",
                signal,
              });
              if (!response.ok) {
                const body: unknown = await response.json().catch(() => null);
                const code =
                  typeof body === "object" &&
                  body !== null &&
                  "code" in body &&
                  typeof body.code === "string"
                    ? body.code
                    : undefined;
                const retryAfter = response.headers.get("retry-after");
                const floor =
                  retryAfter === null
                    ? undefined
                    : /^\d+$/.test(retryAfter)
                      ? Number(retryAfter) * 1000
                      : Math.max(0, Date.parse(retryAfter) - now);
                throw classifyImageHttp(
                  response.status,
                  code,
                  floor !== undefined && Number.isFinite(floor) ? floor : undefined,
                );
              }
              const blob = await response.blob();
              if (
                key.rendition !== "original" &&
                typeof createImageBitmap === "function" &&
                blob.type !== "image/svg+xml"
              ) {
                try {
                  (await createImageBitmap(blob)).close();
                } catch {
                  return {
                    blob: null,
                    failure: "Preview cannot be displayed.",
                    ...(metadata.occurrence === undefined
                      ? {}
                      : { occurrence: metadata.occurrence }),
                  };
                }
              }
              return {
                blob,
                ...(metadata.imageDimensions === undefined
                  ? {}
                  : { dimensions: metadata.imageDimensions }),
                ...(metadata.occurrence === undefined ? {} : { occurrence: metadata.occurrence }),
              };
            },
            catch: (error) =>
              typeof error === "object" && error !== null && "outcome" in error
                ? (error as StreamFault)
                : classifyImageHttp(502),
          });
        }),
      )
      .pipe(
        Effect.catchCause((cause) => {
          const fault = Cause.findErrorOption(cause);
          return Effect.fail(
            Option.isSome(fault) &&
              typeof fault.value === "object" &&
              fault.value !== null &&
              "outcome" in fault.value
              ? (fault.value as StreamFault)
              : classifyImageHttp(502),
          );
        }),
      ),
  watch: (environmentId: EnvironmentId, receive: (fault: StreamFault | null) => void) =>
    Effect.suspend(() => {
      return registry.stateChanges(environmentId).pipe(
        Stream.runForEach((state) =>
          Effect.sync(() => {
            if (
              state.phase === "blocked" &&
              state.lastFailure?._tag === "ConnectionBlockedError" &&
              ["authentication", "permission", "read-only"].includes(state.lastFailure.reason)
            ) {
              receive(
                classifyImageHttp(
                  state.lastFailure.reason === "authentication" ? 503 : 403,
                  state.lastFailure.reason === "authentication"
                    ? "access-unverified"
                    : "access-denied",
                ),
              );
            } else if (state.phase === "connected") {
              receive(null);
            }
          }),
        ),
        Effect.catch(() => Effect.sync(() => receive(classifyImageHttp(403)))),
      );
    }),
  repair: (environmentId: EnvironmentId) =>
    Effect.gen(function* () {
      const before = yield* registry.state(environmentId);
      yield* registry.retryNow(environmentId);
      const next = yield* registry.stateChanges(environmentId).pipe(
        Stream.filter(
          (state) =>
            state.phase === "blocked" ||
            (state.phase === "connected" &&
              (state.attempt > before.attempt || state.generation > before.generation)),
        ),
        Stream.runHead,
      );
      if (Option.isNone(next) || next.value.phase !== "connected")
        return yield* Effect.fail(classifyImageHttp(401));
    }).pipe(Effect.mapError(() => classifyImageHttp(401))),
});

export function makeMateImages(options: {
  /** Hosted images reuse immutable facts; native readers retain their current path. */
  readonly reuseRetained?: boolean;
  readonly store: AccountStore;
  readonly wire: {
    readonly read: (key: MateImageKey) => Effect.Effect<MateImageValue, StreamFault>;
    readonly repair: (id: EnvironmentId) => Effect.Effect<void, StreamFault>;
    readonly watch?: (
      id: EnvironmentId,
      receive: (fault: StreamFault | null) => void,
    ) => Effect.Effect<void>;
  };
}) {
  const seen = new Map<EnvironmentId, Set<string>>();
  const watches = new Map<EnvironmentId, Fiber.Fiber<void>>();
  const active = new Map<
    string,
    {
      holders: number;
      stop: () => void;
      retry: () => void;
      fault: (fault: StreamFault) => void;
      recover: () => void;
    }
  >();
  const withheld = new Map<EnvironmentId, StreamFault>();
  const withhold = (environmentId: EnvironmentId, fault: StreamFault, notify = true) => {
    withheld.set(environmentId, fault);
    for (const id of seen.get(environmentId) ?? []) {
      options.store.dispatch({
        kind: "access",
        family: "mateImage",
        id,
        access: fault.outcome === "authoritative-denial" ? "denied" : "unverified",
      });
      options.store.dispatch({
        kind: "stream",
        key: `mate:${id}:image`,
        now: Effect.runSync(Clock.currentTimeMillis),
        event: { kind: "fault", fault, jitter: 0 },
      });
      if (notify) active.get(id)?.fault(fault);
    }
  };
  const demand = (key: MateImageKey) => {
    const id = mateImageId(key);
    const ids = seen.get(key.environmentId) ?? new Set<string>();
    ids.add(id);
    seen.set(key.environmentId, ids);
    if (!watches.has(key.environmentId) && options.wire.watch)
      watches.set(
        key.environmentId,
        Effect.runFork(
          options.wire.watch(key.environmentId, (fault) => {
            if (fault !== null) withhold(key.environmentId, fault);
            else if (withheld.delete(key.environmentId)) {
              for (const id of seen.get(key.environmentId) ?? []) active.get(id)?.recover();
            }
          }),
        ),
      );
    let entry = active.get(id);
    if (!entry) {
      const scope = mateImageScope(key);
      const link = `mate:${id}` as const;
      const signal = (target: typeof link | typeof scope, event: StreamEvent) =>
        Effect.map(Clock.currentTimeMillis, (now) =>
          options.store.dispatch({ kind: "stream", key: target, now, event }),
        );
      const faults = Effect.runSync(Queue.unbounded<StreamFault>());
      const supervisor = Effect.runSync(
        superviseLink({
          key: link,
          scopes: [scope],
          store: options.store,
          repairSession: options.wire.repair(key.environmentId).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                withheld.delete(key.environmentId);
              }),
            ),
          ),
          attempt: () =>
            Effect.raceFirst(
              Effect.gen(function* () {
                const access = withheld.get(key.environmentId);
                if (access) return yield* Effect.fail(access);
                yield* signal(link, { kind: "handshake" });
                for (;;) {
                  yield* signal(scope, { kind: "attempt" });
                  yield* signal(scope, { kind: "handshake" });
                  const generation = streamOf(options.store.state(), scope).generation;
                  options.store.dispatch({ kind: "baseline-begin", scope, generation });
                  const retained = readsOfState(options.store.state()).fact("mateImage", id);
                  const value = yield* (
                    options.reuseRetained &&
                    id.startsWith("image/") &&
                    retained.kind === "known" &&
                    options.store.state().facts.get(`mateImage:${id}`)?.access === "allowed" &&
                    retained.value.blob !== null
                      ? Effect.succeed(retained.value)
                      : options.wire.read(key)
                  ).pipe(
                    Effect.tapError((fault) =>
                      Effect.sync(() => {
                        if (
                          fault.outcome === "authoritative-denial" ||
                          fault.outcome === "access-unverified"
                        )
                          withhold(key.environmentId, fault);
                        else if (fault.outcome === "recoverable-session")
                          withhold(
                            key.environmentId,
                            classifyImageHttp(503, "access-unverified"),
                            false,
                          );
                      }),
                    ),
                  );
                  options.store.dispatch({
                    kind: "access",
                    family: "mateImage",
                    id,
                    access: "allowed",
                  });
                  options.store.dispatch({
                    kind: "baseline-commit",
                    scope,
                    generation,
                    via: "mate-direct",
                    members: [id],
                    rows: [
                      {
                        family: "mateImage",
                        id,
                        value: { ...value, reference: mateImageReferenceId(key) },
                        revision: { kind: "mate-link", sequence: generation },
                      },
                    ],
                  });
                  yield* signal(scope, { kind: "baseline-committed" });
                  yield* signal(link, { kind: "baseline-committed" });
                  const next = streamOf(options.store.state(), scope).next;
                  if (next.kind !== "revalidate") return yield* Effect.never;
                  yield* Effect.sleep(Math.max(0, next.at - (yield* Clock.currentTimeMillis)));
                  yield* signal(scope, { kind: "revalidate" });
                }
              }),
              Queue.take(faults).pipe(Effect.flatMap(Effect.fail)),
            ),
        }),
      );
      const fiber = Effect.runFork(supervisor.run);
      entry = {
        holders: 0,
        stop: () => {
          Effect.runSync(supervisor.release);
          Effect.runFork(Fiber.interrupt(fiber));
        },
        retry: () => {
          withheld.delete(key.environmentId);
          Effect.runFork(supervisor.signal("manual-retry"));
        },
        fault: (fault) => {
          Effect.runSync(Queue.offer(faults, fault));
        },
        recover: () => {
          Effect.runFork(supervisor.signal("input-changed"));
        },
      };
      active.set(id, entry);
    }
    entry.holders++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const held = active.get(id);
      if (held && --held.holders === 0) {
        held.stop();
        active.delete(id);
      }
    };
  };
  return {
    demand,
    retry: (key: MateImageKey) => active.get(mateImageId(key))?.retry(),
    stop: () => {
      for (const entry of active.values()) entry.stop();
      active.clear();
      for (const fiber of watches.values()) Effect.runFork(Fiber.interrupt(fiber));
      watches.clear();
    },
  };
}
