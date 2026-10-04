// @effect-diagnostics nodeBuiltinImport:off -- a stream ticket is 256 bits from the system's CSPRNG.
/**
 * A caller's structure over a WebSocket (KONCEPT §3 rule 4: the whole state, then changes by key;
 * after a break, the whole state again). JSON messages:
 *
 * - `{ type: "snapshot", can, ungrouped, apps, changes, appReads, mates, people, rolesAnsweredAt }`
 *   — what `GET /api/structure` answers, with what the caller may do with the organization, each
 *   application and each environment (`can`, `offers.ts`); beside it when Zerops answered the org
 *   view those offers are decided over, and the changes of every application the caller may read
 *   them of, by application id (`@t3tools/shared/hqChanges` `ChangesSnapshot`), and where each of
 *   those applications' releases, repository heads and stage/production recipes (`hqAppReads`); and
 *   every Mate the caller may observe (`observe_mate`) as HQ holds it, by project, with the people
 *   the view names (`@t3tools/shared/hqMates`);
 * - `{ type: "changes", appId, changes }` — one application's changes as the caller now reads them
 *   (`changes: null` once they no longer may), sent before the structure's own changes of a tick;
 * - `{ type: "release-revision", appId, read }` — one application's releases or repositories
 *   moved, with their fresh load data (`read: null` once access ends), after its changes;
 * - `{ type: "change", key, value }` — one application by id as the caller now sees it (`value:
 *   null` once it is gone from their view), or, under the key `ungrouped`, the whole list of the
 *   Mates in no application;
 * - `{ type: "org", can, rolesAnsweredAt }` — what the caller may do with the organization, and
 *   when Zerops answered the view its offers are decided over, whenever either moves;
 * - `{ type: "mate", projectId, value }` — what changed of one Mate the caller observes: its
 *   presence, or any section of its overview, each whole; `value: null` once they no longer may;
 * - `{ type: "people", people }` — the people the view names, whenever they differ: its Mates'
 *   makers and stand-up askers, their logins' signers, and whoever an `OWNER` entry names on its
 *   projects, each by user id with their member id — never a token;
 * - `{ type: "ping" }` every 20 s, so the Zerops L7 (which cuts an idle connection at 60 s) never
 *   sees one; the client answers `{ type: "pong" }`. Any message counts: a client silent through
 *   three pings is closed (4408).
 *
 * The view is computed again after every change of the structure, of a change, of a release or of
 * a deploy, of the org's view as Zerops answers it (`Roles.views`), and every 30 s: a role change
 * reaches an open socket as soon as HQ reads it, within 30 s (SPEC §4). A Mate's overview moving reads no structure: its Mates are sent from what HQ
 * holds (`mateOverviews.ts`), to the callers whose last view lets them observe it, at most once per
 * `MATES_BATCH`. The socket closes
 * with `4410` ("segment over") at 100 s: the client opens the next segment at once, keeping its
 * live view until that segment's snapshot. It closes with `4401` when the caller's session ends
 * (sign in again), `1001` when this Core stops leading or shuts down, `1011` when the view cannot be read. These endings require a manual again.
 *
 * A browser cannot set headers on a WebSocket: it opens one with a ticket minted for its session
 * (`POST /api/stream-ticket`): one use, 60 s, held in this Core's memory.
 *
 * @module stream
 */
import * as NodeCrypto from "node:crypto";

import { HQ_STREAM_SEGMENT_CLOSE } from "@t3tools/shared/hqStream";
import type { ChangesMessage, ChangesSnapshot } from "@t3tools/shared/hqChanges";
import type { AppRead, AppReads, ReleaseRevisionMessage } from "@t3tools/shared/hqAppReads";
import type {
  HqMatesMessage,
  HqMatesSnapshot,
  HqPeople,
  MateLiveChange,
} from "@t3tools/shared/hqMates";
import { can } from "@t3tools/shared/zeropsPermissions";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as Socket from "effect/unstable/socket/Socket";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { Changes } from "./changes.ts";
import { Deploys } from "./deploys.ts";
import { type MateOverviewEntry, MateOverviews } from "./mateOverviews.ts";
import { Recomputes } from "./recomputes.ts";
import { Releases } from "./releases.ts";
import { type OrgView, Roles } from "./roles.ts";
import { Structure, type StructureRead } from "./structure.ts";
import type { ZeropsError, ZeropsMember } from "./zerops/api.ts";

