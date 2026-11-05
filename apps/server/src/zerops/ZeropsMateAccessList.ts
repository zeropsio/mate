/**
 * ZeropsMateAccessList — who this Mate's project opens for and whom it lists.
 *
 * The Mate computes the list itself (`ZeropsAccessRead`, with its project key): the project's
 * `userRoles` and the organisation's persons, through the shared door rule
 * (`@t3tools/shared/mateAccess` `projectAccess` over `zeropsRoles`): an active person whose
 * effective role (their override here, else their org role) is Basic user or above is opened for,
 * one at Read only is listed, anyone else is absent. It recomputes every
 * {@link ACCESS_RECOMPUTE_EVERY} give or take {@link ACCESS_RECOMPUTE_JITTER}, and at once when a
 * ticket names a person the list does not open for. A read that fails, Zerops refusing the key
 * included, keeps the last list as it is. Between reads the Zerops websocket keeps it live
 * (`ZeropsAccessSocket`): each frame applies over the rows the last read and frames left, and the
 * list is recomputed from them; a frame that changes no row changes nothing. Every (re)connect
 * reads again, for what the socket missed. After every read, and every frame that changed a row,
 * whom the list names goes up to HQ (`access_report`), whole every time. The list names whose the
 * project is too: whom its `OWNER` override names (`projectOwners`), the owner marker a hand-over
 * moves. It is the only list: HQ sends the Mate none.
 *
 * The same socket carries the project's process frames (ZEROPS-078): the list hands them on,
 * with each `connected`, to whoever waits on a process (`processes`), and reads none itself.
 *
 * A list holds {@link ACCESS_LIST_HOLDS} from the read that brought it; a frame applied over it
 * does not extend that. Past that it refuses new tickets and keeps the connections already open.
 *
 * @module ZeropsMateAccessList
 */
import {
  type MateAccessMember,
  projectAccess,
  projectOwners,
  type ZeropsOrgMember,
} from "@t3tools/shared/mateAccess";
import type { AccessReport, TicketRefusal } from "@t3tools/shared/mateLink";
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
import type * as Scope from "effect/Scope";
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
  type ProcessLiveEvent,
} from "./ZeropsAccessSocket.ts";
import type { ZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZeropsMateKey } from "./ZeropsMateKey.ts";
import { ZEROPS_SUBJECT_PREFIX, zeropsUserIdOf } from "./zeropsSubject.ts";

/**
 * How long a list holds from the read that brought it: the cap a person stays at their last known
 * role while no fresh read arrives, and past which no new ticket is admitted.
 */
export const ACCESS_LIST_HOLDS = Duration.minutes(15);

/** How often the Mate recomputes its own list. */
export const ACCESS_RECOMPUTE_EVERY = Duration.minutes(5);

/** How far each wait strays either side of {@link ACCESS_RECOMPUTE_EVERY}, so Mates spread out. */
export const ACCESS_RECOMPUTE_JITTER = Duration.seconds(60);

/** The longest one recompute waits on Zerops before it counts as failed. */
export const ACCESS_READ_BUDGET = Duration.seconds(15);

/** The Mate's own list of its project. */
export interface AccessList {
  /** Whom the project opens for or lists. */
  readonly members: ReadonlyArray<MateAccessMember>;
  /** Whom the project's own row names its owner (`projectOwners`). */
  readonly owners: ReadonlyArray<string>;
  /** When the read it builds on landed (the Mate's own clock, ms). */
  readonly readAtMs: number;
  /** Past this no new ticket is admitted ({@link ACCESS_LIST_HOLDS}). */
  readonly expiresAtMs: number;
}

/** The rows the Mate's own list is computed from: its project's roles and its org's members. */
export interface OwnRows {
  readonly project: OwnProject;
  readonly members: ReadonlyArray<ZeropsOrgMember>;
}

