/**
 * The verb rule (`zeropsPermissions.ts`) over every input that changes its answer, as literal
 * tables. The client's preview replays them and HQ's `internal/permissions` replays them, so the
 * two cannot disagree.
 *
 * One person, Zerops user `U1`, and one project, `P`: every project a call names is `P`, except the
 * project an attach is about to make (`projectId: null`). A grid's rows are the person's
 * organization role (`SUPERUSER`: a role this build does not know) and membership status; its
 * columns are `P` as Zerops gives it to them (`PROJECT_COLUMNS`): `gone` (not listed), listed with
 * no override of their role (`none`), or listed with that override. A cell is `allow` or the
 * refusal's reason.
 *
 * Plain data: no import but types, so any runtime reads it.
 *
 * @module zeropsPermissions.vectors
 */
import type { AttachTarget, MergeLimit, ReleaseProduction } from "./zeropsPermissions.ts";

export const VECTOR_USER_ID = "U1";
export const VECTOR_PROJECT_ID = "P";

export const ROLE_ROWS = ["OWNER", "ADMIN", "BASIC_USER", "READ_ONLY", "NO_ACCESS", "SUPERUSER"];
export const STATUS_ROWS = ["ACTIVE", "INVITED"];
export const PROJECT_COLUMNS = [
  "gone",
  "none",
  "NO_ACCESS",
  "READ_ONLY",
  "BASIC_USER",
  "ADMIN",
  "OWNER",
  "SUPERUSER",
];

/** One call of the verb rule: its function and every argument but the facts. */
export type PermissionCall =
  | { readonly fn: "createAppPermission" }
  | {
      readonly fn: "appPermission";
      readonly verb: "read_app" | "push_repo";
      readonly projectIds: ReadonlyArray<string>;
    }
  | { readonly fn: "structurePermission" }
  | { readonly fn: "addMatePermission"; readonly projectIds: ReadonlyArray<string> }
  | { readonly fn: "operateMatePermission"; readonly projectId: string }
  | {
      readonly fn: "mateRecordPermission";
      readonly projectId: string;
      readonly create: boolean;
      readonly held: string;
    }
  | { readonly fn: "attachPermission"; readonly target: AttachTarget }
  | {
      readonly fn: "changePermission";
      readonly verb:
        | "read_change"
        | "comment_change"
        | "merge_change"
        | "ask_merge_change"
        | "close_change";
      readonly projectIds: ReadonlyArray<string>;
      readonly mergers: MergeLimit | null;
    }
  | {
      readonly fn: "deployPermission";
      readonly verb: "keep_deploy_token" | "redeploy";
      readonly projectId: string;
      readonly productionMergers: MergeLimit | null;
    }
  | {
      readonly fn: "releasePermission";
      readonly projectIds: ReadonlyArray<string>;
      readonly production: ReleaseProduction;
      readonly mergers: MergeLimit | null;
    }
  | { readonly fn: "detachPermission"; readonly projectId: string; readonly held: string };

export interface PermissionVector {
  readonly name: string;
  readonly call: PermissionCall;
  /** Zerops' *can create projects* flag on the person's membership. */
  readonly canCreateProjects: boolean;
  readonly grid: string;
}