export interface StreamOptions {
  readonly recheck?: Duration.Duration;
  readonly pingEvery?: Duration.Duration;
}

/** Why an open view ends: the caller's session, or this Core's lead. */
export type Ending = "session" | "lead";

type Outgoing = StructureMessage | { readonly type: "end"; readonly ending: Ending };

export type StructureMessage =
  | ({
      readonly type: "snapshot";
      readonly changes: ChangesSnapshot;
      readonly appReads: AppReads;
      /** When Zerops answered the org view its offers are decided over (ISO 8601); none yet. */
      readonly rolesAnsweredAt: string | null;
    } & StructureRead &
      HqMatesSnapshot)
  | ChangesMessage
  | ReleaseRevisionMessage
  | { readonly type: "change"; readonly key: string; readonly value: unknown }
  | {
      readonly type: "org";
      readonly can: StructureRead["can"];
      readonly rolesAnsweredAt: string | null;
    }
  | HqMatesMessage;

/** The key of the Mates in no application; an application's key is its id, never this. */
const UNGROUPED = "ungrouped";

/** How long a caller's Mates' moves are gathered before they go out together. */
export const MATES_BATCH = Duration.millis(500);

/**
 * Zerops cuts a WebSocket through a project's shared IPv4 120 s after open, busy or not
 * (`docs/internals/zerops/verified.md`, "A WebSocket through a project's shared IPv4 is cut
 * 120 s after it opens"). End each segment cleanly before that cut.
 */
export const STRUCTURE_SEGMENT_LIFETIME = Duration.seconds(100);

const CLOSE = {
  session: [4401, "session ended"],
  lead: [1001, "going away"],
  unreadable: [1011, "the view could not be read"],
  silent: [4408, "no pong"],
} as const;

const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** A Mate's parts as a caller is sent them: its presence, and its overview's sections. */
const partsOf = (entry: MateOverviewEntry): Record<string, unknown> => ({
  presence: entry.presence,
  ...entry.overview,
});

const encodedParts = (entry: MateOverviewEntry) =>
  new Map(Object.entries(partsOf(entry)).map(([part, value]) => [part, toJson(value)]));

/** Every Mate the view lists, by project, with its record. */
const matesIn = (view: StructureRead) => [
  ...view.ungrouped.map(({ projectId, mate }) => ({ projectId, mate })),
  ...view.apps.flatMap((app) =>
    app.projects.flatMap(({ projectId, mate }) => (mate === null ? [] : [{ projectId, mate }])),
  ),
];

/**
 * The people of `userIds` among the members HQ last read, each with their member id — what a
 * project's `OWNER` entry names them by: never a token.
 */
const peopleOf = (userIds: ReadonlySet<string>, members: ReadonlyArray<ZeropsMember>): HqPeople =>
  Object.fromEntries(
    members
      .filter((member) => member.kind === "person" && userIds.has(member.userId))
      .map((member) => [member.userId, { name: member.name, clientUserId: member.clientUserId }]),
  );

/**
 * Whoever an `OWNER` entry names on the projects of `view` — a hand-over's owner (F23) — by their
 * Zerops user id, as the members HQ last read have them.
 */
const ownersIn = (view: StructureRead, facts: OrgView): ReadonlyArray<string> => {
  const listed = new Set([
    ...view.ungrouped.map(({ projectId }) => projectId),
    ...view.apps.flatMap((app) => app.projects.map(({ projectId }) => projectId)),
  ]);
  const owners = new Set(
    facts.projects
      .filter((project) => listed.has(project.id))
      .flatMap((project) =>
        project.userRoles.flatMap((entry) =>
          entry.roleCode === "OWNER" ? [entry.clientUserId] : [],
        ),
      ),
  );
  return facts.members.flatMap((member) =>
    owners.has(member.clientUserId) ? [member.userId] : [],
  );
};