/** The Mate's own list from the rows of its project `projectId`, read at `nowMs`. */
export const ownAccessList = (projectId: string, rows: OwnRows, nowMs: number): AccessList => ({
  members: projectAccess({ projectId, members: rows.members, overrides: rows.project.overrides }),
  owners: projectOwners({ members: rows.members, overrides: rows.project.overrides }),
  readAtMs: nowMs,
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
  if (list === undefined || nowMs > list.expiresAtMs) return "not_in_list";
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

/** Who a list opens for and lists, and whose it is: what its readers act on. */
const reachOf = (list: AccessList | undefined): string =>
  list === undefined
    ? ""
    : JSON.stringify([
        list.members.map((member) => [member.userId, member.role, member.visibility]),
        list.owners,
      ]);

/**
 * Whether the session's `subject` administers the Mate's project: a Zerops person the list opens
 * it for at Admin or above. Nobody does without a list.
 */
export const administersProject = (list: Option.Option<AccessList>, subject: string): boolean =>
  Option.isSome(list) &&
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
    /** The Mate's own list, whatever its age: what keeps open connections. */
    readonly current: Effect.Effect<Option.Option<AccessList>>;
    /**
     * A new ticket's verdict for `userId`, recomputing once first (or joining the recompute in
     * flight) if the list does not open for them.
     */
    readonly admits: (userId: string) => Effect.Effect<"open" | TicketRefusal>;
    /** Whom the own list names, latest first, then after each change (`access_report`). */
    readonly reports: Stream.Stream<AccessReport>;
    /**
     * Fires when the list changes whom it opens for or lists, or whose the project is, never
     * when it only aged.
     */
    readonly changes: Stream.Stream<void>;
    /**
     * The Mate's own project — its name and organisation — as the last own read and frames left
     * it: the one copy of that document in the Mate. While no read has landed it joins the read
     * in flight (or starts one); none where the list reads nothing of its own or no read landed.
     */
    readonly ownProject: Effect.Effect<Option.Option<OwnProject>>;
    /**
     * The project's processes as the socket pushes them from the moment this runs: `connected`
     * after each (re)connect, then each frame's own-project processes. Nothing without an own
     * socket.
     */
    readonly processes: Effect.Effect<Stream.Stream<ProcessLiveEvent>, never, Scope.Scope>;
  }
>()("t3/zerops/ZeropsMateAccessList") {}

interface Held {
  /** What the own list was last computed from. */
  readonly rows: OwnRows | undefined;
  readonly own: AccessList | undefined;
}

/**
 * The list with `own`, the Mate's own read of its project, kept live between reads by `live` (the
 * Zerops websocket over its organisation, once a read named it); without it, a list that never
 * names anybody.
 */
export const make = (own?: {
  readonly projectId: string;
  readonly read: ZeropsAccessRead["Service"]["read"];
  readonly live?: (clientId: string) => Stream.Stream<AccessLiveEvent>;
}) =>
  Effect.gen(function* () {
    const held = yield* Ref.make<Held>({ rows: undefined, own: undefined });
    const moved = yield* PubSub.unbounded<void>();
    const processes = yield* PubSub.unbounded<ProcessLiveEvent>();
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
        if (reachOf(before.own) !== reachOf(after.own)) yield* PubSub.publish(moved, undefined);
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
        if (read.kind !== "read") return;
        const [, after] = yield* update((_, nowMs) => ({
          rows: read,
          own: ownAccessList(from.projectId, read, nowMs),
        }));
        if (after.own === undefined) return;
        yield* report(after, after.own.readAtMs);
        yield* Deferred.succeed(organisation, read.project.clientId);
      }).pipe(serial.withPermits(1));

    /**
     * A frame over the last known rows. The list it recomputes holds from the read it builds on:
     * a frame is no read, and the hold counts from reads.
     */
    const appliedFrame = (from: NonNullable<typeof own>, frame: AccessFrame) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const [before, after] = yield* update((current) => {
          if (current.rows === undefined || current.own === undefined) return current;
          const rows = applyAccessFrame(current.rows, frame);
          return rows === current.rows
            ? current
            : { rows, own: ownAccessList(from.projectId, rows, current.own.readAtMs) };
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
        return ticketVerdict((yield* Ref.get(held)).own, userId, now);
      });

    if (own?.live !== undefined) {
      const { live } = own;
      // The socket is scoped to the organisation the first read names.
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          const clientId = yield* Deferred.await(organisation);
          yield* Stream.runForEach(live(clientId), (event) => {
            switch (event._tag) {
              case "connected":
                return PubSub.publish(processes, event).pipe(Effect.andThen(recompute));
              case "process":
                return PubSub.publish(processes, event);
              case "frame":
                return appliedFrame(own, event.frame);
            }
          });
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
      current: Effect.map(Ref.get(held), (current) => Option.fromUndefinedOr(current.own)),
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
      processes: Effect.map(PubSub.subscribe(processes), Stream.fromSubscription),
    });
  });

/** A list that never names anybody: where there is no platform to read (fixture scenes, dev). */
export const emptyLayer = Layer.effect(ZeropsMateAccessList, make());

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
