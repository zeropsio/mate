import { describe, expect, it } from "vite-plus/test";

import {
  type Decision,
  type Facts,
  type Principal,
  REASONS,
  type Targets,
  type Verb,
  can,
} from "./zeropsPermissions.ts";

/**
 * The person `U` (member row `C-U`) and one target project `P`; beside it `P_SEEN` (U reads it
 * through a grant), `P_DEV` (U develops it: a Basic user grant) and `P_HIDDEN` (a grant of none). `OTHER`, an active org owner with an owner's
 * grant on P, is there so that nothing of anyone else's ever counts as U's.
 */
interface Point {
  readonly orgRole: string;
  /** U's grant on P; `null` for none. */
  readonly override: string | null;
  readonly status: string;
  readonly canCreate: boolean;
  /** Whether the org still has P. */
  readonly present: boolean;
}

const BASE: Point = {
  orgRole: "NO_ACCESS",
  override: null,
  status: "ACTIVE",
  canCreate: false,
  present: true,
};

/** U's grant on each project beside P: one table, the facts' and the properties' alike. */
const FIXTURE_GRANTS = { P_SEEN: "READ_ONLY", P_DEV: "BASIC_USER", P_HIDDEN: "NO_ACCESS" } as const;

const factsOf = (point: Point): Facts<"fresh"> => ({
  freshness: "fresh",
  members: [
    {
      userId: "U",
      clientUserId: "C-U",
      roleCode: point.orgRole,
      status: point.status,
      canCreateProjects: point.canCreate,
    },
    {
      userId: "OTHER",
      clientUserId: "C-OTHER",
      roleCode: "OWNER",
      status: "ACTIVE",
      canCreateProjects: true,
    },
  ],
  projects: [
    ...(point.present
      ? [
          {
            id: "P",
            userRoles: [
              { clientUserId: "C-OTHER", roleCode: "OWNER" },
              ...(point.override === null
                ? []
                : [{ clientUserId: "C-U", roleCode: point.override }]),
            ],
          },
        ]
      : []),
    ...Object.entries(FIXTURE_GRANTS).map(([id, roleCode]) => ({
      id,
      userRoles: [{ clientUserId: "C-U", roleCode }],
    })),
  ],
});

const PERSON: Principal = { kind: "person", userId: "U" };

type Request = { readonly [V in Verb]: { readonly verb: V; readonly target: Targets[V] } }[Verb];

const decide = (principal: Principal, request: Request, point: Point): Decision =>
  can(principal, request.verb, request.target as never, factsOf(point));

const outcome = (decision: Decision) => (decision.allow ? "allow" : decision.reason);

type Row = readonly [name: string, point: Partial<Point>, request: Request, expected: string];

const place = (
  verb: "attach" | "move",
  held: string,
  to: string,
  appProjectIds: ReadonlyArray<string> = [],
  slotTaken = false,
): Request =>
  verb === "attach"
    ? { verb, target: { projectId: "P", held, to, appProjectIds, slotTaken } }
    : { verb, target: { projectId: "P", held, to, appProjectIds } };
const onP = (
  verb: "detach" | "create_mate_record" | "edit_mate_record" | "enroll_mate",
  held: string,
): Request => ({ verb, target: { projectId: "P", held } });

/** A Mate verb on P, held as `held` in the application `appId` (`null`: in none). */
const ofMate = (
  verb: "ensure_repo" | "open_change",
  held: string,
  appId: string | null,
): Request => ({ verb, target: { projectId: "P", appId, held } });

/** An edit by Mate P, held so, of a change of `owner`'s (`null`: no such change). */
const editOf = (held: string, appId: string | null, owner: string | null = "P"): Request => ({
  verb: "edit_change",
  target: {
    projectId: "P",
    appId,
    held,
    change: owner === null ? null : { mateProjectId: owner },
  },
});

/** A fetch by Mate P, held so, of a repository of the application `repoAppId`. */
const fetchOf = (held: string, appId: string | null, repoAppId = "A"): Request => ({
  verb: "fetch_repo",
  target: { projectId: "P", appId, held, repoAppId },
});

/** Core's landing of a recipe change in `repo` of the application A, its author P held so. */
const landing = (
  patch: {
    readonly repo?: string;
    readonly held?: string;
    readonly authorApp?: string | null;
    readonly onlyAdded?: boolean;
    readonly empty?: boolean;
  } = {},
): Extract<Request, { readonly verb: "land_recipe" }> => ({
  verb: "land_recipe",
  target: {
    repo: patch.repo ?? "group",
    author: {
      projectId: "P",
      held: patch.held ?? "mate",
      appId: patch.authorApp === undefined ? "A" : patch.authorApp,
    },
    appId: "A",
    onlyAdded: patch.onlyAdded ?? true,
    empty: patch.empty ?? false,
  },
});

const CORE: Principal = { kind: "core" };

/** The verbs a Mate asks for itself; every other one is a person's, but Core's `land_recipe`. */
const MATE_VERBS: ReadonlySet<Verb> = new Set([
  "enroll_mate",
  "ensure_repo",
  "open_change",
  "edit_change",
  "fetch_repo",
]);

/** U as an org owner, a structure writer. */
const WRITER = { orgRole: "OWNER" } as const;
/** U with org NO_ACCESS, who can create projects and owns P: a Mate's creator (the test org's shape). */
const MAKER = { orgRole: "NO_ACCESS", canCreate: true, override: "OWNER" } as const;
/** U with org NO_ACCESS and ADMIN on P alone: P's admin, nobody else's. */
const P_ADMIN = { orgRole: "NO_ACCESS", override: "ADMIN" } as const;

/** A deploy token handed to HQ for P, an environment's project. */
const KEEP_TOKEN: Request = { verb: "keep_deploy_token", target: { projectId: "P" } };

/** A person's "Run again" of a deploy of the application whose projects are `projectIds`. */
const redeploy = (...projectIds: ReadonlyArray<string>): Request => ({
  verb: "redeploy",
  target: { projectIds },
});

