import { AGENT_USAGE_REPORT_PROTOCOL } from "@t3tools/contracts";
import { lifecycleReceipt } from "../families/hqLifecycle.ts";
/**
 * HQ, our own source (`@t3tools/shared/hqStream`): one socket
 * per account, organization and renderer, carrying the scopes this renderer demands. The
 * organization's `navigation` scope is always demanded; it feeds every family whose records it
 * holds, one delivery committed together. Each Mate HQ places is observed through its own
 * `attention` scope, as part of the navigation; any other scope (an application's detail, a
 * change) is a detail a screen demands by its owner's id.
 *
 * HQ ends each socket as planned after its segment (`4410`): the next segment opens with a fresh
 * ticket and resumes each scope from the cursor last committed, naming the keys this renderer
 * holds, so an unchanged scope sends nothing but its `scope-ready`. A delta that does not follow
 * the cursor is not committed: the scope is asked again whole.
 *
 * The adapter only translates and classifies: a scope HQ refuses is that scope's definitive
 * refusal; a socket the session no longer holds (`4401`) retries with a fresh session; HQ
 * refusing the source outright (`4403`) is the link's refusal; any other ending is transient.
 * Retrying belongs to the supervisor and the stream machine.
 *
 * @module data/adapters/hq
 */
import {
  hqScopeKey,
  hqStreamCloseFailure,
  HqStreamMessage,
  type HqCursor,
  type HqHandoverCandidate,
  type HqScope,
  type HqScopeDelivery,
  type HqStreamRequest,
} from "@t3tools/shared/hqStream";
import { makeHqPictureReads } from "./hqPictures.ts";
import type { AttachmentLink, CompareQuery, CompareResponse } from "@t3tools/shared/hqChanges";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { detailScopeOf, makeDetailDemands, type DetailDemand } from "../demand.ts";
import { decodeHqProtocol, hqProtocolScope } from "../families/hqProtocol.ts";
import { FAMILIES, scopeSpec } from "../families/index.ts";
import { hqMateFamily } from "../families/hqMate.ts";
import { placementsScope, type PlacementValue } from "../families/hqNavigation.ts";
import { scopeOf, type AnyFamilySpec, type ScopeOwner } from "../families/spec.ts";
import {
  factKey,
  linkKeys,
  type FamilyValues,
  type LinkKey,
  type Revision,
  type ScopeKey,
} from "../model.ts";
import { streamOf, type DeliveryScope, type RemovalInput, type Row } from "../reducer.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";
import type { LinkOptions } from "../supervisor.ts";

/** One open segment: HQ's messages, and the requests sent on it. */
export interface HqSegment {
  /**
   * Every message from open on, as sent. It ends when HQ ends the segment as planned; it fails
   * with the classified fault on any other ending.
   */
  readonly messages: Stream.Stream<string, StreamFault>;
  readonly send: (request: HqStreamRequest) => Effect.Effect<void>;
}

/** Today's HQ transport behind the adapter — a ticket, then the socket — or a fixture. */
export interface HqWire {
  readonly open: Effect.Effect<HqSegment, StreamFault, Scope.Scope>;
  readonly change?: (
    request: import("../families/hqChangeRead.ts").ChangeReadRequest,
  ) => Effect.Effect<import("@t3tools/shared/hqChanges").ChangeDetailResponse, StreamFault>;
  readonly picture?: (link: AttachmentLink) => Effect.Effect<Blob, StreamFault>;
}

/** How an HQ socket's ending classifies, its planned segment end aside. */
export function classifyHqClose(code: number): StreamFault {
  const failure = hqStreamCloseFailure(code);
  const message = `HQ's stream closed (${failure.code}).`;
  switch (failure.disposition) {
    case "refused":
      return {
        outcome: "definitive-refusal",
        code: failure.code,
        message: "Zerops refused HQ's access. Check HQ's access in Zerops, then try again.",
      };
    case "session-ended":
      // The API already forgets this session. The next ticket enters its door; a close code
      // proves only that this session ended, never that a newly authenticated read is denied.
      return { outcome: "transient", message };
    case "transient":
      return { outcome: "transient", message };
  }
}