/** What a caller was last sent. */
interface Sent {
  /** What they may do with the organization, and when Zerops answered its view, encoded. */
  readonly org: string;
  readonly structure: ReadonlyMap<string, string>;
  readonly changes: ReadonlyMap<string, string>;
  /** Each readable application's release revision, encoded. */
  readonly revisions: ReadonlyMap<string, string>;
  readonly appReads: AppReads;
  /** The Mates the caller's last view lets them observe. */
  readonly observable: ReadonlySet<string>;
  /** The people the last view's records name. */
  readonly named: ReadonlySet<string>;
  /** Each observed Mate's parts, encoded. */
  readonly mates: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly people: string;
}

/**
 * The messages of `userId`'s view until `ending` says why it ends. Every change of the structure,
 * of a change, of a release or of a deploy, and every `recheck`, computes the view again; what differs from the last one sent goes out by key.
 * A Mate's overview moving goes out from what HQ holds of it, gathered for `batch`.
 */
export const structureMessages = <R>(
  userId: string,
  ending: Effect.Effect<Ending | undefined, never, R>,
  recheck: Duration.Duration,
  batch: Duration.Duration = MATES_BATCH,
): Stream.Stream<
  Outgoing,
  SqlError | ZeropsError,
  Structure | Changes | Releases | Deploys | MateOverviews | Roles | R
> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const structure = yield* Structure;
      const changes = yield* Changes;
      const releases = yield* Releases;
      const deploys = yield* Deploys;
      const overviews = yield* MateOverviews;
      const roles = yield* Roles;
      const person = { kind: "person", userId } as const;
      const one = yield* Semaphore.make(1);
      /** When Zerops answered the last view HQ read of the org, as `roles.views` said it. */
      const answered = yield* Ref.make<number | null>(null);
      const sent = yield* Ref.make<Sent | undefined>(undefined);
      /** The keys whose value differs between what was sent and what is now. */
      const differing = (before: ReadonlyMap<string, string>, now: ReadonlyMap<string, string>) =>
        [...new Set([...before.keys(), ...now.keys()])].filter(
          (key) => before.get(key) !== now.get(key),
        );
      /** What changed of one Mate since `before`; none when nothing did. */
      const mateMessage = (
        projectId: string,
        entry: MateOverviewEntry | undefined,
        before: ReadonlyMap<string, string> | undefined,
      ): Outgoing | undefined => {
        if (entry === undefined) {
          return before === undefined ? undefined : { type: "mate", projectId, value: null };
        }
        const parts = partsOf(entry);
        const moved = differing(before ?? new Map(), encodedParts(entry));
        return moved.length === 0
          ? undefined
          : {
              type: "mate",
              projectId,
              value: Object.fromEntries(moved.map((part) => [part, parts[part]])) as MateLiveChange,
            };
      };
      /** The people a view names: its records' and owners, and its observed Mates' signers. */
      const namedBy = (named: ReadonlySet<string>, mates: ReadonlyMap<string, MateOverviewEntry>) =>
        new Set([
          ...named,
          ...[...mates.values()].flatMap((entry) =>
            Object.values(entry.overview?.logins ?? {}).flatMap((login) =>
              [login.signedInBy, login.lastSignedInBy].filter(
                (id): id is string => typeof id === "string" && id.length > 0,
              ),
            ),
          ),
        ]);
      const observed = (
        observable: ReadonlySet<string>,
        all: ReadonlyMap<string, MateOverviewEntry>,
      ) =>
        new Map(
          [...observable].flatMap((projectId) => {
            const entry = all.get(projectId);
            return entry === undefined ? [] : [[projectId, entry] as const];
          }),
        );

      const structureTick = Effect.gen(function* (): Generator<
        Effect.Effect<unknown, SqlError | ZeropsError, R>,
        ReadonlyArray<Outgoing>,
        unknown
      > {
        const ends = yield* ending;
        if (ends !== undefined) return [{ type: "end" as const, ending: ends }];
        yield* (yield* Recomputes).count;
        const view = yield* structure.read(userId);
        const answeredAt = yield* Ref.get(answered);
        const rolesAnsweredAt =
          answeredAt === null ? null : DateTime.formatIso(DateTime.makeUnsafe(answeredAt));
        const readable = yield* changes.readable(userId);
        const moved = yield* changes.releaseRevisions;
        const before = yield* Ref.get(sent);
        const appReads: Record<string, AppRead> = {};
        for (const appId of Object.keys(readable)) {
          const revision = moved.get(appId) ?? null;
          const kept = before?.appReads[appId];
          if (kept !== undefined && kept.revision === revision) {
            appReads[appId] = kept;
            continue;
          }
          appReads[appId] = yield* Effect.gen(function* () {
            const records = yield* releases.list(userId, appId);
            const repos = yield* changes.listRepos(userId, appId);
            const stage = yield* changes.readRecipe(userId, appId, "stage");
            const production = yield* changes.readRecipe(userId, appId, "production");
            return {
              revision,
              value: { releases: records, repos, recipes: { stage, production } },
              failure: null,
            };
          }).pipe(
            Effect.catchTags({
              ChangeRefused: (error) =>
                Effect.succeed({
                  revision,
                  value: null,
                  failure: { code: error.code, reason: error.reason },
                }),
              ReleaseRefused: (error) =>
                Effect.succeed({
                  revision,
                  value: null,
                  failure: { code: error.code, reason: error.reason },
                }),
              GitError: (error) =>
                Effect.succeed({
                  revision,
                  value: null,
                  failure: { code: "repo_unavailable", reason: error.reason },
                }),
              NotLeader: (error) =>
                Effect.succeed({
                  revision,
                  value: null,
                  failure: { code: "not_active", reason: error.reason },
                }),
            }),
          );
        }
        const facts = yield* roles.view;
        const listed = matesIn(view);
        const observable = new Set(
          listed
            .filter(({ projectId }) => can(person, "observe_mate", { projectId }, facts).allow)
            .map(({ projectId }) => projectId),
        );
        const mates = observed(observable, yield* overviews.all);
        const named = new Set([
          ...listed.flatMap(({ mate }) =>
            [mate.madeBy, mate.standupRequestedBy].flatMap((id) => (id === null ? [] : [id])),
          ),
          ...ownersIn(view, facts),
        ]);
        const people = peopleOf(namedBy(named, mates), facts.members);
        const now: Sent = {
          org: toJson({ can: view.can, rolesAnsweredAt }),
          structure: new Map([
            [UNGROUPED, toJson(view.ungrouped)],
            ...view.apps.map((app): [string, string] => [app.id, toJson(app)]),
          ]),
          changes: new Map(
            Object.entries(readable).map(([appId, list]): [string, string] => [
              appId,
              toJson(list),
            ]),
          ),
          revisions: new Map(
            Object.entries(appReads).map(([appId, read]): [string, string] => [
              appId,
              toJson(read.revision),
            ]),
          ),
          appReads,
          observable,
          named,
          mates: new Map([...mates].map(([projectId, entry]) => [projectId, encodedParts(entry)])),
          people: toJson(people),
        };
        yield* Ref.set(sent, now);
        if (before === undefined) {
          return [
            {
              type: "snapshot" as const,
              ...view,
              rolesAnsweredAt,
              changes: readable,
              appReads,
              mates: Object.fromEntries(
                [...mates].map(([projectId, entry]) => [projectId, partsOf(entry)]),
              ) as HqMatesSnapshot["mates"],
              people,
            },
          ];
        }
        return [
          ...differing(before.changes, now.changes).map((appId): Outgoing => ({
            type: "changes",
            appId,
            changes: readable[appId] ?? null,
          })),
          ...differing(before.revisions, now.revisions).map((appId): Outgoing => ({
            type: "release-revision",
            appId,
            read: appReads[appId] ?? null,
          })),
          ...differing(before.structure, now.structure).map((key): Outgoing => ({
            type: "change",
            key,
            value:
              key === UNGROUPED
                ? view.ungrouped
                : (view.apps.find((app) => app.id === key) ?? null),
          })),
          ...(now.org === before.org
            ? []
            : [{ type: "org" as const, can: view.can, rolesAnsweredAt }]),
          ...[...new Set([...before.mates.keys(), ...mates.keys()])].flatMap((projectId) => {
            const message = mateMessage(
              projectId,
              mates.get(projectId),
              before.mates.get(projectId),
            );
            return message === undefined ? [] : [message];
          }),
          ...(now.people === before.people ? [] : [{ type: "people" as const, people }]),
        ];
      });

      const matesTick = (projectIds: ReadonlyArray<string>) =>
        Effect.gen(function* (): Generator<
          Effect.Effect<unknown, ZeropsError, R>,
          ReadonlyArray<Outgoing>,
          unknown
        > {
          const before = yield* Ref.get(sent);
          // Before the snapshot, nothing: the snapshot carries every Mate as it stands.
          if (before === undefined) return [];
          const ends = yield* ending;
          if (ends !== undefined) return [{ type: "end" as const, ending: ends }];
          const all = yield* overviews.all;
          const touched = [...new Set(projectIds)].filter((projectId) =>
            before.observable.has(projectId),
          );
          const mates = new Map(before.mates);
          const messages: Array<Outgoing> = [];
          for (const projectId of touched) {
            const entry = all.get(projectId);
            const message = mateMessage(projectId, entry, before.mates.get(projectId));
            if (message !== undefined) messages.push(message);
            if (entry === undefined) mates.delete(projectId);
            else mates.set(projectId, encodedParts(entry));
          }
          const people = peopleOf(
            namedBy(before.named, observed(before.observable, all)),
            (yield* roles.view).members,
          );
          const encodedPeople = toJson(people);
          if (encodedPeople !== before.people) messages.push({ type: "people", people });
          yield* Ref.set(sent, { ...before, mates, people: encodedPeople });
          return messages;
        });

      return Stream.merge(
        Stream.merge(
          Stream.merge(structure.changes, Stream.merge(changes.changes, releases.changes)),
          Stream.merge(
            Stream.merge(deploys.changes, Stream.tick(recheck)),
            // A view Zerops answered moves the offers at once, not on the next recheck.
            roles.views.pipe(Stream.tap((seen) => Ref.set(answered, seen.answered))),
          ),
        ).pipe(Stream.mapEffect(() => one.withPermits(1)(structureTick))),
        overviews.changes.pipe(
          Stream.groupedWithin(Number.MAX_SAFE_INTEGER, batch),
          Stream.mapEffect((projectIds) => one.withPermits(1)(matesTick(projectIds))),
        ),
      ).pipe(
        Stream.flatMap((messages) => Stream.fromIterable(messages)),
        Stream.takeUntil((message) => message.type === "end"),
      );
    }),
  );

