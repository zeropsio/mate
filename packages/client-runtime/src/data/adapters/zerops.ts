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
 * its pongs go on (`zivost/probe-scoped`). A read the attempt makes that answers 401 ends the
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
import { linkKeys, type Family, type LinkKey, type ScopeKey } from "../model.ts";
import { streamOf, type Row, type RuntimeDirective } from "../reducer.ts";
import type { AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";
import type { LinkOptions } from "../supervisor.ts";

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

/** How an HTTP answer classifies; the wire applies it to every failed request. */
export function classifyHttp(status: number, retryAfterMs?: number): StreamFault {
  const message = `HTTP ${status}`;
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
  add: Schema.Array(Schema.String),
  delete: Schema.Array(Schema.String),
});
const UpdateData = Schema.Struct({ update: Schema.Array(Schema.Unknown) });
const ListAnswer = Schema.Struct({ items: Schema.Array(Schema.Unknown) });
/** A member's identity alone: a row too damaged to read still names its id. */
const Identified = Schema.Struct({ id: Schema.String });

const decodeFrame = Schema.decodeUnknownOption(Schema.fromJsonString(Frame));
const decodeMembership = Schema.decodeUnknownOption(MembershipData);
const decodeUpdates = Schema.decodeUnknownOption(UpdateData);
const decodeList = Schema.decodeUnknownOption(ListAnswer);
const decodeIdentified = Schema.decodeUnknownOption(Identified);

