/**
 * Who may do what with HQ's structure and a Mate's credential: one pure function, `can`, over the
 * facts Zerops gives (the org's members and projects, read by whoever enforces) and the target as
 * HQ holds it now. HQ enforces it; the client asks it what to offer.
 *
 * - **The verbs** are the places that decide today: reading a project or an application, writing an
 *   application, attaching, moving or detaching a project, a Mate's record, a Mate's enrollment,
 *   following a Mate's live summary (who may operate it: open it, as its door does), and reading and
 *   commenting on an application's changes (`hqChanges.ts`), as main's Gitea read them.
 * - **A Mate's own verbs** — its enrollment, and its repositories, its own changes and git in the
 *   application HQ holds it in — are a Mate's alone, for its own project only; it is refused every
 *   other verb.
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

/** A Mate's own project as HQ holds it: its kind and the application it is in (`null`: none). */
export interface MateTarget extends ProjectTarget {
  readonly appId: string | null;
}

/** A change a Mate edits, as HQ records it (`null`: HQ has no such change). */
export interface MateChangeTarget extends MateTarget {
  readonly change: { readonly mateProjectId: string } | null;
}

/** A repository a Mate fetches: the application it is a repository of. */
export interface MateFetchTarget extends MateTarget {
  readonly repoAppId: string;
}

/** A project placed into an application as `to`, beside the application's projects. */
export interface PlacementTarget extends ProjectTarget {
  readonly to: string;
  readonly appProjectIds: ReadonlyArray<string>;
}

export interface Targets {
  readonly read_project: { readonly projectId: string };
  readonly observe_mate: { readonly projectId: string };
  readonly read_app: { readonly projectIds: ReadonlyArray<string> };
  /** An application's changes, as its projects. */
  readonly read_change: { readonly projectIds: ReadonlyArray<string> };
  /** A comment on one of an application's changes: whoever reads the change. */
  readonly comment_change: { readonly projectIds: ReadonlyArray<string> };
  readonly create_app: null;
  readonly rename_app: null;
  readonly attach: PlacementTarget;
  readonly move: PlacementTarget;
  readonly detach: ProjectTarget;
  readonly create_mate_record: ProjectTarget;
  readonly edit_mate_record: ProjectTarget;
  readonly enroll_mate: ProjectTarget;
  readonly ensure_repo: MateTarget;
  readonly open_change: MateTarget;
  readonly edit_change: MateChangeTarget;
  readonly fetch_repo: MateFetchTarget;
}

export type Verb = keyof Targets;

/** The verbs that only read; every other one writes and takes `Facts<"fresh">`. */
export type ReadVerb = "read_project" | "read_app" | "read_change" | "observe_mate" | "fetch_repo";

/** Not distributive: a verb known only as `Verb` may be a write, so it takes `Facts<"fresh">`. */
export type FactsFor<V extends Verb> = [V] extends [ReadVerb] ? Facts : Facts<"fresh">;

