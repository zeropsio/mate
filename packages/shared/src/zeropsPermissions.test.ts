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
 * through a grant) and `P_HIDDEN` (a grant of none). `OTHER`, an active org owner with an owner's
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
    { id: "P_SEEN", userRoles: [{ clientUserId: "C-U", roleCode: "READ_ONLY" }] },
    { id: "P_HIDDEN", userRoles: [{ clientUserId: "C-U", roleCode: "NO_ACCESS" }] },
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
): Request => ({ verb, target: { projectId: "P", held, to, appProjectIds } });
const onP = (
  verb: "detach" | "create_mate_record" | "edit_mate_record" | "enroll_mate",
  held: string,
): Request => ({ verb, target: { projectId: "P", held } });

/** U as an org owner, a structure writer. */
const WRITER = { orgRole: "OWNER" } as const;
/** U with org NO_ACCESS, who can create projects and owns P: a Mate's creator (the test org's shape). */
const MAKER = { orgRole: "NO_ACCESS", canCreate: true, override: "OWNER" } as const;
/** U with org NO_ACCESS and ADMIN on P alone: P's admin, nobody else's. */
const P_ADMIN = { orgRole: "NO_ACCESS", override: "ADMIN" } as const;

const TABLES: Readonly<Record<Verb, ReadonlyArray<Row>>> = {
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
      "not_structure_writer",
    ],
    [
      "P's admin, an environment",
      P_ADMIN,
      place("attach", "none", "production"),
      "not_structure_writer",
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
};

const MATE_P: Principal = { kind: "mate", projectId: "P" };

describe("can — one table per verb", () => {
  for (const [verb, rows] of Object.entries(TABLES)) {
    it.each(rows.map((row) => [row[0], row] as const))(
      `${verb}: %s`,
      (_name, [, point, request, expected]) => {
        const principal = verb === "enroll_mate" ? MATE_P : PERSON;
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
const APPS = [[], ["P"], ["P_SEEN"], ["P_HIDDEN"]] as const;

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
  { verb: "read_project", target: { projectId: "P" } },
  ...APPS.map((projectIds): Request => ({ verb: "read_app", target: { projectIds } })),
  { verb: "create_app", target: null },
  { verb: "rename_app", target: null },
  ...(["attach", "move"] as const).flatMap((verb) =>
    HELD.flatMap((held) => TO.flatMap((to) => APPS.map((app) => place(verb, held, to, app)))),
  ),
  ...(["detach", "create_mate_record", "edit_mate_record", "enroll_mate"] as const).flatMap(
    (verb) => HELD.map((held) => onP(verb, held)),
  ),
];

const PRINCIPALS: ReadonlyArray<Principal> = [
  PERSON,
  { kind: "person", userId: "STRANGER" },
  MATE_P,
  { kind: "mate", projectId: "Q" },
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
    case "attach":
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
