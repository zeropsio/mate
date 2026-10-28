import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import {
  accessChanges,
  asksFirst,
  defaultAccessMenu,
  personMenu,
  projectPeople,
  shortName,
  type ProjectPeopleInput,
  type ProjectPerson,
} from "./projectPeople.logic";

const member = (
  id: string,
  name: string,
  roleCode: string,
  extra: Partial<ZeropsOrganizationMember> = {},
): ZeropsOrganizationMember => ({
  id: `cu-${id}`,
  status: "ACTIVE",
  roleCode,
  user: { id: `u-${id}`, fullName: name },
  ...extra,
});

type Grants = ReadonlyArray<readonly [who: string, roleCode: string]>;
type Kind = ProjectPeopleInput["projects"][number]["kind"];

/** One of the group's projects, its grants read. */
interface Project {
  readonly projectId: string;
  readonly kind: Kind;
  readonly name?: string;
  readonly grants?: ProjectPeopleInput["grants"][string];
  readonly owner?: string;
}

const place = (projectId: string, kind: Kind, grants: Grants = [], name?: string): Project => ({
  projectId,
  kind,
  ...(name === undefined ? {} : { name }),
  grants: {
    status: "ready",
    grants: grants.map(([who, roleCode]) => ({ clientUserId: `cu-${who}`, roleCode })),
  },
});

const PROD_AND_STAGE = (prod: Grants = [], stage: Grants = []) => [
  place("p-prod", "production", prod),
  place("p-stage", "stage", stage),
];

const input = (
  overrides: Partial<Omit<ProjectPeopleInput, "projects" | "grants" | "owners">> & {
    readonly projects?: ReadonlyArray<Project>;
  },
): ProjectPeopleInput => {
  const { projects = PROD_AND_STAGE(), ...rest } = overrides;
  return {
    members: { known: true, status: "ready", refused: false, list: [] },
    pictures: {},
    viewerUserId: null,
    ...rest,
    projects: projects.map(({ projectId, kind, name }) => ({
      projectId,
      kind,
      ...(name === undefined ? {} : { name }),
    })),
    grants: Object.fromEntries(
      projects.flatMap(({ projectId, grants }) =>
        grants === undefined ? [] : [[projectId, grants]],
      ),
    ),
    owners: Object.fromEntries(
      projects.flatMap(({ projectId, owner }) => (owner === undefined ? [] : [[projectId, owner]])),
    ),
  };
};

const mate = (projectId: string, owner?: string, grants: Grants = []): Project => ({
  ...place(projectId, "mate", grants),
  ...(owner === undefined ? {} : { owner }),
});

const people = (view: ReturnType<typeof projectPeople>): ReadonlyArray<ProjectPerson> =>
  view.kind === "people" ? view.people : [];

const lineOf = (view: ReturnType<typeof projectPeople>, name: string) =>
  people(view).find((person) => person.name === name)?.line;

