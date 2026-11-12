/**
 * The verb rule: what a person may do in Mate, decided from Zerops roles alone — every reason a
 * refusal names, a decision's shape, and the rule for each verb HQ enforces. The client runs it over
 * its own live read of Zerops (the person's membership and each project's override for them) to
 * decide what it offers; HQ runs the same rule over the fresh read each verb carries and answers
 * the write, and its refusal wins. Nobody streams a verdict.
 *
 * Pure: no clock, no network.
 *
 * @module zeropsPermissions
 */
import {
  activeMember,
  effectiveRole,
  isMateKind,
  mayCreateProjects,
  roleAtLeast,
  type MembershipFacts,
} from "./zeropsRoles.ts";

export const REASONS = [
  "wrong_principal",
  "not_your_project",
  "not_active_member",
  "unknown_kind",
  "not_project_reader",
  "not_mate_operator",
  "app_not_seen",
  "not_structure_writer",
  "cannot_create_projects",
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
  "slot_taken",
  "not_app_developer",
  "not_app_merger",
  "not_recipe_repo",
  "author_not_in_app",
  "recipe_empty",
  "recipe_changes_files",
  "no_production",
  "not_releaser",
] as const;

export type Reason = (typeof REASONS)[number];

export type Decision =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: Reason };

const ALLOW: Decision = { allow: true };
const refuse = (reason: Reason): Decision => ({ allow: false, reason });

/**
 * What the rule reads of Zerops for one person: their membership, and each project Zerops lists
 * them with their own override there (`override` absent: their org role holds). A project Zerops
 * does not list them is `undefined`: gone, or not theirs to know.
 */
export interface PermissionFacts {
  readonly member: MembershipFacts | undefined;
  readonly project: (projectId: string) => { readonly override?: string | undefined } | undefined;
}

type Member = MembershipFacts;

const roleOn = (facts: PermissionFacts, member: Member, projectId: string) =>
  effectiveRole(facts.project(projectId)?.override, member.roleCode);

const writer = (member: Member) => roleAtLeast(member.roleCode, "ADMIN");

/** Basic user or above on one of the projects Zerops still lists. */
const developsIn = (facts: PermissionFacts, member: Member, projectIds: ReadonlyArray<string>) =>
  projectIds.some(
    (id) => facts.project(id) !== undefined && roleAtLeast(roleOn(facts, member, id), "BASIC_USER"),
  );

/** Read only or above in the organization, or on one of the application's projects. */
const seesApp = (facts: PermissionFacts, member: Member, projectIds: ReadonlyArray<string>) =>
  roleAtLeast(member.roleCode, "READ_ONLY") ||
  projectIds.some(
    (id) => facts.project(id) !== undefined && roleAtLeast(roleOn(facts, member, id), "READ_ONLY"),
  );

/** Creating an application: Zerops' own *can create projects*. */
export function createAppPermission(facts: PermissionFacts): Decision {
  const member = activeMember(facts.member);
  if (member === undefined) return refuse("not_active_member");
  return mayCreateProjects(member) ? ALLOW : refuse("cannot_create_projects");
}

/** Reading an application (`read_app`) or pushing to its code (`push_repo`), by its projects. */
export function appPermission(
  facts: PermissionFacts,
  verb: "read_app" | "push_repo",
  projectIds: ReadonlyArray<string>,
): Decision {
  const member = activeMember(facts.member);
  if (member === undefined) return refuse("not_active_member");
  if (!seesApp(facts, member, projectIds)) return refuse("app_not_seen");
  if (verb === "read_app") return ALLOW;
  return developsIn(facts, member, projectIds) ||
    (projectIds.length === 0 && roleAtLeast(member.roleCode, "BASIC_USER"))
    ? ALLOW
    : refuse("not_app_developer");
}

/** The organization's structure — applications, environments, remotes: an owner or admin. */
export function structurePermission(facts: PermissionFacts): Decision {
  const member = activeMember(facts.member);
  if (member === undefined) return refuse("not_active_member");
  return writer(member) ? ALLOW : refuse("not_structure_writer");
}

