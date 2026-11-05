/**
 * ZeropsMateAccessList — who this Mate's project opens for and whom it lists.
 *
 * The Mate computes the list itself (`ZeropsAccessRead`, with its project key): the project's
 * `userRoles` and the organisation's persons, through the shared door rule
 * (`@t3tools/shared/mateAccess` `projectAccess` over `zeropsRoles`): an active person whose
 * effective role (their override here, else their org role) is Basic user or above is opened for,
 * one at Read only is listed, anyone else is absent. It recomputes every
 * {@link ACCESS_RECOMPUTE_EVERY} give or take {@link ACCESS_RECOMPUTE_JITTER}, and at once when a
 * ticket names a person the list does not open for. A read Zerops refuses for good (`401`, or
 * `400 userNotFound|projectNotFound`) keeps the last list, marked stale; any other failure keeps
 * it as it is. Between reads the Zerops websocket keeps it live (`ZeropsAccessSocket`): each frame
 * applies over the rows the last read and frames left, and the list is recomputed from them; a
 * frame that changes no row changes nothing. Every (re)connect reads again, for what the socket
 * missed. After every read, and every frame that changed a row, whom the list names goes up to
 * HQ (`access_report`), whole every time. The own
 * list names whose the project is too: whom its `OWNER` override names (`projectOwners`), the
 * owner marker a hand-over moves.
 *
 * The list HQ relays down the link (`access`, `@t3tools/shared/mateLink`) is advisory: it decides
 * only while the Mate has no own list or its own is stale. A full frame always replaces the
 * relayed baseline, whatever its version (a redeployed HQ numbers afresh); a delta whose version
 * is not above the last is discarded. A frame saying the organisation's key was refused holds no
 * members until a full frame without it.
 *
 * A list holds {@link ACCESS_LIST_HOLDS} from the read or frame that brought it (a relayed one
 * capped by its view time when the clocks differ by at most sixty seconds). Past that it refuses
 * new tickets and keeps the connections already open.
 *
 * @module ZeropsMateAccessList
 */
import { projectAccess, projectOwners, type ZeropsOrgMember } from "@t3tools/shared/mateAccess";
import type {
  AccessReport,
  KeyLinkAccess,
  LinkAccessMember,
  TicketRefusal,
} from "@t3tools/shared/mateLink";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/http";

import { type AccessRead, type OwnProject, ZeropsAccessRead } from "./ZeropsAccessRead.ts";
import {
  type AccessFrame,
  type AccessLiveEvent,
  accessEvents,
  connectAccessSocket,
  type MemberPatch,
} from "./ZeropsAccessSocket.ts";
import type { ZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZeropsMateKey } from "./ZeropsMateKey.ts";
import { ZEROPS_SUBJECT_PREFIX, zeropsUserIdOf } from "./zeropsSubject.ts";

/**
 * How long a list holds from the read or frame that brought it: the cap a person stays at their
 * last known role while no fresh one arrives, and past which no new ticket is admitted.
 */
export const ACCESS_LIST_HOLDS = Duration.minutes(15);

/** How often the Mate recomputes its own list. */
export const ACCESS_RECOMPUTE_EVERY = Duration.minutes(5);

/** How far each wait strays either side of {@link ACCESS_RECOMPUTE_EVERY}, so Mates spread out. */
export const ACCESS_RECOMPUTE_JITTER = Duration.seconds(60);

/** The longest one recompute waits on Zerops before it counts as failed. */
export const ACCESS_READ_BUDGET = Duration.seconds(15);

/** A member the list names for the project: one it opens for, or one it only lists. */
export type ListedMember = LinkAccessMember & { readonly visibility: "open" | "listed" };

