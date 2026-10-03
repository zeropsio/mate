/**
 * A Mate's access as HQ relays it (`access`, `@t3tools/shared/mateLink`): who the Mate's project
 * opens for and whom it lists, computed from the org's view HQ already reads (`roles.ts`) by the
 * rule a Mate's own read applies (`@t3tools/shared/mateAccess`), so a Mate need not read its org's
 * whole member list itself (R6).
 *
 * Sent whole down the Mate's link after every view, with how long before it was sent Zerops
 * answered that view: freshness and content in one frame. A frame past `MATE_LINK_FRAME_MAX` is
 * not sent — the Mate reads Zerops itself — and is logged once per Mate until one fits again, so a
 * large org is seen, not silent.
 *
 * @module mateAccess
 */
import { type MateAccessMember, projectAccess } from "@t3tools/shared/mateAccess";
import { MATE_LINK_FRAME_MAX, type MateLinkDown, linkFrameBytes } from "@t3tools/shared/mateLink";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { Roles } from "./roles.ts";
import type { ZeropsMember, ZeropsProject } from "./zerops/api.ts";

/**
 * The access of the Mate whose project is `projectId`, from the org's members and projects; none
 * where the view holds no such project, or where it opens for nobody — an org always has an owner,
 * so that is a view to say nothing on, never "nobody may enter".
 */
export const accessOf = (
  view: {
    readonly members: ReadonlyArray<ZeropsMember>;
    readonly projects: ReadonlyArray<ZeropsProject>;
  },
  projectId: string,
): Option.Option<ReadonlyArray<MateAccessMember>> => {
  const project = view.projects.find((candidate) => candidate.id === projectId);
  if (project === undefined) return Option.none();
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
  });
  return access.length === 0 ? Option.none() : Option.some(access);
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
    /** The Mates whose last frame was too big, logged once until one fits again. */
    const oversized = yield* Ref.make<ReadonlySet<string>>(new Set());
    const frames = (projectId: string) =>
      roles.views.pipe(
        Stream.mapEffect((seen) =>
          Effect.gen(function* () {
            const access = accessOf(seen.view, projectId);
            if (Option.isNone(access)) return Option.none<string>();
            const ageMs = Math.max(0, (yield* Clock.currentTimeMillis) - seen.answered);
            const frame = encodeDown({ type: "access", ageMs, members: access.value });
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