const TABLES: Readonly<Record<Verb, ReadonlyArray<Row>>> = {
  // "Run again" of a deploy (main B36): main re-ran a deploy's job with write on its repository —
  // whoever develops the application, as a merge.
  redeploy: [
    [
      "a developer of the application: Basic user on one of its projects",
      {},
      redeploy("P_SEEN", "P_DEV"),
      "allow",
    ],
    ["org Basic user, through the org's role", { orgRole: "BASIC_USER" }, redeploy("P"), "allow"],
    ["an org owner", WRITER, redeploy("P"), "allow"],
    [
      "org Read only sees it, does not develop it",
      { orgRole: "READ_ONLY" },
      redeploy("P"),
      "not_app_developer",
    ],
    ["org none, a Read only grant on a project of it", {}, redeploy("P_SEEN"), "not_app_developer"],
    ["org none, only a hidden project", {}, redeploy("P_HIDDEN"), "app_not_seen"],
    ["an org owner, an application with no project left", WRITER, redeploy(), "not_app_developer"],
    [
      "an invited owner",
      { orgRole: "OWNER", status: "INVITED" },
      redeploy("P"),
      "not_active_member",
    ],
  ],
  // Who may hand HQ an environment's deploy token: who may attach it (Full access on its project),
  // or the structure's writer (SPEC §3.2b, main E03).
  keep_deploy_token: [
    ["an org owner, a structure writer", WRITER, KEEP_TOKEN, "allow"],
    ["an org admin", { orgRole: "ADMIN" }, KEEP_TOKEN, "allow"],
    [
      "a writer, a project the org no longer has",
      { ...WRITER, present: false },
      KEEP_TOKEN,
      "project_gone",
    ],
    ["P's admin", P_ADMIN, KEEP_TOKEN, "allow"],
    ["P's owner, who made it", MAKER, KEEP_TOKEN, "allow"],
    ["a Basic user there", { override: "BASIC_USER" }, KEEP_TOKEN, "not_project_admin"],
    // The writer's shortcut: an org admin lowered to Read only on P still hands it over.
    [
      "an org admin, Read only on P",
      { orgRole: "ADMIN", override: "READ_ONLY" },
      KEEP_TOKEN,
      "allow",
    ],
    ["org Basic user", { orgRole: "BASIC_USER" }, KEEP_TOKEN, "not_project_admin"],
    ["org Read only", { orgRole: "READ_ONLY" }, KEEP_TOKEN, "not_project_admin"],
    [
      "P's admin, a project the org no longer has",
      { ...P_ADMIN, present: false },
      KEEP_TOKEN,
      "not_project_admin",
    ],
    ["an invited owner", { orgRole: "OWNER", status: "INVITED" }, KEEP_TOKEN, "not_active_member"],
  ],
  read_project: [
    [
      "org Read only reads",
      { orgRole: "READ_ONLY" },
      { verb: "read_project", target: { projectId: "P" } },
      "allow",
    ],
    [
      "org none, no grant",
      {},
      { verb: "read_project", target: { projectId: "P" } },
      "not_project_reader",
    ],
    [
      "org none, a Read only grant",
      { override: "READ_ONLY" },
      { verb: "read_project", target: { projectId: "P" } },
      "allow",
    ],
    [
      "an owner lowered to none there",
      { orgRole: "OWNER", override: "NO_ACCESS" },
      { verb: "read_project", target: { projectId: "P" } },
      "not_project_reader",
    ],
    [
      "a project the org no longer has",
      { orgRole: "OWNER", present: false },
      { verb: "read_project", target: { projectId: "P" } },
      "not_project_reader",
    ],
    [
      "an invited owner",
      { orgRole: "OWNER", status: "INVITED" },
      { verb: "read_project", target: { projectId: "P" } },
      "not_active_member",
    ],
    [
      "an unknown org role",
      { orgRole: "FUTURE" },
      { verb: "read_project", target: { projectId: "P" } },
      "not_project_reader",
    ],
    [
      "an unknown org role, a Basic user grant",
      { orgRole: "FUTURE", override: "BASIC_USER" },
      { verb: "read_project", target: { projectId: "P" } },
      "allow",
    ],
    [
      "an owner with an unknown grant there",
      { orgRole: "OWNER", override: "FUTURE" },
      { verb: "read_project", target: { projectId: "P" } },
      "not_project_reader",
    ],
  ],
  observe_mate: [
    [
      "org Basic user operates every Mate",
      { orgRole: "BASIC_USER" },
      { verb: "observe_mate", target: { projectId: "P" } },
      "allow",
    ],
    [
      "org none, a Basic user grant on it",
      { override: "BASIC_USER" },
      { verb: "observe_mate", target: { projectId: "P" } },
      "allow",
    ],
    [
      "org Read only sees it, does not operate it",
      { orgRole: "READ_ONLY" },
      { verb: "observe_mate", target: { projectId: "P" } },
      "not_mate_operator",
    ],
    [
      "an owner lowered to Read only on it",
      { orgRole: "OWNER", override: "READ_ONLY" },
      { verb: "observe_mate", target: { projectId: "P" } },
      "not_mate_operator",
    ],
    [
      "its project gone",
      { orgRole: "OWNER", present: false },
      { verb: "observe_mate", target: { projectId: "P" } },
      "not_mate_operator",
    ],
    [
      "an invited owner",
      { orgRole: "OWNER", status: "INVITED" },
      { verb: "observe_mate", target: { projectId: "P" } },
      "not_active_member",
    ],
    [
      "org Read only, a Basic user grant on it: the grant opens it, as the door does",
      { orgRole: "READ_ONLY", override: "BASIC_USER" },
      { verb: "observe_mate", target: { projectId: "P" } },
      "allow",
    ],
    [
      "org Basic user lowered to Read only on it",
      { orgRole: "BASIC_USER", override: "READ_ONLY" },
      { verb: "observe_mate", target: { projectId: "P" } },
      "not_mate_operator",
    ],
    [
      "org owner",
      { orgRole: "OWNER" },
      { verb: "observe_mate", target: { projectId: "P" } },
      "allow",
    ],
  ],
  read_app: [
    [
      "org Read only sees an empty application",
      { orgRole: "READ_ONLY" },
      { verb: "read_app", target: { projectIds: [] } },
      "allow",
    ],
    [
      "org none sees it through a project it reads",
      {},
      { verb: "read_app", target: { projectIds: ["P_SEEN"] } },
      "allow",
    ],
    [
      "org none, only a hidden project",
      {},
      { verb: "read_app", target: { projectIds: ["P_HIDDEN"] } },
      "app_not_seen",
    ],
    [
      "org none, an empty application",
      {},
      { verb: "read_app", target: { projectIds: [] } },
      "app_not_seen",
    ],
    [
      "an invited owner",
      { orgRole: "OWNER", status: "INVITED" },
      { verb: "read_app", target: { projectIds: [] } },
      "not_active_member",
    ],
  ],
  create_app: [
    ["org owner", { orgRole: "OWNER" }, { verb: "create_app", target: null }, "allow"],
    ["org admin", { orgRole: "ADMIN" }, { verb: "create_app", target: null }, "allow"],
    [
      "org Basic user",
      { orgRole: "BASIC_USER" },
      { verb: "create_app", target: null },
      "not_structure_writer",
    ],
    [
      "org none who can create projects",
      { canCreate: true },
      { verb: "create_app", target: null },
      "not_structure_writer",
    ],
    [
      "an unknown org role",
      { orgRole: "FUTURE" },
      { verb: "create_app", target: null },
      "not_structure_writer",
    ],
    [
      "an invited admin",
      { orgRole: "ADMIN", status: "INVITED" },
      { verb: "create_app", target: null },
      "not_active_member",
    ],
  ],
  rename_app: [
    ["org admin", { orgRole: "ADMIN" }, { verb: "rename_app", target: null }, "allow"],
    [
      "org Read only",
      { orgRole: "READ_ONLY" },
      { verb: "rename_app", target: null },
      "not_structure_writer",
    ],
    [
      "an admin of one project",
      P_ADMIN,
      { verb: "rename_app", target: null },
      "not_structure_writer",
    ],
  ],
  attach: [
    [
      "can create projects, no grant of their own, held as a production: told only the role",
      { orgRole: "BASIC_USER", canCreate: true },
      place("attach", "production", "mate", ["P_SEEN"]),
      "not_own_new_mate",
    ],
    ["a writer attaches an environment", WRITER, place("attach", "none", "stage"), "allow"],
    ["a writer attaches a production", WRITER, place("attach", "none", "production"), "allow"],
    ["a writer attaches a Mate as devstage", WRITER, place("attach", "mate", "devstage"), "allow"],
    [
      "a writer, a project gone",
      { ...WRITER, present: false },
      place("attach", "none", "stage"),
      "project_gone",
    ],
    [
      "org Basic user, an environment",
      { orgRole: "BASIC_USER" },
      place("attach", "none", "stage"),
      "not_project_admin",
    ],
    [
      "P's admin, an environment to an application they do not see",
      P_ADMIN,
      place("attach", "none", "production"),
      "app_not_seen",
    ],
    [
      "P's admin, a stage into an empty place of an application they develop",
      P_ADMIN,
      place("attach", "none", "stage", ["P_DEV"]),
      "allow",
    ],
    [
      "P's admin, a stage into an application they only see",
      P_ADMIN,
      place("attach", "none", "stage", ["P_SEEN"]),
      "not_app_developer",
    ],
    [
      "a Developer attaches their new project as the production of an application without one",
      MAKER,
      place("attach", "none", "production", ["P_DEV"]),
      "allow",
    ],
    [
      "a Developer, the application's production taken",
      MAKER,
      place("attach", "none", "production", ["P_DEV"], true),
      "slot_taken",
    ],
    [
      "a Developer of an application they only see",
      MAKER,
      place("attach", "none", "production", ["P_SEEN"]),
      "not_app_developer",
    ],
    [
      "a Developer's own Mate into an application they only see: seeing it is enough",
      MAKER,
      place("attach", "mate", "mate", ["P_SEEN"]),
      "allow",
    ],
    [
      "Read only on the project",
      { override: "READ_ONLY" },
      place("attach", "none", "production", ["P_SEEN"]),
      "not_project_admin",
    ],
    [
      "an org admin, the production taken",
      { orgRole: "ADMIN" },
      place("attach", "none", "production", [], true),
      "allow",
    ],
    [
      "a Developer replaces nothing: their project is a stage already",
      MAKER,
      place("attach", "stage", "production", ["P_SEEN"]),
      "not_structure_writer",
    ],
    [
      "a Developer turns their Mate into a production",
      MAKER,
      place("attach", "mate", "production", ["P_SEEN"]),
      "kind_class_change",
    ],
    [
      "a Developer whose new project is gone",
      { ...MAKER, present: false },
      place("attach", "none", "production", ["P_SEEN"]),
      "not_project_admin",
    ],
    [
      "a maker attaches their own Mate to an application they see",
      MAKER,
      place("attach", "mate", "mate", ["P_SEEN"]),
      "allow",
    ],
    [
      "a maker, to an application they do not see",
      MAKER,
      place("attach", "mate", "mate", ["P_HIDDEN"]),
      "app_not_seen",
    ],
    [
      "a maker who cannot create projects",
      { ...MAKER, canCreate: false },
      place("attach", "mate", "mate", ["P_SEEN"]),
      "not_own_new_mate",
    ],
    [
      "a maker with only Read only there",
      { ...MAKER, override: "READ_ONLY" },
      place("attach", "mate", "devstage", ["P_SEEN"]),
      "not_own_new_mate",
    ],
    [
      "org Basic user who can create projects, no grant of their own",
      { orgRole: "BASIC_USER", canCreate: true },
      place("attach", "mate", "mate", ["P_SEEN"]),
      "not_own_new_mate",
    ],
    [
      "a maker, the project gone",
      { ...MAKER, present: false },
      place("attach", "mate", "mate", ["P_SEEN"]),
      "not_own_new_mate",
    ],
    [
      "a maker turns an environment into a Mate",
      MAKER,
      place("attach", "stage", "mate", ["P_SEEN"]),
      "kind_class_change",
    ],
    [
      "a writer turns an environment into a Mate",
      WRITER,
      place("attach", "stage", "mate"),
      "allow",
    ],
    [
      "a kind held that this build does not know",
      WRITER,
      place("attach", "FUTURE", "stage"),
      "unknown_kind",
    ],
    [
      "a kind asked for that this build does not know",
      WRITER,
      place("attach", "none", "FUTURE"),
      "unknown_kind",
    ],
  ],
  move: [
    [
      "no role on P, held as a production: told only the role",
      { orgRole: "BASIC_USER" },
      place("move", "production", "mate", ["P"]),
      "not_project_admin",
    ],
    [
      "no role on P, held as a kind this build does not know: told only the role",
      { orgRole: "READ_ONLY" },
      place("move", "FUTURE", "mate"),
      "not_project_admin",
    ],
    [
      "P's admin moves its Mate into an application they see",
      P_ADMIN,
      place("move", "mate", "mate", ["P_SEEN"]),
      "allow",
    ],
    [
      "P's admin, a devstage to a Mate",
      P_ADMIN,
      place("move", "devstage", "mate", ["P_SEEN"]),
      "allow",
    ],
    [
      "P's admin, into an application they do not see",
      P_ADMIN,
      place("move", "mate", "mate", ["P_HIDDEN"]),
      "app_not_seen",
    ],
    [
      "a Basic user of P",
      { override: "BASIC_USER" },
      place("move", "mate", "mate", ["P_SEEN"]),
      "not_project_admin",
    ],
    [
      "an owner lowered to Read only on P",
      { orgRole: "OWNER", override: "READ_ONLY" },
      place("move", "mate", "mate"),
      "not_project_admin",
    ],
    [
      "S-1: P's owner turns its production into a Mate",
      MAKER,
      place("move", "production", "mate", ["P"]),
      "kind_class_change",
    ],
    [
      "S-1: P's admin turns its stage into a devstage",
      P_ADMIN,
      place("move", "stage", "devstage", ["P"]),
      "kind_class_change",
    ],
    [
      "P's admin turns its Mate into a stage",
      P_ADMIN,
      place("move", "mate", "stage"),
      "kind_class_change",
    ],
    [
      "a writer turns a production into a Mate",
      WRITER,
      place("move", "production", "mate"),
      "allow",
    ],
    [
      "a writer turns a stage into the production",
      WRITER,
      place("move", "stage", "production"),
      "allow",
    ],
    [
      "P's admin turns a stage into the production",
      P_ADMIN,
      place("move", "stage", "production"),
      "not_structure_writer",
    ],
    [
      "a writer moves a project gone",
      { ...WRITER, present: false },
      place("move", "stage", "stage"),
      "project_gone",
    ],
    [
      "a writer moves a Mate gone",
      { ...WRITER, present: false },
      place("move", "mate", "mate"),
      "project_gone",
    ],
    [
      "P's admin moves a Mate gone: no role on it",
      { ...P_ADMIN, present: false },
      place("move", "mate", "mate"),
      "not_project_admin",
    ],
    [
      "a kind held that this build does not know",
      WRITER,
      place("move", "FUTURE", "mate"),
      "unknown_kind",
    ],
  ],
  detach: [
    [
      "no role on P, held as a stage: told only the role",
      { orgRole: "BASIC_USER" },
      onP("detach", "stage"),
      "not_project_admin",
    ],
    ["P's admin takes its Mate out", P_ADMIN, onP("detach", "mate"), "allow"],
    ["P's admin takes its devstage out", P_ADMIN, onP("detach", "devstage"), "allow"],
    ["a Basic user of P", { override: "BASIC_USER" }, onP("detach", "mate"), "not_project_admin"],
    ["a writer takes a stage out", WRITER, onP("detach", "stage"), "allow"],
    ["P's admin takes a stage out", P_ADMIN, onP("detach", "production"), "not_structure_writer"],
    ["a writer, nothing held", WRITER, onP("detach", "none"), "allow"],
    ["P's admin, nothing held", P_ADMIN, onP("detach", "none"), "not_structure_writer"],
    [
      "a writer, a stage gone",
      { ...WRITER, present: false },
      onP("detach", "stage"),
      "project_gone",
    ],
    [
      "P's admin, its Mate gone: no role on it",
      { ...P_ADMIN, present: false },
      onP("detach", "mate"),
      "not_project_admin",
    ],
    ["a kind this build does not know", WRITER, onP("detach", "FUTURE"), "unknown_kind"],
  ],
  create_mate_record: [
    ["P's admin, nothing held", P_ADMIN, onP("create_mate_record", "none"), "allow"],
    ["P's admin, held as a devstage", P_ADMIN, onP("create_mate_record", "devstage"), "allow"],
    [
      "S-1: P's owner, held as a production",
      MAKER,
      onP("create_mate_record", "production"),
      "held_as_environment",
    ],
    [
      "a writer, held as a stage",
      WRITER,
      onP("create_mate_record", "stage"),
      "held_as_environment",
    ],
    [
      "a Basic user of P",
      { override: "BASIC_USER" },
      onP("create_mate_record", "none"),
      "not_project_admin",
    ],
    [
      "an owner, the project gone",
      { ...WRITER, present: false },
      onP("create_mate_record", "none"),
      "project_gone",
    ],
    [
      "a maker, the project gone: no role on it",
      { ...MAKER, present: false },
      onP("create_mate_record", "none"),
      "not_project_admin",
    ],
    [
      "a kind this build does not know",
      WRITER,
      onP("create_mate_record", "FUTURE"),
      "unknown_kind",
    ],
  ],
  edit_mate_record: [
    ["P's admin", P_ADMIN, onP("edit_mate_record", "mate"), "allow"],
    [
      "a Basic user of P",
      { override: "BASIC_USER" },
      onP("edit_mate_record", "mate"),
      "not_project_admin",
    ],
    [
      "an owner, the project gone",
      { ...WRITER, present: false },
      onP("edit_mate_record", "mate"),
      "project_gone",
    ],
  ],
  enroll_mate: [
    ["a Mate", {}, onP("enroll_mate", "mate"), "allow"],
    ["a devstage", {}, onP("enroll_mate", "devstage"), "allow"],
    ["nothing held", {}, onP("enroll_mate", "none"), "not_a_mate"],
    ["a stage", {}, onP("enroll_mate", "stage"), "not_a_mate"],
    ["a production", {}, onP("enroll_mate", "production"), "not_a_mate"],
    [
      "a Mate whose project is gone",
      { present: false },
      onP("enroll_mate", "mate"),
      "project_gone",
    ],
    // The door is open to anyone: it says nothing of a project HQ holds as no Mate, gone or not.
    [
      "a project gone that HQ holds as nothing",
      { present: false },
      onP("enroll_mate", "none"),
      "not_a_mate",
    ],
    ["a kind this build does not know", {}, onP("enroll_mate", "FUTURE"), "unknown_kind"],
  ],
  ensure_repo: [
    ["its Mate in an application", {}, ofMate("ensure_repo", "mate", "A"), "allow"],
    ["its devstage", {}, ofMate("ensure_repo", "devstage", "A"), "allow"],
    ["its Mate in no application", {}, ofMate("ensure_repo", "mate", null), "mate_not_in_app"],
    ["nothing held", {}, ofMate("ensure_repo", "none", null), "mate_not_in_app"],
    ["a stage", {}, ofMate("ensure_repo", "stage", "A"), "not_a_mate"],
    ["a production", {}, ofMate("ensure_repo", "production", "A"), "not_a_mate"],
    ["a kind this build does not know", {}, ofMate("ensure_repo", "FUTURE", "A"), "unknown_kind"],
    [
      "its Mate whose project is gone",
      { present: false },
      ofMate("ensure_repo", "mate", "A"),
      "project_gone",
    ],
    [
      "a stage whose project is gone",
      { present: false },
      ofMate("ensure_repo", "stage", "A"),
      "not_a_mate",
    ],
  ],
  open_change: [
    ["its Mate in an application", {}, ofMate("open_change", "mate", "A"), "allow"],
    ["its devstage", {}, ofMate("open_change", "devstage", "A"), "allow"],
    ["its Mate in no application", {}, ofMate("open_change", "mate", null), "mate_not_in_app"],
    ["a stage", {}, ofMate("open_change", "stage", "A"), "not_a_mate"],
    [
      "its Mate whose project is gone",
      { present: false },
      ofMate("open_change", "devstage", "A"),
      "project_gone",
    ],
  ],
  edit_change: [
    ["its own change", {}, editOf("mate", "A"), "allow"],
    ["its own change, as a devstage", {}, editOf("devstage", "A"), "allow"],
    ["a sibling Mate's change", {}, editOf("mate", "A", "Q"), "not_your_change"],
    ["no such change", {}, editOf("mate", "A", null), "unknown_change"],
    [
      "a sibling's change, its project gone",
      { present: false },
      editOf("mate", "A", "Q"),
      "not_your_change",
    ],
    ["its own change, its project gone", { present: false }, editOf("mate", "A"), "project_gone"],
    ["its Mate in no application", {}, editOf("mate", null), "mate_not_in_app"],
    ["a production", {}, editOf("production", "A"), "not_a_mate"],
    ["a production, a sibling's change", {}, editOf("production", "A", "Q"), "not_a_mate"],
    ["a kind this build does not know", {}, editOf("FUTURE", "A"), "unknown_kind"],
  ],
  land_recipe: [
    ["a Mate of the application adds tiers", {}, landing(), "allow"],
    ["its devstage adds them", {}, landing({ held: "devstage" }), "allow"],
    ["a Mate's change in a service repository", {}, landing({ repo: "appdev" }), "not_recipe_repo"],
    ["an author in no application", {}, landing({ authorApp: null }), "author_not_in_app"],
    ["an author of another application", {}, landing({ authorApp: "B" }), "author_not_in_app"],
    ["an author HQ holds as a stage", {}, landing({ held: "stage" }), "not_a_mate"],
    ["an author HQ holds as nothing", {}, landing({ held: "none", authorApp: null }), "not_a_mate"],
    [
      "an author of a kind this build does not know",
      {},
      landing({ held: "FUTURE" }),
      "unknown_kind",
    ],
    ["a change that modifies a file", {}, landing({ onlyAdded: false }), "recipe_changes_files"],
    ["an empty change", {}, landing({ empty: true }), "recipe_empty"],
    // Empty first: a change of nothing is closed, whatever else is said of it.
    [
      "an empty change, said to do more than add",
      {},
      landing({ empty: true, onlyAdded: false }),
      "recipe_empty",
    ],
    // Whoever is in the org has no say: the decision is the change's, not the org's.
    [
      "nobody in the org",
      { orgRole: "OWNER", status: "INVITED", present: false },
      landing(),
      "allow",
    ],
  ],
  fetch_repo: [
    ["its own application's repository", {}, fetchOf("mate", "A"), "allow"],
    ["as a devstage", {}, fetchOf("devstage", "A"), "allow"],
    ["another application's repository", {}, fetchOf("mate", "A", "B"), "not_your_app"],
    ["its Mate in no application", {}, fetchOf("mate", null), "mate_not_in_app"],
    ["a stage", {}, fetchOf("stage", "A"), "not_a_mate"],
    ["a kind this build does not know", {}, fetchOf("FUTURE", "A"), "unknown_kind"],
    ["its project gone", { present: false }, fetchOf("mate", "A"), "project_gone"],
  ],
  read_change: [
    [
      "org Read only reads an empty application's changes",
      { orgRole: "READ_ONLY" },
      { verb: "read_change", target: { projectIds: [] } },
      "allow",
    ],
    [
      "org none, a Read only grant on a project of it: sees the application, not its changes",
      {},
      { verb: "read_change", target: { projectIds: ["P_SEEN"] } },
      "changes_not_seen",
    ],
    [
      "org none, a Read only grant on P",
      { override: "READ_ONLY" },
      { verb: "read_change", target: { projectIds: ["P"] } },
      "changes_not_seen",
    ],
    [
      "org none, a Basic user grant on P",
      { override: "BASIC_USER" },
      { verb: "read_change", target: { projectIds: ["P", "P_HIDDEN"] } },
      "allow",
    ],
    [
      "org Read only lowered to none on its only project",
      { orgRole: "READ_ONLY", override: "NO_ACCESS" },
      { verb: "read_change", target: { projectIds: ["P"] } },
      "allow",
    ],
    [
      "org none, only a hidden project",
      {},
      { verb: "read_change", target: { projectIds: ["P_HIDDEN"] } },
      "app_not_seen",
    ],
    [
      "an invited owner",
      { orgRole: "OWNER", status: "INVITED" },
      { verb: "read_change", target: { projectIds: [] } },
      "not_active_member",
    ],
  ],
  comment_change: [
    [
      "org Read only comments on whatever change they read",
      { orgRole: "READ_ONLY" },
      { verb: "comment_change", target: { projectIds: [] } },
      "allow",
    ],
    [
      "org none, a Read only grant on a project of it",
      {},
      { verb: "comment_change", target: { projectIds: ["P_SEEN"] } },
      "changes_not_seen",
    ],
    [
      "org none, a Basic user grant on P",
      { override: "BASIC_USER" },
      { verb: "comment_change", target: { projectIds: ["P"] } },
      "allow",
    ],
    [
      "org none, only a hidden project",
      {},
      { verb: "comment_change", target: { projectIds: ["P_HIDDEN"] } },
      "app_not_seen",
    ],
    [
      "an invited owner",
      { orgRole: "OWNER", status: "INVITED" },
      { verb: "comment_change", target: { projectIds: [] } },
      "not_active_member",
    ],
  ],
  merge_change: [
    [
      "a developer of the application: Basic user on one of its projects",
      {},
      { verb: "merge_change", target: { projectIds: ["P_SEEN", "P_DEV"] } },
      "allow",
    ],
    [
      "org Basic user, through the org's role on a project of it",
      { orgRole: "BASIC_USER" },
      { verb: "merge_change", target: { projectIds: ["P"] } },
      "allow",
    ],
    [
      "org Read only sees it, does not develop it",
      { orgRole: "READ_ONLY" },
      { verb: "merge_change", target: { projectIds: ["P"] } },
      "not_app_developer",
    ],
    [
      "org none, a Read only grant on a project of it",
      {},
      { verb: "merge_change", target: { projectIds: ["P_SEEN"] } },
      "not_app_developer",
    ],
    [
      "an org owner lowered to none on its only project",
      { orgRole: "OWNER", override: "NO_ACCESS" },
      { verb: "merge_change", target: { projectIds: ["P"] } },
      "not_app_developer",
    ],
    [
      "an org owner, an application with no project left: merging is a developer's",
      { orgRole: "OWNER" },
      { verb: "merge_change", target: { projectIds: [] } },
      "not_app_developer",
    ],
    [
      "an org admin with Read only on its only project: the org's role falls back per project",
      { orgRole: "ADMIN", override: "READ_ONLY" },
      { verb: "merge_change", target: { projectIds: ["P"] } },
      "not_app_developer",
    ],
    [
      "a Basic user grant on P beside a hidden project",
      { override: "BASIC_USER" },
      { verb: "merge_change", target: { projectIds: ["P", "P_HIDDEN"] } },
      "allow",
    ],
    [
      "org none, only a hidden project",
      {},
      { verb: "merge_change", target: { projectIds: ["P_HIDDEN"] } },
      "app_not_seen",
    ],
    [
      "an invited owner",
      { orgRole: "OWNER", status: "INVITED" },
      { verb: "merge_change", target: { projectIds: ["P"] } },
      "not_active_member",
    ],
  ],
  close_change: [
    [
      "a developer of the application: Basic user on one of its projects",
      {},
      { verb: "close_change", target: { projectIds: ["P_SEEN", "P_DEV"] } },
      "allow",
    ],
    [
      "org Basic user, through the org's role on a project of it",
      { orgRole: "BASIC_USER" },
      { verb: "close_change", target: { projectIds: ["P"] } },
      "allow",
    ],
    [
      "org Read only sees it, does not develop it",
      { orgRole: "READ_ONLY" },
      { verb: "close_change", target: { projectIds: ["P"] } },
      "not_app_developer",
    ],
    [
      "org none, a Read only grant on a project of it",
      {},
      { verb: "close_change", target: { projectIds: ["P_SEEN"] } },
      "not_app_developer",
    ],
    [
      "an org owner lowered to none on its only project: closes as the structure's writer",
      { orgRole: "OWNER", override: "NO_ACCESS" },
      { verb: "close_change", target: { projectIds: ["P"] } },
      "allow",
    ],
    [
      "an org owner, an application with no project left: still closes its changes",
      { orgRole: "OWNER" },
      { verb: "close_change", target: { projectIds: [] } },
      "allow",
    ],
    [
      "an org admin with Read only on its only project",
      { orgRole: "ADMIN", override: "READ_ONLY" },
      { verb: "close_change", target: { projectIds: ["P"] } },
      "allow",
    ],
    [
      "a Basic user grant on P beside a hidden project",
      { override: "BASIC_USER" },
      { verb: "close_change", target: { projectIds: ["P", "P_HIDDEN"] } },
      "allow",
    ],
    [
      "org none, only a hidden project",
      {},
      { verb: "close_change", target: { projectIds: ["P_HIDDEN"] } },
      "app_not_seen",
    ],
    [
      "an invited owner",
      { orgRole: "OWNER", status: "INVITED" },
      { verb: "close_change", target: { projectIds: ["P"] } },
      "not_active_member",
    ],
  ],
};

