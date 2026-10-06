import { describe, expect, it } from "@effect/vitest";
import { resolveDoorVisibility } from "@t3tools/shared/mateAccess";

import { type Decision } from "@t3tools/shared/zeropsPermissions";
import { type Facts, type FactMember, can } from "./permissions.ts";

import {
  type AppProjectRow,
  appOffers,
  appTarget,
  environmentOffers,
  mateOffers,
  moveDestinations,
  orgOffers,
  recordOffers,
  releaseTarget,
} from "./offers.ts";

const KINDS = ["mate", "devstage", "stage", "production"];

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

describe("HQ's offers on a Mate", () => {
  /** maker: org No access who can create projects, Owner of the Mate they made; ada: its admin. */
  const FACTS: Facts = {
    freshness: "cached",
    members: [
      { ...member("maker", "NO_ACCESS"), canCreateProjects: true },
      member("ada", "BASIC_USER"),
      member("owner", "OWNER"),
      member("reader", "READ_ONLY"),
    ],
    projects: [
      { id: "P_MADE", userRoles: [{ clientUserId: "C-maker", roleCode: "OWNER" }] },
      { id: "P_SEEN", userRoles: [{ clientUserId: "C-maker", roleCode: "READ_ONLY" }] },
      { id: "P_OTHER", userRoles: [] },
      { id: "P_ADA", userRoles: [{ clientUserId: "C-ada", roleCode: "ADMIN" }] },
      { id: "P_LIVE", userRoles: [] },
    ],
  };
  /** app-live holds a production Zerops still has; app-lost one it no longer has. */
  const APPS = [
    { id: "app-seen", projects: [{ project_id: "P_SEEN", kind: "stage" }] },
    { id: "app-other", projects: [{ project_id: "P_OTHER", kind: "stage" }] },
    { id: "app-live", projects: [{ project_id: "P_LIVE", kind: "production" }] },
    { id: "app-lost", projects: [{ project_id: "P_LOST", kind: "production" }] },
  ];

  it.each<[string, string, string, boolean, Record<string, ReadonlyArray<string>>]>([
    // Their own Mate goes as a Mate into an application they see, never as an environment.
    ["the Mate's maker", "maker", "P_MADE", true, { "app-seen": ["mate", "devstage"] }],
    // A Mate HQ holds no record of takes no Mate kind anywhere.
    ["a Mate without its record", "maker", "P_MADE", false, {}],
    // A writer moves it anywhere, as anything, or into a new application — but into a production
    // place a production Zerops still has holds, which the move would refuse (`production_taken`).
    [
      "the org's owner",
      "owner",
      "P_MADE",
      true,
      {
        "app-seen": KINDS,
        "app-other": KINDS,
        "app-live": ["mate", "devstage", "stage"],
        "app-lost": KINDS,
        new: KINDS,
      },
    ],
    // The production itself stays offered where it is.
    [
      "the org's owner, of the production",
      "owner",
      "P_LIVE",
      true,
      {
        "app-seen": KINDS,
        "app-other": KINDS,
        "app-live": KINDS,
        "app-lost": KINDS,
        new: KINDS,
      },
    ],
    ["a reader", "reader", "P_MADE", true, {}],
  ])("moves for %s as the write decides", (_, userId, projectId, recorded, expected) => {
    expect(moveDestinations(userId, { projectId, held: "mate", recorded }, APPS, FACTS)).toEqual(
      expected,
    );
  });

  it.each<[string, string, Record<string, Decision>]>([
    ["its project's admin", "ada", { observe_mate: ALLOW, edit_mate_record: ALLOW, detach: ALLOW }],
    [
      "an org reader",
      "reader",
      {
        observe_mate: no("not_mate_operator"),
        edit_mate_record: no("not_project_admin"),
        detach: no("not_project_admin"),
      },
    ],
  ])("offers %s its Mate's verbs as the write decides", (_, userId, expected) => {
    expect(mateOffers(userId, "P_ADA", "mate", FACTS)).toEqual(expected);
  });

  it("offers writing a record of a Mate HQ holds nowhere to its project's admin alone", () => {
    expect([recordOffers("ada", "P_ADA", FACTS), recordOffers("reader", "P_ADA", FACTS)]).toEqual([
      { create_mate_record: ALLOW },
      { create_mate_record: no("not_project_admin") },
    ]);
  });
});

/**
 * Who opens a Mate is decided twice, by two executors over the same Zerops facts: HQ offers following
 * it (`observe_mate`) and the Mate's door lets them in (`resolveDoorVisibility`). Every org role,
 * every grant on the Mate's project and an inactive member: the two never disagree.
 */
describe("a Basic user opens a Mate: HQ's offer and the door agree", () => {
  const ROLES = ["NO_ACCESS", "READ_ONLY", "BASIC_USER", "ADMIN", "OWNER", "SUPREME"] as const;
  const GRANTS = [undefined, ...ROLES] as const;
  const cases = ROLES.flatMap((orgRole) =>
    GRANTS.flatMap((grant) =>
      ["ACTIVE", "SUSPENDED"].map((status) => [orgRole, grant, status] as const),
    ),
  );
  it.each(cases)("org %s, grant %s, %s", (orgRole, grant, status) => {
    const facts: Facts = {
      freshness: "cached",
      members: [member("u", orgRole, status)],
      projects: [
        {
          id: "P_MATE",
          userRoles: grant === undefined ? [] : [{ clientUserId: "C-u", roleCode: grant }],
        },
      ],
    };
    const door = resolveDoorVisibility({
      projectId: "P_MATE",
      member: {
        userId: "u",
        clientUserId: "C-u",
        orgRole,
        status,
        canCreateProjects: false,
      },
      override: grant,
    });
    expect(mateOffers("u", "P_MATE", "mate", facts).observe_mate.allow).toBe(
      door.visibility === "open",
    );
  });
});
