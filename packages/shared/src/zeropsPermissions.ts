/**
 * Who may do what with HQ's structure and a Mate's credential: one pure function, `can`, over the
 * facts Zerops gives (the org's members and projects, read by whoever enforces) and the target as
 * HQ holds it now. HQ enforces it; the client asks it what to offer.
 *
 * - **The verbs** are the places that decide today: reading a project or an application, writing an
 *   application, attaching, moving or detaching a project, an environment's deploy token, a Mate's
 *   record, a Mate's enrollment, following a Mate's live summary (who may operate it: open it, as
 *   its door does), and reading and commenting on an application's changes (`hqChanges.ts`), as
 *   main's Gitea read them, and merging or closing one, as its write team did — closing also the
 *   structure's writer — and asking a deploy again, as that team re-ran its job; and releasing an
 *   application to production, or rolling it back (`hqRelease.ts`), by whoever may deploy there.
 * - **A Mate's own verbs** — its enrollment, and its repositories, its own changes and git in the
 *   application HQ holds it in — are a Mate's alone, for its own project only; it is refused every
 *   other verb.
 * - **Core's own verb**, landing a recipe change (`land_recipe`), is Core's alone, and Core is refused
 *   every other: what Core does by itself is a named actor's, never a person's verb.
 * - **The target carries its current kind** (`held`), never only the requested one: a change between a
 *   Mate and an environment is the structure's writers' alone, whoever owns the project.
 * - **Freshness is a type:** every verb that writes takes `Facts<"fresh" | "recent">` — read at
 *   the moment of use, or at most 30 s before it, or, while Zerops leaves a read 3 s unanswered,
 *   the last answer it gave within five minutes: whoever enforces lets an allow stand on a recent
 *   read and confirms a refusal over a fresh one (F22, 2026-10-03: under Zerops' stalls every
 *   write waited on a fresh read and fell over). Only the reads take facts up to the cache's age,
 *   and Core's landing, which reads none.
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
import { RECIPE_REPO } from "./hqRecipe.ts";
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

export type Freshness = "fresh" | "recent" | "cached";

/**
 * How fresh a write's facts are: read now, or at most 30 s before it — or, while Zerops leaves a
 * read 3 s unanswered, its last answer within five minutes.
 */
export type WriteFreshness = "fresh" | "recent";

/**
 * The org as Zerops gave it: read now (`fresh`), at most 30 s ago or, while Zerops does not answer,
 * its last answer within five minutes (`recent`), or from a cache that may be older (`cached`).
 */
export interface Facts<F extends Freshness = Freshness> {
  readonly freshness: F;
  readonly members: ReadonlyArray<FactMember>;
  readonly projects: ReadonlyArray<FactProject>;
}

export type Principal =
  | { readonly kind: "person"; readonly userId: string }
  /** A Mate proving its project (its container's own Zerops key wrote the challenge). */
  | { readonly kind: "mate"; readonly projectId: string }
  /** HQ's Core acting on its own: a named actor, never a person's verb (`land_recipe`). */
  | { readonly kind: "core" };

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

/**
 * A change Core would land in an application's repository `repo`: its author, the Mate's project as
 * HQ holds it now (`appId` the application it is in, `null`: none), and what the change does to
 * `main` — only adding files, or nothing at all.
 */
export interface RecipeLandingTarget {
  readonly repo: string;
  readonly author: {
    readonly projectId: string;
    readonly held: Held;
    readonly appId: string | null;
  };
  readonly appId: string;
  readonly onlyAdded: boolean;
  readonly empty: boolean;
}

/**
 * A release of an application to production, or a rollback: the application's projects, and its
 * production (`null`: none yet).
 */
export interface ReleaseTarget {
  readonly projectIds: ReadonlyArray<string>;
  readonly productionProjectId: string | null;
}

/** A project placed into an application as `to`, beside the application's projects. */
export interface PlacementTarget extends ProjectTarget {
  readonly to: string;
  readonly appProjectIds: ReadonlyArray<string>;
}

/** A project attached to an application: and whether the application has a project of `to` already. */
export interface AttachTarget extends PlacementTarget {
  readonly slotTaken: boolean;
}