/** A list as the Mate keeps it: its own, or the one HQ relayed. */
export interface AccessList {
  /** The relayed list's version; an own list is unversioned (0). */
  readonly version: number;
  readonly members: ReadonlyArray<ListedMember>;
  /**
   * Whom the project's own row names its owner (`projectOwners`); only an own list knows, as HQ's
   * relay carries no row.
   */
  readonly owners?: ReadonlyArray<string>;
  /** HQ relayed that the organisation's key was refused: nobody is admitted. */
  readonly refused: boolean;
  /** When this Mate read or received it (its own clock, ms). */
  readonly heardAtMs: number;
  /** Past this no new ticket is admitted ({@link ACCESS_LIST_HOLDS}). */
  readonly expiresAtMs: number;
}

const named = (members: ReadonlyArray<LinkAccessMember>): ReadonlyArray<ListedMember> =>
  members.filter((member): member is ListedMember => member.visibility !== "none");

/**
 * The relayed list after `frame`, heard at `nowMs`: a full frame replaces it, a delta above its
 * version applies over it, any other delta leaves it as it was (the same reference).
 */
export function nextAccessList(
  list: AccessList | undefined,
  frame: KeyLinkAccess,
  nowMs: number,
): AccessList | undefined {
  const viewAtMs = "viewAt" in frame ? Date.parse(frame.viewAt) : Number.NaN;
  const baseMs = Math.abs(nowMs - viewAtMs) <= 60_000 ? Math.min(nowMs, viewAtMs) : nowMs;
  const expiresAtMs = baseMs + Duration.toMillis(ACCESS_LIST_HOLDS);
  if (frame.full)
    return {
      version: frame.version,
      members: named(frame.members),
      refused: "refused" in frame,
      heardAtMs: nowMs,
      expiresAtMs,
    };
  if (list === undefined || frame.version <= list.version) return list;
  const members = new Map(list.members.map((member) => [member.userId, member] as const));
  for (const member of frame.members) {
    if (member.visibility === "none") members.delete(member.userId);
    else members.set(member.userId, member as ListedMember);
  }
  return {
    version: frame.version,
    members: named([...members.values()]),
    refused: list.refused,
    heardAtMs: nowMs,
    expiresAtMs,
  };
}

/** The rows the Mate's own list is computed from: its project's roles and its org's members. */
export interface OwnRows {
  readonly project: OwnProject;
  readonly members: ReadonlyArray<ZeropsOrgMember>;
}

/** The Mate's own list from the rows of its project `projectId`, read at `nowMs`. */
export const ownAccessList = (projectId: string, rows: OwnRows, nowMs: number): AccessList => ({
  version: 0,
  members: projectAccess({ projectId, members: rows.members, overrides: rows.project.overrides }),
  owners: projectOwners({ members: rows.members, overrides: rows.project.overrides }),
  refused: false,
  heardAtMs: nowMs,
  expiresAtMs: nowMs + Duration.toMillis(ACCESS_LIST_HOLDS),
});

const patched = (member: ZeropsOrgMember, patch: MemberPatch): ZeropsOrgMember => ({
  clientUserId: member.clientUserId,
  userId: patch.userId ?? member.userId,
  orgRole: patch.orgRole ?? member.orgRole,
  status: patch.status ?? member.status,
  canCreateProjects: patch.canCreateProjects ?? member.canCreateProjects,
});

const sameMember = (a: ZeropsOrgMember, b: ZeropsOrgMember): boolean =>
  a.userId === b.userId &&
  a.orgRole === b.orgRole &&
  a.status === b.status &&
  a.canCreateProjects === b.canCreateProjects;

/**
 * The rows after `frame`: its content over the last known rows. The same reference when it
 * changes none of them, so a frame seen twice changes nothing.
 */