/** What HQ says a Mate may be moved into, per application, as asked when the move opens. */
export interface HqMoveOffers {
  readonly moveTo: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly refused: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/**
 * How long a socket may say nothing — not even HQ's ping, sent every 20 s — before it is given up:
 * a socket a sleeping laptop or a stalled path left open carries nothing, though it never closed.
 */
export const HQ_SILENCE_MS = 60_000;

/** Whom a Mate may be handed over to, as HQ answers when the hand-over opens. */
export type HqHandoverCandidates = ReadonlyArray<HqHandoverCandidate>;

const protocolIdentity = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeMessage = Schema.decodeUnknownOption(Schema.fromJsonString(HqStreamMessage));

/** The families each scope kind feeds. */
const familiesOf = (kind: HqScope["kind"]): ReadonlyArray<AnyFamilySpec> =>
  FAMILIES.filter((spec) => spec.hq?.scope === kind);

const NAVIGATION: HqScope = { kind: "navigation" };

/**
 * What one HQ scope is to the store: the store scopes it feeds (one per family it holds), the
 * owner they observe, and the families themselves.
 */
interface Registered {
  readonly wire: HqScope;
  readonly owner: ScopeOwner;
  readonly families: ReadonlyArray<{ readonly spec: AnyFamilySpec; readonly scope: ScopeKey }>;
}

export function hqNavigationLink(options: {
  readonly orgId: string;
  readonly wire: HqWire;
  readonly store: AccountStore;
}): Pick<LinkOptions, "key" | "scopes" | "details" | "attempt" | "childMoved"> & {
  readonly retryDetail: (demand: DetailDemand) => void;
  /** A screen's hold on a detail scope; the release lets it go once nothing holds it. */
  readonly demandDetail: (demand: DetailDemand) => () => void;
  /** Asks HQ where a Mate may move, on the open socket. */
  readonly moveOffers: (projectId: string) => Effect.Effect<HqMoveOffers, StreamFault>;
  /** Asks HQ whom a Mate may be handed over to, on the open socket. */
  readonly handoverCandidates: (
    projectId: string,
  ) => Effect.Effect<HqHandoverCandidates, StreamFault>;
  /** Asks HQ what lies between two commits of an application's repository, on the open socket. */
  readonly compare: (
    ask: { readonly appId: string; readonly repo: string } & CompareQuery,
  ) => Effect.Effect<CompareResponse, StreamFault>;
  /** Tells HQ the reader saw these results of a Mate: on the open socket, else on the next. */
  readonly seen: (projectId: string, resultIds: ReadonlyArray<string>) => Effect.Effect<void>;
  /** Ends the link's own holds (each Mate's attention). */
  readonly stop: () => void;
  /** The same HQ reached anew (its session's API again): the next socket opens over it. */
  readonly rewire: (wire: HqWire) => void;
} {
  const { orgId, store } = options;
  let wire = options.wire;
  const key: LinkKey = linkKeys.hq(orgId);
  const nav: Registered = {
    wire: NAVIGATION,
    owner: { orgId, ownerId: null },
    families: familiesOf("navigation").map((spec) => ({ spec, scope: scopeOf(spec, orgId) })),
  };
  const scopes = [...nav.families.map(({ scope }) => scope), hqProtocolScope(orgId)];
  const demands = makeDetailDemands({
    // A demanded scope's riders are demanded with it: their records come on its wire.
    demanded: (scope, demanded) =>
      Effect.runSync(
        Effect.map(Clock.currentTimeMillis, (now) => {
          for (const fed of fedBy(scope))
            store.dispatch({ kind: "stream", key: fed, now, event: { kind: "demand", demanded } });
        }),
      ),
  });

  /**
   * A detail store scope as HQ names it: its family's scope for the owner it is demanded for, and
   * beside it the scope of each family riding the same kind of HQ scope without demanding one (a
   * Mate's attention, relayed in HQ's record of that Mate).
   */
  const detailOf = (scope: ScopeKey): Registered | null => {
    const spec = scopeSpec(scope);
    const ownerId = scope.split(":").slice(3).join(":");
    if (spec.hq?.wireScope === undefined || ownerId === "") return null;
    const riders = familiesOf(spec.hq.scope).filter(
      (rider) => rider !== spec && rider.hq?.wireScope === undefined,
    );
    return {
      wire: spec.hq.wireScope(ownerId),
      owner: { orgId, ownerId },
      families: [
        { spec, scope },
        ...riders.map((rider) => ({
          spec: rider,
          scope: `${linkKeys.hq(orgId)}:${rider.scope.suffix}:${ownerId}` as ScopeKey,
        })),
      ],
    };
  };
  /** The store scopes a demanded scope feeds: its own, and its riders'. */
  const fedBy = (scope: ScopeKey): ReadonlyArray<ScopeKey> =>
    detailOf(scope)?.families.map((family) => family.scope) ?? [scope];

  /**
   * Each Mate HQ places is observed while it is placed: navigation demand, held by the link
   * itself, never by a screen.
   */
  const mateHolds = new Map<string, () => void>();
  /** A hold's own demand moves the store, which asks again: that inner ask has nothing to add. */
  let holding = false;
  const holdPlacedMates = () => {
    if (holding) return;
    holding = true;
    try {
      followPlacedMates();
    } finally {
      holding = false;
    }
  };
  const followPlacedMates = () => {
    const placed = new Set(
      readsOfState(store.state())
        .members(placementsScope(orgId))
        .ids.filter((id) => {
          const fact = store.state().facts.get(factKey("placement", id));
          return (
            fact?.content.kind === "value" && (fact.content.value as PlacementValue).mate != null
          );
        }),
    );
    for (const [projectId, release] of mateHolds)
      if (!placed.has(projectId)) {
        mateHolds.delete(projectId);
        release();
      }
    for (const projectId of placed)
      if (!mateHolds.has(projectId))
        mateHolds.set(
          projectId,
          demands.hold(detailScopeOf(orgId, { family: hqMateFamily.family, ownerId: projectId })),
        );
  };
  let stopHolding: (() => void) | null = null;

  /** The cursor last committed of each HQ scope, by `hqScopeKey`, across segments and attempts. */
  const cursors = new Map<string, HqCursor>();
  /** The segment open now, if any: what a request is sent on. */
  let open: HqSegment | null = null;
  /** What the person saw while no socket was open, by project: told HQ on the next one. */
  const untold = new Map<string, Set<string>>();
  /** The asks sent on the open socket that HQ has not answered yet, by request id. */
  const pendingOffers = new Map<string, Deferred.Deferred<unknown, StreamFault>>();
  let requests = 0;
  /** Looks at the demanded details again in the attempt under way, if one is. */
  const refresh = new Set<ScopeKey>();
  let wakeAttempt: (() => void) | null = null;
  /** The scopes HQ refused, by key: asked again only with the person's explicit `retry`. */
  const refused = new Set<string>();
  /** HQ refused the whole socket (`4403`): the next one opens with the person's `retry`. */
  let refusedWhole = false;

  const attempt = (): Effect.Effect<never, StreamFault, Scope.Scope> =>
    Effect.gen(function* () {
      stopHolding ??= (() => {
        holdPlacedMates();
        return store.subscribe(holdPlacedMates);
      })();
      const signal = (target: LinkKey | ScopeKey, event: StreamEvent) =>
        Effect.map(Clock.currentTimeMillis, (now) =>
          store.dispatch({ kind: "stream", key: target, now, event }),
        );
      /** Each subscribed HQ scope this attempt, by its key, with the generations it was given. */
      const subscribed = new Map<
        string,
        { readonly registered: Registered; generations: ReadonlyArray<DeliveryScope> }
      >();

      /** The scopes the open segment was asked for: what HQ may be sending. */
      const asked = new Set<string>();
      /** Whether a socket of this attempt said anything yet. */
      let said = false;
      // Each new segment negotiates usage before any consumption scope is sent.
      let usageSupported: boolean | null = null;
      /** When the open segment last said anything. */
      let heardAt = 0;
      /** Fails once the open segment said nothing for {@link HQ_SILENCE_MS}. */
      const silence: Effect.Effect<never, StreamFault> = Effect.gen(function* () {
        while (true) {
          const now = yield* Clock.currentTimeMillis;
          const quietFor = now - heardAt;
          if (quietFor >= HQ_SILENCE_MS)
            return yield* Effect.fail<StreamFault>({
              outcome: "transient",
              message: "HQ's stream said nothing for a minute.",
            });
          yield* Effect.sleep(HQ_SILENCE_MS - quietFor);
        }
      });

      /** The keys this renderer holds of an HQ scope: what proves a removal on resume. */
      const knownKeys = (registered: Registered): ReadonlyArray<string> => [
        ...new Set(
          registered.families.flatMap(({ spec, scope }) => {
            const { ids, unverified } = readsOfState(store.state()).members(scope);
            return [...ids, ...unverified].map((id) => spec.hq!.keyOf(id, registered.owner));
          }),
        ),
      ];

      const subscription = (registered: Registered) => {
        const cursor = cursors.get(hqScopeKey(registered.wire));
        return {
          scope: registered.wire,
          ...(cursor === undefined ? {} : { cursor }),
          knownKeys: knownKeys(registered),
        };
      };

      /** Starts a registration of each store scope: a new generation, its handshake made. */
      const register = (registered: Registered) =>
        Effect.gen(function* () {
          const generations: DeliveryScope[] = [];
          for (const scope of [
            ...registered.families.map(({ scope }) => scope),
            ...(registered.wire.kind === "navigation" ? [hqProtocolScope(orgId)] : []),
          ]) {
            yield* signal(scope, { kind: "attempt" });
            yield* signal(scope, { kind: "handshake" });
            generations.push({ scope, generation: streamOf(store.state(), scope).generation });
          }
          subscribed.set(hqScopeKey(registered.wire), { registered, generations });
        });

      const deliver = (message: HqScopeDelivery) =>
        Effect.gen(function* () {
          const scopeKey = hqScopeKey(message.scope);
          const entry = subscribed.get(scopeKey);
          if (entry === undefined) return;
          const cursor = cursors.get(scopeKey);
          const follows =
            message.type === "scope-reset" ||
            (cursor !== undefined &&
              cursor.incarnation === message.incarnation &&
              message.revision === cursor.revision + 1);
          if (!follows) {
            // A delta that does not follow what was committed: ask for the scope whole.
            cursors.delete(scopeKey);
            yield* resubscribe(entry.registered);
            return;
          }
          const revision = {
            kind: "hq",
            incarnation: message.incarnation,
            revision: message.revision,
          } as const;
          const rows: Row[] = [];
          for (const { key: recordKey, value } of message.values)
            for (const { spec } of entry.registered.families) {
              const id = spec.hq!.idOf(recordKey, entry.registered.owner);
              if (id === null) continue;
              const decoded = spec.hq!.decode(value, recordKey);
              // A record this build cannot read changes nothing: its last value stays.
              if (decoded !== null)
                rows.push({
                  family: spec.family,
                  id,
                  value: decoded,
                  // A relayed value keeps its author's revision; HQ's own records, the scope's.
                  revision:
                    (
                      spec.hq!.revisionOf as
                        | ((value: unknown, raw: unknown) => Revision)
                        | undefined
                    )?.(decoded, value) ?? revision,
                } as Row);
            }
          const removals: RemovalInput[] = message.removals.flatMap(({ key: recordKey, reason }) =>
            entry.registered.families.flatMap(({ spec }) => {
              const id = spec.hq!.idOf(recordKey, entry.registered.owner);
              return id === null ? [] : [{ family: spec.family, id, reason }];
            }),
          );
          store.dispatch({
            kind: "delivery",
            via: "hq-stream",
            scopes: entry.generations,
            reset: message.type === "scope-reset",
            rows,
            removals,
          });
          // Only committed, recipient-filtered HQ values can restore a lifecycle request.
          for (const row of rows) {
            if (row.family !== "hqLifecycle") continue;
            const fact = readsOfState(store.state()).fact("hqLifecycle", row.id);
            if (fact?.kind !== "known" || fact.value.intent.orgId !== orgId) continue;
            const record = fact.value;
            store.dispatch({
              kind: "operation-recorded",
              requestId: record.requestId,
              intent: record.intent,
            });
            store.dispatch({ kind: "operation-receipt", receipt: lifecycleReceipt(record) });
          }
          cursors.set(scopeKey, { incarnation: message.incarnation, revision: message.revision });
        });

      /**
       * Asks HQ for registrations again, each on a new registration: a scope the person tried
       * again, one whose retry came due, or one whose delta did not follow — whatever HQ still
       * sends of the old one is fenced out.
       */
      const again = (registrations: ReadonlyArray<Registered>) =>
        Effect.gen(function* () {
          if (open === null || registrations.length === 0) return;
          // HQ knows only what this segment asked.
          const known = registrations.filter((registered) =>
            asked.has(hqScopeKey(registered.wire)),
          );
          for (const registered of registrations) yield* register(registered);
          // A refused scope comes back only by the person's explicit retry, sent before asking.
          const retried = registrations.filter(({ wire }) => refused.delete(hqScopeKey(wire)));
          if (retried.length > 0)
            yield* open.send({ type: "retry", scopes: retried.map(({ wire }) => wire) });
          if (known.length > 0)
            yield* open.send({ type: "unsubscribe", scopes: known.map(({ wire }) => wire) });
          yield* open.send({ type: "subscribe", scopes: registrations.map(subscription) });
          for (const { wire } of registrations) asked.add(hqScopeKey(wire));
        });
      const resubscribe = (registered: Registered) => again([registered]);

      const onMessage = (encoded: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          heardAt = yield* Clock.currentTimeMillis;
          // The socket said something: its session holds, and the link is live.
          if (!said) {
            said = true;
            yield* signal(key, { kind: "baseline-committed" });
          }
          const message = Option.getOrUndefined(decodeMessage(encoded));
          if (message === undefined) return;
          switch (message.type) {
            case "ping":
              if (open !== null) yield* open.send({ type: "pong" });
              return;
            case "scope-reset":
            case "scope-values":
              return yield* deliver(message);
            case "scope-ready": {
              const scopeKey = hqScopeKey(message.scope);
              const entry = subscribed.get(scopeKey);
              if (entry === undefined) return;
              cursors.set(scopeKey, {
                incarnation: message.incarnation,
                revision: message.revision,
              });
              if (message.scope.kind === "navigation") {
                const scope = hqProtocolScope(orgId);
                const core: FamilyValues["hqProtocol"] = Option.getOrElse(
                  decodeHqProtocol(message.core),
                  () => ({}),
                );
                usageSupported = core.agentUsage === AGENT_USAGE_REPORT_PROTOCOL;
                if (usageSupported)
                  for (const demanded of demands.scopes()) {
                    if (
                      detailOf(demanded)?.wire.kind === "agentUsage" &&
                      streamOf(store.state(), demanded).fault?.code === "usage-update-required"
                    )
                      yield* signal(demanded, { kind: "input-changed" });
                  }
                store.dispatch({
                  kind: "delivery",
                  via: "hq-stream",
                  scopes: entry.generations.filter((entry) => entry.scope === scope),
                  reset: true,
                  rows: [
                    {
                      family: "hqProtocol",
                      id: orgId,
                      value: core,
                      revision: {
                        kind: "hq",
                        // A Core declaration can change without a navigation revision moving.
                        incarnation: protocolIdentity([
                          message.incarnation,
                          core.build ?? null,
                          core.protocol ?? null,
                          core.agentUsage ?? null,
                        ]),
                        revision: message.revision,
                      },
                    },
                  ],
                  removals: [],
                });
              }
              if (
                message.scope.kind === "navigation" &&
                demands.scopes().some((scope) => detailOf(scope)?.wire.kind === "agentUsage")
              )
                wakeAttempt?.();
              store.dispatch({ kind: "hq-ready", scopes: entry.generations });
              for (const { scope } of entry.generations)
                yield* signal(scope, { kind: "baseline-committed" });
              return;
            }
            case "scope-error": {
              const entry = subscribed.get(hqScopeKey(message.scope));
              if (entry === undefined) return;
              const fault: StreamFault = {
                outcome: message.disposition === "refused" ? "definitive-refusal" : "transient",
                message: message.reason ?? `HQ could not read this (${message.code}).`,
                code: message.code,
              };
              if (message.disposition === "refused") refused.add(hqScopeKey(message.scope));
              const jitter = yield* Random.next;
              for (const { scope } of entry.generations)
                yield* signal(scope, { kind: "fault", fault, jitter });
              return;
            }
            case "move-offers":
            case "move-offers-error":
            case "handover-candidates":
            case "handover-candidates-error":
            case "compare":
            case "compare-error": {
              const waiting = pendingOffers.get(message.requestId);
              if (waiting === undefined) return;
              pendingOffers.delete(message.requestId);
              if (message.type === "move-offers")
                return yield* Deferred.succeed(waiting, {
                  moveTo: message.moveTo,
                  refused: message.refused ?? {},
                });
              if (message.type === "handover-candidates")
                return yield* Deferred.succeed(waiting, message.candidates);
              if (message.type === "compare")
                return yield* Deferred.succeed(waiting, message.result);
              return yield* Deferred.fail(waiting, {
                outcome: message.disposition === "refused" ? "definitive-refusal" : "transient",
                message: message.reason ?? `HQ could not answer this (${message.code}).`,
                code: message.code,
              });
            }
          }
        });

      /**
       * Every scope as this attempt must observe it — the navigation, and each detail demanded
       * now: one not asked yet, or moved to a new registration (the person's try again, its retry
       * come due), asked; a detail let go, unsubscribed. A refused one is never asked again by
       * itself.
       */
      const observe = Effect.gen(function* () {
        if (open === null) return Number.POSITIVE_INFINITY;
        const now = yield* Clock.currentTimeMillis;
        const held = demands.scopes().flatMap((scope) => {
          const registered = detailOf(scope);
          return registered === null ? [] : [registered];
        });
        if (usageSupported === false)
          for (const registered of held) {
            if (registered.wire.kind !== "agentUsage") continue;
            for (const { scope } of registered.families) {
              if (streamOf(store.state(), scope).fault?.code === "usage-update-required") continue;
              yield* signal(scope, {
                kind: "fault",
                jitter: 0,
                fault: {
                  outcome: "definitive-refusal",
                  code: "usage-update-required",
                  message: "Update HQ to read recorded Mate usage.",
                },
              });
            }
          }
        const wanted = [
          nav,
          ...held.filter(
            (registered) => registered.wire.kind !== "agentUsage" || usageSupported === true,
          ),
        ];
        const keys = new Set(wanted.map(({ wire }) => hqScopeKey(wire)));
        for (const [scopeKey, entry] of subscribed) {
          if (keys.has(scopeKey)) continue;
          subscribed.delete(scopeKey);
          if (!asked.delete(scopeKey)) continue;
          yield* open.send({ type: "unsubscribe", scopes: [entry.registered.wire] });
        }
        const fresh: Registered[] = [];
        let wakeAt = yield* pictures(demands.scopes());
        for (const registered of wanted) {
          const stream = streamOf(store.state(), registered.families[0]!.scope);
          if (stream.phase === "refused") continue;
          if (refresh.delete(registered.families[0]!.scope)) {
            fresh.push(registered);
            continue;
          }
          if (stream.phase === "recovering" && stream.next.kind === "retry") {
            if (stream.next.at > now) wakeAt = Math.min(wakeAt, stream.next.at);
            else fresh.push(registered);
            continue;
          }
          const entry = subscribed.get(hqScopeKey(registered.wire));
          if (
            entry === undefined ||
            stream.phase === "stale" ||
            stream.generation !== entry.generations[0]?.generation
          )
            fresh.push(registered);
        }
        yield* again(fresh);
        return wakeAt;
      });

      const wakes = yield* Queue.sliding<void>(1);
      const wake = () => Queue.offerUnsafe(wakes, undefined);
      const stopListening = demands.onChange(wake);
      wakeAttempt = wake;
      const pictures = yield* makeHqPictureReads({
        refresh,
        change: (request) =>
          wire.change?.(request) ??
          Effect.fail({ outcome: "definitive-refusal", message: "HQ cannot read this change." }),
        orgId,
        store,
        signal,
        wake,
        read: (link) =>
          wire.picture?.(link) ??
          Effect.fail({
            outcome: "definitive-refusal",
            message: "This HQ cannot read change pictures.",
          }),
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          stopListening();
          if (wakeAttempt === wake) wakeAttempt = null;
          open = null;
          for (const waiting of pendingOffers.values())
            Deferred.doneUnsafe(
              waiting,
              Effect.fail({ outcome: "transient", message: "HQ's stream closed." }),
            );
          pendingOffers.clear();
        }),
      );

      /** One segment: open, subscribe every scope from its cursor, read until it ends. */
      const segment = (first: boolean) =>
        Effect.scoped(
          Effect.gen(function* () {
            const opened = yield* wire.open;
            open = opened;
            usageSupported = null;
            for (const { registered } of subscribed.values()) {
              if (registered.wire.kind === "agentUsage")
                for (const { scope } of registered.families)
                  yield* signal(scope, { kind: "parent-lost" });
            }
            if (first) yield* signal(key, { kind: "handshake" });
            if (refusedWhole) {
              refusedWhole = false;
              yield* opened.send({ type: "retry" });
            }
            const reading = yield* Effect.forkScoped(Stream.runForEach(opened.messages, onMessage));
            // A new segment resumes every scope still observed from its cursor, in one ask.
            const resumed = [...subscribed.values()]
              .map(({ registered }) => registered)
              .filter((registered) => {
                if (registered.wire.kind === "agentUsage") return false;
                const { phase } = streamOf(store.state(), registered.families[0]!.scope);
                return phase !== "refused" && phase !== "recovering";
              });
            asked.clear();
            if (resumed.length > 0) {
              for (const registered of resumed) yield* register(registered);
              yield* opened.send({ type: "subscribe", scopes: resumed.map(subscription) });
              for (const { wire } of resumed) asked.add(hqScopeKey(wire));
            }
            for (const [projectId, resultIds] of untold)
              yield* opened.send({ type: "seen", projectId, resultIds: [...resultIds] });
            untold.clear();
            wake();
            const watching = Effect.forever(
              Effect.gen(function* () {
                const wakeAt = yield* observe;
                const now = yield* Clock.currentTimeMillis;
                yield* Number.isFinite(wakeAt)
                  ? Effect.raceFirst(Queue.take(wakes), Effect.sleep(Math.max(0, wakeAt - now)))
                  : Queue.take(wakes);
              }),
            );
            // The segment's end, as planned or by its fault, ends the look at the details too.
            heardAt = yield* Clock.currentTimeMillis;
            yield* Effect.raceAllFirst([Fiber.join(reading), watching, silence]);
            open = null;
          }),
        );

      return yield* segment(true).pipe(
        // HQ ended the segment as planned: the next resumes from the committed cursors.
        Effect.andThen(Effect.forever(segment(false))),
        Effect.tapError((fault) =>
          Effect.sync(() => {
            if (fault.outcome === "definitive-refusal") refusedWhole = true;
          }),
        ),
      );
    });

  /** One question to HQ on the open socket, answered by its request id; none without a socket. */
  const ask = <A>(
    type: "move-offers" | "handover-candidates" | "compare",
    request: (requestId: string) => HqStreamRequest,
  ): Effect.Effect<A, StreamFault> =>
    Effect.suspend(() => {
      const segment = open;
      if (segment === null)
        return Effect.fail<StreamFault>({
          outcome: "transient",
          message: "HQ's stream is not open.",
        });
      const requestId = `${type}-${(requests += 1)}`;
      const answer = Deferred.makeUnsafe<unknown, StreamFault>();
      pendingOffers.set(requestId, answer);
      return Effect.andThen(
        segment.send(request(requestId)),
        Deferred.await(answer) as Effect.Effect<A, StreamFault>,
      );
    });

  return {
    key,
    scopes,
    details: () => demands.scopes().flatMap(fedBy),
    attempt,
    childMoved: () => wakeAttempt?.(),
    retryDetail: (demand) => {
      const scope = detailScopeOf(orgId, demand);
      refresh.add(scope);
      void Effect.runFork(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          store.dispatch({
            kind: "stream",
            key: scope,
            now,
            event: {
              kind: streamOf(store.state(), scope).phase === "live" ? "revalidate" : "manual-retry",
            },
          });
          wakeAttempt?.();
        }),
      );
    },
    demandDetail: (demand) => demands.hold(detailScopeOf(orgId, demand)),
    moveOffers: (projectId) =>
      ask<HqMoveOffers>("move-offers", (requestId) => ({
        type: "move-offers",
        requestId,
        projectId,
      })),
    handoverCandidates: (projectId) =>
      ask<HqHandoverCandidates>("handover-candidates", (requestId) => ({
        type: "handover-candidates",
        requestId,
        projectId,
      })),
    compare: (asked) =>
      ask<CompareResponse>("compare", (requestId) => ({ type: "compare", requestId, ...asked })),
    seen: (projectId, resultIds) =>
      Effect.suspend(() => {
        if (open !== null) return open.send({ type: "seen", projectId, resultIds });
        const held = untold.get(projectId) ?? new Set<string>();
        for (const id of resultIds) held.add(id);
        untold.set(projectId, held);
        return Effect.void;
      }),
    rewire: (next) => {
      wire = next;
    },
    stop: () => {
      stopHolding?.();
      stopHolding = null;
      for (const release of mateHolds.values()) release();
      mateHolds.clear();
    },
  };
}