describe("what each person may do on the project, in words", () => {
  it.each<{
    readonly name: string;
    readonly member: ZeropsOrganizationMember;
    readonly places: ReadonlyArray<Project>;
    readonly line: string | undefined;
  }>([
    {
      name: "An organization owner reads 'Owner · everything'",
      member: member("ada", "Ada", "OWNER"),
      places: PROD_AND_STAGE(),
      line: "Owner · everything",
    },
    {
      name: "An organization admin reads 'Admin · everything'",
      member: member("ada", "Ada", "ADMIN"),
      places: PROD_AND_STAGE(),
      line: "Admin · everything",
    },
    {
      name: "A developer of the organization reads 'Works on every project'",
      member: member("ada", "Ada", "BASIC_USER"),
      places: PROD_AND_STAGE(),
      line: "Works on every project",
    },
    {
      name: "A read-only member of the organization reads 'Sees every project'",
      member: member("ada", "Ada", "READ_ONLY"),
      places: PROD_AND_STAGE(),
      line: "Sees every project",
    },
    {
      name: "A member given read access on production only reads 'Read only on production'",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: PROD_AND_STAGE([["ada", "READ_ONLY"]]),
      line: "Read only on production",
    },
    {
      name: "A member given different access per place reads each place's",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: PROD_AND_STAGE([["ada", "READ_ONLY"]], [["ada", "ADMIN"]]),
      line: "Full access on stage · read only on production",
    },
    {
      name: "A member given full access on every place reads 'Full access'",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: PROD_AND_STAGE([["ada", "ADMIN"]], [["ada", "ADMIN"]]),
      line: "Full access",
    },
    {
      name: "A member given read access on every place reads 'Read only'",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: PROD_AND_STAGE([["ada", "READ_ONLY"]], [["ada", "READ_ONLY"]]),
      line: "Read only",
    },
    {
      name: "An admin lowered to read on production reads the exception beside the role",
      member: member("ada", "Ada", "ADMIN"),
      places: PROD_AND_STAGE([["ada", "READ_ONLY"]]),
      line: "Admin · read only on production",
    },
    {
      name: "An owner lowered on two places names both",
      member: member("ada", "Ada", "OWNER"),
      places: PROD_AND_STAGE([["ada", "READ_ONLY"]], [["ada", "READ_ONLY"]]),
      line: "Owner · read only on production and stage",
    },
    {
      name: "A read-only member raised to full on stage reads the exception beside the role",
      member: member("ada", "Ada", "READ_ONLY"),
      places: PROD_AND_STAGE([], [["ada", "ADMIN"]]),
      line: "Sees every project · full access on stage",
    },
    {
      name: "An override that grants what the role already does changes nothing",
      member: member("ada", "Ada", "ADMIN"),
      places: PROD_AND_STAGE([["ada", "ADMIN"]]),
      line: "Admin · everything",
    },
    {
      name: "A member with no access to any place of the project is not listed",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: PROD_AND_STAGE(),
      line: undefined,
    },
    {
      name: "A grant on a Mate alone gives no access to the project's places",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: [...PROD_AND_STAGE(), mate("p-mate", "u-ada", [["ada", "OWNER"]])],
      line: "1 Mate",
    },
    {
      name: "Two stages are named by their own names",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: [
        place("p-prod", "production", [["ada", "READ_ONLY"]]),
        place("p-beta", "stage", [["ada", "ADMIN"]], "Beta"),
        place("p-rc", "stage", [], "RC"),
      ],
      line: "Full access on Beta · read only on production",
    },
    {
      name: "A Mate that serves as stage is a place: 'Dev / Stage'",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: [place("p-prod", "production"), place("p-dev", "devstage", [["ada", "ADMIN"]])],
      line: "Full access on dev / stage",
    },
    {
      name: "An integration token in the member list is not a person on the project",
      member: member("ada", "Ada", "ADMIN", {
        user: { id: "u-ada", fullName: "Ada", email: "token-AbCdEfGhIjKlMnOpQrStUv@zerops.io" },
      }),
      places: PROD_AND_STAGE(),
      line: undefined,
    },
    {
      name: "A member not yet joined is listed as invited, with what they would get",
      member: member("ada", "Ada", "ADMIN", { status: "WAITING_AUTHORIZATION" }),
      places: PROD_AND_STAGE(),
      line: "Invited · not joined yet · Admin · everything",
    },
  ])("$name", ({ member: one, places, line }) => {
    expect(lineOf(projectPeople(input({ members: known([one]), projects: places })), "Ada")).toBe(
      line,
    );
  });
});

function known(list: ReadonlyArray<ZeropsOrganizationMember>): ProjectPeopleInput["members"] {
  return { known: true, status: "ready", refused: false, list };
}