export interface Targets {
  readonly read_project: { readonly projectId: string };
  readonly observe_mate: { readonly projectId: string };
  readonly read_app: { readonly projectIds: ReadonlyArray<string> };
  /** An application's changes, as its projects. */
  readonly read_change: { readonly projectIds: ReadonlyArray<string> };
  /** A comment on one of an application's changes: whoever reads the change. */
  readonly comment_change: { readonly projectIds: ReadonlyArray<string> };
  /** A merge of one of an application's changes into its `main`: whoever develops it. */
  readonly merge_change: { readonly projectIds: ReadonlyArray<string> };
  /** A change of an application closed without merging: whoever may merge it, or a writer. */
  readonly close_change: { readonly projectIds: ReadonlyArray<string> };
  /** A deploy of one of an application's environments asked again ("Run again"): whoever develops it. */
  readonly redeploy: { readonly projectIds: ReadonlyArray<string> };
  readonly release: ReleaseTarget;
  readonly create_app: null;
  readonly rename_app: null;
  /** An application deleted: HQ removes only one that holds nothing (`app_not_empty`). */
  readonly delete_app: null;
  /** An environment's deploy token handed to HQ (SPEC §3.2b): by who may attach the project. */
  readonly keep_deploy_token: { readonly projectId: string };
  readonly attach: AttachTarget;
  readonly move: PlacementTarget;
  readonly detach: ProjectTarget;
  readonly create_mate_record: ProjectTarget;
  readonly edit_mate_record: ProjectTarget;
  readonly enroll_mate: ProjectTarget;
  readonly ensure_repo: MateTarget;
  readonly open_change: MateTarget;
  readonly edit_change: MateChangeTarget;
  readonly fetch_repo: MateFetchTarget;
  readonly land_recipe: RecipeLandingTarget;
}

export type Verb = keyof Targets;

/** The verbs that only read; every other one writes and takes `Facts<WriteFreshness>`. */
export type ReadVerb = "read_project" | "read_app" | "read_change" | "observe_mate" | "fetch_repo";

/** The verbs decided by their target alone, whatever the org: Core's own. */
export type FactlessVerb = "land_recipe";

/**
 * Facts of any age for a read or a verb that reads none; not distributive: a verb known only as
 * `Verb` may be a write, so it takes `Facts<WriteFreshness>`.
 */
