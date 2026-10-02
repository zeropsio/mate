/**
 * Who may do and see what, from Zerops at the moment of use. HQ reads its org's members and
 * projects with its own Read only credential and keeps that view for at most 30 s (SPEC §4); a
 * write reads it fresh. Nothing about people is stored in HQ.
 *
 * @module roles
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import {
  ZEROPS_ACTIVE_MEMBER_STATUS,
  type ZeropsOrgRole,
  effectiveProjectRole,
} from "@t3tools/shared/zeropsRoles";

import {
  ZeropsApi,
  type ZeropsError,
  type ZeropsMember,
  type ZeropsProject,
  ZeropsRefused,
  ZeropsUnavailable,
} from "./zerops/api.ts";

export interface OrgView {
  readonly orgId: string;
  readonly members: ReadonlyArray<ZeropsMember>;
  readonly projects: ReadonlyArray<ZeropsProject>;
}

export const activeMember = (view: OrgView, userId: string) =>
  view.members.find(
    (member) => member.userId === userId && member.status === ZEROPS_ACTIVE_MEMBER_STATUS,
  );

const ROLES: ReadonlyArray<ZeropsOrgRole> = [
  "NO_ACCESS",
  "READ_ONLY",
  "BASIC_USER",
  "ADMIN",
  "OWNER",
];

/** A role this build does not know is no role, as on main (`asOrgRole`): it shuts, never opens. */
const asRole = (code: string | undefined): ZeropsOrgRole =>
  ROLES.find((role) => role === code) ?? "NO_ACCESS";

export const atLeast = (role: ZeropsOrgRole, floor: ZeropsOrgRole): boolean =>
  ROLES.indexOf(role) >= ROLES.indexOf(floor);

/**
 * The role a person has on a project, by main's own function (`effectiveProjectRole`): their grant
 * there (`userRoles`), else their org role — a grant can lower even an owner. No active
 * membership, no project: none.
 */
export const effectiveRole = (view: OrgView, userId: string, projectId: string): ZeropsOrgRole => {
  const member = activeMember(view, userId);
  const project = view.projects.find((candidate) => candidate.id === projectId);
  if (member === undefined || project === undefined) return "NO_ACCESS";
  const grant = project.userRoles.find((entry) => entry.clientUserId === member.clientUserId);
  return effectiveProjectRole(
    {
      person: {
        id: member.userId,
        orgRole: asRole(member.roleCode),
        status: member.status,
        canCreateProjects: member.canCreateProjects,
      },
      overrides: grant === undefined ? {} : { [projectId]: asRole(grant.roleCode) },
      registry: { groups: [] },
    },
    projectId,
  );
};

/** Who writes the structure: an active org owner or admin, as main's `canWriteRegistry`. */
export const canWriteStructure = (view: OrgView, userId: string): boolean =>
  atLeast(asRole(activeMember(view, userId)?.roleCode), "ADMIN");

/**
 * Who renames a Mate or changes its face: an owner or admin of its project there (their grant,
 * else their org role) — main's `resolveMateVerbs(...).rename`, the gate of both its rename and its
 * face dialog. A Mate's creator is its project's owner.
 */
export const canEditMate = (view: OrgView, userId: string, projectId: string): boolean =>
  atLeast(effectiveRole(view, userId, projectId), "ADMIN");

/** Whether a person sees a project: Zerops still has it, and their role on it is above none. */
export const sees = (view: OrgView, userId: string, projectId: string): boolean =>
  atLeast(effectiveRole(view, userId, projectId), "READ_ONLY");

/** Whether a person sees an application: org Read only or above, or one of its projects (#219). */
export const seesApp = (view: OrgView, userId: string, projectIds: ReadonlyArray<string>) =>
  atLeast(asRole(activeMember(view, userId)?.roleCode), "READ_ONLY") ||
  projectIds.some((projectId) => sees(view, userId, projectId));