export const REASONS = [
  "wrong_principal",
  "not_your_project",
  "not_active_member",
  "unknown_kind",
  "not_project_reader",
  "not_mate_operator",
  "app_not_seen",
  "not_structure_writer",
  "not_project_admin",
  "not_own_new_mate",
  "kind_class_change",
  "project_gone",
  "held_as_environment",
  "not_a_mate",
  "mate_not_in_app",
  "unknown_change",
  "not_your_change",
  "not_your_app",
  "changes_not_seen",
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

  if (
    request.verb === "ensure_repo" ||
    request.verb === "open_change" ||
    request.verb === "edit_change" ||
    request.verb === "fetch_repo"
  ) {
    // A Mate's work on its application: its repositories, its changes and its git. Only for its
    // own project, and only in the application HQ holds it in.
    const { projectId, appId, held } = request.target;
    if (principal.kind !== "mate") return deny("wrong_principal");
    if (principal.projectId !== projectId) return deny("not_your_project");
    if (appId === null) return deny("mate_not_in_app");
    if (!knownHeld(held)) return deny("unknown_kind");
    if (!isMateKind(held)) return deny("not_a_mate");
    if (request.verb === "edit_change") {
      // Its own change only: a sibling Mate's is no change of its own to word.
      const { change } = request.target;
      if (change === null) return deny("unknown_change");
      if (change.mateProjectId !== projectId) return deny("not_your_change");
    }
    if (request.verb === "fetch_repo" && request.target.repoAppId !== appId) {
      return deny("not_your_app");
    }
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
  /**
   * An application's changes are read as main's Gitea read them: from org Read only up, or with
   * Basic user or above on one of its projects — a Read only grant shows the application, not
   * its changes.
   */
  const seesChanges = (projectIds: ReadonlyArray<string>) =>
    roleAtLeast(member.roleCode, "READ_ONLY") ||
    projectIds.some((projectId) => roleAtLeast(roleOn(projectId), "BASIC_USER"));
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
    case "read_change":
    case "comment_change":
      if (!seesApp(request.target.projectIds)) return deny("app_not_seen");
      return seesChanges(request.target.projectIds) ? ALLOW : deny("changes_not_seen");
    case "observe_mate":
      // Who may operate a Mate is who its door opens for: Basic user or above there. No kind check:
      // HQ has a live summary only for a project it holds as a Mate.
      return roleAtLeast(roleOn(request.target.projectId), "BASIC_USER")
        ? ALLOW
        : deny("not_mate_operator");
    case "create_app":
    case "rename_app":
      return writer ? ALLOW : deny("not_structure_writer");
    // Who a person is on the project comes before what HQ holds it as, so a refusal never tells
    // someone without that role the project's kind; the kind asked for is their own input.
    case "attach":
    case "move": {
      const { projectId, held, to, appProjectIds } = request.target;
      if (!KINDS.has(to)) return deny("unknown_kind");
      if (writer) {
        if (!knownHeld(held)) return deny("unknown_kind");
        if (classChange(held, to) || !isMateKind(to) || request.verb === "attach") {
          return exists(projectId);
        }
      }
      // A member who can create projects attaches their own new Mate: their own grant there, never
      // the org role's fallback (parity B #42, #53). Moving takes the project's admin.
      const lacksRole =
        request.verb === "attach"
          ? !(member.canCreateProjects && roleAtLeast(grantOn(projectId), "BASIC_USER"))
          : !roleAtLeast(roleOn(projectId), "ADMIN");
      if (lacksRole) {
        // Placing an environment is the writers' alone, whoever asks.
        if (!isMateKind(to)) return deny("not_structure_writer");
        return request.verb === "attach"
          ? deny("not_own_new_mate")
          : lacking(projectId, "not_project_admin");
      }
      if (!knownHeld(held)) return deny("unknown_kind");
      // A change between a Mate and an environment is the writers' alone too.
      if (classChange(held, to)) return deny("kind_class_change");
      if (!isMateKind(to)) return deny("not_structure_writer");
      if (!seesApp(appProjectIds)) return deny("app_not_seen");
      return exists(projectId);
    }
    case "detach": {
      const { projectId, held } = request.target;
      if (!writer && !roleAtLeast(roleOn(projectId), "ADMIN")) return deny("not_project_admin");
      if (!knownHeld(held)) return deny("unknown_kind");
      if (writer && !isMateKind(held)) return exists(projectId);
      if (!roleAtLeast(roleOn(projectId), "ADMIN")) return lacking(projectId, "not_project_admin");
      return isMateKind(held) ? ALLOW : deny("not_structure_writer");
    }
    case "create_mate_record":
    case "edit_mate_record": {
      const { projectId, held } = request.target;
      if (!roleAtLeast(roleOn(projectId), "ADMIN")) return lacking(projectId, "not_project_admin");
      if (!knownHeld(held)) return deny("unknown_kind");
      // An application's environment is no Mate, whoever asks (S-1).
      if (request.verb === "create_mate_record" && held !== "none" && !isMateKind(held)) {
        return deny("held_as_environment");
      }
      return ALLOW;
    }
  }
}