/** Adding a Mate to an application: whoever sees it and may create projects. */
export function addMatePermission(
  facts: PermissionFacts,
  projectIds: ReadonlyArray<string>,
): Decision {
  const seen = appPermission(facts, "read_app", projectIds);
  if (!seen.allow) return seen;
  return mayCreateProjects(facts.member!) ? ALLOW : refuse("cannot_create_projects");
}

/** Operating a Mate (`observe_mate`): who its door opens for, Basic user or above on its project. */
export function operateMatePermission(facts: PermissionFacts, projectId: string): Decision {
  const member = activeMember(facts.member);
  if (member === undefined) return refuse("not_active_member");
  if (facts.project(projectId) === undefined) return refuse("project_gone");
  return roleAtLeast(roleOn(facts, member, projectId), "BASIC_USER")
    ? ALLOW
    : refuse("not_mate_operator");
}

/**
 * Writing a Mate's record — making one (`create`) for a project held as `held`, or editing it: an
 * admin of its project; a project held as an environment takes no new Mate record.
 */
export function mateRecordPermission(
  facts: PermissionFacts,
  projectId: string,
  input: { readonly create: boolean; readonly held: string },
): Decision {
  const member = activeMember(facts.member);
  if (member === undefined) return refuse("not_active_member");
  if (facts.project(projectId) === undefined) return refuse("project_gone");
  if (!roleAtLeast(roleOn(facts, member, projectId), "ADMIN")) return refuse("not_project_admin");
  return input.create && (input.held === "stage" || input.held === "production")
    ? refuse("held_as_environment")
    : ALLOW;
}

/**
 * Finishing a deletion another person prepared, once Zerops proved its project gone: the delete-Mate
 * rule (`mateRecordPermission`) over the project as a gone one, which no grant names, so the
 * organization role decides — an owner or an admin. The preparer finishes their own by its receipt.
 */
export function finishDeletionPermission(facts: PermissionFacts, projectId: string): Decision {
  return mateRecordPermission(
    { member: facts.member, project: (id) => (id === projectId ? {} : facts.project(id)) },
    projectId,
    { create: false, held: "mate" },
  );
}

/**
 * Attaching a project to an application as `kind`, from how it is held now (`held`, `none` for
 * nowhere). `projectId` `null` is a project the person is about to make: theirs as its owner.
 */
export interface AttachTarget {
  readonly projectId: string | null;
  readonly projectIds: ReadonlyArray<string>;
  readonly kind: string;
  readonly held: string;
  readonly slotTaken: boolean;
}

export function attachPermission(facts: PermissionFacts, target: AttachTarget): Decision {
  const member = activeMember(facts.member);
  if (member === undefined) return refuse("not_active_member");
  const listed =
    target.projectId === null ? { override: "OWNER" } : facts.project(target.projectId);
  if (listed === undefined) return refuse("project_gone");
  if (writer(member)) return ALLOW;
  const grant = listed.override;
  if (isMateKind(target.kind)) {
    if (!(member.canCreateProjects === true && roleAtLeast(grant ?? "NO_ACCESS", "ADMIN")))
      return refuse("not_own_new_mate");
    if (target.held === "stage" || target.held === "production") return refuse("kind_class_change");
    return appPermission(facts, "read_app", target.projectIds);
  }
  if (!roleAtLeast(effectiveRole(grant, member.roleCode), "ADMIN"))
    return refuse("not_project_admin");
  if (isMateKind(target.held)) return refuse("kind_class_change");
  if (target.held !== "" && target.held !== "none") return refuse("not_structure_writer");
  if (target.projectIds.length === 0) return refuse("not_app_developer");
  const develop = appPermission(facts, "push_repo", target.projectIds);
  if (!develop.allow) return develop;
  return target.slotTaken ? refuse("slot_taken") : ALLOW;
}

/**
 * Who merges an application's changes, where it limits that (`HqMergers`): the organization's
 * owners and admins, and the people it names by Zerops user id. `undefined`: whoever may push.
 */
export interface MergeLimit {
  readonly people: ReadonlyArray<string>;
}