export type FactsFor<V extends Verb> = [V] extends [ReadVerb | FactlessVerb]
  ? Facts
  : Facts<WriteFreshness>;

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
  "slot_taken",
  "not_app_developer",
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

  if (request.verb === "land_recipe") {
    // Core lands a recipe change by itself (main's broker, C01): one in the application's recipe
    // repository, by a Mate HQ holds in that application, that only adds files. One that changes a
    // file waits for a person (`merge_change`); an empty one Core closes.
    const { repo, author, appId, onlyAdded, empty } = request.target;
    if (principal.kind !== "core") return deny("wrong_principal");
    if (repo !== RECIPE_REPO) return deny("not_recipe_repo");
    if (!knownHeld(author.held)) return deny("unknown_kind");
    if (!isMateKind(author.held)) return deny("not_a_mate");
    if (author.appId !== appId) return deny("author_not_in_app");
    if (empty) return deny("recipe_empty");
    return onlyAdded ? ALLOW : deny("recipe_changes_files");
  }

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
   * An application is developed with Basic user or above on one of its projects: main's Gitea
   * write team, who may merge its changes.
   */
  const writesApp = (projectIds: ReadonlyArray<string>) =>
    projectIds.some((projectId) => roleAtLeast(roleOn(projectId), "BASIC_USER"));
  /**
   * An application's changes are read as main's Gitea read them: from org Read only up, or with
   * Basic user or above on one of its projects — a Read only grant shows the application, not
   * its changes.
   */
  const seesChanges = (projectIds: ReadonlyArray<string>) =>
    roleAtLeast(member.roleCode, "READ_ONLY") || writesApp(projectIds);
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
    // Main's Gitea write team merges. It closes too, as does the structure's writer, who merges
    // nothing — Gitea's split: a Mate's open change outlives its leaving the application, so an
    // application with no project left still has a closer.
    case "merge_change":
    case "close_change":
      if (!seesApp(request.target.projectIds)) return deny("app_not_seen");
      if (request.verb === "close_change" && writer) return ALLOW;
      return writesApp(request.target.projectIds) ? ALLOW : deny("not_app_developer");
    // Main re-ran a deploy's job with write on its repository (B36): whoever develops the
    // application, as a merge.
    case "redeploy":
      if (!seesApp(request.target.projectIds)) return deny("app_not_seen");
      return writesApp(request.target.projectIds) ? ALLOW : deny("not_app_developer");
    // A release, and a rollback, by whoever may deploy to the application's production: Basic user
    // or above there (SPEC §3.3a). Before production exists, an org owner/admin may save a snapshot.
    case "release": {
      const { projectIds, productionProjectId } = request.target;
      // Its production is one of its projects, whatever HQ named beside it.
      const app = productionProjectId === null ? projectIds : [...projectIds, productionProjectId];
      if (!seesApp(app)) return deny("app_not_seen");
      // That it has none is told to whoever reads its changes, as its environments are.
      if (productionProjectId === null) {
        if (writer) return ALLOW;
        return deny(seesChanges(app) ? "no_production" : "not_releaser");
      }
      return roleAtLeast(roleOn(productionProjectId), "BASIC_USER")
        ? ALLOW
        : lacking(productionProjectId, "not_releaser");
    }
    case "observe_mate":
      // Who may operate a Mate is who its door opens for: Basic user or above there. No kind check:
      // HQ has a live summary only for a project it holds as a Mate.
      return roleAtLeast(roleOn(request.target.projectId), "BASIC_USER")
        ? ALLOW
        : deny("not_mate_operator");
    case "create_app":
    case "rename_app":
    case "delete_app":
      return writer ? ALLOW : deny("not_structure_writer");
    // The token is minted by the person who attaches the environment, on their own client (main
    // E03): whoever has Full access on its project, or the structure's writer.
    case "keep_deploy_token": {
      const { projectId } = request.target;
      if (writer) return exists(projectId);
      return roleAtLeast(roleOn(projectId), "ADMIN") ? ALLOW : deny("not_project_admin");
    }
    // Who a person is on the project comes before what HQ holds it as, so a refusal never tells
    // someone without that role the project's kind; the kind asked for is their own input.
    case "attach": {
      const { projectId, held, to, appProjectIds, slotTaken } = request.target;
      if (!KINDS.has(to)) return deny("unknown_kind");
      if (writer) return knownHeld(held) ? exists(projectId) : deny("unknown_kind");
      if (isMateKind(to)) {
        // A member who can create projects attaches their own new Mate: their own grant there,
        // never the org role's fallback (parity B #42, #53).
        if (!(member.canCreateProjects && roleAtLeast(grantOn(projectId), "BASIC_USER"))) {
          return deny("not_own_new_mate");
        }
        if (!knownHeld(held)) return deny("unknown_kind");
        if (classChange(held, to)) return deny("kind_class_change");
        if (!seesApp(appProjectIds)) return deny("app_not_seen");
        return exists(projectId);
      }
      // An environment, by Full access on its project (SPEC §3.3a): only a project held nowhere,
      // only into an application they develop, only into its empty place. Replacing one, or a
      // Mate turned environment, stays the writers'.
      if (!roleAtLeast(roleOn(projectId), "ADMIN")) return deny("not_project_admin");
      if (!knownHeld(held)) return deny("unknown_kind");
      if (classChange(held, to)) return deny("kind_class_change");
      if (held !== "none") return deny("not_structure_writer");
      if (!seesApp(appProjectIds)) return deny("app_not_seen");
      if (!writesApp(appProjectIds)) return deny("not_app_developer");
      if (slotTaken) return deny("slot_taken");
      return exists(projectId);
    }
    case "move": {
      const { projectId, held, to, appProjectIds } = request.target;
      if (!KINDS.has(to)) return deny("unknown_kind");
      if (writer) {
        if (!knownHeld(held)) return deny("unknown_kind");
        if (classChange(held, to) || !isMateKind(to)) return exists(projectId);
      }
      // Moving takes the project's admin; moving an environment, the writers' alone, whoever asks.
      if (!roleAtLeast(roleOn(projectId), "ADMIN")) {
        if (!isMateKind(to)) return deny("not_structure_writer");
        return lacking(projectId, "not_project_admin");
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
