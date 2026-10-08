/**
 * Zerops, a fixed source: one receiver per account, organization and renderer
 * carries the organization's navigation registrations (`demand.ts`). An attempt opens the
 * receiver, starts reading frames before it registers anything, then registers each scope —
 * updates first — and commits the membership answer as that scope's baseline. Frames that arrive
 * while a baseline is read are staged by the reducer and replayed after it. After an outage
 * nothing is replayed by Zerops: the next attempt registers again and its answers are the truth;
 * what went missing meanwhile is not invented.
 *
 * The credential is proven by answers, never by the socket: a socket outlives a revoked token and
 * its pongs go on. A read the attempt makes that answers 401 ends the
 * attempt, and the supervisor repairs the session; a project taken from the viewer ends it too,
 * for the other scopes never say what it took away: the next attempt registers every scope again
 * and its answers are the truth.
 *
 * The adapter only translates and classifies. It never retries: an attempt ends by failing, and the
 * supervisor decides what follows.
 *
 * @module data/adapters/zerops
 */
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

import {
  detailScopeOf,
  makeDetailDemands,
  ORGANIZATION_SEARCH_LIMIT,
  zeropsNavigation,
  type DetailDemand,
  type Registration,
} from "../demand.ts";
import { familySpec, scopeListing, scopeSpec } from "../families/index.ts";
import { factKey, linkKeys, type Family, type LinkKey, type ScopeKey } from "../model.ts";
import { factOf, streamOf, type Row, type RuntimeDirective } from "../reducer.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import { scopeOf } from "../families/spec.ts";
import { retryDelayMs, type StreamEvent, type StreamFault } from "../streamMachine.ts";
import type { LinkOptions } from "../supervisor.ts";

/**
 * How many query registrations one receiver may have let go: the platform cannot unsubscribe
 * them, so their frames go on arriving. Past it, the receiver is opened afresh.
 */
export const RELEASED_QUERIES_PER_RECEIVER = 256;

/** A demanded query's registration on the receiver; `held` its frames until its answer lands. */
interface QuerySubscription {
  readonly scope: ScopeKey;
  readonly generation: number;
  held: Array<unknown> | null;
}

