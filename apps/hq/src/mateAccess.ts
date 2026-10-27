/**
 * A Mate's access as HQ relays it (`access`, `@t3tools/shared/mateLink`): who the Mate's project
 * opens for and whom it lists, computed from the org's view HQ already reads (`roles.ts`) by the
 * rule a Mate's own read applies (`@t3tools/shared/mateAccess`), so a Mate need not read its org's
 * whole member list itself (R6).
 *
 * Sent whole down the Mate's link after every view, with how long before it was sent Zerops
 * answered that view: freshness and content in one frame. A frame past `MATE_LINK_FRAME_MAX` is
 * not sent and is logged once per Mate until one fits again. An enrolled Mate cannot admit from
 * an expired view; the log identifies the oversized org that prevented its refresh.
 *
 * @module mateAccess
 */
import {
  type ChiefMateOwner,
  type MateAccessMember,
  projectAccess,
} from "@t3tools/shared/mateAccess";
import { MATE_LINK_FRAME_MAX, type MateLinkDown, linkFrameBytes } from "@t3tools/shared/mateLink";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { Roles } from "./roles.ts";
import { Structure } from "./structure.ts";
import type { ZeropsMember, ZeropsProject } from "./zerops/api.ts";

/**
 * The access of the Mate whose project is `projectId`, from the org's members and projects; none
 * where the view holds no such project, or an ordinary project opens for nobody. A Chief without
 * an eligible registered owner has a meaningful empty answer: nobody may enter.
 */
export const accessOf = (
  view: {
    readonly members: ReadonlyArray<ZeropsMember>;
    readonly projects: ReadonlyArray<ZeropsProject>;
  },
  projectId: string,
  chief: ChiefMateOwner | null = null,
): Option.Option<ReadonlyArray<MateAccessMember>> => {
  const project = view.projects.find((candidate) => candidate.id === projectId);
  if (project === undefined) return Option.none();
  const owner =
    chief ?? (project.tags.includes("chief") ? { userId: null, ownerName: null } : null);
  const overrides: Record<string, string> = {};
  for (const grant of project.userRoles) overrides[grant.clientUserId] = grant.roleCode;
  const access = projectAccess({
    projectId,
    members: view.members.map((member) => ({
      clientUserId: member.clientUserId,
      userId: member.userId,
      orgRole: member.roleCode,
      status: member.status,
      canCreateProjects: member.canCreateProjects,
    })),
    overrides,
    chief: owner,
  });
  return access.length === 0 && owner === null ? Option.none() : Option.some(access);
};

export class MateAccess extends Context.Service<
  MateAccess,
  {
    /** The `access` frames of the Mate whose project is `projectId`: one per view that has any. */
    readonly frames: (projectId: string) => Stream.Stream<string>;
  }
>()("@t3tools/hq/mateAccess") {}

const encodeDown = (message: MateLinkDown) => JSON.stringify(message);

export const mateAccessLayer = Layer.effect(
  MateAccess,
  Effect.gen(function* () {
    const roles = yield* Roles;
    const structure = yield* Structure;
    /** The Mates whose last frame was too big, logged once until one fits again. */
    const oversized = yield* Ref.make<ReadonlySet<string>>(new Set());
    // One structure read for each source event, shared by every linked Mate. The single
    // replayed snapshot lets a newly connected Mate receive the same authoritative verdict.
    const snapshots = yield* Stream.merge(roles.views, structure.changes).pipe(
      Stream.mapEffect(() =>
        Effect.gen(function* () {
          // A concurrent platform refresh must not make an older snapshot look newer.
          const before = yield* roles.answeredAt;
          const source = yield* structure.navigation;
          const answered = before ?? (yield* roles.answeredAt);
          return answered === undefined ? Option.none() : Option.some({ source, answered });
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Mate admission could not be read", { cause }).pipe(
              Effect.as(Option.none()),
            ),
          ),
        ),
      ),
      Stream.filter(Option.isSome),
      Stream.map((snapshot) => snapshot.value),
      Stream.share({ capacity: 1, replay: 1 }),
    );
    const frames = (projectId: string) =>
      snapshots.pipe(
        Stream.mapEffect(({ source, answered }) =>
          Effect.gen(function* () {
            const project = source.facts.projects.find((candidate) => candidate.id === projectId);
            const userId = source.chiefOwners.get(projectId);
            const chief =
              userId !== undefined || project?.tags.includes("chief") === true
                ? {
                    userId: userId ?? null,
                    ownerName:
                      source.facts.members
                        .find((member) => member.userId === userId)
                        ?.name.trim() || null,
                  }
                : null;
            const access = accessOf(source.facts, projectId, chief);
            if (Option.isNone(access)) return Option.none<string>();
            const ageMs = Math.max(0, (yield* Clock.currentTimeMillis) - answered);
            const frame = encodeDown({ type: "access", ageMs, members: access.value, chief });
            const bytes = linkFrameBytes(frame);
            const logged = (yield* Ref.get(oversized)).has(projectId);
            if (bytes <= MATE_LINK_FRAME_MAX) {
              if (logged) {
                yield* Ref.update(
                  oversized,
                  (set) => new Set([...set].filter((id) => id !== projectId)),
                );
              }
              return Option.some(frame);
            }
            if (!logged) {
              yield* Ref.update(oversized, (set) => new Set([...set, projectId]));
              yield* Effect.logWarning("a Mate's access is past the link's frame bound: not sent", {
                projectId,
                bytes,
                members: access.value.length,
              });
            }
            return Option.none<string>();
          }),
        ),
        Stream.filter(Option.isSome),
        Stream.map((frame) => frame.value),
      );
    return MateAccess.of({ frames });
  }),
);