export const permissionVectors: ReadonlyArray<PermissionVector> = [
  {
    name: "Creating an application",
    call: { fn: "createAppPermission" },
    canCreateProjects: false,
    grid: `
    role       status  gone                   none                   NO_ACCESS              READ_ONLY              BASIC_USER             ADMIN                  OWNER                  SUPERUSER
    OWNER      ACTIVE  allow                  allow                  allow                  allow                  allow                  allow                  allow                  allow
    OWNER      INVITED not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member
    ADMIN      ACTIVE  allow                  allow                  allow                  allow                  allow                  allow                  allow                  allow
    ADMIN      INVITED not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member
    BASIC_USER ACTIVE  cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects
    BASIC_USER INVITED not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member
    READ_ONLY  ACTIVE  cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects
    READ_ONLY  INVITED not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member
    NO_ACCESS  ACTIVE  cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects
    NO_ACCESS  INVITED not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member
    SUPERUSER  ACTIVE  cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects
    SUPERUSER  INVITED not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member
`,
  },
  {
    name: "Creating an application, with Zerops' can-create flag",
    call: { fn: "createAppPermission" },
    canCreateProjects: true,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Reading an application by its project",
    call: { fn: "appPermission", verb: "read_app", projectIds: ["P"] },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      allow             allow             allow             allow             app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      allow             allow             allow             allow             app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Pushing to an application by its project",
    call: { fn: "appPermission", verb: "push_repo", projectIds: ["P"] },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer allow             allow             allow             not_app_developer
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_app_developer allow             allow             allow             app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_app_developer allow             allow             allow             app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Pushing to an application with no project",
    call: { fn: "appPermission", verb: "push_repo", projectIds: [] },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer not_app_developer not_app_developer not_app_developer not_app_developer
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      app_not_seen      app_not_seen      app_not_seen      app_not_seen      app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      app_not_seen      app_not_seen      app_not_seen      app_not_seen      app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Writing the structure",
    call: { fn: "structurePermission" },
    canCreateProjects: false,
    grid: `
    role       status  gone                 none                 NO_ACCESS            READ_ONLY            BASIC_USER           ADMIN                OWNER                SUPERUSER
    OWNER      ACTIVE  allow                allow                allow                allow                allow                allow                allow                allow
    OWNER      INVITED not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member
    ADMIN      ACTIVE  allow                allow                allow                allow                allow                allow                allow                allow
    ADMIN      INVITED not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member
    BASIC_USER ACTIVE  not_structure_writer not_structure_writer not_structure_writer not_structure_writer not_structure_writer not_structure_writer not_structure_writer not_structure_writer
    BASIC_USER INVITED not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member
    READ_ONLY  ACTIVE  not_structure_writer not_structure_writer not_structure_writer not_structure_writer not_structure_writer not_structure_writer not_structure_writer not_structure_writer
    READ_ONLY  INVITED not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member
    NO_ACCESS  ACTIVE  not_structure_writer not_structure_writer not_structure_writer not_structure_writer not_structure_writer not_structure_writer not_structure_writer not_structure_writer
    NO_ACCESS  INVITED not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member
    SUPERUSER  ACTIVE  not_structure_writer not_structure_writer not_structure_writer not_structure_writer not_structure_writer not_structure_writer not_structure_writer not_structure_writer
    SUPERUSER  INVITED not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member    not_active_member
`,
  },
  {
    name: "Adding a Mate to an application",
    call: { fn: "addMatePermission", projectIds: ["P"] },
    canCreateProjects: false,
    grid: `
    role       status  gone                   none                   NO_ACCESS              READ_ONLY              BASIC_USER             ADMIN                  OWNER                  SUPERUSER
    OWNER      ACTIVE  allow                  allow                  allow                  allow                  allow                  allow                  allow                  allow
    OWNER      INVITED not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member
    ADMIN      ACTIVE  allow                  allow                  allow                  allow                  allow                  allow                  allow                  allow
    ADMIN      INVITED not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member
    BASIC_USER ACTIVE  cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects
    BASIC_USER INVITED not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member
    READ_ONLY  ACTIVE  cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects
    READ_ONLY  INVITED not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member
    NO_ACCESS  ACTIVE  app_not_seen           app_not_seen           app_not_seen           cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects app_not_seen
    NO_ACCESS  INVITED not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member
    SUPERUSER  ACTIVE  app_not_seen           app_not_seen           app_not_seen           cannot_create_projects cannot_create_projects cannot_create_projects cannot_create_projects app_not_seen
    SUPERUSER  INVITED not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member      not_active_member
`,
  },
  {
    name: "Adding a Mate to an application, with the can-create flag",
    call: { fn: "addMatePermission", projectIds: ["P"] },
    canCreateProjects: true,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      allow             allow             allow             allow             app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      allow             allow             allow             allow             app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Operating a Mate",
    call: { fn: "operateMatePermission", projectId: "P" },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  project_gone      allow             not_mate_operator not_mate_operator allow             allow             allow             not_mate_operator
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  project_gone      allow             not_mate_operator not_mate_operator allow             allow             allow             not_mate_operator
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  project_gone      allow             not_mate_operator not_mate_operator allow             allow             allow             not_mate_operator
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  project_gone      not_mate_operator not_mate_operator not_mate_operator allow             allow             allow             not_mate_operator
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  project_gone      not_mate_operator not_mate_operator not_mate_operator allow             allow             allow             not_mate_operator
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  project_gone      not_mate_operator not_mate_operator not_mate_operator allow             allow             allow             not_mate_operator
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Creating a Mate record",
    call: { fn: "mateRecordPermission", projectId: "P", create: true, held: "none" },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  project_gone      allow             not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  project_gone      allow             not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Creating a Mate record for a project held as a production",
    call: { fn: "mateRecordPermission", projectId: "P", create: true, held: "production" },
    canCreateProjects: false,
    grid: `
    role       status  gone              none                NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN               OWNER               SUPERUSER
    OWNER      ACTIVE  project_gone      held_as_environment not_project_admin not_project_admin not_project_admin held_as_environment held_as_environment not_project_admin
    OWNER      INVITED not_active_member not_active_member   not_active_member not_active_member not_active_member not_active_member   not_active_member   not_active_member
    ADMIN      ACTIVE  project_gone      held_as_environment not_project_admin not_project_admin not_project_admin held_as_environment held_as_environment not_project_admin
    ADMIN      INVITED not_active_member not_active_member   not_active_member not_active_member not_active_member not_active_member   not_active_member   not_active_member
    BASIC_USER ACTIVE  project_gone      not_project_admin   not_project_admin not_project_admin not_project_admin held_as_environment held_as_environment not_project_admin
    BASIC_USER INVITED not_active_member not_active_member   not_active_member not_active_member not_active_member not_active_member   not_active_member   not_active_member
    READ_ONLY  ACTIVE  project_gone      not_project_admin   not_project_admin not_project_admin not_project_admin held_as_environment held_as_environment not_project_admin
    READ_ONLY  INVITED not_active_member not_active_member   not_active_member not_active_member not_active_member not_active_member   not_active_member   not_active_member
    NO_ACCESS  ACTIVE  project_gone      not_project_admin   not_project_admin not_project_admin not_project_admin held_as_environment held_as_environment not_project_admin
    NO_ACCESS  INVITED not_active_member not_active_member   not_active_member not_active_member not_active_member not_active_member   not_active_member   not_active_member
    SUPERUSER  ACTIVE  project_gone      not_project_admin   not_project_admin not_project_admin not_project_admin held_as_environment held_as_environment not_project_admin
    SUPERUSER  INVITED not_active_member not_active_member   not_active_member not_active_member not_active_member not_active_member   not_active_member   not_active_member
`,
  },
  {
    name: "Editing a Mate record",
    call: { fn: "mateRecordPermission", projectId: "P", create: false, held: "mate" },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  project_gone      allow             not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  project_gone      allow             not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Attaching a project as a Mate",
    call: {
      fn: "attachPermission",
      target: { projectId: "P", projectIds: ["P"], kind: "mate", held: "none", slotTaken: false },
    },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  project_gone      allow             allow             allow             allow             allow             allow             allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  project_gone      allow             allow             allow             allow             allow             allow             allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  project_gone      not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  project_gone      not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  project_gone      not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  project_gone      not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Attaching a project as a Mate, with the can-create flag",
    call: {
      fn: "attachPermission",
      target: { projectId: "P", projectIds: ["P"], kind: "mate", held: "none", slotTaken: false },
    },
    canCreateProjects: true,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  project_gone      allow             allow             allow             allow             allow             allow             allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  project_gone      allow             allow             allow             allow             allow             allow             allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  project_gone      not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  allow             allow             not_own_new_mate
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  project_gone      not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  allow             allow             not_own_new_mate
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  project_gone      not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  allow             allow             not_own_new_mate
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  project_gone      not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  allow             allow             not_own_new_mate
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Attaching a project held as a stage as a Mate, with the can-create flag",
    call: {
      fn: "attachPermission",
      target: {
        projectId: "P",
        projectIds: ["P"],
        kind: "devstage",
        held: "stage",
        slotTaken: false,
      },
    },
    canCreateProjects: true,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  project_gone      allow             allow             allow             allow             allow             allow             allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  project_gone      allow             allow             allow             allow             allow             allow             allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  project_gone      not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  kind_class_change kind_class_change not_own_new_mate
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  project_gone      not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  kind_class_change kind_class_change not_own_new_mate
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  project_gone      not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  kind_class_change kind_class_change not_own_new_mate
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  project_gone      not_own_new_mate  not_own_new_mate  not_own_new_mate  not_own_new_mate  kind_class_change kind_class_change not_own_new_mate
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Attaching a project the person is about to make as a Mate, with the can-create flag",
    call: {
      fn: "attachPermission",
      target: { projectId: null, projectIds: ["P"], kind: "mate", held: "none", slotTaken: false },
    },
    canCreateProjects: true,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      allow             allow             allow             allow             app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      allow             allow             allow             allow             app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Attaching a project as a stage",
    call: {
      fn: "attachPermission",
      target: { projectId: "P", projectIds: ["P"], kind: "stage", held: "none", slotTaken: false },
    },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  project_gone      allow             allow             allow             allow             allow             allow             allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  project_gone      allow             allow             allow             allow             allow             allow             allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Attaching a project as a production whose slot is taken",
    call: {
      fn: "attachPermission",
      target: {
        projectId: "P",
        projectIds: ["P"],
        kind: "production",
        held: "none",
        slotTaken: true,
      },
    },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  project_gone      allow             allow             allow             allow             allow             allow             allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  project_gone      allow             allow             allow             allow             allow             allow             allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin slot_taken        slot_taken        not_project_admin
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin slot_taken        slot_taken        not_project_admin
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin slot_taken        slot_taken        not_project_admin
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin slot_taken        slot_taken        not_project_admin
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Attaching a project held as a Mate as a stage",
    call: {
      fn: "attachPermission",
      target: { projectId: "P", projectIds: ["P"], kind: "stage", held: "mate", slotTaken: false },
    },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  project_gone      allow             allow             allow             allow             allow             allow             allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  project_gone      allow             allow             allow             allow             allow             allow             allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin kind_class_change kind_class_change not_project_admin
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin kind_class_change kind_class_change not_project_admin
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin kind_class_change kind_class_change not_project_admin
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin kind_class_change kind_class_change not_project_admin
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Attaching a project held as a production as a stage",
    call: {
      fn: "attachPermission",
      target: {
        projectId: "P",
        projectIds: ["P"],
        kind: "stage",
        held: "production",
        slotTaken: false,
      },
    },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN                OWNER                SUPERUSER
    OWNER      ACTIVE  project_gone      allow             allow             allow             allow             allow                allow                allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member    not_active_member    not_active_member
    ADMIN      ACTIVE  project_gone      allow             allow             allow             allow             allow                allow                allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member    not_active_member    not_active_member
    BASIC_USER ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin not_structure_writer not_structure_writer not_project_admin
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member    not_active_member    not_active_member
    READ_ONLY  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin not_structure_writer not_structure_writer not_project_admin
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member    not_active_member    not_active_member
    NO_ACCESS  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin not_structure_writer not_structure_writer not_project_admin
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member    not_active_member    not_active_member
    SUPERUSER  ACTIVE  project_gone      not_project_admin not_project_admin not_project_admin not_project_admin not_structure_writer not_structure_writer not_project_admin
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member    not_active_member    not_active_member
`,
  },
  {
    name: "Reading a change",
    call: { fn: "changePermission", verb: "read_change", projectIds: ["P"], mergers: null },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      allow             allow             allow             allow             app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      allow             allow             allow             allow             app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Commenting on a change",
    call: { fn: "changePermission", verb: "comment_change", projectIds: ["P"], mergers: null },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer allow             allow             allow             not_app_developer
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_app_developer allow             allow             allow             app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_app_developer allow             allow             allow             app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Commenting on a change of an application with no project",
    call: { fn: "changePermission", verb: "comment_change", projectIds: [], mergers: null },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer not_app_developer not_app_developer not_app_developer not_app_developer
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      app_not_seen      app_not_seen      app_not_seen      app_not_seen      app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      app_not_seen      app_not_seen      app_not_seen      app_not_seen      app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Closing a change",
    call: { fn: "changePermission", verb: "close_change", projectIds: ["P"], mergers: null },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  allow             allow             allow             allow             allow             allow             allow             allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer allow             allow             allow             not_app_developer
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_app_developer allow             allow             allow             app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_app_developer allow             allow             allow             app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Merging a change",
    call: { fn: "changePermission", verb: "merge_change", projectIds: ["P"], mergers: null },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer allow             allow             allow             not_app_developer
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_app_developer allow             allow             allow             app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_app_developer allow             allow             allow             app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Merging a change where the application's merge limit names nobody",
    call: {
      fn: "changePermission",
      verb: "merge_change",
      projectIds: ["P"],
      mergers: { people: [] },
    },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_app_developer not_app_merger    not_app_developer not_app_developer not_app_merger    not_app_merger    not_app_merger    not_app_developer
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer not_app_merger    not_app_merger    not_app_merger    not_app_developer
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_app_developer not_app_merger    not_app_merger    not_app_merger    app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_app_developer not_app_merger    not_app_merger    not_app_merger    app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Merging a change where the merge limit names the person",
    call: {
      fn: "changePermission",
      verb: "merge_change",
      projectIds: ["P"],
      mergers: { people: ["U1"] },
    },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer allow             allow             allow             not_app_developer
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_app_developer allow             allow             allow             app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_app_developer allow             allow             allow             app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Asking for a merge where the merge limit names nobody",
    call: {
      fn: "changePermission",
      verb: "ask_merge_change",
      projectIds: ["P"],
      mergers: { people: [] },
    },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer allow             allow             allow             not_app_developer
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_app_developer allow             allow             allow             app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_app_developer allow             allow             allow             app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Keeping an environment's deploy token",
    call: {
      fn: "deployPermission",
      verb: "keep_deploy_token",
      projectId: "P",
      productionMergers: null,
    },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  project_gone      allow             allow             allow             allow             allow             allow             allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  project_gone      allow             allow             allow             allow             allow             allow             allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_project_admin not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_project_admin not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  not_project_admin not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  not_project_admin not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Deploying an environment again",
    call: { fn: "deployPermission", verb: "redeploy", projectId: "P", productionMergers: null },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer allow             allow             allow             not_app_developer
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer allow             allow             allow             not_app_developer
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer allow             allow             allow             not_app_developer
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Deploying a production again where the merge limit names nobody",
    call: {
      fn: "deployPermission",
      verb: "redeploy",
      projectId: "P",
      productionMergers: { people: [] },
    },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_app_developer not_app_merger    not_app_developer not_app_developer not_app_merger    not_app_merger    not_app_merger    not_app_developer
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer not_app_merger    not_app_merger    not_app_merger    not_app_developer
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer not_app_merger    not_app_merger    not_app_merger    not_app_developer
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer not_app_merger    not_app_merger    not_app_merger    not_app_developer
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Deploying a production again where the merge limit names the person",
    call: {
      fn: "deployPermission",
      verb: "redeploy",
      projectId: "P",
      productionMergers: { people: ["U1"] },
    },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_app_developer allow             not_app_developer not_app_developer allow             allow             allow             not_app_developer
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer allow             allow             allow             not_app_developer
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer allow             allow             allow             not_app_developer
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  not_app_developer not_app_developer not_app_developer not_app_developer allow             allow             allow             not_app_developer
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Releasing an application with no production",
    call: { fn: "releasePermission", projectIds: ["P"], production: null, mergers: null },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  no_production     no_production     no_production     no_production     no_production     no_production     no_production     no_production
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  no_production     no_production     no_production     no_production     no_production     no_production     no_production     no_production
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  no_production     no_production     no_production     no_production     no_production     no_production     no_production     no_production
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  no_production     no_production     no_production     no_production     no_production     no_production     no_production     no_production
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      no_production     no_production     no_production     no_production     app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      no_production     no_production     no_production     no_production     app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Releasing to a Git production",
    call: {
      fn: "releasePermission",
      projectIds: ["P"],
      production: { kind: "git" },
      mergers: null,
    },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  not_releaser      allow             not_releaser      not_releaser      allow             allow             allow             not_releaser
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  not_releaser      allow             not_releaser      not_releaser      allow             allow             allow             not_releaser
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_releaser      allow             not_releaser      not_releaser      allow             allow             allow             not_releaser
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_releaser      not_releaser      not_releaser      not_releaser      allow             allow             allow             not_releaser
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_releaser      allow             allow             allow             app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_releaser      allow             allow             allow             app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Releasing to a Git production where the merge limit names nobody",
    call: {
      fn: "releasePermission",
      projectIds: ["P"],
      production: { kind: "git" },
      mergers: { people: [] },
    },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  not_releaser      allow             not_releaser      not_releaser      allow             allow             allow             not_releaser
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  not_releaser      allow             not_releaser      not_releaser      allow             allow             allow             not_releaser
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_releaser      not_app_merger    not_releaser      not_releaser      not_app_merger    not_app_merger    not_app_merger    not_releaser
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_releaser      not_releaser      not_releaser      not_releaser      not_app_merger    not_app_merger    not_app_merger    not_releaser
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_releaser      not_app_merger    not_app_merger    not_app_merger    app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_releaser      not_app_merger    not_app_merger    not_app_merger    app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Releasing to a Zerops production",
    call: {
      fn: "releasePermission",
      projectIds: [],
      production: { kind: "zerops", projectId: "P" },
      mergers: null,
    },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  project_gone      allow             not_releaser      not_releaser      allow             allow             allow             not_releaser
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  project_gone      allow             not_releaser      not_releaser      allow             allow             allow             not_releaser
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_releaser      allow             not_releaser      not_releaser      allow             allow             allow             not_releaser
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_releaser      not_releaser      not_releaser      not_releaser      allow             allow             allow             not_releaser
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_releaser      allow             allow             allow             app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_releaser      allow             allow             allow             app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Releasing to a Zerops production where the merge limit names nobody",
    call: {
      fn: "releasePermission",
      projectIds: [],
      production: { kind: "zerops", projectId: "P" },
      mergers: { people: [] },
    },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  project_gone      allow             not_releaser      not_releaser      allow             allow             allow             not_releaser
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  project_gone      allow             not_releaser      not_releaser      allow             allow             allow             not_releaser
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_releaser      not_app_merger    not_releaser      not_releaser      not_app_merger    not_app_merger    not_app_merger    not_releaser
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_releaser      not_releaser      not_releaser      not_releaser      not_app_merger    not_app_merger    not_app_merger    not_releaser
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_releaser      not_app_merger    not_app_merger    not_app_merger    app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_releaser      not_app_merger    not_app_merger    not_app_merger    app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Releasing to a Zerops production where the merge limit names the person",
    call: {
      fn: "releasePermission",
      projectIds: [],
      production: { kind: "zerops", projectId: "P" },
      mergers: { people: ["U1"] },
    },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  project_gone      allow             not_releaser      not_releaser      allow             allow             allow             not_releaser
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  project_gone      allow             not_releaser      not_releaser      allow             allow             allow             not_releaser
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_releaser      allow             not_releaser      not_releaser      allow             allow             allow             not_releaser
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_releaser      not_releaser      not_releaser      not_releaser      allow             allow             allow             not_releaser
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_releaser      allow             allow             allow             app_not_seen
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  app_not_seen      app_not_seen      app_not_seen      not_releaser      allow             allow             allow             app_not_seen
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Detaching a Mate",
    call: { fn: "detachPermission", projectId: "P", held: "mate" },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN             OWNER             SUPERUSER
    OWNER      ACTIVE  project_gone      allow             not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    ADMIN      ACTIVE  project_gone      allow             not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    BASIC_USER ACTIVE  not_project_admin not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    READ_ONLY  ACTIVE  not_project_admin not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    NO_ACCESS  ACTIVE  not_project_admin not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
    SUPERUSER  ACTIVE  not_project_admin not_project_admin not_project_admin not_project_admin not_project_admin allow             allow             not_project_admin
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member
`,
  },
  {
    name: "Detaching an environment",
    call: { fn: "detachPermission", projectId: "P", held: "stage" },
    canCreateProjects: false,
    grid: `
    role       status  gone              none              NO_ACCESS         READ_ONLY         BASIC_USER        ADMIN                OWNER                SUPERUSER
    OWNER      ACTIVE  project_gone      allow             allow             allow             allow             allow                allow                allow
    OWNER      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member    not_active_member    not_active_member
    ADMIN      ACTIVE  project_gone      allow             allow             allow             allow             allow                allow                allow
    ADMIN      INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member    not_active_member    not_active_member
    BASIC_USER ACTIVE  not_project_admin not_project_admin not_project_admin not_project_admin not_project_admin not_structure_writer not_structure_writer not_project_admin
    BASIC_USER INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member    not_active_member    not_active_member
    READ_ONLY  ACTIVE  not_project_admin not_project_admin not_project_admin not_project_admin not_project_admin not_structure_writer not_structure_writer not_project_admin
    READ_ONLY  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member    not_active_member    not_active_member
    NO_ACCESS  ACTIVE  not_project_admin not_project_admin not_project_admin not_project_admin not_project_admin not_structure_writer not_structure_writer not_project_admin
    NO_ACCESS  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member    not_active_member    not_active_member
    SUPERUSER  ACTIVE  not_project_admin not_project_admin not_project_admin not_project_admin not_project_admin not_structure_writer not_structure_writer not_project_admin
    SUPERUSER  INVITED not_active_member not_active_member not_active_member not_active_member not_active_member not_active_member    not_active_member    not_active_member
`,
  },
];
