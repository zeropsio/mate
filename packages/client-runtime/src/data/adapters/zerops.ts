/**
 * Zerops, a fixed source (HANDOFF §4.2): one receiver per account, organization and renderer
 * carries the organization's navigation registrations (`demand.ts`). An attempt opens the
 * receiver, starts reading frames before it registers anything, then registers each scope —
 * updates first — and commits the membership answer as that scope's baseline. Frames that arrive
 * while a baseline is read are staged by the reducer and replayed after it. After an outage
 * nothing is replayed by Zerops: the next attempt registers again and its answers are the truth;
 * what went missing meanwhile is not invented.
 *
 * The adapter only translates and classifies. It never retries: an attempt ends by failing, and the
 * supervisor decides what follows.
 *
 * @module data/adapters/zerops
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { ORGANIZATION_SEARCH_LIMIT, zeropsNavigation, type Registration } from "../demand.ts";
import { scopeKeys, type LinkKey, type ScopeKey } from "../model.ts";
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

/** How an HTTP answer classifies (HANDOFF §4.3); the wire applies it to every failed request. */
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

const ProjectRow = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  _version: Schema.optionalKey(Schema.Number),
});
const ProcessRow = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  status: Schema.String,
  actionName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  _version: Schema.optionalKey(Schema.Number),
});
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

const decodeProjectRow = Schema.decodeUnknownOption(ProjectRow);
const decodeProcessRow = Schema.decodeUnknownOption(ProcessRow);
const decodeFrame = Schema.decodeUnknownOption(Schema.fromJsonString(Frame));
const decodeMembership = Schema.decodeUnknownOption(MembershipData);
const decodeUpdates = Schema.decodeUnknownOption(UpdateData);
const decodeList = Schema.decodeUnknownOption(ListAnswer);
const decodeIdentified = Schema.decodeUnknownOption(Identified);

/** Each row that decodes; a damaged row is refused alone, its neighbours admitted (corrupt data). */
function rowsOf(family: Registration["family"], raw: ReadonlyArray<unknown>): ReadonlyArray<Row> {
  return raw.flatMap((input): Row[] => {
    if (family === "project")
      return Option.match(decodeProjectRow(input), {
        onNone: () => [],
        onSome: (row) => [
          {
            family: "project",
            id: row.id,
            value: { id: row.id, name: row.name ?? "", status: row.status ?? "" },
            revision: { kind: "zerops", version: row._version ?? null },
          },
        ],
      });
    return Option.match(decodeProcessRow(input), {
      onNone: () => [],
      onSome: (row) => [
        {
          family: "process",
          id: row.id,
          value: {
            id: row.id,
            projectId: row.projectId,
            status: row.status,
            actionName: row.actionName ?? null,
          },
          revision: { kind: "zerops", version: row._version ?? null },
        },
      ],
    });
  });
}

const corrupt = (message: string): StreamFault => ({ outcome: "transient", message });

export function zeropsNavigationLink(options: {
  readonly orgId: string;
  readonly wire: ZeropsWire;
  readonly store: AccountStore;
  /** A fresh subscription name. */
  readonly makeId: () => string;
}): Pick<LinkOptions, "key" | "scopes" | "attempt"> {
  const { orgId, store } = options;
  const key: LinkKey = scopeKeys.zeropsLink(orgId);
  const registrations = zeropsNavigation(orgId);
  const scopes: ReadonlyArray<ScopeKey> = [scopeKeys.projects(orgId), scopeKeys.running(orgId)];
  const familyOf = (scope: ScopeKey) =>
    registrations.find((registration) => registration.scope === scope)?.family ?? "project";

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

      /** The runtime work a reduction asks for, run beside the frames, never blocking them. */
      const carryOut = (directives: ReadonlyArray<RuntimeDirective>): Effect.Effect<void> =>
        Effect.forEach(directives, (directive) => {
          if (directive.kind === "resolve-rows") return resolveRows(directive.key, directive.ids);
          if (directive.kind === "verify-absence")
            return Effect.forEach(directive.ids, verifyAbsence, { discard: true });
          return Effect.void;
        }).pipe(Effect.ignore, Effect.forkIn(attemptScope), Effect.asVoid);

      const resolveRows = (
        scope: ScopeKey,
        ids: ReadonlyArray<string>,
      ): Effect.Effect<void, StreamFault> =>
        Effect.gen(function* () {
          const family = familyOf(scope);
          const answer = yield* link.post(`/${family}/search`, {
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

      /** A project gone from the roster: deleted, or no longer the viewer's — the owner says. */
      const verifyAbsence = (id: string): Effect.Effect<void, StreamFault> =>
        Effect.gen(function* () {
          const { status } = yield* link.get(`/project/${encodeURIComponent(id)}`);
          if (status === 404)
            store.dispatch({
              kind: "proven-deletion",
              family: "project",
              id,
              evidence: `GET /project/${id} answered 404`,
            });
          else if (status === 403)
            store.dispatch({ kind: "access", family: "project", id, access: "denied" });
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
      yield* Fiber.join(reading);
      return yield* Effect.fail(corrupt("The receiver's socket closed."));
    });

  return { key, scopes, attempt };
}
