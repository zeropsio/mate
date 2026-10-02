/**
 * Who may do what with HQ's structure and a Mate's credential: one pure function, `can`, over the
 * facts Zerops gives (the org's members and projects, read by whoever enforces) and the target as
 * HQ holds it now. HQ enforces it; the client asks it what to offer.
 *
 * - **The verbs** are the places that decide today: reading a project or an application, writing an
 *   application, attaching, moving or detaching a project, a Mate's record, and a Mate's enrollment.
 * - **The target carries its current kind** (`held`), never only the requested one: a change between a
 *   Mate and an environment is the structure's writers' alone, whoever owns the project.
 * - **Freshness is a type:** every verb that writes takes `Facts<"fresh">`, read at the moment of
 *   use; only the reads take facts up to the cache's age.
 * - **The checks run in one order** — an active member, the role, the project's existence, its
 *   kind — so a project id tells someone without the role nothing about whether it exists; for a
 *   Mate, being HQ's Mate stands in for the role.
 * - **A value this build does not know** decides as `NO_ACCESS` when it is a role (`asOrgRole`)
 *   and denies when it is a status or a kind.
 *
 * A refusal is a reason code; the words for a person are the client's.
 *
 * @module zeropsPermissions
 */
import {
  type ZeropsOrgRole,
  ZEROPS_ACTIVE_MEMBER_STATUS,
  asOrgRole,
  isMateKind,
  roleAtLeast,
} from "./zeropsRoles.ts";

/** A member of the org as its member list gives it; a role and a status as the platform spells them. */
export interface FactMember {
  readonly userId: string;
  /** The member row's own id: what a project's grants name. */
  readonly clientUserId: string;
  readonly roleCode: string;
  readonly status: string;
  readonly canCreateProjects: boolean;
}

/** A project the org still has, with its grants (`userRoles`). */
export interface FactProject {
  readonly id: string;
  readonly userRoles: ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }>;
}

export type Freshness = "fresh" | "cached";

/** The org as Zerops gave it: read now (`fresh`), or from a cache (`cached`). */
export interface Facts<F extends Freshness = Freshness> {
  readonly freshness: F;
  readonly members: ReadonlyArray<FactMember>;
  readonly projects: ReadonlyArray<FactProject>;
}

export type Principal =
  | { readonly kind: "person"; readonly userId: string }
  /** A Mate proving its project (its container's own Zerops key wrote the challenge). */
  | { readonly kind: "mate"; readonly projectId: string };

/**
 * What HQ holds a project as now: `none`; `mate` for a Mate in no application; else its kind in its
 * application (`mate`, `devstage`, `stage`, `production`). As stored — a value this build does not
 * know denies.
 */
export type Held = string;

export interface ProjectTarget {
  readonly projectId: string;
  readonly held: Held;
}

/** A project placed into an application as `to`, beside the application's projects. */
export interface PlacementTarget extends ProjectTarget {
  readonly to: string;
  readonly appProjectIds: ReadonlyArray<string>;
}

export interface Targets {
  readonly read_project: { readonly projectId: string };
  readonly read_app: { readonly projectIds: ReadonlyArray<string> };
  readonly create_app: null;
  readonly rename_app: null;
  readonly attach: PlacementTarget;
  readonly move: PlacementTarget;
  readonly detach: ProjectTarget;
  readonly create_mate_record: ProjectTarget;
  readonly edit_mate_record: ProjectTarget;
  readonly enroll_mate: ProjectTarget;
}

export type Verb = keyof Targets;

/** The verbs that only read; every other one writes and takes `Facts<"fresh">`. */
export type ReadVerb = "read_project" | "read_app";

/** Not distributive: a verb known only as `Verb` may be a write, so it takes `Facts<"fresh">`. */
export type FactsFor<V extends Verb> = [V] extends [ReadVerb] ? Facts : Facts<"fresh">;

export const REASONS = [
  "wrong_principal",
  "not_your_project",
  "not_active_member",
  "unknown_kind",
  "not_project_reader",
  "app_not_seen",
  "not_structure_writer",
  "not_project_admin",
  "not_own_new_mate",
  "kind_class_change",
  "project_gone",
  "held_as_environment",
  "not_a_mate",
] as const;

export type Reason = (typeof REASONS)[number];

export type Decision =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: Reason };

const ALLOW: Decision = { allow: true };
const deny = (reason: Reason): Decision => ({ allow: false, reason });

const KINDS: ReadonlySet<string> = new Set(["mate", "devstage", "stage", "production"]);
const knownHeld = (held: string) => held === "none" || KINDS.has(held);

/** Whether placing a project held as `held` into `to` changes it between a Mate and an environment. */
const classChange = (held: string, to: string) =>
  held !== "none" && isMateKind(held) !== isMateKind(to);

type Request = { readonly [V in Verb]: { readonly verb: V; readonly target: Targets[V] } }[Verb];

