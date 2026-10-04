import { describe, expect, it } from "@effect/vitest";

import { type Decision, type Facts, type FactMember, can } from "@t3tools/shared/zeropsPermissions";

import {
  type AppProjectRow,
  appOffers,
  appTarget,
  environmentOffers,
  orgOffers,
  releaseTarget,
} from "./offers.ts";

const member = (userId: string, roleCode: string, status = "ACTIVE"): FactMember => ({
  userId,
  clientUserId: `C-${userId}`,
  roleCode,
  status,
  canCreateProjects: false,
});

/**
 * owner and admin by their org role; dev develops the Mate, stager the stage — neither may see
 * production; reader reads the org; suspended is an owner Zerops no longer counts active; nobody has
 * no access at all.
 */
const ORG: Omit<Facts, "freshness"> = {
  members: [
    member("owner", "OWNER"),
    member("admin", "ADMIN"),
    member("dev", "NO_ACCESS"),
    member("stager", "NO_ACCESS"),
    member("reader", "READ_ONLY"),
    member("suspended", "OWNER", "SUSPENDED"),
    member("nobody", "NO_ACCESS"),
  ],
  projects: [
    { id: "P_MATE", userRoles: [{ clientUserId: "C-dev", roleCode: "BASIC_USER" }] },
    { id: "P_STAGE", userRoles: [{ clientUserId: "C-stager", roleCode: "BASIC_USER" }] },
    { id: "P_PROD", userRoles: [] },
  ],
};

/** The application as HQ holds it: every project, whoever may see which. */
const APP: ReadonlyArray<AppProjectRow> = [
  { project_id: "P_MATE", kind: "mate" },
  { project_id: "P_STAGE", kind: "stage" },
  { project_id: "P_PROD", kind: "production" },
];

const ALLOW: Decision = { allow: true };
const no = (reason: Extract<Decision, { allow: false }>["reason"]): Decision => ({
  allow: false,
  reason,
});

type Row = Record<
  | "read_change"
  | "comment_change"
  | "merge_change"
  | "close_change"
  | "redeploy"
  | "release"
  | "keep_deploy_token"
  | "create_app",
  Decision
>;

const WRITER: Row = {
  read_change: ALLOW,
  comment_change: ALLOW,
  merge_change: ALLOW,
  close_change: ALLOW,
  redeploy: ALLOW,
  release: ALLOW,
  keep_deploy_token: ALLOW,
  create_app: ALLOW,
};

/** A developer of the application without production: releasing is refused, not "no production". */
const DEVELOPER: Row = {
  ...WRITER,
  release: no("not_releaser"),
  keep_deploy_token: no("not_project_admin"),
  create_app: no("not_structure_writer"),
};

const EXPECTED: ReadonlyArray<readonly [string, Row]> = [
  ["owner", WRITER],
  ["admin", WRITER],
  ["dev", DEVELOPER],
  ["stager", DEVELOPER],
  [
    "reader",
    {
      read_change: ALLOW,
      comment_change: ALLOW,
      merge_change: no("not_app_developer"),
      close_change: no("not_app_developer"),
      redeploy: no("not_app_developer"),
      release: no("not_releaser"),
      keep_deploy_token: no("not_project_admin"),
      create_app: no("not_structure_writer"),
    },
  ],
  [
    "suspended",
    {
      read_change: no("not_active_member"),
      comment_change: no("not_active_member"),
      merge_change: no("not_active_member"),
      close_change: no("not_active_member"),
      redeploy: no("not_active_member"),
      release: no("not_active_member"),
      keep_deploy_token: no("not_active_member"),
      create_app: no("not_active_member"),
    },
  ],
  [
    "nobody",
    {
      read_change: no("app_not_seen"),
      comment_change: no("app_not_seen"),
      merge_change: no("app_not_seen"),
      close_change: no("app_not_seen"),
      redeploy: no("app_not_seen"),
      release: no("app_not_seen"),
      keep_deploy_token: no("not_project_admin"),
      create_app: no("not_structure_writer"),
    },
  ],
];

describe("HQ's offers", () => {
  describe.each(EXPECTED)("%s", (userId, expected) => {
    const offered = {
      ...appOffers(userId, APP, { ...ORG, freshness: "cached" }),
      ...environmentOffers(userId, "P_PROD", { ...ORG, freshness: "cached" }),
      ...orgOffers(userId, { ...ORG, freshness: "cached" }),
    };
    /** What the write decides, over the target its enforcement builds and facts read for it. */
    const enforced = (verb: keyof Row): Decision => {
      const person = { kind: "person", userId } as const;
      const facts = { ...ORG, freshness: "fresh" } as const;
      switch (verb) {
        case "release":
          return can(person, verb, releaseTarget(APP), facts);
        case "keep_deploy_token":
          return can(person, verb, { projectId: "P_PROD" }, facts);
        case "create_app":
          return can(person, verb, null, facts);
        default:
          return can(person, verb, appTarget(APP), facts);
      }
    };
    it.each(Object.keys(expected) as ReadonlyArray<keyof Row>)(
      "%s: offered as the write decides it",
      (verb) => {
        expect([offered[verb], enforced(verb)]).toEqual([expected[verb], expected[verb]]);
      },
    );
  });
});