/** Each row its family decodes; a damaged row is refused alone, its neighbours admitted. */
function rowsOf(family: Family, raw: ReadonlyArray<unknown>): ReadonlyArray<Row> {
  const decode = familySpec(family).zerops?.decode;
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

const corrupt = (message: string): StreamFault => ({ outcome: "transient", message });

export function zeropsNavigationLink(options: {
  readonly orgId: string;
  readonly wire: ZeropsWire;
  readonly store: AccountStore;
  /** A fresh subscription name. */
  readonly makeId: () => string;
}): Pick<LinkOptions, "key" | "scopes" | "details" | "attempt"> & {
  /** A screen's hold on a detail; the release lets it go once no screen holds it. */
  readonly demandDetail: (demand: DetailDemand) => () => void;
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
       * The runtime work a reduction asks for, run beside the frames, never blocking them. A read
       * the credential no longer passes ends the attempt; any other failure leaves it to the next
       * baseline.
       */
      const carryOut = (directives: ReadonlyArray<RuntimeDirective>): Effect.Effect<void> =>
        Effect.forEach(directives, (directive) => {
          if (directive.kind === "resolve-rows") return resolveRows(directive.key, directive.ids);
          if (directive.kind === "verify-absence")
            return Effect.forEach(
              directive.ids,
              (id) => verifyAbsence(familyOf(directive.key), id),
              { discard: true },
            );
          return Effect.void;
        }).pipe(
          Effect.catch((fault) =>
            fault.outcome === "recoverable-session" || fault.outcome === "authoritative-denial"
              ? Deferred.fail(ended, fault)
              : Effect.void,
          ),
          Effect.forkIn(attemptScope),
          Effect.asVoid,
        );

      const resolveRows = (
        scope: ScopeKey,
        ids: ReadonlyArray<string>,
      ): Effect.Effect<void, StreamFault> =>
        Effect.gen(function* () {
          const family = familyOf(scope);
          const entity = familySpec(family).zerops?.entity;
          if (entity === undefined) return;
          const answer = yield* link.post(`/${entity}/search`, {
            search: [
              { name: "clientId", operator: "eq", value: orgId },
              { name: "id", operator: "in", value: ids },
            ],
            sort: [],
            limit: ids.length,
          });
          const items = Option.getOrUndefined(decodeList(answer))?.items ?? [];
          yield* carryOut(
            store.dispatch({
              kind: "rows",
              scope,
              generation: generationOf(scope),
              method: "read",
              via: "zerops-read",
              rows: rowsOf(family, items),
            }),
          );
        });

      /** A member gone from its scope: deleted, or no longer the viewer's — the owner says. */
      const verifyAbsence = (family: Family, id: string): Effect.Effect<void, StreamFault> =>
        Effect.gen(function* () {
          const path = familySpec(family).zerops?.verifyPath?.(id);
          if (path === undefined) return;
          const { status } = yield* link.get(path);
          if (status === 404)
            store.dispatch({
              kind: "proven-deletion",
              family,
              id,
              evidence: `GET ${path} answered 404`,
            });
          else if (status === 403) {
            store.dispatch({ kind: "access", family, id, access: "denied" });
            // The viewer's access changed; what else it took, only a fresh baseline says.
            yield* Deferred.fail(ended, {
              outcome: "transient",
              message: "The viewer's access changed: every scope is registered again.",
            });
          }
        });

      const subscriptions = new Map<string, Registration>();
      const onFrame = (encoded: string): Effect.Effect<void> =>
        Effect.suspend(() => {
          const frame = Option.getOrUndefined(decodeFrame(encoded));
          if (frame === undefined || frame.type !== "search") return Effect.void;
          const registration = subscriptions.get(frame.subscriptionName ?? "");
          if (registration === undefined) return Effect.void;
          const { scope } = registration;
          if (registration.role === "membership") {
            const delta = Option.getOrUndefined(decodeMembership(frame.data));
            if (delta === undefined) return Effect.void;
            return carryOut(
              store.dispatch({
                kind: "membership",
                scope,
                generation: generationOf(scope),
                delta: { add: delta.add, remove: delta.delete },
              }),
            );
          }
          const updates = Option.getOrUndefined(decodeUpdates(frame.data));
          if (updates === undefined) return Effect.void;
          return carryOut(
            store.dispatch({
              kind: "rows",
              scope,
              generation: generationOf(scope),
              method: "push",
              via: "zerops-realtime",
              rows: rowsOf(registration.family, updates.update),
            }),
          );
        });

      yield* signal(key, { kind: "handshake" });
      yield* signal(key, { kind: "baseline-committed" });
      const reading = yield* Effect.forkIn(Stream.runForEach(link.frames, onFrame), attemptScope);

      for (const scope of scopes) {
        yield* signal(scope, { kind: "attempt" });
        generations.set(scope, streamOf(store.state(), scope).generation);
        yield* signal(scope, { kind: "handshake" });
        store.dispatch({ kind: "baseline-begin", scope, generation: generationOf(scope) });
        for (const registration of registrations.filter((entry) => entry.scope === scope)) {
          const subscriptionName = options.makeId();
          subscriptions.set(subscriptionName, registration);
          const answer = yield* link.post(registration.path, {
            search: registration.search,
            sort: [],
            receiverId: link.receiverId,
            subscriptionName,
            ...(registration.role === "membership"
              ? { wsOutputType: "listStream", limit: ORGANIZATION_SEARCH_LIMIT }
              : { wsOutputType: "updateStream", disableOutput: true }),
          });
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
              members: list.items.flatMap((item) =>
                Option.match(decodeIdentified(item), {
                  onNone: () => [],
                  onSome: ({ id }) => [id],
                }),
              ),
              rows,
            }),
          );
          yield* signal(scope, { kind: "baseline-committed" });
        }
      }
      /**
       * One demanded detail listing, read while the receiver is up: its answer is the scope's
       * baseline. The owner refusing that one read refuses that scope alone; a failure the link
       * would recover from ends the attempt, and the next one reads every demanded detail again.
       */
      const observeDetail = (scope: ScopeKey): Effect.Effect<void, StreamFault> =>
        Effect.gen(function* () {
          const { spec, detail } = scopeListing(scope);
          if (detail === null) return;
          yield* signal(scope, { kind: "attempt" });
          generations.set(scope, streamOf(store.state(), scope).generation);
          yield* signal(scope, { kind: "handshake" });
          store.dispatch({ kind: "baseline-begin", scope, generation: generationOf(scope) });
          const ownerId = scope.split(":").slice(3).join(":");
          const answer = yield* link.get(detail.zerops.path({ orgId, ownerId })).pipe(
            Effect.map((read) =>
              read.status === 403
                ? classifyHttp(403)
                : read.status === 404
                  ? classifyHttp(404)
                  : read,
            ),
            Effect.catchIf(
              (fault) =>
                fault.outcome === "definitive-refusal" || fault.outcome === "authoritative-denial",
              Effect.succeed,
            ),
          );
          if ("outcome" in answer)
            return yield* signal(scope, { kind: "fault", fault: answer, jitter: 0 });
          const items = detail.zerops.items(answer.body);
          if (items === undefined)
            return yield* Effect.fail(corrupt("A detail baseline answer is malformed."));
          yield* carryOut(
            store.dispatch({
              kind: "baseline-commit",
              scope,
              generation: generationOf(scope),
              via: "zerops-read",
              members: items.flatMap((item) =>
                Option.match(decodeIdentified(item), {
                  onNone: () => [],
                  onSome: ({ id }) => [id],
                }),
              ),
              rows: rowsOf(spec.family, items),
            }),
          );
          yield* signal(scope, { kind: "baseline-committed" });
        });

      // Every detail demanded now is read once in this attempt, and each one demanded later.
      const observed = new Set<ScopeKey>();
      const changes = yield* Queue.unbounded<void>();
      const stopListening = demands.onChange(() => Queue.offerUnsafe(changes, undefined));
      yield* Effect.addFinalizer(() => Effect.sync(stopListening));
      const observeDemanded = Effect.suspend(() => {
        const demanded = new Set(demands.scopes());
        for (const scope of observed) if (!demanded.has(scope)) observed.delete(scope);
        // A scope let go and held again before this ran is stale again: it is read again too.
        const fresh = [...demanded].filter(
          (scope) => !observed.has(scope) || streamOf(store.state(), scope).phase === "stale",
        );
        for (const scope of fresh) observed.add(scope);
        return Effect.forEach(fresh, observeDetail, { concurrency: "unbounded", discard: true });
      });
      yield* Effect.raceAllFirst([
        Fiber.join(reading),
        Effect.forever(Effect.andThen(observeDemanded, Queue.take(changes))),
        Deferred.await(ended),
      ]);
      return yield* Effect.fail(corrupt("The receiver's socket closed."));
    });

  return {
    key,
    scopes,
    details: demands.scopes,
    attempt,
    demandDetail: (demand) => demands.hold(detailScopeOf(orgId, demand)),
  };
}
