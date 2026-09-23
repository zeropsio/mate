/**
 * The invalidation bus (DESIGN §6.2): a closed, typed set of revalidation requests that carries no
 * data and has no merge semantics. Only owners of pull-based facts subscribe. Other tabs of the same
 * login reach it over one `BroadcastChannel` (§6.7).
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import {
  ZeropsAccountId,
  ZeropsApiOrigin,
  ZeropsOrganizationId,
  ZeropsProjectId,
  ZeropsServiceId,
  organizationKeyOf,
  projectKeyOf,
  serviceKeyOf,
} from "../data/types.ts";

// ── The union ────────────────────────────────────────────────────────────────────────────────

const AccountRef = Schema.Struct({ apiOrigin: ZeropsApiOrigin, accountId: ZeropsAccountId });
const OrganizationRef = Schema.Struct({
  kind: Schema.Literal("organization"),
  account: AccountRef,
  organizationId: ZeropsOrganizationId,
});
const ProjectRef = Schema.Struct({
  kind: Schema.Literal("project"),
  organization: OrganizationRef,
  projectId: ZeropsProjectId,
});
const ServiceRef = Schema.Struct({
  kind: Schema.Literal("service"),
  project: ProjectRef,
  serviceId: ZeropsServiceId,
});

/** A Mate's stable identity, `projectId:serviceId` (§1.1, AL-05). */
export const TargetKey = Schema.TemplateLiteral([Schema.String, ":", Schema.String]);
export type TargetKey = typeof TargetKey.Type;

/** The origin a Gitea instance answers on; an address that keys its session and forge facts. */
export const GiteaOrigin = Schema.String.check(Schema.isNonEmpty());
export type GiteaOrigin = typeof GiteaOrigin.Type;

const Repository = { origin: GiteaOrigin, owner: Schema.String, repo: Schema.String };

export const Invalidation = Schema.Union([
  Schema.Struct({
    topic: Schema.Literal("access"),
    change: Schema.Literals(["granted", "lapsed", "renew-now"]),
  }),
  Schema.Struct({ topic: Schema.Literal("inventory"), organization: OrganizationRef }),
  Schema.Struct({ topic: Schema.Literal("project"), project: ProjectRef }),
  Schema.Struct({
    topic: Schema.Literal("environment"),
    target: TargetKey,
    why: Schema.Literals(["user-retry", "descriptor", "presence"]),
  }),
  Schema.Struct({ topic: Schema.Literal("container"), target: TargetKey }),
  Schema.Struct({ topic: Schema.Literal("deployment"), service: ServiceRef }),
  Schema.Struct({ topic: Schema.Literal("gitea-session"), origin: GiteaOrigin }),
  Schema.Struct({ topic: Schema.Literal("forge-org"), origin: GiteaOrigin, org: Schema.String }),
  Schema.Struct({ topic: Schema.Literal("forge-repo"), ...Repository }),
  Schema.Struct({ topic: Schema.Literal("forge-pr"), ...Repository, number: Schema.Int }),
]);
/** "Facts under this key may have changed at the source." */
export type Invalidation = typeof Invalidation.Type;

// ── The bus ──────────────────────────────────────────────────────────────────────────────────

/** Invalidations of one key within this window reach subscribers once, when it closes. */
export const INVALIDATION_COALESCE_MS = 250;

/**
 * A tab hidden this long collects its invalidations instead of delivering them (§6.4). Coming
 * back from it always raises a visible wake, which needs 30 s hidden, so nothing stays collected.
 */
export const INVALIDATION_HIDDEN_COLLECT_MS = 60_000;

/**
 * What the bus hears of the tab (§6.4), from the signals port: the document's visibility, and the
 * coalesced visible wake.
 */
export type InvalidationSignal =
  | { readonly type: "hidden" }
  | { readonly type: "visible" }
  | { readonly type: "visible-wake" };

export interface InvalidationBusOptions {
  readonly signals: Stream.Stream<InvalidationSignal>;
  /** Whether a mounted view shows facts under this invalidation's key. */
  readonly shown: (invalidation: Invalidation) => boolean;
}

export interface InvalidationBus {
  /** Requests revalidation of the facts under one key. */
  readonly invalidate: (invalidation: Invalidation) => Effect.Effect<void>;
  readonly subscribe: Effect.Effect<PubSub.Subscription<Invalidation>, never, Scope.Scope>;
}

/** The fact key an invalidation names: two equal requests share it. */
function keyOf(invalidation: Invalidation): string {
  switch (invalidation.topic) {
    case "access":
      return JSON.stringify([invalidation.topic, invalidation.change]);
    case "inventory":
      return JSON.stringify([invalidation.topic, organizationKeyOf(invalidation.organization)]);
    case "project":
      return JSON.stringify([invalidation.topic, projectKeyOf(invalidation.project)]);
    case "environment":
      return JSON.stringify([invalidation.topic, invalidation.target, invalidation.why]);
    case "container":
      return JSON.stringify([invalidation.topic, invalidation.target]);
    case "deployment":
      return JSON.stringify([invalidation.topic, serviceKeyOf(invalidation.service)]);
    case "gitea-session":
      return JSON.stringify([invalidation.topic, invalidation.origin]);
    case "forge-org":
      return JSON.stringify([invalidation.topic, invalidation.origin, invalidation.org]);
    case "forge-repo":
      return JSON.stringify([
        invalidation.topic,
        invalidation.origin,
        invalidation.owner,
        invalidation.repo,
      ]);
    case "forge-pr":
      return JSON.stringify([
        invalidation.topic,
        invalidation.origin,
        invalidation.owner,
        invalidation.repo,
        invalidation.number,
      ]);
  }
}