export function applyAccessFrame(rows: OwnRows, frame: AccessFrame): OwnRows {
  if (frame.kind === "project") {
    const before = Object.entries(rows.project.overrides);
    const same =
      before.length === Object.keys(frame.overrides).length &&
      before.every(([clientUserId, role]) => frame.overrides[clientUserId] === role);
    return same ? rows : { ...rows, project: { ...rows.project, overrides: frame.overrides } };
  }
  let changed = false;
  const members = rows.members.filter((member) => {
    const leaves = frame.remove.includes(member.clientUserId);
    changed ||= leaves;
    return !leaves;
  });
  for (const patch of frame.upsert) {
    const at = members.findIndex((member) => member.clientUserId === patch.clientUserId);
    if (at === -1) {
      // Someone the last read did not name: only a row that says who they are joins.
      if (patch.userId === undefined) continue;
      members.push(
        patched(
          {
            clientUserId: patch.clientUserId,
            userId: "",
            orgRole: "",
            status: "",
            canCreateProjects: false,
          },
          patch,
        ),
      );
      changed = true;
      continue;
    }
    const next = patched(members[at]!, patch);
    if (sameMember(members[at]!, next)) continue;
    members[at] = next;
    changed = true;
  }
  return changed ? { ...rows, members } : rows;
}

/** What a new ticket for `userId` gets from `list` at `nowMs`: admitted, or why not. */
export const ticketVerdict = (
  list: AccessList | undefined,
  userId: string,
  nowMs: number,
): "open" | TicketRefusal => {
  if (list === undefined || list.refused || nowMs > list.expiresAtMs) return "not_in_list";
  const member = list.members.find((candidate) => candidate.userId === userId);
  if (member === undefined) return "not_in_list";
  return member.visibility === "open" ? "open" : "read_only";
};

/** Whom `list` opens for and lists, as of `at`. */
export const accessNamed = (list: AccessList, at: string): AccessReport => ({
  at,
  openers: list.members.filter((m) => m.visibility === "open").map((m) => m.userId),
  listed: list.members.filter((m) => m.visibility === "listed").map((m) => m.userId),
});

/** Who a list opens for and lists, whose it is, and whether it is refused: what its readers act on. */
const reachOf = (list: AccessList | undefined): string =>
  list === undefined
    ? ""
    : JSON.stringify([
        list.refused,
        list.members.map((member) => [member.userId, member.role, member.visibility]),
        list.owners ?? null,
      ]);

/**
 * Whether the session's `subject` administers the Mate's project: a Zerops person the list opens
 * it for at Admin or above. Nobody does without a list, or while the key is refused.
 */
export const administersProject = (list: Option.Option<AccessList>, subject: string): boolean =>
  Option.isSome(list) &&
  !list.value.refused &&
  subject.startsWith(ZEROPS_SUBJECT_PREFIX) &&
  list.value.members.some(
    (member) =>
      member.userId === zeropsUserIdOf(subject) &&
      member.visibility === "open" &&
      roleAtLeast(member.role, "ADMIN"),
  );

export class ZeropsMateAccessList extends Context.Service<
  ZeropsMateAccessList,
  {
    /** HQ's relayed access frame, as the link brings it: advisory. */
    readonly heard: (frame: KeyLinkAccess) => Effect.Effect<void>;
    /**
     * The list that decides, whatever its age — what keeps open connections: the Mate's own
     * while it has one that is not stale, else HQ's relay, else its own stale one.
     */
    readonly current: Effect.Effect<Option.Option<AccessList>>;
    /**
     * A new ticket's verdict for `userId`, recomputing once first (or joining the recompute in
     * flight) if the list does not open for them.
     */
    readonly admits: (userId: string) => Effect.Effect<"open" | TicketRefusal>;
    /** Whom the own list names, latest first, then after each change (`access_report`). */
    readonly reports: Stream.Stream<AccessReport>;
    /**
     * Fires when the deciding list changes whom it opens for or lists, or whose the project is,
     * never when it only aged.
     */
    readonly changes: Stream.Stream<void>;
    /**
     * The Mate's own project — its name and organisation — as the last own read and frames left
     * it: the one copy of that document in the Mate. While no read has landed it joins the read
     * in flight (or starts one); none where the list reads nothing of its own or no read landed.
     */
    readonly ownProject: Effect.Effect<Option.Option<OwnProject>>;
  }