const MATE_P: Principal = { kind: "mate", projectId: "P" };

describe("can — one table per verb", () => {
  for (const [verb, rows] of Object.entries(TABLES)) {
    it.each(rows.map((row) => [row[0], row] as const))(
      `${verb}: %s`,
      (_name, [, point, request, expected]) => {
        const principal =
          verb === "land_recipe" ? CORE : MATE_VERBS.has(verb as Verb) ? MATE_P : PERSON;
        expect(outcome(decide(principal, request, { ...BASE, ...point }))).toBe(expected);
      },
    );
  }

  it("a principal of the wrong kind is refused every verb", () => {
    expect(outcome(decide(PERSON, onP("enroll_mate", "mate"), BASE))).toBe("wrong_principal");
    expect(outcome(decide(MATE_P, { verb: "create_app", target: null }, WRITER_POINT))).toBe(
      "wrong_principal",
    );
    expect(
      outcome(decide({ kind: "mate", projectId: "Q" }, onP("enroll_mate", "mate"), BASE)),
    ).toBe("not_your_project");
  });

  it("a write verb takes facts read now, not cached ones", () => {
    const cached: Facts<"cached"> = { ...factsOf(BASE), freshness: "cached" };
    expect(can(PERSON, "read_app", { projectIds: [] }, cached).allow).toBe(false);
    // @ts-expect-error -- creating an application is a write: it takes `Facts<"fresh">`.
    can(PERSON, "create_app", null, cached);
    expect(can(PERSON, "read_change", { projectIds: [] }, cached).allow).toBe(false);
    // @ts-expect-error -- a comment is a write.
    can(PERSON, "comment_change", { projectIds: [] }, cached);
    // @ts-expect-error -- and a merge.
    can(PERSON, "merge_change", { projectIds: [] }, cached);
    // @ts-expect-error -- and a close.
    can(PERSON, "close_change", { projectIds: [] }, cached);
    // @ts-expect-error -- and asking a deploy again.
    can(PERSON, "redeploy", { projectIds: [] }, cached);
    // @ts-expect-error -- so is a Mate's change.
    can(MATE_P, "open_change", { projectId: "P", appId: "A", held: "mate" }, cached);
    // A Mate's fetch is a read.
    const fetched = { projectId: "P", appId: "A", held: "mate", repoAppId: "A" };
    expect(can(MATE_P, "fetch_repo", fetched, cached).allow).toBe(true);
    // Core's landing reads no fact of the org: any it has will do.
    expect(can(CORE, "land_recipe", landing().target, cached).allow).toBe(true);
    // Nor when the verb is known only at run time: it may be a write.
    // @ts-expect-error -- `can` over any verb takes `Facts<"fresh">`.
    const anyVerb: Parameters<typeof can<Verb>>[3] = cached;
    expect(anyVerb.freshness).toBe("cached");
  });
});