export function can<V extends Verb>(
  principal: Principal,
  verb: V,
  target: Targets[V],
  facts: FactsFor<V>,
): Decision {
  // `verb` and `target` vary together by `Targets`; the union lets each case read its own target.
  return decide(principal, { verb, target } as Request, facts);
}

function decide(principal: Principal, request: Request, facts: Facts): Decision {
  const projectOf = (projectId: string) =>
    facts.projects.find((project) => project.id === projectId);

  if (request.verb === "enroll_mate") {
    const { projectId, held } = request.target;
    if (principal.kind !== "mate") return deny("wrong_principal");
    if (principal.projectId !== projectId) return deny("not_your_project");
    if (!knownHeld(held)) return deny("unknown_kind");
    // Being HQ's Mate comes before existence: the door is open to anyone, and tells nobody whether
    // a project it holds as no Mate exists.
    if (!isMateKind(held)) return deny("not_a_mate");
    return projectOf(projectId) === undefined ? deny("project_gone") : ALLOW;
  }

  if (principal.kind !== "person") return deny("wrong_principal");
  const member = facts.members.find(
    (candidate) =>
      candidate.userId === principal.userId && candidate.status === ZEROPS_ACTIVE_MEMBER_STATUS,
  );
  if (member === undefined) return deny("not_active_member");

  const writer = roleAtLeast(member.roleCode, "ADMIN");
  const grantOn = (projectId: string) =>
    projectOf(projectId)?.userRoles.find((entry) => entry.clientUserId === member.clientUserId)
      ?.roleCode;
  /** Their grant there, else their org role; none on a project the org does not have. */
  const roleOn = (projectId: string): ZeropsOrgRole =>
    projectOf(projectId) === undefined
      ? "NO_ACCESS"
      : asOrgRole(grantOn(projectId) ?? member.roleCode);
  const readsProject = (projectId: string) => roleAtLeast(roleOn(projectId), "READ_ONLY");
  /** An application is seen from org Read only up, or through one of its projects (#219). */
  const seesApp = (projectIds: ReadonlyArray<string>) =>
    roleAtLeast(member.roleCode, "READ_ONLY") || projectIds.some(readsProject);
  const exists = (projectId: string) =>
    projectOf(projectId) === undefined ? deny("project_gone") : ALLOW;
  /**
   * The role a person lacks on a project: `project_gone` to a writer, who sees the whole org, for a
   * project it no longer has; to anyone else only the role, so an id tells them nothing.
   */
  const lacking = (projectId: string, reason: Reason) =>
    writer && projectOf(projectId) === undefined ? deny("project_gone") : deny(reason);

  switch (request.verb) {
    case "read_project":
      return readsProject(request.target.projectId) ? ALLOW : deny("not_project_reader");
    case "read_app":
      return seesApp(request.target.projectIds) ? ALLOW : deny("app_not_seen");
    case "create_app":
    case "rename_app":
      return writer ? ALLOW : deny("not_structure_writer");
    case "attach":
    case "move": {
      const { projectId, held, to, appProjectIds } = request.target;
      if (!knownHeld(held) || !KINDS.has(to)) return deny("unknown_kind");
      if (classChange(held, to)) return writer ? exists(projectId) : deny("kind_class_change");
      if (!isMateKind(to)) return writer ? exists(projectId) : deny("not_structure_writer");
      if (request.verb === "attach") {
        // A structure writer, or a member who can create projects attaching their own new Mate:
        // their own grant there, never the org role's fallback (parity B #42, #53).
        const ownNewMate =
          member.canCreateProjects && roleAtLeast(grantOn(projectId), "BASIC_USER");
        if (!writer && !ownNewMate) return deny("not_own_new_mate");
        if (!writer && !seesApp(appProjectIds)) return deny("app_not_seen");
        return exists(projectId);
      }
      if (!roleAtLeast(roleOn(projectId), "ADMIN")) return lacking(projectId, "not_project_admin");
      if (!seesApp(appProjectIds)) return deny("app_not_seen");
      return ALLOW;
    }
    case "detach": {
      const { projectId, held } = request.target;
      if (!knownHeld(held)) return deny("unknown_kind");
      if (isMateKind(held)) {
        return roleAtLeast(roleOn(projectId), "ADMIN")
          ? ALLOW
          : lacking(projectId, "not_project_admin");
      }
      return writer ? exists(projectId) : deny("not_structure_writer");
    }
    case "create_mate_record":
    case "edit_mate_record": {
      const { projectId, held } = request.target;
      if (!knownHeld(held)) return deny("unknown_kind");
      if (!roleAtLeast(roleOn(projectId), "ADMIN")) return lacking(projectId, "not_project_admin");
      // An application's environment is no Mate, whoever asks (S-1).
      if (request.verb === "create_mate_record" && held !== "none" && !isMateKind(held)) {
        return deny("held_as_environment");
      }
      return ALLOW;
    }
  }
}
