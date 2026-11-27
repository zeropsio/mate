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
  projectReach,
  roleAtLeast,
  type MembershipFacts,
} from "./zeropsRoles.ts";

const REASONS = [
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
  "no_own_mate",
  "task_not_queued",
  "task_not_taken",
  "task_not_live",
  "not_task_taker",
  "not_task_putter",
  "not_task_stopper",
  "not_pool_held",
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

/** How far a role reaches on a project (`projectReach`): sees it, works on it, administers it. */
const reads = (role: string | undefined) => projectReach(role) !== "none";
const works = (role: string | undefined) => {
  const reach = projectReach(role);
  return reach === "work" || reach === "administer";
};
const administers = (role: string | undefined) => projectReach(role) === "administer";

const writer = (member: Member) => roleAtLeast(member.roleCode, "ADMIN");

/** Basic user or above on one of the projects Zerops still lists. */
const developsIn = (facts: PermissionFacts, member: Member, projectIds: ReadonlyArray<string>) =>
  projectIds.some((id) => facts.project(id) !== undefined && works(roleOn(facts, member, id)));

/** Read only or above in the organization, or on one of the application's projects. */
const seesApp = (facts: PermissionFacts, member: Member, projectIds: ReadonlyArray<string>) =>
  reads(member.roleCode) ||
  projectIds.some((id) => facts.project(id) !== undefined && reads(roleOn(facts, member, id)));

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
    (projectIds.length === 0 && works(member.roleCode))
    ? ALLOW
    : refuse("not_app_developer");
}

/**
 * The organization's structure — applications, environments, remotes, its automated Mates' key, its
 * tasks' stops, its GitHub app: an owner or admin.
 */
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
  return works(roleOn(facts, member, projectId)) ? ALLOW : refuse("not_mate_operator");
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
  if (!administers(roleOn(facts, member, projectId))) return refuse("not_project_admin");
  return input.create && (input.held === "stage" || input.held === "production")
    ? refuse("held_as_environment")
    : ALLOW;
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
    if (!(member.canCreateProjects === true && administers(grant)))
      return refuse("not_own_new_mate");
    if (target.held === "stage" || target.held === "production") return refuse("kind_class_change");
    return appPermission(facts, "read_app", target.projectIds);
  }
  if (!administers(effectiveRole(grant, member.roleCode))) return refuse("not_project_admin");
  if (isMateKind(target.held)) return refuse("kind_class_change");
  if (target.held !== "" && target.held !== "none") return refuse("not_structure_writer");
  if (target.projectIds.length === 0) return refuse("not_app_developer");
  const develop = appPermission(facts, "push_repo", target.projectIds);
  if (!develop.allow) return develop;
  return target.slotTaken ? refuse("slot_taken") : ALLOW;
}

/**
 * Setting a Mate up on the project that holds it, as HQ's start decides it: `add_mate` and `attach`
 * in its application, or, held in none, making its record.
 */