const WRITER_POINT: Point = { ...BASE, ...WRITER };

// The whole input space: every role, grant, status, flag and presence, every kind held and asked.
const ROLES = ["NO_ACCESS", "READ_ONLY", "BASIC_USER", "ADMIN", "OWNER", "FUTURE"] as const;
const RANKED = ["NO_ACCESS", "READ_ONLY", "BASIC_USER", "ADMIN", "OWNER"] as const;
const HELD = ["none", "mate", "devstage", "stage", "production", "FUTURE"] as const;
const TO = ["mate", "devstage", "stage", "production", "FUTURE"] as const;
const APPS = [[], ["P"], ["P_SEEN"], ["P_DEV"], ["P_HIDDEN"]] as const;

const POINTS: ReadonlyArray<Point> = ROLES.flatMap((orgRole) =>
  [null, ...ROLES].flatMap((override) =>
    ["ACTIVE", "INVITED", "OTHER"].flatMap((status) =>
      [false, true].flatMap((canCreate) =>
        [true, false].map((present) => ({ orgRole, override, status, canCreate, present })),
      ),
    ),
  ),
);

const REQUESTS: ReadonlyArray<Request> = [
  ...["group", "appdev"].flatMap((repo) =>
    HELD.flatMap((held) =>
      [null, "A", "B"].flatMap((authorApp) =>
        [true, false].flatMap((onlyAdded) =>
          [true, false].map((empty) => landing({ repo, held, authorApp, onlyAdded, empty })),
        ),
      ),
    ),
  ),
  { verb: "read_project", target: { projectId: "P" } },
  { verb: "observe_mate", target: { projectId: "P" } },
  ...APPS.map((projectIds): Request => ({ verb: "read_app", target: { projectIds } })),
  { verb: "create_app", target: null },
  { verb: "rename_app", target: null },
  KEEP_TOKEN,
  ...HELD.flatMap((held) =>
    TO.flatMap((to) =>
      APPS.flatMap((app) => [false, true].map((taken) => place("attach", held, to, app, taken))),
    ),
  ),
  ...HELD.flatMap((held) => TO.flatMap((to) => APPS.map((app) => place("move", held, to, app)))),
  ...(["detach", "create_mate_record", "edit_mate_record", "enroll_mate"] as const).flatMap(
    (verb) => HELD.map((held) => onP(verb, held)),
  ),
  ...(["ensure_repo", "open_change"] as const).flatMap((verb) =>
    HELD.flatMap((held) => [null, "A"].map((appId) => ofMate(verb, held, appId))),
  ),
  ...HELD.flatMap((held) =>
    [null, "A"].flatMap((appId) => [null, "P", "Q"].map((owner) => editOf(held, appId, owner))),
  ),
  ...HELD.flatMap((held) =>
    [null, "A"].flatMap((appId) => ["A", "B"].map((repoAppId) => fetchOf(held, appId, repoAppId))),
  ),
  ...(
    ["read_change", "comment_change", "merge_change", "close_change", "redeploy"] as const
  ).flatMap((verb) => APPS.map((projectIds): Request => ({ verb, target: { projectIds } }))),
];