>()("t3/zerops/ZeropsMateAccessList") {}

interface Held {
  /** What the own list was last computed from. */
  readonly rows: OwnRows | undefined;
  readonly own: AccessList | undefined;
  /** Zerops refused the last own read for good: the own list is kept but no longer decides. */
  readonly stale: boolean;
  readonly relayed: AccessList | undefined;
}

const deciding = (held: Held): AccessList | undefined =>
  held.own !== undefined && !held.stale ? held.own : (held.relayed ?? held.own);

/**
 * The list over the relay alone, and, with `own`, the Mate's own read of its project, kept live
 * between reads by `live` (the Zerops websocket over its organisation, once a read named it).
 */
export const make = (own?: {
  readonly projectId: string;
  readonly read: ZeropsAccessRead["Service"]["read"];
  readonly live?: (clientId: string) => Stream.Stream<AccessLiveEvent>;
}) =>
  Effect.gen(function* () {
    const held = yield* Ref.make<Held>({
      rows: undefined,
      own: undefined,
      stale: false,
      relayed: undefined,
    });
    const moved = yield* PubSub.unbounded<void>();
    const reports = yield* SubscriptionRef.make(Option.none<AccessReport>());
    const scope = yield* Effect.scope;
    /** The recompute in flight: a ticket joins it rather than queueing a read of its own. */
    const inFlight = yield* Ref.make<Deferred.Deferred<void> | undefined>(undefined);
    /** The organisation the first read named: what the websocket subscribes to. */
    const organisation = yield* Deferred.make<string>();

    const update = (next: (held: Held, nowMs: number) => Held) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const [before, after] = yield* Ref.modify(held, (before): [[Held, Held], Held] => {
          const after = next(before, now);
          return [[before, after], after];
        });
        if (reachOf(deciding(before)) !== reachOf(deciding(after)))
          yield* PubSub.publish(moved, undefined);
        return [before, after] as const;
      });

    /** Reports the own list `after` holds, as of `nowMs`. */
    const report = (after: Held, nowMs: number) => {
      const list = after.own;
      return list === undefined
        ? Effect.void
        : SubscriptionRef.set(
            reports,
            Option.some(accessNamed(list, DateTime.formatIso(DateTime.makeUnsafe(nowMs)))),
          );
    };

    /**
     * Reads and frames apply one at a time, each over what the last left: a frame waits for the
     * read in flight, so an answer Zerops gave before the frame never lands after it.
     */
    const serial = yield* Semaphore.make(1);

    const readOnce = (from: NonNullable<typeof own>) =>
      Effect.gen(function* () {
        const read = yield* from.read.pipe(
          Effect.timeoutOrElse({
            duration: ACCESS_READ_BUDGET,
            orElse: () => Effect.succeed<AccessRead>({ kind: "failed", reason: "timeout" }),
          }),
        );
        if (read.kind === "failed") return;
        const [, after] = yield* update((current, nowMs) =>
          read.kind === "refused"
            ? { ...current, stale: true }
            : {
                ...current,
                rows: read,
                own: ownAccessList(from.projectId, read, nowMs),
                stale: false,
              },
        );
        if (read.kind !== "read" || after.own === undefined) return;
        yield* report(after, after.own.heardAtMs);
        yield* Deferred.succeed(organisation, read.project.clientId);
      }).pipe(serial.withPermits(1));

    /**
     * A frame over the last known rows. The list it recomputes holds from the read it builds on:
     * a frame is no read, and the stale rule counts reads.
     */
    const heardFrame = (from: NonNullable<typeof own>, frame: AccessFrame) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const [before, after] = yield* update((current) => {
          if (current.rows === undefined || current.own === undefined) return current;
          const rows = applyAccessFrame(current.rows, frame);
          return rows === current.rows
            ? current
            : { ...current, rows, own: ownAccessList(from.projectId, rows, current.own.heardAtMs) };
        });
        if (after !== before) yield* report(after, now);
      }).pipe(serial.withPermits(1));

    /**
     * One read at a time, and whoever asks while it runs waits on it. The read runs in the list's
     * scope, so a waiter that goes away (its link closed) leaves it to the others.
     */
    const recompute =
      own === undefined
        ? Effect.void
        : Effect.gen(function* () {
            const fresh = yield* Deferred.make<void>();
            const running = yield* Ref.modify(
              inFlight,
              (current): [Deferred.Deferred<void> | undefined, Deferred.Deferred<void>] =>
                current === undefined ? [undefined, fresh] : [current, current],
            );
            if (running !== undefined) return yield* Deferred.await(running);
            yield* readOnce(own).pipe(
              Effect.ensuring(Ref.set(inFlight, undefined)),
              Deferred.into(fresh),
              Effect.forkIn(scope, { startImmediately: true }),
            );
            return yield* Deferred.await(fresh);
          });

    const verdict = (userId: string) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        return ticketVerdict(deciding(yield* Ref.get(held)), userId, now);
      });

    if (own?.live !== undefined) {
      const { live } = own;
      // The socket is scoped to the organisation the first read names.
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          const clientId = yield* Deferred.await(organisation);
          yield* Stream.runForEach(live(clientId), (event) =>
            event._tag === "connected" ? recompute : heardFrame(own, event.frame),
          );
        }),
      );
    }

    if (own !== undefined) {
      const everyMs = Duration.toMillis(ACCESS_RECOMPUTE_EVERY);
      const jitterMs = Duration.toMillis(ACCESS_RECOMPUTE_JITTER);
      yield* Effect.forkScoped(
        Effect.forever(
          recompute.pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("zerops access list: a recompute failed", { cause }),
            ),
            Effect.andThen(Random.nextIntBetween(everyMs - jitterMs, everyMs + jitterMs)),
            Effect.flatMap((waitMs) => Effect.sleep(Duration.millis(waitMs))),
          ),
        ),
      );
    }

    return ZeropsMateAccessList.of({
      heard: (frame) =>
        Effect.asVoid(
          update((current, nowMs) => ({
            ...current,
            relayed: nextAccessList(current.relayed, frame, nowMs),
          })),
        ),
      current: Effect.map(Ref.get(held), (current) => Option.fromUndefinedOr(deciding(current))),
      admits: (userId) =>
        Effect.gen(function* () {
          const first = yield* verdict(userId);
          if (first !== "not_in_list" || own === undefined) return first;
          yield* recompute;
          return yield* verdict(userId);
        }),
      reports: SubscriptionRef.changes(reports).pipe(
        Stream.filter(Option.isSome),
        Stream.map((report) => report.value),
      ),
      changes: Stream.fromPubSub(moved),
      ownProject: Effect.gen(function* () {
        if ((yield* Ref.get(held)).rows === undefined) yield* recompute;
        return Option.fromUndefinedOr((yield* Ref.get(held)).rows?.project);
      }),
    });
  });

/** The relay alone: where there is no platform to read (fixtures, tests of the relay). */
export const relayLayer = Layer.effect(ZeropsMateAccessList, make());

/**
 * The Mate's own list of its project, read through {@link ZeropsAccessRead} and kept live over
 * the Zerops websocket with its project key.
 */
export const layer = (environment: Pick<ZeropsEnvironment, "apiBaseUrl" | "projectId">) =>
  Layer.effect(
    ZeropsMateAccessList,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const mateKey = yield* ZeropsMateKey;
      return yield* make({
        projectId: environment.projectId,
        read: (yield* ZeropsAccessRead).read,
        live: (clientId) =>
          accessEvents({ ...environment, clientId, mateKey, connect: connectAccessSocket }).pipe(
            Stream.provideService(HttpClient.HttpClient, httpClient),
          ),
      });
    }),
  );