const monotonicMs = Effect.map(Clock.monotonicTimeNanos, (nanos) => Number(nanos) / 1_000_000);

/**
 * The bus lives in the caller's scope — the account runtime's — and ends with it.
 *
 * - Each key's first invalidation opens a 250 ms window; the key reaches subscribers once when it
 *   closes.
 * - A window that closes while the tab has been hidden for a minute puts its key in the dirty set.
 *   The next visible wake flushes the set: the keys a mounted view shows first, each group in the
 *   order it was collected.
 */
export const makeInvalidationBus = Effect.fnUntraced(function* (
  options: InvalidationBusOptions,
): Effect.fn.Return<InvalidationBus, never, Scope.Scope> {
  const scope = yield* Effect.scope;
  const pubsub = yield* Effect.acquireRelease(PubSub.unbounded<Invalidation>(), PubSub.shutdown);
  const open = new Map<string, Invalidation>();
  const dirty = new Map<string, Invalidation>();
  let hiddenSinceMs: number | null = null;

  const close = (key: string) =>
    Effect.flatMap(monotonicMs, (nowMs) => {
      const invalidation = open.get(key);
      open.delete(key);
      if (invalidation === undefined) return Effect.void;
      if (hiddenSinceMs !== null && nowMs - hiddenSinceMs >= INVALIDATION_HIDDEN_COLLECT_MS) {
        dirty.set(key, invalidation);
        return Effect.void;
      }
      return PubSub.publish(pubsub, invalidation);
    });

  const flush = Effect.suspend(() => {
    const collected = [...dirty.values()];
    dirty.clear();
    return PubSub.publishAll(pubsub, [
      ...collected.filter(options.shown),
      ...collected.filter((invalidation) => !options.shown(invalidation)),
    ]);
  });

  const hear = (signal: InvalidationSignal) =>
    Effect.flatMap(monotonicMs, (nowMs) => {
      switch (signal.type) {
        case "hidden":
          hiddenSinceMs ??= nowMs;
          return Effect.void;
        case "visible":
          hiddenSinceMs = null;
          return Effect.void;
        case "visible-wake":
          hiddenSinceMs = null;
          return flush;
      }
    });

  yield* options.signals.pipe(Stream.runForEach(hear), Effect.forkIn(scope));

  return {
    invalidate: (invalidation) =>
      Effect.suspend(() => {
        const key = keyOf(invalidation);
        if (open.has(key)) return Effect.void;
        open.set(key, invalidation);
        return Effect.sleep(INVALIDATION_COALESCE_MS).pipe(
          Effect.andThen(close(key)),
          Effect.forkIn(scope),
          Effect.asVoid,
        );
      }),
    subscribe: PubSub.subscribe(pubsub),
  };
});

// ── Across tabs ──────────────────────────────────────────────────────────────────────────────

/** One login of one person: the cross-tab epoch (§1.1 owner record). */
export interface AccountLogin {
  readonly userId: string;
  readonly loginGeneration: string;
}

export const CrossTabInvalidation = Schema.Struct({
  userId: Schema.String,
  loginGeneration: Schema.String,
  invalidation: Invalidation,
});
export type CrossTabInvalidation = typeof CrossTabInvalidation.Type;

const isCrossTabInvalidation = Schema.is(CrossTabInvalidation);

/** The `BroadcastChannel` members the transport uses. */
export interface InvalidationChannel {
  postMessage(message: CrossTabInvalidation): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  /** Stops delivery to this tab. */
  close(): void;
}

export interface CrossTabInvalidationsOptions {
  readonly bus: InvalidationBus;
  /** Opens the channel the account's tabs share; the transport closes it with its scope. */
  readonly openChannel: () => InvalidationChannel;
  /** The login this tab has open, or `null` while it has none: its messages go nowhere. */
  readonly owner: () => AccountLogin | null;
}

export interface CrossTabInvalidations {
  /** Invalidates here and in the other tabs of this tab's login, after an account-level write. */
  readonly broadcast: (invalidation: Invalidation) => Effect.Effect<void>;
}

/**
 * Carries invalidations between the tabs of one login. A message reaches this tab's bus only when
 * its `{userId, loginGeneration}` is the login this tab has open; anything else — another account,
 * an older login, a shape this build cannot read — is dropped.
 */
export const connectCrossTabInvalidations = Effect.fnUntraced(function* (
  options: CrossTabInvalidationsOptions,
): Effect.fn.Return<CrossTabInvalidations, never, Scope.Scope> {
  const scope = yield* Effect.scope;
  const inbox = yield* Queue.unbounded<unknown>();
  // The listener is on before the transport returns, so no message waits for a fiber to start.
  const channel = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const opened = options.openChannel();
      opened.addEventListener("message", (event) => {
        Queue.offerUnsafe(inbox, event.data);
      });
      return opened;
    }),
    (opened) => Effect.sync(() => opened.close()),
  );
  const receive = (data: unknown) =>
    Effect.suspend(() => {
      const owner = options.owner();
      return isCrossTabInvalidation(data) &&
        owner !== null &&
        data.userId === owner.userId &&
        data.loginGeneration === owner.loginGeneration
        ? options.bus.invalidate(data.invalidation)
        : Effect.void;
    });
  yield* Queue.take(inbox).pipe(Effect.flatMap(receive), Effect.forever, Effect.forkIn(scope));

  return {
    broadcast: (invalidation) =>
      Effect.andThen(
        Effect.sync(() => {
          const owner = options.owner();
          if (owner === null) return;
          const { userId, loginGeneration } = owner;
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel stays within its origin
          channel.postMessage({ userId, loginGeneration, invalidation });
        }),
        options.bus.invalidate(invalidation),
      ),
  };
});