const PRINCIPALS: ReadonlyArray<Principal> = [
  PERSON,
  { kind: "person", userId: "STRANGER" },
  MATE_P,
  { kind: "mate", projectId: "Q" },
  CORE,
];

const everywhere = (check: (principal: Principal, request: Request, point: Point) => void) => {
  for (const point of POINTS) {
    for (const request of REQUESTS) {
      for (const principal of PRINCIPALS) check(principal, request, point);
    }
  }
};

/** What placing or holding a project does to the structure's own writing. */
const writerOnly = (request: Request): boolean => {
  switch (request.verb) {
    case "create_app":
    case "rename_app":
      return true;
    case "attach": {
      // An environment into an empty place is its project's admin's too (SPEC §3.3a).
      const { held, to, slotTaken } = request.target;
      const mate = (kind: string) => kind === "mate" || kind === "devstage";
      return (
        (held !== "none" && mate(held) !== mate(to)) ||
        (!mate(to) && (held !== "none" || slotTaken))
      );
    }
    case "move": {
      const { held, to } = request.target;
      const mate = (kind: string) => kind === "mate" || kind === "devstage";
      return !mate(to) || (held !== "none" && mate(held) !== mate(to));
    }
    case "detach":
      return request.target.held !== "mate" && request.target.held !== "devstage";
    default:
      return false;
  }
};