export class LiveSockets extends Context.Service<
  LiveSockets,
  {
    /** Registers an open socket's close for the scope's lifetime. */
    readonly track: (
      close: (code: number, reason: string) => Effect.Effect<void>,
    ) => Effect.Effect<void, never, Scope.Scope>;
    /** Closes every open socket: on shutdown, `1001` sends each client to the next Core. */
    readonly closeAll: (code: number, reason: string) => Effect.Effect<void>;
  }
>()("@t3tools/hq/stream/LiveSockets") {}

export const liveSocketsLayer = Layer.sync(LiveSockets, () => {
  const open = new Set<(code: number, reason: string) => Effect.Effect<void>>();
  return LiveSockets.of({
    track: (close) =>
      Effect.acquireRelease(
        Effect.sync(() => open.add(close)),
        () => Effect.sync(() => open.delete(close)),
      ),
    closeAll: (code, reason) =>
      Effect.forEach([...open], (close) => close(code, reason), { discard: true }),
  });
});

/** Who ended a socket, and with what code: a cut on the way reaches HQ as the client's `1006`. */
export interface SocketEnding {
  readonly by: "client" | "hq";
  readonly code: number;
}

/**
 * Keeps how a socket ends, the first ending winning: `close` sends HQ's close as HQ's ending, and
 * `heardClose` takes a failed read as the client's, with its close's code. `ending` is either, or
 * HQ's `1000` where what it served simply ran out.
 */
export const socketEnding = (writer: Socket.Writer) =>
  Effect.map(Ref.make<SocketEnding | undefined>(undefined), (ended) => {
    const endBy = (ending: SocketEnding) => Ref.update(ended, (held) => held ?? ending);
    return {
      close: (code: number, reason: string) =>
        Effect.andThen(
          endBy({ by: "hq", code }),
          writer.write(new Socket.CloseEvent(code, reason)).pipe(Effect.ignore),
        ),
      heardClose: (error: Socket.SocketError) =>
        endBy({
          by: "client",
          code: error.reason._tag === "SocketCloseError" ? error.reason.code : 1006,
        }),
      ending: Effect.map(Ref.get(ended), (held): SocketEnding => held ?? { by: "hq", code: 1000 }),
    };
  });