describe("who the people are", () => {
  it("A person's Mates in the project are counted after what they may do", () => {
    const view = projectPeople(
      input({
        members: known([member("ada", "Ada", "BASIC_USER"), member("bo", "Bo", "ADMIN")]),
        projects: [
          ...PROD_AND_STAGE(),
          mate("m-1", "u-ada"),
          mate("m-2", "u-ada"),
          mate("m-3", "u-bo"),
          mate("m-4", "u-gone"),
          { ...place("p-dev", "devstage"), owner: "u-bo" },
        ],
      }),
    );
    expect(lineOf(view, "Ada")).toBe("Works on every project · 2 Mates");
    expect(lineOf(view, "Bo")).toBe("Admin · everything · 2 Mates");
  });

  it("The viewer is marked as you", () => {
    const view = projectPeople(
      input({
        members: known([member("ada", "Ada", "ADMIN"), member("bo", "Bo", "ADMIN")]),
        viewerUserId: "u-bo",
      }),
    );
    expect(people(view).map(({ name, you }) => [name, you])).toEqual([
      ["Bo", true],
      ["Ada", false],
    ]);
  });

  it("A face is HQ's picture of the person, else the member list's, else their initials", () => {
    const view = projectPeople(
      input({
        members: known([
          member("ada", "Ada Lovelace", "ADMIN", {
            user: {
              id: "u-ada",
              fullName: "Ada Lovelace",
              avatar: { smallAvatarUrl: "https://zerops/ada.png" },
            },
          }),
          member("bo", "Bo", "ADMIN", {
            user: {
              id: "u-bo",
              fullName: "Bo",
              avatar: { smallAvatarUrl: "https://zerops/bo.png" },
            },
          }),
          member("cy", "Cy Young", "ADMIN"),
        ]),
        pictures: { "u-bo": "https://hq/bo.png" },
      }),
    );
    expect(
      people(view).map(({ name, initials, avatarUrl }) => [name, initials, avatarUrl]),
    ).toEqual([
      ["Ada Lovelace", "AL", "https://zerops/ada.png"],
      ["Bo", "B", "https://hq/bo.png"],
      ["Cy Young", "CY", null],
    ]);
  });

  it("A member the list names only by e-mail is called by it", () => {
    const view = projectPeople(
      input({
        members: known([
          member("ada", "", "ADMIN", { user: { id: "u-ada", email: "ada@example.com" } }),
        ]),
      }),
    );
    expect(people(view).map(({ name }) => name)).toEqual(["ada@example.com"]);
  });

  it("People are ordered: you, then everything, full here, read here, by name; invited last", () => {
    const view = projectPeople(
      input({
        members: known([
          member("inv", "Ivo", "OWNER", { status: "WAITING_AUTHORIZATION" }),
          member("rd", "Rita", "NO_ACCESS"),
          member("ro", "Rob", "READ_ONLY"),
          member("fh", "Fay", "NO_ACCESS"),
          member("dev", "Dan", "BASIC_USER"),
          member("adm2", "Alba", "ADMIN"),
          member("adm", "Abe", "ADMIN"),
          member("own", "Otto", "OWNER"),
          member("me", "Zed", "READ_ONLY"),
        ]),
        projects: PROD_AND_STAGE([
          ["rd", "READ_ONLY"],
          ["fh", "ADMIN"],
        ]),
        viewerUserId: "u-me",
      }),
    );
    expect(people(view).map(({ name }) => name)).toEqual([
      "Zed",
      "Otto",
      "Abe",
      "Alba",
      "Dan",
      "Fay",
      "Rob",
      "Rita",
      "Ivo",
    ]);
    expect(people(view).map(({ pending }) => pending)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });
});

describe("what is said when the people cannot be known", () => {
  it.each<{
    readonly name: string;
    readonly members: ProjectPeopleInput["members"];
    readonly places?: ReadonlyArray<Project>;
    readonly view: ReturnType<typeof projectPeople>;
  }>([
    {
      name: "A member list Zerops refuses the viewer is said in one line, never guessed",
      members: { known: false, status: "failed", refused: true, list: [] },
      view: {
        kind: "unreadable",
        line: "Zerops doesn’t show you this organization’s members.",
      },
    },
    {
      name: "A member list that failed to read is said in one line, never guessed",
      members: { known: false, status: "failed", refused: false, list: [] },
      view: { kind: "unreadable", line: "Couldn’t read this organization’s members." },
    },
    {
      name: "A member list still being read is reading, never an empty list",
      members: { known: false, status: "loading", refused: false, list: [] },
      view: { kind: "reading" },
    },
    {
      name: "A place's grants not read yet are reading, never the roles alone",
      members: known([member("ada", "Ada", "ADMIN")]),
      places: [
        place("p-prod", "production"),
        { projectId: "p-stage", kind: "stage", grants: { status: "loading", grants: undefined } },
      ],
      view: { kind: "reading" },
    },
    {
      name: "A place whose grants failed to read is said in one line",
      members: known([member("ada", "Ada", "ADMIN")]),
      places: [
        place("p-prod", "production"),
        { projectId: "p-stage", kind: "stage", grants: { status: "failed", grants: undefined } },
      ],
      view: { kind: "unreadable", line: "Couldn’t read who has access to stage." },
    },
  ])("$name", ({ members, places, view }) => {
    expect(projectPeople(input({ members, ...(places ? { projects: places } : {}) }))).toEqual(
      view,
    );
  });

  it("A member list read before keeps its people while a read again fails", () => {
    const view = projectPeople(
      input({
        members: {
          known: true,
          status: "failed",
          refused: false,
          list: [member("ada", "Ada", "ADMIN")],
        },
      }),
    );
    expect(people(view).map(({ name }) => name)).toEqual(["Ada"]);
  });

  it("A place's grants read before keep counting while they are read again", () => {
    const view = projectPeople(
      input({
        members: known([member("ada", "Ada", "NO_ACCESS")]),
        projects: [
          {
            projectId: "p-prod",
            kind: "production",
            grants: {
              status: "loading",
              grants: [{ clientUserId: "cu-ada", roleCode: "READ_ONLY" }],
            },
          },
        ],
      }),
    );
    expect(lineOf(view, "Ada")).toBe("Read only");
  });
});

describe("what an owner or admin may change of each person's access", () => {
  const MEMBERS = [
    member("own", "Olga", "OWNER"),
    member("adm", "Adam", "ADMIN"),
    member("me", "Mia", "ADMIN"),
    member("dev", "Dana", "NO_ACCESS"),
    member("inv", "Ivo", "NO_ACCESS", { status: "WAITING_AUTHORIZATION" }),
  ];
  const view = (viewer: ProjectPeopleInput["viewer"]) =>
    projectPeople(
      input({
        members: known(MEMBERS),
        projects: [
          ...PROD_AND_STAGE(
            [
              ["dev", "BASIC_USER"],
              ["inv", "READ_ONLY"],
            ],
            [
              ["dev", "BASIC_USER"],
              ["inv", "READ_ONLY"],
            ],
          ),
          mate("m-dana", "u-dev"),
          mate("m-other", "u-adm"),
        ],
        viewerUserId: "u-me",
        ...(viewer === undefined ? {} : { viewer }),
      }),
    );
  const changes = (viewer: ProjectPeopleInput["viewer"]) =>
    Object.fromEntries(people(view(viewer)).map((person) => [person.name, person.change]));

  it("An admin changes a member's level, their own Mates kept out of it, and withdraws an invitation", () => {
    const shown = changes({ roleCode: "ADMIN", membershipId: "cu-me" });
    expect({ Olga: shown.Olga, Adam: shown.Adam, Dana: shown.Dana, Ivo: shown.Ivo }).toEqual({
      Olga: null,
      Adam: null,
      Dana: {
        clientUserId: "cu-dev",
        level: "basic",
        levels: ["full", "read"],
        actions: [],
        self: false,
        end: "remove",
        owned: ["m-dana"],
      },
      Ivo: {
        clientUserId: "cu-inv",
        level: "read",
        levels: ["full", "read"],
        actions: [],
        self: false,
        end: "withdraw",
        owned: [],
      },
    });
  });

  it("Someone who isn't an owner or admin changes nobody's access, and invites nobody", () => {
    expect(Object.values(changes({ roleCode: "BASIC_USER", membershipId: "cu-me" }))).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    const shown = view({ roleCode: "BASIC_USER", membershipId: "cu-me" });
    expect(shown.kind === "people" && shown.invite).toBe(false);
  });

  it("An owner or admin may invite people", () => {
    const shown = view({ roleCode: "OWNER", membershipId: "cu-me" });
    expect(shown.kind === "people" && shown.invite).toBe(true);
  });

  it("A person's menu offers the two levels, theirs checked, then the way out", () => {
    const both = ["full", "read"] as const;
    expect(
      personMenu({
        clientUserId: "cu-dev",
        level: "full",
        levels: both,
        actions: [],
        self: false,
        end: "remove",
        owned: [],
      }),
    ).toEqual([
      { kind: "level", level: "full", label: "Give full access", checked: true },
      { kind: "level", level: "read", label: "Make read only", checked: false },
      { kind: "end", end: "remove", label: "Remove access" },
    ]);
    expect(
      personMenu({
        clientUserId: "cu-inv",
        level: "read",
        levels: both,
        actions: [],
        self: false,
        end: "withdraw",
        owned: [],
      }).at(-1),
    ).toEqual({ kind: "end", end: "withdraw", label: "Withdraw invite" });
  });
});

describe("an owner's, admin's or every-project member's chip menu, as legacy offers it", () => {
  it.each<{
    sentence: string;
    viewer: string;
    member: "OWNER" | "ADMIN" | "BASIC_USER" | "READ_ONLY";
    held: "full" | "basic" | "read" | "hidden";
    override?: boolean;
    self?: boolean;
    offered: ReadonlyArray<string> | null;
  }>([
    {
      sentence: "never offers to hide a project from an organization owner",
      viewer: "OWNER",
      member: "OWNER",
      held: "full",
      offered: ["Make read only"],
    },
    {
      sentence: "offers an admin read only; back to full is removing the override",
      viewer: "OWNER",
      member: "ADMIN",
      held: "read",
      override: true,
      offered: ["Remove override"],
    },
    {
      sentence: "never offers to hide a project from an organization admin or owner",
      viewer: "OWNER",
      member: "ADMIN",
      held: "full",
      offered: ["Make read only"],
    },
    {
      sentence: "offers to hide a project from a basic or read-only member",
      viewer: "OWNER",
      member: "READ_ONLY",
      held: "read",
      offered: ["Give full access", "Hide this project"],
    },
    {
      sentence:
        "offers a member who sees every project full access, and back to read only is removing the override",
      viewer: "ADMIN",
      member: "READ_ONLY",
      held: "full",
      override: true,
      offered: ["Remove override", "Hide this project"],
    },
    {
      sentence:
        "offers a member who works on every project both levels, hiding, and their own way back",
      viewer: "ADMIN",
      member: "BASIC_USER",
      held: "read",
      override: true,
      offered: ["Give full access", "Hide this project", "Remove override"],
    },
    {
      sentence:
        "offers a member who works on every project no way back while nothing is overridden",
      viewer: "ADMIN",
      member: "BASIC_USER",
      held: "basic",
      offered: ["Give full access", "Make read only", "Hide this project"],
    },
    {
      sentence: "a hidden member's way back is removing the override",
      viewer: "OWNER",
      member: "READ_ONLY",
      held: "hidden",
      override: true,
      offered: ["Give full access", "Remove override"],
    },
    {
      sentence: "an admin viewer changes no owner",
      viewer: "ADMIN",
      member: "OWNER",
      held: "full",
      offered: null,
    },
    {
      sentence: "an admin viewer changes no other admin",
      viewer: "ADMIN",
      member: "ADMIN",
      held: "full",
      offered: null,
    },
    {
      sentence: "an admin viewer may lower their own access",
      viewer: "ADMIN",
      member: "ADMIN",
      held: "full",
      self: true,
      offered: ["Make read only"],
    },
    {
      sentence: "someone who isn't an owner or admin changes nothing",
      viewer: "BASIC_USER",
      member: "READ_ONLY",
      held: "read",
      offered: null,
    },
  ])(
    "$sentence",
    ({ viewer, member: memberRole, held, override = false, self = false, offered }) => {
      expect(
        defaultAccessMenu({ viewerRole: viewer, memberRole, self, held, override })?.map(
          ({ label }) => label,
        ) ?? null,
      ).toEqual(offered);
    },
  );

  it.each([
    {
      sentence: "Lowering your own full access asks first",
      self: true,
      level: "full",
      choice: "read",
      asks: true,
    },
    {
      sentence: "Hiding a project from yourself asks first",
      self: true,
      level: "full",
      choice: "none",
      asks: true,
    },
    {
      sentence: "Giving yourself access back asks nothing",
      self: true,
      level: "read",
      choice: "full",
      asks: false,
    },
    {
      sentence: "Lowering someone else asks nothing",
      self: false,
      level: "full",
      choice: "read",
      asks: false,
    },
  ] as const)("$sentence", ({ self, level, choice, asks }) => {
    expect(
      asksFirst(
        { clientUserId: "cu-me", level, levels: [], actions: [], self, end: null, owned: [] },
        choice,
      ),
    ).toBe(asks);
  });
});

describe("each person as a chip", () => {
  const chip = (view: ReturnType<typeof projectPeople>, name: string) =>
    people(view).find((person) => person.name === name);
  const ADMIN_VIEWER = { roleCode: "ADMIN", membershipId: "cu-me" };

  it.each<{
    readonly name: string;
    readonly member: ZeropsOrganizationMember;
    readonly places: ReadonlyArray<Project>;
    readonly level: string | undefined;
  }>([
    {
      name: "An owner of the organization is full access everywhere",
      member: member("ada", "Ada", "OWNER"),
      places: PROD_AND_STAGE(),
      level: "full",
    },
    {
      name: "A developer of the organization is basic",
      member: member("ada", "Ada", "BASIC_USER"),
      places: PROD_AND_STAGE(),
      level: "basic",
    },
    {
      name: "A read-only member of the organization is read",
      member: member("ada", "Ada", "READ_ONLY"),
      places: PROD_AND_STAGE(),
      level: "read",
    },
    {
      name: "A member given full access on every place is full",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: PROD_AND_STAGE([["ada", "ADMIN"]], [["ada", "ADMIN"]]),
      level: "full",
    },
    {
      name: "An app with no place is judged on its Mates",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: [
        mate("m-1", undefined, [["ada", "READ_ONLY"]]),
        mate("m-2", undefined, [["ada", "READ_ONLY"]]),
      ],
      level: "read",
    },
    {
      name: "Someone reaching only their own Mate is judged on it",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: [...PROD_AND_STAGE(), mate("m-ada", "u-ada")],
      level: "full",
    },
    {
      name: "An integration token is no chip",
      member: member("ada", "Ada", "ADMIN", {
        user: { id: "u-ada", fullName: "Ada", email: "token-AbCdEfGhIjKlMnOpQrStUv@zerops.io" },
      }),
      places: PROD_AND_STAGE(),
      level: undefined,
    },
  ])("$name", ({ member: one, places, level }) => {
    expect(
      chip(projectPeople(input({ members: known([one]), projects: places })), "Ada")?.level,
    ).toBe(level);
  });

  it("A chip names a person short, with their e-mail and their role for the hover card", () => {
    const view = projectPeople(
      input({
        members: known([
          member("ada", "Ada King Lovelace", "BASIC_USER", {
            user: { id: "u-ada", fullName: "Ada King Lovelace", email: "ada@example.com" },
          }),
        ]),
      }),
    );
    expect(chip(view, "Ada King Lovelace")).toMatchObject({
      short: "Ada L.",
      email: "ada@example.com",
      role: "Works on every project",
    });
    expect([shortName("Bo"), shortName("cy@example.com")]).toEqual(["Bo", "cy@example.com"]);
  });

  it("When the viewer is an admin, an owner's or another admin's chip has no menu: Zerops refuses those writes", () => {
    const view = projectPeople(
      input({
        members: known([member("own", "Olga", "OWNER"), member("adm", "Adam", "ADMIN")]),
        viewer: ADMIN_VIEWER,
      }),
    );
    expect(people(view).map(({ change }) => change)).toEqual([null, null]);
  });

  it("Remove access is offered only where a person holds a grant of their own here", () => {
    const view = projectPeople(
      input({
        members: known([member("dev", "Dana", "BASIC_USER"), member("ro", "Rob", "BASIC_USER")]),
        projects: PROD_AND_STAGE([["ro", "READ_ONLY"]]),
        viewer: ADMIN_VIEWER,
      }),
    );
    const removes = (name: string) =>
      chip(view, name)?.change?.actions.some(({ choice }) => choice === "remove");
    expect(removes("Dana")).toBe(false);
    expect(removes("Rob")).toBe(true);
  });

  it("A project hidden from a read-only member shows as hidden, and says an owner or admin can show it again", () => {
    const view = projectPeople(
      input({
        members: known([member("ro", "Rita", "READ_ONLY")]),
        projects: PROD_AND_STAGE([["ro", "NO_ACCESS"]], [["ro", "NO_ACCESS"]]),
        viewer: { roleCode: "OWNER", membershipId: "cu-me" },
      }),
    );
    expect(chip(view, "Rita")?.level).toBe("hidden");
    expect(chip(view, "Rita")?.note).toBe(
      "Hidden from them here. An owner or admin can show it again.",
    );
    expect(chip(view, "Rita")?.change?.actions).toEqual([
      { choice: "full", label: "Give full access" },
      { choice: "remove", label: "Remove override" },
    ]);
  });

  it("Members who reach none of the projects are offered to add access for, tokens never", () => {
    const view = projectPeople(
      input({
        members: known([
          member("zoe", "Zoe", "NO_ACCESS", {
            user: { id: "u-zoe", fullName: "Zoe", email: "zoe@example.com" },
          }),
          member("ada", "Ada", "NO_ACCESS"),
          member("dev", "Dana", "BASIC_USER"),
          member("tok", "Token", "NO_ACCESS", {
            user: { id: "u-tok", email: "token-AbCdEfGhIjKlMnOpQrStUv@zerops.io" },
          }),
        ]),
        viewer: ADMIN_VIEWER,
      }),
    );
    expect(view.kind === "people" && view.candidates.map(({ name, role }) => [name, role])).toEqual(
      [
        ["Ada", "Guest"],
        ["Zoe", "Guest"],
      ],
    );
  });

  it("A choice writes every project here but the Mates the person owns", () => {
    expect(
      accessChanges({
        clientUserId: "cu-ada",
        projectIds: ["prod", "stage", "m-ada", "m-bo"],
        owned: ["m-ada"],
        choice: "full",
      }),
    ).toEqual([
      { clientUserId: "cu-ada", projectId: "prod", roleCode: "ADMIN" },
      { clientUserId: "cu-ada", projectId: "stage", roleCode: "ADMIN" },
      { clientUserId: "cu-ada", projectId: "m-bo", roleCode: "ADMIN" },
    ]);
    expect(
      accessChanges({ clientUserId: "cu-ada", projectIds: ["prod"], owned: [], choice: "remove" }),
    ).toEqual([{ clientUserId: "cu-ada", projectId: "prod", roleCode: null }]);
  });
});