describe("can — over the whole input space", () => {
  it("is total: every input is allowed or denied with a reason of the catalogue", () => {
    everywhere((principal, request, point) => {
      const decision = decide(principal, request, point);
      if (!decision.allow) expect(REASONS).toContain(decision.reason);
    });
  });

  it("refuses a person who is not a member every verb, whoever else the org has", () => {
    everywhere((principal, request, point) => {
      if (principal.kind === "person" && principal.userId === "STRANGER") {
        expect(decide(principal, request, point).allow).toBe(false);
      }
    });
  });

  it("decides an unknown role as none, and denies an unknown status or kind", () => {
    everywhere((principal, request, point) => {
      const decision = outcome(decide(principal, request, point));
      if (point.orgRole === "FUTURE") {
        expect(decision).toBe(
          outcome(decide(principal, request, { ...point, orgRole: "NO_ACCESS" })),
        );
      }
      if (point.override === "FUTURE") {
        expect(decision).toBe(
          outcome(decide(principal, request, { ...point, override: "NO_ACCESS" })),
        );
      }
      if (point.status === "OTHER" && principal.kind === "person")
        expect(decision).not.toBe("allow");
      const target = request.target as { readonly held?: string; readonly to?: string } | null;
      if (target?.held === "FUTURE" || target?.to === "FUTURE") expect(decision).not.toBe("allow");
    });
  });

  it("never lets a grant on the target stand in for the structure's writer", () => {
    everywhere((principal, request, point) => {
      if (principal.kind !== "person" || !writerOnly(request)) return;
      if (point.orgRole === "ADMIN" || point.orgRole === "OWNER") return;
      expect(outcome(decide(principal, request, point))).not.toBe("allow");
    });
  });

  it("lets a Mate only its own verbs, for its own project, in the application HQ holds it in", () => {
    everywhere((principal, request, point) => {
      if (principal.kind !== "mate") return;
      const decision = outcome(decide(principal, request, point));
      if (!MATE_VERBS.has(request.verb)) {
        expect(decision).toBe("wrong_principal");
        return;
      }
      if (decision !== "allow") return;
      const target = request.target as {
        readonly projectId: string;
        readonly held: string;
        readonly appId?: string | null;
        readonly change?: { readonly mateProjectId: string } | null;
        readonly repoAppId?: string;
      };
      expect(target.projectId).toBe(principal.projectId);
      expect(["mate", "devstage"]).toContain(target.held);
      if (request.verb !== "enroll_mate") expect(target.appId).not.toBeNull();
      if (request.verb === "edit_change")
        expect(target.change?.mateProjectId).toBe(principal.projectId);
      if (request.verb === "fetch_repo") expect(target.repoAppId).toBe(target.appId);
    });
  });

  it("never lets a Mate edit another Mate's change, and tells it so once HQ holds it as a Mate in an application", () => {
    for (const point of POINTS) {
      for (const held of HELD) {
        for (const appId of [null, "A"]) {
          const decision = outcome(decide(MATE_P, editOf(held, appId, "Q"), point));
          expect(decision).not.toBe("allow");
          if (appId !== null && (held === "mate" || held === "devstage")) {
            expect(decision, `${held} at ${JSON.stringify(point)}`).toBe("not_your_change");
          }
        }
      }
    }
  });

  it("lets a person read an application's changes only where they see the application", () => {
    everywhere((principal, request, point) => {
      if (request.verb !== "read_change" && request.verb !== "comment_change") return;
      if (!decide(principal, request, point).allow) return;
      const app: Request = { verb: "read_app", target: request.target };
      expect(decide(principal, app, point).allow).toBe(true);
    });
  });

  it("lets a person merge a change only where they develop the application, and close it there or as the structure's writer", () => {
    everywhere((principal, request, point) => {
      if (request.verb !== "merge_change" && request.verb !== "close_change") return;
      const decision = decide(principal, request, point);
      // Close is allowed wherever merge is, not the reverse (Gitea's split: an admin closes).
      if (request.verb === "merge_change" && decision.allow) {
        const close: Request = { verb: "close_change", target: request.target };
        expect(decide(principal, close, point).allow).toBe(true);
      }
      if (!decision.allow) return;
      const read: Request = { verb: "read_change", target: request.target };
      expect(decide(principal, read, point).allow).toBe(true);
      const writer =
        principal.kind === "person" &&
        principal.userId === "U" &&
        point.status === "ACTIVE" &&
        (point.orgRole === "ADMIN" || point.orgRole === "OWNER");
      if (request.verb === "close_change" && writer) return;
      // Developing it: Basic user or above on one of its projects (P is the point's own).
      const ranked = (role: string) => RANKED.indexOf(role as (typeof RANKED)[number]);
      const roleIn = (projectId: string) =>
        projectId === "P"
          ? point.present
            ? ranked(point.override ?? point.orgRole)
            : 0
          : ranked(FIXTURE_GRANTS[projectId as keyof typeof FIXTURE_GRANTS]);
      expect(request.target.projectIds.some((projectId) => roleIn(projectId) >= 2)).toBe(true);
    });
  });

  it("lets Core land a recipe and do nothing else, and only as the rule says", () => {
    everywhere((principal, request, point) => {
      if (principal.kind !== "core") return;
      const decision = outcome(decide(principal, request, point));
      if (request.verb !== "land_recipe") {
        expect(decision).toBe("wrong_principal");
        return;
      }
      if (decision !== "allow") return;
      const { repo, author, appId, onlyAdded, empty } = request.target;
      expect([
        repo,
        ["mate", "devstage"].includes(author.held),
        author.appId,
        onlyAdded,
        empty,
      ]).toEqual(["group", true, appId, true, false]);
    });
  });

  it("decides Core's landing by the change alone, whoever the org has", () => {
    for (const request of REQUESTS) {
      const first = outcome(decide(CORE, request, POINTS[0]!));
      for (const point of POINTS) expect(outcome(decide(CORE, request, point))).toBe(first);
    }
  });

  it("refuses a person or a Mate the landing of a recipe: it is Core's", () => {
    everywhere((principal, request, point) => {
      if (principal.kind !== "core" && request.verb === "land_recipe") {
        expect(outcome(decide(principal, request, point))).toBe("wrong_principal");
      }
    });
  });

  it("refuses a person every verb a Mate asks for itself", () => {
    everywhere((principal, request, point) => {
      if (principal.kind === "person" && MATE_VERBS.has(request.verb)) {
        expect(outcome(decide(principal, request, point))).toBe("wrong_principal");
      }
    });
  });

  it("tells a Mate asking for another project the same, whatever HQ holds it as, wherever", () => {
    for (const point of POINTS) {
      for (const verb of [
        "enroll_mate",
        "ensure_repo",
        "open_change",
        "edit_change",
        "fetch_repo",
      ] as const) {
        const asked = (held: string, appId: string | null): ReadonlyArray<Request> =>
          verb === "enroll_mate"
            ? [onP(verb, held)]
            : verb === "edit_change"
              ? [null, "P", "Q"].map((owner) => editOf(held, appId, owner))
              : verb === "fetch_repo"
                ? ["A", "B"].map((repoAppId) => fetchOf(held, appId, repoAppId))
                : [ofMate(verb, held, appId)];
        const reasons = new Set(
          HELD.flatMap((held) =>
            [null, "A"].flatMap((appId) =>
              asked(held, appId).map((request) =>
                outcome(decide({ kind: "mate", projectId: "Q" }, request, point)),
              ),
            ),
          ),
        );
        expect([...reasons], `${verb} at ${JSON.stringify(point)}`).toEqual(["not_your_project"]);
      }
    }
  });

  it("tells a member without the role on a project the same, whatever HQ holds it as", () => {
    const readsP = (point: Point) => {
      const role = point.override ?? point.orgRole;
      return point.present && RANKED.indexOf(role as (typeof RANKED)[number]) >= 1;
    };
    const asked = (
      verb: Request["verb"],
      held: string,
      to: string,
      app: ReadonlyArray<string>,
    ): ReadonlyArray<Request> =>
      verb === "attach"
        ? [false, true].map((taken) => place(verb, held, to, app, taken))
        : verb === "move"
          ? [place(verb, held, to, app)]
          : [onP(verb as "detach" | "create_mate_record" | "edit_mate_record", held)];
    for (const point of POINTS) {
      if (point.status !== "ACTIVE" || point.orgRole === "ADMIN" || point.orgRole === "OWNER") {
        continue;
      }
      // No grant of their own and an org role below the writers', or no read of the project at all.
      if (point.override !== null && readsP(point)) continue;
      for (const verb of [
        "attach",
        "move",
        "detach",
        "create_mate_record",
        "edit_mate_record",
      ] as const) {
        for (const to of TO) {
          for (const app of APPS) {
            const reasons = new Set(
              HELD.flatMap((held) =>
                asked(verb, held, to, app).map((request) =>
                  outcome(decide(PERSON, request, point)),
                ),
              ),
            );
            expect([...reasons], `${verb} to ${to} at ${JSON.stringify(point)}`).toHaveLength(1);
          }
        }
      }
    }
  });

  it("lets a member who is no writer attach only their project held nowhere, into an empty place, as its admin", () => {
    const effective = (point: Point) => {
      const role = point.present ? (point.override ?? point.orgRole) : "NO_ACCESS";
      return RANKED.indexOf(role as (typeof RANKED)[number]);
    };
    for (const point of POINTS) {
      if (point.status !== "ACTIVE" || point.orgRole === "ADMIN" || point.orgRole === "OWNER") {
        continue;
      }
      for (const to of ["stage", "production"]) {
        for (const app of APPS) {
          const decisions = HELD.flatMap((held) =>
            [false, true].map((taken) => ({
              held,
              taken,
              outcome: outcome(decide(PERSON, place("attach", held, to, app, taken), point)),
            })),
          );
          // Who sees the application, and who develops it: a role on one of its projects (P's
          // is the point's own, the others FIXTURE_GRANTS'), or for seeing, the org's Read only.
          const roleIn = (projectId: string) =>
            projectId === "P"
              ? effective(point)
              : RANKED.indexOf(FIXTURE_GRANTS[projectId as keyof typeof FIXTURE_GRANTS]);
          const sees =
            RANKED.indexOf(point.orgRole as (typeof RANKED)[number]) >= 1 ||
            app.some((projectId) => roleIn(projectId) >= 1);
          const develops = app.some((projectId) => roleIn(projectId) >= 2);
          for (const { held, taken, outcome: decision } of decisions) {
            if (decision === "allow") {
              expect([
                held,
                taken,
                effective(point) >= RANKED.indexOf("ADMIN"),
                sees,
                develops,
              ]).toEqual(["none", false, true, true, true]);
            }
          }
          // Without Full access on the project, neither its kind nor the place shows.
          if (effective(point) < RANKED.indexOf("ADMIN")) {
            expect(new Set(decisions.map((entry) => entry.outcome)).size).toBe(1);
          }
        }
      }
    }
  });

  it("never allows more after a lowering: a role, a grant, the flag, the membership, the project", () => {
    const lowered = (point: Point): ReadonlyArray<Point> => {
      const below = (role: string) => RANKED[RANKED.indexOf(role as (typeof RANKED)[number]) - 1];
      const lower = below(point.orgRole);
      const lowerGrant = point.override === null ? undefined : below(point.override);
      return [
        ...(lower === undefined ? [] : [{ ...point, orgRole: lower }]),
        ...(lowerGrant === undefined ? [] : [{ ...point, override: lowerGrant }]),
        ...(point.canCreate ? [{ ...point, canCreate: false }] : []),
        ...(point.status === "ACTIVE" ? [{ ...point, status: "INVITED" }] : []),
        ...(point.present ? [{ ...point, present: false }] : []),
      ];
    };
    everywhere((principal, request, point) => {
      if (decide(principal, request, point).allow) return;
      for (const lower of lowered(point))
        expect(decide(principal, request, lower).allow).toBe(false);
    });
  });
});