/**
 * Serves `messages` on `socket` with the ping and the close codes above, until either side ends;
 * says which side ended it.
 */
export const serveStructureSocket = <R>(
  socket: Socket.Socket,
  messages: Stream.Stream<Outgoing, SqlError | ZeropsError, R>,
  pingEvery: Duration.Duration,
): Effect.Effect<SocketEnding, Socket.SocketError, LiveSockets | R> =>
  Effect.scoped(
    Effect.gen(function* () {
      const writer = yield* socket.writer;
      const reader = yield* socket.reader;
      const ends = yield* socketEnding(writer);
      const close = ([code, reason]: readonly [number, string]) => ends.close(code, reason);
      yield* (yield* LiveSockets).track(ends.close);
      const heard = yield* Ref.make(yield* Clock.currentTimeMillis);
      const listen = Effect.forever(
        Effect.andThen(
          reader.pull,
          Effect.flatMap(Clock.currentTimeMillis, (now) => Ref.set(heard, now)),
        ),
      ).pipe(Effect.catch(ends.heardClose));
      const ping = Effect.gen(function* () {
        for (;;) {
          yield* Effect.sleep(pingEvery);
          const silentFor = (yield* Clock.currentTimeMillis) - (yield* Ref.get(heard));
          if (silentFor > 3 * Duration.toMillis(pingEvery)) return yield* close(CLOSE.silent);
          yield* writer.write(toJson({ type: "ping" }));
        }
      }).pipe(Effect.ignore);
      const deliver = Stream.runForEach(messages, (message) =>
        message.type === "end" ? close(CLOSE[message.ending]) : writer.write(toJson(message)),
      ).pipe(Effect.catch(() => close(CLOSE.unreadable)));
      const segment = Effect.andThen(
        Effect.sleep(STRUCTURE_SEGMENT_LIFETIME),
        ends.close(HQ_STREAM_SEGMENT_CLOSE.code, HQ_STREAM_SEGMENT_CLOSE.reason),
      );
      yield* Effect.raceAll([listen, ping, deliver, segment]);
      return yield* ends.ending;
    }),
  );

/** One-use tickets for a socket a client opens without headers: 60 s, held in this Core's memory. */
export interface Tickets {
  /** A ticket for `holder` (a person's session, a Mate's credential). */
  readonly mint: (holder: string) => Effect.Effect<{ readonly ticket: string }>;
  /** The holder a live, unused ticket was minted for; the ticket is spent. */
  readonly take: (ticket: string) => Effect.Effect<Option.Option<string>>;
}

/** Tickets for a person's structure socket, minted for their session. */
export class StreamTickets extends Context.Service<StreamTickets, Tickets>()(
  "@t3tools/hq/stream/StreamTickets",
) {}

/** Tickets for a Mate's link, minted for its credential (`link.ts`). */
export class MateLinkTickets extends Context.Service<MateLinkTickets, Tickets>()(
  "@t3tools/hq/stream/MateLinkTickets",
) {}

const TICKET_TTL_MS = 60_000;

const makeTickets = (): Tickets => {
  const tickets = new Map<string, { readonly holder: string; readonly until: number }>();
  const hashOf = (ticket: string) => NodeCrypto.createHash("sha256").update(ticket).digest("hex");
  return {
    mint: (holder) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        for (const [key, entry] of tickets) if (entry.until <= now) tickets.delete(key);
        const ticket = NodeCrypto.randomBytes(32).toString("base64url");
        tickets.set(hashOf(ticket), { holder, until: now + TICKET_TTL_MS });
        return { ticket };
      }),
    take: (ticket) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const entry = tickets.get(hashOf(ticket));
        tickets.delete(hashOf(ticket));
        return entry !== undefined && entry.until > now ? Option.some(entry.holder) : Option.none();
      }),
  };
};

export const streamTicketsLayer = Layer.sync(StreamTickets, makeTickets);
export const mateLinkTicketsLayer = Layer.sync(MateLinkTickets, makeTickets);