export function setUpMatePermission(
  facts: PermissionFacts,
  projectId: string,
  projectIds: ReadonlyArray<string>,
  held: string,
): Decision {
  if (projectIds.length === 0)
    return mateRecordPermission(facts, projectId, { create: true, held });
  const adds = addMatePermission(facts, projectIds);
  if (!adds.allow) return adds;
  return attachPermission(facts, { projectId, projectIds, kind: "mate", held, slotTaken: false });
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
 * place among the people it names: a grant on one of its projects is not enough. Asking for a
 * merge (`ask_merge_change`) is the merge without that limit: whoever it holds may ask.
 */
export function changePermission(
  facts: PermissionFacts,
  verb: "read_change" | "comment_change" | "merge_change" | "ask_merge_change" | "close_change",
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
 * An environment's deploys: keeping its deploy token takes Basic user or above on its project or
 * the structure; deploying again, Basic user or above on it — and, on a production whose application
 * limits who merges (`productionMergers`), a place inside that limit: the same people release.
 * A stage passes none.
 */
export function deployPermission(
  facts: PermissionFacts,
  verb: "keep_deploy_token" | "redeploy",
  projectId: string,
  productionMergers?: MergeLimit | null,
): Decision {
  const member = activeMember(facts.member);
  if (member === undefined) return refuse("not_active_member");
  const listed = facts.project(projectId) !== undefined;
  if (verb === "keep_deploy_token") {
    if (writer(member)) return listed ? ALLOW : refuse("project_gone");
    return listed && works(roleOn(facts, member, projectId)) ? ALLOW : refuse("not_app_developer");
  }
  if (!(listed && works(roleOn(facts, member, projectId)))) return refuse("not_app_developer");
  return productionMergers != null && !mergesWithin(member, productionMergers)
    ? refuse("not_app_merger")
    : ALLOW;
}

/** Where an application releases to: its Zerops production project, a Git production, or none. */
export type ReleaseProduction =
  | { readonly kind: "zerops"; readonly projectId: string }
  | { readonly kind: "git" }
  | null;

/**
 * Releasing: to Git by whoever merges; to Zerops by Basic user or above on the production. Where
 * the application limits who merges (`mergers`), the same people release to either: a person the
 * limit holds is refused `not_app_merger`, after the role that would otherwise release.
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
  if (listed && works(roleOn(facts, member, production.projectId)))
    return mergers != null && !mergesWithin(member, mergers) ? refuse("not_app_merger") : ALLOW;
  return !listed && writer(member) ? refuse("project_gone") : refuse("not_releaser");
}

/**
 * Deleting a stage's or a production's Zerops project with its application: an admin of that
 * project, as Zerops itself lets only full access delete a project, the organization's own role
 * lowered there included. A project Zerops does not list is gone, or not theirs to know.
 */
export function deleteProjectPermission(facts: PermissionFacts, projectId: string): Decision {
  const member = activeMember(facts.member);
  if (member === undefined) return refuse("not_active_member");
  if (facts.project(projectId) === undefined) return refuse("project_gone");
  return administers(roleOn(facts, member, projectId)) ? ALLOW : refuse("not_project_admin");
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
  const projectAdmin = administers(roleOn(facts, member, projectId));
  if (!writer(member) && !projectAdmin) return refuse("not_project_admin");
  if (facts.project(projectId) === undefined) return refuse("project_gone");
  if (writer(member) && !isMateKind(held)) return ALLOW;
  if (!projectAdmin) return refuse("not_project_admin");
  return isMateKind(held) ? ALLOW : refuse("not_structure_writer");
}

/**
 * A task of an application's Board, as its verbs read it: where it stands as HQ stores it
 * (`stored` — a taken task whose every change closed unmerged is still `taken`, though HQ shows it
 * `closed`: the verbs decide on what it is, the Board draws what HQ shows), who put it there (the
 * person who put it, from a conversation or on the Board directly, by Zerops user id; `null` for
 * every other source), the least Board protocol a Mate reads its source at
 * (`mateBoardProtocolOf`), and who has it.
 */
export interface BoardTask {
  readonly stored: string;
  readonly putBy: string | null;
  readonly protocol: number;
  readonly taker:
    | { readonly kind: "pool"; readonly mateProjectId: string }
    | { readonly kind: "person"; readonly userId: string; readonly mateProjectId: string }
    | null;
}

/**
 * One of the application's Mates, as a Take reads it: whom HQ names its owner, whether it is
 * automated, and the Board protocol its server reads (`identity.board`, the `MATE_BOARD_PROTOCOL`
 * its overview advertises; 0 where it says none): one below a task's ignores the task it is sent,
 * so it would never be linked to its conversation or end.
 */
export interface BoardMate {
  readonly projectId: string;
  readonly ownerUserId: string | undefined;
  readonly automated: boolean;
  readonly boardProtocol: number;
}

/** A task still on the Board: queued, handed out, at work, waiting on a person, or taken. */
const LIVE_TASK: ReadonlySet<string> = new Set([
  "queued",
  "assigned",
  "working",
  "waiting",
  "taken",
]);

const takes = (member: Member, task: BoardTask) =>
  task.taker?.kind === "person" &&
  member.userId !== undefined &&
  task.taker.userId === member.userId;

const puts = (member: Member, task: BoardTask) =>
  task.putBy !== null && member.userId !== undefined && task.putBy === member.userId;

/**
 * Putting work on an application's Board (`put_task`) from a conversation of one of its Mates:
 * whoever sees the application, from a Mate in it.
 */
export function putTaskPermission(
  facts: PermissionFacts,
  projectIds: ReadonlyArray<string>,
  mateProjectId: string,
): Decision {
  const seen = appPermission(facts, "read_app", projectIds);
  if (!seen.allow) return seen;
  return projectIds.includes(mateProjectId) ? ALLOW : refuse("mate_not_in_app");
}

/**
 * Taking a queued task (`take_task`) for one of the person's own Mates in the application — one HQ
 * names them owner of, never an automated one, and only one whose server reads the task's source;
 * `mateProjectId` names the Mate, absent: any of theirs (whether the Board offers Take at all).
 */
export function takeTaskPermission(
  facts: PermissionFacts,
  task: BoardTask,
  mates: ReadonlyArray<BoardMate>,
  mateProjectId?: string,
): Decision {
  const member = activeMember(facts.member);
  if (member === undefined) return refuse("not_active_member");
  const own = mates.some(
    (mate) =>
      !mate.automated &&
      mate.boardProtocol >= task.protocol &&
      member.userId !== undefined &&
      mate.ownerUserId === member.userId &&
      (mateProjectId === undefined || mate.projectId === mateProjectId),
  );
  if (!own) return refuse("no_own_mate");
  return task.stored === "queued" ? ALLOW : refuse("task_not_queued");
}

/** Giving a taken task back to the queue (`release_task`): its taker, or an owner or admin. */
export function releaseTaskPermission(facts: PermissionFacts, task: BoardTask): Decision {
  const member = activeMember(facts.member);
  if (member === undefined) return refuse("not_active_member");
  if (!takes(member, task) && !writer(member)) return refuse("not_task_taker");
  return task.stored === "taken" ? ALLOW : refuse("task_not_taken");
}

/** Marking a taken task done (`done_task`): its taker alone. */
export function doneTaskPermission(facts: PermissionFacts, task: BoardTask): Decision {
  const member = activeMember(facts.member);
  if (member === undefined) return refuse("not_active_member");
  if (!takes(member, task)) return refuse("not_task_taker");
  return task.stored === "taken" ? ALLOW : refuse("task_not_taken");
}

/** Stopping a task still on the Board (`stop_task`): an owner or admin, its putter, or its taker. */
export function stopTaskPermission(facts: PermissionFacts, task: BoardTask): Decision {
  const member = activeMember(facts.member);
  if (member === undefined) return refuse("not_active_member");
  if (!writer(member) && !puts(member, task) && !takes(member, task))
    return refuse("not_task_stopper");
  return LIVE_TASK.has(task.stored) ? ALLOW : refuse("task_not_live");
}

/**
 * Answering or steering a task a person put (`answer_task`) while a pool Mate holds it: its putter
 * alone. A person's taken task is their own conversation, answered there.
 */
export function answerTaskPermission(facts: PermissionFacts, task: BoardTask): Decision {
  const member = activeMember(facts.member);
  if (member === undefined) return refuse("not_active_member");
  if (!puts(member, task)) return refuse("not_task_putter");
  return task.taker?.kind === "pool" &&
    (task.stored === "assigned" || task.stored === "working" || task.stored === "waiting")
    ? ALLOW
    : refuse("not_pool_held");
}