/**
 * Who attaches a Mate to an existing application (main's Add Mate with a recipe tier, parity B #42,
 * #53): a structure writer; or a member who can create projects, attaching their own new Mate —
 * their OWN grant on the project (what Zerops leaves its creator) Basic user or above, never the
 * org role's fallback — to an application they see. A creator Zerops leaves no grant on their new
 * project (an org Basic user's may get none: unmeasured) needs an owner or admin to attach it.
 */
export const canAttachMate = (
  view: OrgView,
  userId: string,
  projectId: string,
  appProjectIds: ReadonlyArray<string>,
): boolean => {
  if (canWriteStructure(view, userId)) return true;
  const member = activeMember(view, userId);
  const grant = view.projects
    .find((project) => project.id === projectId)
    ?.userRoles.find((entry) => entry.clientUserId === member?.clientUserId);
  return (
    member?.canCreateProjects === true &&
    atLeast(asRole(grant?.roleCode), "BASIC_USER") &&
    seesApp(view, userId, appProjectIds)
  );
};

export class Roles extends Context.Service<
  Roles,
  {
    /** The org's view, at most 30 s old. */
    readonly view: Effect.Effect<OrgView, ZeropsError>;
    /** The org's view read now, for a write. */
    readonly fresh: Effect.Effect<OrgView, ZeropsError>;
    /**
     * Whether Zerops still has a project, read by its id: a `not_found` refusal is gone, any other
     * failure no answer.
     */
    readonly exists: (projectId: string) => Effect.Effect<boolean, ZeropsError>;
  }
>()("@t3tools/hq/roles") {}

const VIEW_TTL = Duration.seconds(30);

export const rolesLayer = (options: {
  readonly hqProjectId: string;
  /** `HQ_ORG_TOKEN`. */
  readonly credential: Option.Option<Redacted.Redacted>;
  /** How old a view may be served; 30 s. */
  readonly viewTtl?: Duration.Duration;
}): Layer.Layer<Roles, never, ZeropsApi> =>
  Layer.effect(
    Roles,
    Effect.gen(function* () {
      const api = yield* ZeropsApi;
      const cached = yield* Ref.make<{ readonly view: OrgView; readonly at: number } | undefined>(
        undefined,
      );
      const permit = yield* Semaphore.make(1);
      const credential = Effect.fromOption(options.credential).pipe(
        Effect.mapError(
          () =>
            new ZeropsRefused({
              operation: "view",
              reason: "unauthorized",
              status: 0,
              code: "noCredential",
            }),
        ),
      );
      const exists = (projectId: string) =>
        Effect.flatMap(credential, (own) => api.project(projectId)(own)).pipe(
          Effect.as(true),
          Effect.catchIf(
            (error) => error._tag === "ZeropsRefused" && error.reason === "not_found",
            () => Effect.succeed(false),
          ),
        );
      const read = Effect.gen(function* () {
        const own = yield* credential;
        const { orgId } = yield* api.project(options.hqProjectId)(own);
        const [members, projects] = yield* Effect.all(
          [api.members(orgId)(own), api.projects(orgId)(own)],
          { concurrency: 2 },
        );
        // An org always has its owner: an empty list is an outage dressed as an answer.
        if (members.length === 0) {
          return yield* new ZeropsUnavailable({
            operation: "members",
            message: "empty member list",
          });
        }
        return { orgId, members, projects };
      });
      /**
       * A view read no earlier than `since`. One read at a time: whoever waited for it takes the
       * one that just finished, if it started late enough. A failure is never kept.
       */
      const readSince = (since: number) =>
        Semaphore.withPermits(
          permit,
          1,
        )(
          Effect.gen(function* () {
            const hit = yield* Ref.get(cached);
            if (hit !== undefined && hit.at >= since) return hit.view;
            const at = yield* Clock.currentTimeMillis;
            const view = yield* read;
            yield* Ref.set(cached, { view, at });
            return view;
          }),
        );
      const fresh = Effect.flatMap(Clock.currentTimeMillis, readSince);
      const view = Effect.flatMap(Clock.currentTimeMillis, (now) =>
        readSince(now - Duration.toMillis(options.viewTtl ?? VIEW_TTL) + 1),
      );
      return Roles.of({ view, fresh, exists });
    }),
  );
