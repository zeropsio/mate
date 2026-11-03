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
 * it as it is. After every recompute the list is reported to HQ (`access_report`), `missing`
 * against the previous report.
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
import { projectAccess } from "@t3tools/shared/mateAccess";
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

import { type AccessRead, ZeropsAccessRead } from "./ZeropsAccessRead.ts";
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

/** The Mate's own list from a read of its project `projectId`, made at `nowMs`. */
export const ownAccessList = (
  projectId: string,
  read: Extract<AccessRead, { readonly kind: "read" }>,
  nowMs: number,
): AccessList => ({
  version: 0,
  members: projectAccess({ projectId, members: read.members, overrides: read.project.overrides }),
  refused: false,
  heardAtMs: nowMs,
  expiresAtMs: nowMs + Duration.toMillis(ACCESS_LIST_HOLDS),
});

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

/** The report of `list` made at `at`: `missing` is whom `previous` named and `list` does not. */
export const accessReport = (
  previous: AccessReport | undefined,
  list: AccessList,
  at: string,
): AccessReport => {
  const openers = list.members.filter((m) => m.visibility === "open").map((m) => m.userId);
  const listed = list.members.filter((m) => m.visibility === "listed").map((m) => m.userId);
  const now = new Set([...openers, ...listed]);
  const before = previous === undefined ? [] : [...previous.openers, ...previous.listed];
  return { at, openers, listed, missing: before.filter((userId) => !now.has(userId)) };
};

/** Who a list opens for and lists, and whether it is refused: what its readers act on. */
const reachOf = (list: AccessList | undefined): string =>
  list === undefined
    ? ""
    : JSON.stringify([
        list.refused,
        list.members.map((member) => [member.userId, member.role, member.visibility]),
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
    /** A new ticket's verdict for `userId`, recomputing once first if the list does not open for them. */
    readonly admits: (userId: string) => Effect.Effect<"open" | TicketRefusal>;
    /** The latest report, then each one after a recompute. */
    readonly reports: Stream.Stream<AccessReport>;
    /** Fires when the deciding list changes whom it opens for or lists, never when it only aged. */
    readonly changes: Stream.Stream<void>;
  }
>()("t3/zerops/ZeropsMateAccessList") {}

interface Held {
  readonly own: AccessList | undefined;
  /** Zerops refused the last own read for good: the own list is kept but no longer decides. */
  readonly stale: boolean;
  readonly relayed: AccessList | undefined;
}

const deciding = (held: Held): AccessList | undefined =>
  held.own !== undefined && !held.stale ? held.own : (held.relayed ?? held.own);

/** The list over the relay alone, and, with `own`, the Mate's own read of its project. */
export const make = (own?: {
  readonly projectId: string;
  readonly read: ZeropsAccessRead["Service"]["read"];
}) =>
  Effect.gen(function* () {
    const held = yield* Ref.make<Held>({ own: undefined, stale: false, relayed: undefined });
    const moved = yield* PubSub.unbounded<void>();
    const reports = yield* SubscriptionRef.make(Option.none<AccessReport>());
    const recomputing = yield* Semaphore.make(1);

    const update = (next: (held: Held, nowMs: number) => Held) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const [before, after] = yield* Ref.modify(held, (before): [[Held, Held], Held] => {
          const after = next(before, now);
          return [[before, after], after];
        });
        if (reachOf(deciding(before)) !== reachOf(deciding(after)))
          yield* PubSub.publish(moved, undefined);
        return after;
      });

    const recompute =
      own === undefined
        ? Effect.void
        : recomputing.withPermits(1)(
            Effect.gen(function* () {
              const read = yield* own.read.pipe(
                Effect.timeoutOrElse({
                  duration: ACCESS_READ_BUDGET,
                  orElse: () => Effect.succeed<AccessRead>({ kind: "failed", reason: "timeout" }),
                }),
              );
              if (read.kind === "failed") return;
              const after = yield* update((current, nowMs) =>
                read.kind === "refused"
                  ? { ...current, stale: true }
                  : { ...current, own: ownAccessList(own.projectId, read, nowMs), stale: false },
              );
              if (read.kind !== "read" || after.own === undefined) return;
              const list = after.own;
              yield* SubscriptionRef.update(reports, (previous) =>
                Option.some(
                  accessReport(
                    Option.getOrUndefined(previous),
                    list,
                    DateTime.formatIso(DateTime.makeUnsafe(list.heardAtMs)),
                  ),
                ),
              );
            }),
          );

    const verdict = (userId: string) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        return ticketVerdict(deciding(yield* Ref.get(held)), userId, now);
      });

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
    });
  });

/** The relay alone: where there is no platform to read (fixtures, tests of the relay). */
export const relayLayer = Layer.effect(ZeropsMateAccessList, make());

/** The Mate's own list of its project `projectId`, read through {@link ZeropsAccessRead}. */
export const layer = (projectId: string) =>
  Layer.effect(
    ZeropsMateAccessList,
    Effect.gen(function* () {
      return yield* make({ projectId, read: (yield* ZeropsAccessRead).read });
    }),
  );
