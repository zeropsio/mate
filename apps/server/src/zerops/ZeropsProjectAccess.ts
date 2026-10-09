/**
 * ZeropsProjectAccess — who this Mate's project lets in: the one answer the membership watch, the
 * signers' check (turn admission, offboarding) and the door ask (R6).
 *
 * HQ reads its org's member list anyway, and relays the answer down the Mate's link (`access`,
 * `@t3tools/shared/mateLink`): the door's own rule over the same list (`@t3tools/shared/mateAccess`),
 * aged by how long before it was sent Zerops answered HQ's view. HQ relays Zerops's access; this
 * Mate trusts it at most {@link RELAY_HOLDS} from HQ's read of Zerops, then reads Zerops itself —
 * its own project and its org's member list, with its own key (`ZeropsOrgRead`) — as it does with
 * no relay at all: before HQ links, or while HQ is out.
 *
 * @module ZeropsProjectAccess
 */
import {
  type MateAccessMember,
  projectAccess,
  readOrgMembers,
  readProjectRoles,
} from "@t3tools/shared/mateAccess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { MAX_ZEROPS_ROLE_RECHECK_SECONDS, type ZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { readMemberEntries, ZeropsOrgRead } from "./ZeropsOrgRead.ts";

/**
 * How long HQ's relay holds from HQ's read of Zerops: one role recheck at its ceiling, the window
 * a removed person keeps their screen for when this Mate reads Zerops itself.
 */
export const RELAY_HOLDS = Duration.seconds(MAX_ZEROPS_ROLE_RECHECK_SECONDS);

/** Who the project lets in, and when Zerops answered that; or that nobody could say. */
export type ProjectAccess =
  | {
      readonly ok: true;
      readonly members: ReadonlyArray<MateAccessMember>;
      /** When Zerops answered the read this comes from (wall ms). */
      readonly readAtMs: number;
      /** Relayed by HQ, rather than read by this Mate. */
      readonly relayed: boolean;
    }
  | { readonly ok: false };

export type KnownAccess = Extract<ProjectAccess, { readonly ok: true }>;

export class ZeropsProjectAccess extends Context.Service<
  ZeropsProjectAccess,
  {
    /** HQ's relay, as the link brings it: its members, and how old HQ's read of Zerops was. */
    readonly relayed: (access: {
      readonly members: ReadonlyArray<MateAccessMember>;
      readonly ageMs: number;
    }) => Effect.Effect<void>;
    /** HQ's relay while it holds ({@link RELAY_HOLDS} from HQ's read); none past that. */
    readonly relay: Effect.Effect<Option.Option<KnownAccess>>;
    /** HQ's relay while it holds, else this Mate's own read; `ok: false` when neither answers. */
    readonly read: Effect.Effect<ProjectAccess>;
    /** Fires when HQ relays a different answer: who it lets in, never only its age. */
    readonly changes: Stream.Stream<void>;
  }
>()("t3/zerops/ZeropsProjectAccess") {}

/**
 * Whether `body` claims the member list it carried is the whole thing.
 *
 * A finite `totalCount` must be covered by the rows read; otherwise the list is partial.
 * Without that field, this reader treats the supplied array as complete.
 */
export function isMemberListComplete(body: unknown, entriesLength: number): boolean {
  if (typeof body !== "object" || body === null) return true;
  const totalCount = (body as Record<string, unknown>)["totalCount"];
  if (typeof totalCount !== "number" || !Number.isFinite(totalCount)) return true;
  return entriesLength >= totalCount;
}

/**
 * This Mate's own read, with its own key: its project and its org's member list, read once for
 * every asker (`ZeropsOrgRead`). Nothing usable — a read that failed, a list unreadable, empty (an
 * outage dressed as an answer) or a partial page (S6) — is `ok: false`.
 */
export const readOwnAccess = Effect.fn("ZeropsProjectAccess.readOwn")(function* (input: {
  readonly environment: ZeropsEnvironment;
}) {
  const { apiBaseUrl, projectId } = input.environment;
  const orgRead = yield* ZeropsOrgRead;
  const nothing: ProjectAccess = { ok: false };
  const own = yield* orgRead.project({ apiBaseUrl, projectId });
  if (own.kind !== "answered" || own.status !== 200) return nothing;
  const project = readProjectRoles(own.body);
  if (project === null) return nothing;
  const members = yield* orgRead.members({ apiBaseUrl, clientId: project.clientId });
  if (members.kind !== "answered" || members.status !== 200) return nothing;
  const entries = readMemberEntries(members.body);
  if (entries === null || entries.length === 0) return nothing;
  if (!isMemberListComplete(members.body, entries.length)) return nothing;
  const answer: ProjectAccess = {
    ok: true,
    members: projectAccess({
      projectId,
      members: readOrgMembers(entries),
      overrides: project.overrides,
    }),
    readAtMs: yield* Clock.currentTimeMillis,
    relayed: false,
  };
  return answer;
});

/** Whether two answers let in the same members, the same way, in the same order. */
const sameMembers = (
  left: ReadonlyArray<MateAccessMember>,
  right: ReadonlyArray<MateAccessMember>,
): boolean =>
  left.length === right.length &&
  left.every((entry, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      entry.userId === other.userId &&
      entry.role === other.role &&
      entry.visibility === other.visibility
    );
  });

export const make = Effect.gen(function* () {
  const environment = (yield* ServerConfig).zerops;
  const orgRead = yield* ZeropsOrgRead;
  const held = yield* Ref.make<KnownAccess | undefined>(undefined);
  const moved = yield* PubSub.unbounded<void>();
  const holdsMs = Duration.toMillis(RELAY_HOLDS);

  const relayed: ZeropsProjectAccess["Service"]["relayed"] = (access) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const next: KnownAccess = {
        ok: true,
        members: access.members,
        readAtMs: now - access.ageMs,
        relayed: true,
      };
      const before = yield* Ref.getAndSet(held, next);
      if (before === undefined || !sameMembers(before.members, next.members)) {
        yield* PubSub.publish(moved, undefined);
      }
    });

  const relay = Effect.gen(function* () {
    const last = yield* Ref.get(held);
    const now = yield* Clock.currentTimeMillis;
    return last !== undefined && now - last.readAtMs <= holdsMs
      ? Option.some(last)
      : Option.none<KnownAccess>();
  });

  const read: ZeropsProjectAccess["Service"]["read"] = Effect.gen(function* () {
    const fresh = yield* relay;
    if (Option.isSome(fresh)) return fresh.value;
    if (environment === undefined) return { ok: false } as const;
    return yield* readOwnAccess({ environment }).pipe(
      Effect.provideService(ZeropsOrgRead, orgRead),
    );
  });

  return ZeropsProjectAccess.of({
    relayed,
    relay,
    read,
    changes: Stream.fromPubSub(moved),
  });
});

export const layer = Layer.effect(ZeropsProjectAccess, make);