/** Inside an application's merge limit: an owner or admin of the organization, or a named person. */
const mergesWithin = (member: Member, limit: MergeLimit) =>
  writer(member) || (member.userId !== undefined && limit.people.includes(member.userId));

/**
 * An application's change verbs over its projects; a comment where it has none, by push rights. A
 * merge where the application limits who merges (`mergers`) also takes the organization role or a
 * place among the people it names: a grant on one of its projects is not enough.
 */
export function changePermission(
  facts: PermissionFacts,
  verb: "read_change" | "comment_change" | "merge_change" | "close_change",
  projectIds: ReadonlyArray<string>,
  mergers?: MergeLimit | null,
): Decision {
  const read = appPermission(facts, "read_app", projectIds);
  if (!read.allow || verb === "read_change") return read;
  if (verb === "comment_change" && projectIds.length === 0)
    return appPermission(facts, "push_repo", projectIds);
  const member = facts.member!;
  if (verb === "close_change" && writer(member)) return ALLOW;
  if (!developsIn(facts, member, projectIds)) return refuse("not_app_developer");
  return verb === "merge_change" && mergers != null && !mergesWithin(member, mergers)
    ? refuse("not_app_merger")
    : ALLOW;
}

/**
 * An environment's deploys: keeping its deploy token takes Full access on its project or the
 * structure; deploying again, Basic user or above on it.
 */
export function deployPermission(
  facts: PermissionFacts,
  verb: "keep_deploy_token" | "redeploy",
  projectId: string,
): Decision {
  const member = activeMember(facts.member);
  if (member === undefined) return refuse("not_active_member");
  const listed = facts.project(projectId) !== undefined;
  if (verb === "keep_deploy_token") {
    if (writer(member)) return listed ? ALLOW : refuse("project_gone");
    return roleAtLeast(roleOn(facts, member, projectId), "ADMIN")
      ? ALLOW
      : refuse("not_project_admin");
  }
  return listed && roleAtLeast(roleOn(facts, member, projectId), "BASIC_USER")
    ? ALLOW
    : refuse("not_app_developer");
}

/** Where an application releases to: its Zerops production project, a Git production, or none. */
export type ReleaseProduction =
  | { readonly kind: "zerops"; readonly projectId: string }
  | { readonly kind: "git" }
  | null;

/**
 * Releasing: to Git by whoever merges, the application's merge limit (`mergers`) included; to
 * Zerops by Basic user or above on the production.
 */
export function releasePermission(
  facts: PermissionFacts,
  projectIds: ReadonlyArray<string>,
  production: ReleaseProduction,
  mergers?: MergeLimit | null,
): Decision {
  if (production?.kind === "git") {
    const merge = changePermission(facts, "merge_change", projectIds, mergers);
    return merge.allow || merge.reason !== "not_app_developer" ? merge : refuse("not_releaser");
  }
  const seen = appPermission(
    facts,
    "read_app",
    production === null ? projectIds : [...projectIds, production.projectId],
  );
  if (!seen.allow) return seen;
  if (production === null) return refuse("no_production");
  const member = facts.member!;
  const listed = facts.project(production.projectId) !== undefined;
  if (listed && roleAtLeast(roleOn(facts, member, production.projectId), "BASIC_USER"))
    return ALLOW;
  return !listed && writer(member) ? refuse("project_gone") : refuse("not_releaser");
}

/**
 * Taking a project out of its application: an environment by the structure's writers, a Mate by an
 * admin of its project. Who a person is on it comes before whether it exists.
 */
export function detachPermission(
  facts: PermissionFacts,
  projectId: string,
  held: string,
): Decision {
  const member = activeMember(facts.member);
  if (member === undefined) return refuse("not_active_member");
  const projectAdmin = roleAtLeast(roleOn(facts, member, projectId), "ADMIN");
  if (!writer(member) && !projectAdmin) return refuse("not_project_admin");
  if (facts.project(projectId) === undefined) return refuse("project_gone");
  if (writer(member) && !isMateKind(held)) return ALLOW;
  if (!projectAdmin) return refuse("not_project_admin");
  return isMateKind(held) ? ALLOW : refuse("not_structure_writer");
}