/** One open receiver: its frames, and requests made on its behalf. */
export interface ZeropsLink {
  readonly receiverId: string;
  /** Every frame from open on, as sent; fails with the classified fault when the socket breaks. */
  readonly frames: Stream.Stream<string, StreamFault>;
  readonly post: (
    path: string,
    body: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<unknown, StreamFault>;
  readonly get: (
    path: string,
  ) => Effect.Effect<{ readonly status: number; readonly body: unknown }, StreamFault>;
}

/** Today's receiver (socket, web-socket login, REST client) behind the adapter, or a fixture. */
export interface ZeropsWire {
  readonly open: Effect.Effect<ZeropsLink, StreamFault, Scope.Scope>;
}

/**
 * How an HTTP answer classifies, by its status alone; the wire applies it to every failed request.
 * The message is what the person reads: the platform's own words where it gave any, else the
 * API client's words for the status.
 */
export function classifyHttp(
  status: number,
  retryAfterMs?: number,
  message: string = status === 403
    ? "This Zerops account is not allowed to do that."
    : `Zerops API request failed (${status}).`,
): StreamFault {
  if (status === 401) return { outcome: "recoverable-session", message };
  if (status === 403) return { outcome: "authoritative-denial", message };
  if (status === 429 || status >= 500)
    return {
      outcome: "transient",
      message,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  return { outcome: "definitive-refusal", message };
}

const Frame = Schema.Struct({
  type: Schema.String,
  subscriptionName: Schema.optionalKey(Schema.String),
  data: Schema.optionalKey(Schema.Unknown),
});
const MembershipData = Schema.Struct({
  add: Schema.optionalKey(Schema.Array(Schema.String)),
  update: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  delete: Schema.optionalKey(Schema.Array(Schema.String)),
});
const UpdateData = Schema.Struct({ update: Schema.Array(Schema.Unknown) });
const ListAnswer = Schema.Struct({
  items: Schema.Array(Schema.Unknown),
  totalHits: Schema.optionalKey(Schema.Number),
});
/** A member's identity alone: a row too damaged to read still names its id. */
const Identified = Schema.Struct({ id: Schema.String });

const decodeFrame = Schema.decodeUnknownOption(Schema.fromJsonString(Frame));
const decodeMembership = Schema.decodeUnknownOption(MembershipData);
const decodeUpdates = Schema.decodeUnknownOption(UpdateData);
const decodeList = Schema.decodeUnknownOption(ListAnswer);
const decodeIdentified = Schema.decodeUnknownOption(Identified);

/** Each row its family decodes; a damaged row is refused alone, its neighbours admitted. */
function rowsOf(family: Family, raw: ReadonlyArray<unknown>): ReadonlyArray<Row> {
  const spec = familySpec(family);
  const decode = spec.zerops?.decode ?? spec.zeropsQuery?.decode;
  if (decode === undefined) return [];
  return raw.flatMap((input): Row[] => {
    const row = decode(input);
    return row === null
      ? []
      : [
          {
            family,
            id: row.id,
            value: row.value,
            revision: { kind: "zerops", version: row.version },
          } as Row,
        ];
  });
}

/** A registration the owner refused to this viewer alone: its scope's, never the link's. */
interface RefusedAlone {
  readonly refusedAlone: StreamFault;
}
const isRefusedAlone = (answer: unknown): answer is RefusedAlone =>
  typeof answer === "object" && answer !== null && "refusedAlone" in answer;

const corrupt = (message: string): StreamFault => ({ outcome: "transient", message });

/** Each item's id: a row too damaged to read still names its member. */
const membersOf = (items: ReadonlyArray<unknown>): ReadonlyArray<string> =>
  items.flatMap((item) =>
    Option.match(decodeIdentified(item), { onNone: () => [], onSome: ({ id }) => [id] }),
  );

/**
 * Whether an answer lists less than the whole: cut at its page limit, or holding a row its family
 * could not read. Its absences then say nothing, and it never completes its scope.
 */
const partialAnswer = (
  items: ReadonlyArray<unknown>,
  rows: ReadonlyArray<Row>,
  totalHits: number | undefined,
): boolean => rows.length < items.length || (totalHits !== undefined && totalHits > items.length);

export function zeropsNavigationLink(options: {
  readonly orgId: string;
  readonly wire: ZeropsWire;
  readonly store: AccountStore;
  /** A fresh subscription name. */
  readonly makeId: () => string;
}): Pick<LinkOptions, "key" | "scopes" | "details" | "attempt" | "childMoved"> & {
  /** A screen's hold on a detail; the release lets it go once no screen holds it. */
  readonly demandDetail: (demand: DetailDemand) => () => void;
  /**
   * Our own write changed a sampled detail: read it again now while it is demanded, and on its
   * next demand whatever its age.
   */
  readonly revalidate: (demand: DetailDemand) => void;
  /** The person's "try again" on one detail: a failed or refused read is read again. */
  readonly retryDetail: (demand: DetailDemand) => void;
  /** Renew a held own row without reviving a refusal. */
  readonly renew: (demand: DetailDemand) => void;
} {
  const { orgId, store } = options;
  const demands = makeDetailDemands({
    demanded: (scope, demanded) =>
      Effect.runSync(
        Effect.map(Clock.currentTimeMillis, (now) =>
          store.dispatch({ kind: "stream", key: scope, now, event: { kind: "demand", demanded } }),
        ),
      ),
  });
  const key: LinkKey = linkKeys.zerops(orgId);
  const registrations = zeropsNavigation(orgId);
  const scopes = [...new Set(registrations.map((registration) => registration.scope))];
  const familyOf = (scope: ScopeKey) => scopeSpec(scope).family;
  /** Looks at the demanded details again in the attempt under way, if one is. */
  let wakeAttempt: (() => void) | null = null;
  /**
   * When each sampled detail was last read whole, across attempts: a new demand inside its
   * family's `freshMs` reads nothing. Our own write forgets it.
   */
  const sampledAt = new Map<ScopeKey, number>();
  /**
   * Sampled details our own write changed while their read was under way: that read's answer may
   * predate the write, so each is read once more after it.
   */
  const written = new Set<ScopeKey>();
  const tellDetail = (demand: DetailDemand, event: StreamEvent) => {
    const scope = detailScopeOf(orgId, demand);
    Effect.runSync(
      Effect.map(Clock.currentTimeMillis, (now) =>
        store.dispatch({ kind: "stream", key: scope, now, event }),
      ),
    );
    wakeAttempt?.();
  };

  // A refused filtered pair stays refused across remounts and receiver rotations. Only a
  // changed generation of its navigation scope (manual retry / changed input) permits it again.
  const refusedPairs = new Map<ScopeKey, number>();

  const attempt = (): Effect.Effect<never, StreamFault, Scope.Scope> =>
    Effect.gen(function* () {
      const link = yield* options.wire.open;
      const attemptScope = yield* Effect.scope;
      const signal = (target: LinkKey | ScopeKey, event: StreamEvent) =>
        Effect.map(Clock.currentTimeMillis, (now) =>
          store.dispatch({ kind: "stream", key: target, now, event }),
        );
      // Each scope's generation as this attempt registered it: input of a registration the scope
      // has since replaced carries the old one, and the reducer fences it out.
      const generations = new Map<ScopeKey, number>();
      const generationOf = (scope: ScopeKey) => generations.get(scope) ?? -1;
      /** What ends this attempt from its side work: the credential refused, or access changed. */
      const ended = yield* Deferred.make<never, StreamFault>();
      /**
       * A read beside the frames whose credential no longer passes ends the attempt: the session
       * and access are the link's. A read that fails transiently is tried again alone; one the
       * owner refuses is its own.
       */
      const sessionEnds = (fault: StreamFault): Effect.Effect<void> =>
        fault.outcome === "recoverable-session" || fault.outcome === "authoritative-denial"
          ? Deferred.fail(ended, fault)
          : Effect.void;

      /**
       * The runtime work a reduction asks for, run beside the frames, never blocking them. A read
       * the credential no longer passes ends the attempt; any other failure leaves it to the next
       * baseline.
       */
      const carryOut = (directives: ReadonlyArray<RuntimeDirective>): Effect.Effect<void> =>
        Effect.forEach(directives, (directive) => {
          if (directive.kind === "resolve-rows") return resolveRows(directive.key, directive.ids);
          if (directive.kind === "verify-absence")
            // Every member gone is asked about first; access that changed ends the attempt once.
            return Effect.flatMap(
              Effect.forEach(directive.ids, (id) => verifyAbsence(directive.key, id)),
              (denied) =>
                denied.some(Boolean)
                  ? Deferred.fail(ended, {
                      outcome: "transient",
                      message: "The viewer's access changed: every scope is registered again.",
                    })
                  : Effect.void,
            );
          return Effect.void;
        }).pipe(Effect.catch(sessionEnds), Effect.forkIn(attemptScope), Effect.asVoid);

      /**
       * A read by id that fails transiently is tried again alone, on the one retry policy with
       * `Retry-After` as its floor, for as long as the attempt lasts: the link and its
       * registrations stay.
       */
      const readAgain = <A>(
        read: Effect.Effect<A, StreamFault>,
        failures = 0,
      ): Effect.Effect<A, StreamFault> =>
        read.pipe(
          Effect.catch((fault) =>
            fault.outcome !== "transient"
              ? Effect.fail(fault)
              : Effect.flatMap(Random.next, (jitter) =>
                  Effect.andThen(
                    Effect.sleep(retryDelayMs(failures + 1, jitter, fault.retryAfterMs)),
                    readAgain(read, failures + 1),
                  ),
                ),
          ),
        );

      const resolveRows = (
        scope: ScopeKey,
        ids: ReadonlyArray<string>,
      ): Effect.Effect<void, StreamFault> =>
        Effect.gen(function* () {
          // A damaged fallback row cannot be resolved through the search already refused to
          // this viewer. Keep it unknown until the next owner-triggered project read.
          if (refusedPairs.has(scope)) return;
          const family = familyOf(scope);
          const entity = familySpec(family).zerops?.entity;
          if (entity === undefined) return;
          const generation = generationOf(scope);
          const ownerId = scope.split(":").slice(3).join(":");
          const filter = scopeListing(scope).detail?.zerops.subscription?.({ orgId, ownerId }) ?? [
            { name: "clientId", operator: "eq", value: orgId },
          ];
          const answer = yield* readAgain(
            link.post(`/${entity}/search`, {
              search: [...filter, { name: "id", operator: "in", value: ids }],
              sort: [],
              limit: ids.length,
            }),
          );
          const items = Option.getOrUndefined(decodeList(answer))?.items ?? [];
          yield* carryOut(
            store.dispatch({
              kind: "rows",
              scope,
              generation,
              method: "read",
              via: "zerops-read",
              rows: rowsOf(family, items),
            }),
          );
        });

      /**
       * A member gone from its scope: deleted, or no longer the viewer's — the owner says. Whether
       * the viewer's access to it was taken.
       */
      const verifyAbsence = (scope: ScopeKey, id: string): Effect.Effect<boolean, StreamFault> =>
        Effect.gen(function* () {
          const family = familyOf(scope);
          const source = familySpec(family).zerops;
          const path = source?.verifyPath?.(id);
          if (path === undefined) return false;
          const { status, body } = yield* link.get(path);
          const placed = status === 200 ? (source?.organizationOf?.(body) ?? null) : null;
          // It exists, in another organization: it left this one, claiming nothing more.
          if (placed !== null && placed !== orgId)
            store.dispatch({ kind: "left", scope, generation: generationOf(scope), id });
          if (status === 404)
            store.dispatch({
              kind: "proven-deletion",
              family,
              id,
              evidence: `GET ${path} answered 404`,
            });
          // The viewer's access changed; what else it took, only a fresh baseline says.
          else if (status === 403) store.dispatch({ kind: "access", family, id, access: "denied" });
          return status === 403;
        });

      const subscriptions = new Map<string, Registration & { readonly generation: number }>();
      const dirtyDetails = new Set<ScopeKey>();
      const acceptRows = (scope: ScopeKey, generation: number, rows: ReadonlyArray<Row>) => {
        const before = store.state();
        const directives = store.dispatch({
          kind: "rows",
          scope,
          generation,
          method: "push",
          via: "zerops-realtime",
          rows,
        });
        const changed = rows.filter(
          (row) => factOf(before, row.family, row.id) !== factOf(store.state(), row.family, row.id),
        );
        for (const detailScope of demands.scopes()) {
          if (!refusedPairs.has(detailScope)) continue;
          const refresh = scopeListing(detailScope).detail?.zerops.refreshOn;
          const ownerId = detailScope.split(":").slice(3).join(":");
          if (changed.some((row) => refresh?.({ orgId, ownerId }, row, readsOfState(before)))) {
            dirtyDetails.add(detailScope);
            wakeAttempt?.();
          }
        }
        return carryOut(directives);
      };
      /**
       * Each demanded query's registration, by its subscription: the scope and generation it was
       * made for, and its frames held back until its answer is the scope's baseline. A released
       * one is forgotten — the platform cannot unsubscribe, so its frames go on arriving on this
       * receiver and are dropped here.
       */
      const queries = new Map<string, QuerySubscription>();
      const onQueryFrame = (query: QuerySubscription, data: unknown): Effect.Effect<void> => {
        if (query.held !== null) {
          query.held.push(data);
          return Effect.void;
        }
        const { family, zeropsQuery } = scopeListing(query.scope).spec;
        if (zeropsQuery?.frames === "listing") {
          const listing = Option.getOrUndefined(decodeList(data));
          return listing === undefined ? Effect.void : commitQuery(query, listing.items);
        }
        const updates = Option.getOrUndefined(decodeUpdates(data));
        if (updates === undefined) return Effect.void;
        const rows = rowsOf(family, updates.update);
        // A bucket the window did not hold yet joins it: the hour that began.
        store.dispatch({
          kind: "rows",
          scope: query.scope,
          generation: query.generation,
          method: "push",
          via: "zerops-realtime",
          rows,
        });
        return carryOut(
          store.dispatch({
            kind: "membership",
            scope: query.scope,
            generation: query.generation,
            delta: { add: rows.map((row) => row.id), remove: [] },
          }),
        );
      };
      /** A query's whole answer, or a frame listing it again, as the scope's baseline. */
      const commitQuery = (
        query: QuerySubscription,
        items: ReadonlyArray<unknown>,
      ): Effect.Effect<void> => {
        const rows = rowsOf(scopeListing(query.scope).spec.family, items);
        store.dispatch({
          kind: "baseline-begin",
          scope: query.scope,
          generation: query.generation,
        });
        return carryOut(
          store.dispatch({
            kind: "baseline-commit",
            scope: query.scope,
            generation: query.generation,
            via: "zerops-realtime",
            members: rows.map((row) => row.id),
            rows,
            // A row it cannot read is refused alone: what it lacks has not left the scope.
            partial: rows.length < items.length,
          }),
        );
      };
      const onFrame = (encoded: string): Effect.Effect<void> =>
        Effect.suspend(() => {
          const frame = Option.getOrUndefined(decodeFrame(encoded));
          if (frame === undefined || frame.type !== "search") return Effect.void;
          const query = queries.get(frame.subscriptionName ?? "");
          if (query !== undefined) return onQueryFrame(query, frame.data);
          const registration = subscriptions.get(frame.subscriptionName ?? "");
          if (registration === undefined) return Effect.void;
          const { scope } = registration;
          if (registration.role === "membership") {
            const delta = Option.getOrUndefined(decodeMembership(frame.data));
            if (delta === undefined) return Effect.void;
            // Some listStream frames carry rows too; admit them before resolving id-only adds.
            const rows = rowsOf(registration.family, delta.update ?? []);
            store.dispatch({
              kind: "rows",
              scope,
              generation: registration.generation,
              method: "push",
              via: "zerops-realtime",
              rows,
            });
            return carryOut(
              store.dispatch({
                kind: "membership",
                scope,
                generation: registration.generation,
                delta: { add: delta.add ?? [], remove: delta.delete ?? [] },
              }),
            );
          }
          const updates = Option.getOrUndefined(decodeUpdates(frame.data));
          if (updates === undefined) return Effect.void;
          return acceptRows(
            scope,
            registration.generation,
            rowsOf(registration.family, updates.update),
          );
        });

      yield* signal(key, { kind: "handshake" });
      const frames = yield* Effect.forkIn(Stream.runForEach(link.frames, onFrame), attemptScope);

      /**
       * One demanded detail listing, read while the receiver is up: its answer is the scope's
       * baseline. The owner refusing that one read refuses that scope alone; a transient failure,
       * or an answer it cannot read, leaves that scope to retry alone on the one policy; a session
       * that ended ends the attempt.
       */
      /**
       * A demanded detail family Zerops observes as one query: registered on this receiver, its
       * answer the scope's baseline. The owner refusing it refuses that scope alone; a session that
       * ended ends the attempt.
       */
      const observeQuery = (scope: ScopeKey): Effect.Effect<void, StreamFault> =>
        Effect.gen(function* () {
          const source = scopeListing(scope).spec.zeropsQuery;
          if (source === undefined) return;
          yield* signal(scope, { kind: "attempt" });
          const generation = streamOf(store.state(), scope).generation;
          generations.set(scope, generation);
          yield* signal(scope, { kind: "handshake" });
          yield* forgetQueries(scope);
          const subscriptionName = options.makeId();
          const query: QuerySubscription = { scope, generation, held: [] };
          queries.set(subscriptionName, query);
          const ownerId = scope.split(":").slice(3).join(":");
          const answer = yield* link
            .post(source.path, {
              ...source.body({ orgId, ownerId }),
              receiverId: link.receiverId,
              subscriptionName,
            })
            .pipe(
              Effect.catchIf((fault) => fault.outcome !== "recoverable-session", Effect.succeed),
            );
          const listing =
            typeof answer === "object" && answer !== null && "outcome" in answer
              ? (answer as StreamFault)
              : (Option.getOrUndefined(decodeList(answer)) ??
                corrupt("Zerops answered with something this app cannot read."));
          if ("outcome" in listing) {
            queries.delete(subscriptionName);
            return yield* signal(scope, {
              kind: "fault",
              fault: listing,
              jitter: yield* Random.next,
            });
          }
          yield* commitQuery(query, listing.items);
          yield* signal(scope, { kind: "baseline-committed" });
          // Drained in order: a frame arriving meanwhile waits behind the older ones.
          const held = query.held ?? [];
          while (held.length > 0) yield* onQueryFrame({ ...query, held: null }, held.shift());
          query.held = null;
        });
      /** The query registrations this receiver let go, still subscribed on the platform. */
      let released = 0;
      /**
       * Forgets a scope's query registrations: their frames are dropped from now on. Past the
       * receiver's bound of them, the attempt ends and the next one opens a fresh receiver.
       */
      const forgetQueries = (scope: ScopeKey): Effect.Effect<void> =>
        Effect.suspend(() => {
          for (const [name, query] of queries)
            if (query.scope === scope) {
              queries.delete(name);
              released += 1;
            }
          for (const [name, registration] of subscriptions)
            if (registration.scope === scope) {
              subscriptions.delete(name);
              released += 1;
            }
          return released > RELEASED_QUERIES_PER_RECEIVER
            ? Effect.asVoid(
                Deferred.fail(ended, {
                  outcome: "transient",
                  message: "The connection to Zerops is opened afresh.",
                }),
              )
            : Effect.void;
        });

      const observeDetail = (scope: ScopeKey): Effect.Effect<void, StreamFault> =>
        Effect.gen(function* () {
          const { spec, detail } = scopeListing(scope);
          const sampled = detail === null ? spec.sampled : undefined;
          if (detail === null && sampled === undefined) return yield* observeQuery(scope);
          yield* signal(scope, { kind: "attempt" });
          const generation = streamOf(store.state(), scope).generation;
          generations.set(scope, generation);
          yield* signal(scope, { kind: "handshake" });
          const ownerId = scope.split(":").slice(3).join(":");
          const readAt = sampledAt.get(scope);
          const now = yield* Clock.currentTimeMillis;
          // A sampled value read within its freshness is the answer to a new demand: nothing is
          // read, and its next revalidation comes on the cadence.
          if (
            sampled !== undefined &&
            readAt !== undefined &&
            (sampled.freshMs === null || now - readAt < sampled.freshMs) &&
            store.state().facts.has(factKey(spec.family, ownerId))
          )
            return yield* signal(scope, { kind: "baseline-committed" });
          store.dispatch({ kind: "baseline-begin", scope, generation: generationOf(scope) });
          const navigationGeneration = streamOf(store.state(), scopeOf(spec, orgId)).generation;
          const search = detail?.zerops.subscription?.({ orgId, ownerId });
          if (
            search !== undefined &&
            refusedPairs.get(scope) !== navigationGeneration &&
            spec.zerops !== undefined
          ) {
            refusedPairs.delete(scope);
            yield* forgetQueries(scope);
            for (const role of ["updates", "membership"] as const) {
              const subscriptionName = options.makeId();
              const path = `/${spec.zerops.entity}/search`;
              subscriptions.set(subscriptionName, {
                scope,
                generation,
                family: spec.family,
                role,
                path,
                search,
              });
              const answer = yield* link
                .post(path, {
                  search,
                  sort: [],
                  receiverId: link.receiverId,
                  subscriptionName,
                  ...(role === "membership"
                    ? { wsOutputType: "listStream", limit: ORGANIZATION_SEARCH_LIMIT }
                    : { wsOutputType: "updateStream", disableOutput: true }),
                })
                .pipe(Effect.catch(Effect.succeed));
              if (typeof answer === "object" && answer !== null && "outcome" in answer) {
                const fault = answer as StreamFault;
                yield* forgetQueries(scope);
                if (
                  fault.outcome === "recoverable-session" ||
                  fault.outcome === "authoritative-denial" ||
                  fault.outcome === "definitive-refusal"
                ) {
                  refusedPairs.set(scope, navigationGeneration);
                  break;
                }
                return yield* signal(scope, { kind: "fault", fault, jitter: yield* Random.next });
              }
              if (role !== "membership") continue;
              const list = Option.getOrUndefined(decodeList(answer));
              if (list === undefined)
                return yield* signal(scope, {
                  kind: "fault",
                  fault: corrupt("A detail baseline answer is malformed."),
                  jitter: yield* Random.next,
                });
              const rows = rowsOf(spec.family, list.items);
              yield* carryOut(
                store.dispatch({
                  kind: "baseline-commit",
                  scope,
                  generation,
                  via: "zerops-realtime",
                  members: membersOf(list.items),
                  rows,
                  partial: partialAnswer(list.items, rows, list.totalHits),
                }),
              );
              return yield* signal(scope, { kind: "baseline-committed" });
            }
          }
          const owner = { orgId, ownerId };
          const path =
            sampled !== undefined ? sampled.path(owner) : (detail?.zerops.path(owner) ?? "");
          const sampledSearch = sampled?.search?.(owner);
          // A search is a POST of it: its answer is the rows asked for, never a whole set.
          const read =
            sampledSearch === undefined
              ? link.get(path)
              : link.post(path, sampledSearch).pipe(Effect.map((body) => ({ status: 200, body })));
          const answer = yield* read.pipe(
            Effect.map((read) => {
              if (detail?.member === true && ownerId !== null) {
                if (read.status === 404)
                  store.dispatch({
                    kind: "proven-deletion",
                    family: spec.family,
                    id: ownerId,
                    scope,
                    evidence: `GET ${path} answered 404`,
                  });
                else if (read.status === 403)
                  store.dispatch({
                    kind: "access",
                    family: spec.family,
                    id: ownerId,
                    scope,
                    access: "denied",
                  });
              }
              return read.status === 403
                ? classifyHttp(403)
                : read.status === 404
                  ? classifyHttp(404)
                  : read;
            }),
            Effect.catchIf((fault) => fault.outcome !== "recoverable-session", Effect.succeed),
          );
          if ("outcome" in answer)
            return yield* signal(scope, {
              kind: "fault",
              fault: answer,
              jitter: yield* Random.next,
            });
          const malformed = Effect.flatMap(Random.next, (jitter) =>
            signal(scope, {
              kind: "fault",
              fault: corrupt("A detail baseline answer is malformed."),
              jitter,
            }),
          );
          if (sampled !== undefined) {
            const value = sampled.decode(answer.body);
            if (value === null) return yield* malformed;
            const row = {
              family: spec.family,
              id: ownerId,
              value,
              revision: { kind: "zerops", version: null },
            } as Row;
            store.dispatch({
              kind: "baseline-commit",
              scope,
              generation: generationOf(scope),
              via: "zerops-read",
              members: [ownerId],
              rows: [row],
            });
            sampledAt.set(scope, yield* Clock.currentTimeMillis);
            return yield* signal(scope, { kind: "baseline-committed" });
          }
          const items = detail?.zerops.items(answer.body);
          if (items === undefined) return yield* malformed;
          const rows = rowsOf(spec.family, items);
          yield* carryOut(
            store.dispatch({
              kind: "baseline-commit",
              scope,
              generation,
              via: "zerops-read",
              members: membersOf(items),
              rows,
              partial: partialAnswer(items, rows, undefined),
            }),
          );
          yield* signal(scope, { kind: "baseline-committed" });
        });

      /**
       * Every detail demanded now is read once in this attempt, and each one demanded later. One
       * whose own read failed is read again when its retry comes due; one refused is never read
       * again by itself — only the person's try again or a changed input moves it (to a new
       * generation), and then it is read again.
       */
      const observed = new Map<ScopeKey, number>();
      const inFlight = new Set<ScopeKey>();
      const wakes = yield* Queue.sliding<void>(1);
      const wake = () => Queue.offerUnsafe(wakes, undefined);
      const stopListening = demands.onChange(wake);
      wakeAttempt = wake;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          stopListening();
          if (wakeAttempt === wake) wakeAttempt = null;
        }),
      );
      const observeDemanded = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const demanded = new Set(demands.scopes());
        for (const scope of observed.keys())
          if (!demanded.has(scope)) {
            observed.delete(scope);
            dirtyDetails.delete(scope);
            yield* forgetQueries(scope);
          }
        // A write to a detail no longer demanded is read by its next demand anyway.
        for (const scope of written) if (!demanded.has(scope)) written.delete(scope);
        const fresh: Array<ScopeKey> = [];
        let wakeAt = Number.POSITIVE_INFINITY;
        for (const scope of demanded) {
          const renewed = demands.takeRenewal(scope);
          const navigation = scopeOf(scopeListing(scope).spec, orgId);
          const navigationPhase = streamOf(store.state(), navigation).phase;
          if (
            scopes.includes(navigation) &&
            navigationPhase !== "live" &&
            navigationPhase !== "refused"
          )
            continue;
          const stream = streamOf(store.state(), scope);
          if (stream.phase === "refused") continue;
          // A read that passed its deadline may still hang: its retry does not wait for it, and
          // its late answer is fenced out by the new generation.
          if (stream.phase === "recovering" && stream.next.kind === "retry") {
            if (stream.next.at > now) {
              wakeAt = Math.min(wakeAt, stream.next.at);
              continue;
            }
            yield* signal(scope, { kind: "retry-due" });
            fresh.push(scope);
            continue;
          }
          if (inFlight.has(scope)) continue;
          // Our write landed while its last read was under way: it is read once more, now.
          if (
            stream.phase === "live" &&
            (written.delete(scope) || (renewed && observed.has(scope)))
          ) {
            sampledAt.delete(scope);
            yield* signal(scope, { kind: "revalidate" });
            fresh.push(scope);
            continue;
          }
          // A sampled detail's revalidation comes due on its cadence while it stays demanded.
          if (stream.phase === "live" && stream.next.kind === "revalidate") {
            if (stream.next.at > now) wakeAt = Math.min(wakeAt, stream.next.at);
            else fresh.push(scope);
            continue;
          }
          const seen = observed.get(scope);
          if (
            seen === undefined ||
            dirtyDetails.has(scope) ||
            stream.phase === "stale" ||
            (stream.phase === "connecting" && stream.generation !== seen)
          )
            fresh.push(scope);
        }
        for (const scope of fresh) {
          inFlight.add(scope);
          dirtyDetails.delete(scope);
          yield* observeDetail(scope).pipe(
            Effect.catch(sessionEnds),
            Effect.ensuring(
              Effect.sync(() => {
                inFlight.delete(scope);
                observed.set(scope, streamOf(store.state(), scope).generation);
                wake();
              }),
            ),
            Effect.forkIn(attemptScope),
          );
        }
        return wakeAt;
      });
      /**
       * Each navigation family opens independently: updates first, then its membership baseline.
       * A slow family cannot hold back another family or its demanded details.
       */
      const registerNavigation = Effect.forEach(
        scopes,
        (scope) =>
          Effect.gen(function* () {
            yield* signal(scope, { kind: "attempt" });
            // A scope refused alone stays so until the person tries again: nothing registers it.
            if (streamOf(store.state(), scope).phase === "refused") {
              wake();
              return;
            }
            generations.set(scope, streamOf(store.state(), scope).generation);
            yield* signal(scope, { kind: "handshake" });
            store.dispatch({ kind: "baseline-begin", scope, generation: generationOf(scope) });
            const refusedAlone = scopeSpec(scope).zerops?.refusedAlone === true;
            for (const registration of registrations.filter((entry) => entry.scope === scope)) {
              const subscriptionName = options.makeId();
              subscriptions.set(subscriptionName, {
                ...registration,
                generation: generationOf(scope),
              });
              const answer = yield* link
                .post(registration.path, {
                  search: registration.search,
                  sort: [],
                  receiverId: link.receiverId,
                  subscriptionName,
                  ...(registration.role === "membership"
                    ? { wsOutputType: "listStream", limit: ORGANIZATION_SEARCH_LIMIT }
                    : { wsOutputType: "updateStream", disableOutput: true }),
                })
                .pipe(
                  Effect.catchIf(
                    (fault) =>
                      refusedAlone &&
                      (fault.outcome === "recoverable-session" ||
                        fault.outcome === "authoritative-denial"),
                    (fault) => Effect.succeed<RefusedAlone>({ refusedAlone: fault }),
                  ),
                );
              if (isRefusedAlone(answer)) {
                subscriptions.delete(subscriptionName);
                yield* signal(scope, {
                  kind: "fault",
                  fault: { outcome: "authoritative-denial", message: answer.refusedAlone.message },
                  jitter: 0,
                });
                break;
              }
              if (registration.role !== "membership") continue;
              const list = Option.getOrUndefined(decodeList(answer));
              if (list === undefined)
                return yield* Effect.fail(corrupt("A baseline answer is malformed."));
              const rows = rowsOf(registration.family, list.items);
              yield* carryOut(
                store.dispatch({
                  kind: "baseline-commit",
                  scope,
                  generation: generationOf(scope),
                  via: "zerops-realtime",
                  // Membership is every item's id: a damaged row keeps its member and its last value.
                  members: membersOf(list.items),
                  rows,
                  partial: partialAnswer(list.items, rows, list.totalHits),
                }),
              );
              yield* signal(scope, { kind: "baseline-committed" });
            }
            wake();
          }),
        { concurrency: "unbounded", discard: true },
      );
      const observeForever = Effect.forever(
        Effect.gen(function* () {
          const wakeAt = yield* observeDemanded;
          const now = yield* Clock.currentTimeMillis;
          yield* Number.isFinite(wakeAt)
            ? Effect.raceFirst(Queue.take(wakes), Effect.sleep(Math.max(0, wakeAt - now)))
            : Queue.take(wakes);
        }),
      );
      // Only details with a navigation scope wait for it; independent queries open at once.
      const details = yield* Effect.forkIn(observeForever, attemptScope);
      yield* Effect.raceAllFirst([
        Effect.gen(function* () {
          yield* registerNavigation;
          yield* signal(key, { kind: "baseline-committed" });
          wake();
          return yield* Effect.never;
        }),
        Fiber.join(frames),
        Fiber.join(details),
        Deferred.await(ended),
      ]);
      return yield* Effect.fail(corrupt("The receiver's socket closed."));
    });

  return {
    key,
    scopes,
    details: demands.scopes,
    attempt,
    // A detail the person tried again, or whose read passed its deadline: look at it now.
    childMoved: () => wakeAttempt?.(),
    demandDetail: (demand) => demands.hold(detailScopeOf(orgId, demand)),
    revalidate: (demand) => {
      const scope = detailScopeOf(orgId, demand);
      sampledAt.delete(scope);
      const { phase, mode } = streamOf(store.state(), scope);
      if (
        phase === "connecting" ||
        phase === "baselining" ||
        (phase === "live" && mode === "realtime")
      )
        written.add(scope);
      tellDetail(demand, { kind: "revalidate" });
    },
    retryDetail: (demand) => tellDetail(demand, { kind: "manual-retry" }),
    renew: (demand) => demands.renew(detailScopeOf(orgId, demand)),
  };
}
