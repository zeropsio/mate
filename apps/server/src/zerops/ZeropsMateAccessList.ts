/**
 * ZeropsMateAccessList — who this Mate's project opens for and whom it lists, as HQ last said.
 *
 * HQ computes the list from its organisation view and sends it down the Mate's link (`access`,
 * `@t3tools/shared/mateLink`, spec-mate §3.9): a full snapshot on every link, then deltas, each
 * with a version and the time of the view it was computed from. A full frame always replaces the
 * baseline, whatever its version (a redeployed HQ numbers afresh); a delta whose version is not
 * above the last is discarded. The Mate keeps this list and nothing else: it never reads Zerops
 * for access and never runs the role function.
 *
 * The list holds {@link ACCESS_LIST_HOLDS} from when this Mate received the frame that last
 * brought it, capped by the view time when the clocks differ by at most sixty seconds.
 * HQ sends one after every fresh view, changed or not, so only a link that is down or
 * a Zerops that fails transiently lets it age. Past that it answers nothing, and whoever asks
 * vouches for nobody. A frame saying the organisation's key was refused holds no members until a
 * full frame without it.
 *
 * @module ZeropsMateAccessList
 */
import type { KeyLinkAccess, LinkAccessMember } from "@t3tools/shared/mateLink";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { ZEROPS_SUBJECT_PREFIX, zeropsUserIdOf } from "./zeropsSubject.ts";

/**
 * How long the latest list holds from the frame that brought it: the cap a person stays at their
 * last known role while no fresh view arrives (spec-mate §3.10).
 */
export const ACCESS_LIST_HOLDS = Duration.minutes(15);

/** A member HQ names for the project: one it opens for, or one it only lists. */
export type ListedMember = LinkAccessMember & { readonly visibility: "open" | "listed" };

/** The list as the Mate keeps it. */
export interface AccessList {
  readonly version: number;
  readonly members: ReadonlyArray<ListedMember>;
  /** The organisation's key was refused: nobody is admitted until a full frame without it. */
  readonly refused: boolean;
  /** When this Mate received the frame that last brought the list (its own clock, ms). */
  readonly heardAtMs: number;
  /** Receipt plus fifteen minutes, capped by a view within sixty seconds of this clock. */
  readonly expiresAtMs: number;
}

const named = (members: ReadonlyArray<LinkAccessMember>): ReadonlyArray<ListedMember> =>
  members.filter((member): member is ListedMember => member.visibility !== "none");

/**
 * The list after `frame`, heard at `nowMs`: a full frame replaces it, a delta above its version
 * applies over it, any other delta leaves it as it was (the same reference).
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
 * it for at Admin or above. Nobody does without a list that holds, or while the key is refused.
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
    /** An access frame, as the link brings it. */
    readonly heard: (frame: KeyLinkAccess) => Effect.Effect<void>;
    /** The latest list while it holds; none before the first snapshot or past the hold. */
    readonly current: Effect.Effect<Option.Option<AccessList>>;
    /** Fires when a frame changes whom the list opens for or lists, never one that only aged. */
    readonly changes: Stream.Stream<void>;
  }
>()("t3/zerops/ZeropsMateAccessList") {}

export const make = Effect.gen(function* () {
  const held = yield* Ref.make<AccessList | undefined>(undefined);
  const moved = yield* PubSub.unbounded<void>();
  return ZeropsMateAccessList.of({
    heard: (frame) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const before = yield* Ref.get(held);
        const after = nextAccessList(before, frame, now);
        yield* Ref.set(held, after);
        if (reachOf(before) !== reachOf(after)) yield* PubSub.publish(moved, undefined);
      }),
    current: Effect.gen(function* () {
      const list = yield* Ref.get(held);
      const now = yield* Clock.currentTimeMillis;
      return list !== undefined && now <= list.expiresAtMs
        ? Option.some(list)
        : Option.none<AccessList>();
    }),
    changes: Stream.fromPubSub(moved),
  });
});

export const layer = Layer.effect(ZeropsMateAccessList, make);
