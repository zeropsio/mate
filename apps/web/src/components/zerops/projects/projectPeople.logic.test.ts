import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import { projectPeople, type ProjectPeopleInput, type ProjectPerson } from "./projectPeople.logic";

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
      name: "A member given read access on production only reads 'Production: read'",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: PROD_AND_STAGE([["ada", "READ_ONLY"]]),
      line: "Production: read",
    },
    {
      name: "A member given different access per place reads each place's",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: PROD_AND_STAGE([["ada", "READ_ONLY"]], [["ada", "ADMIN"]]),
      line: "Production: read · Stage: full",
    },
    {
      name: "A member given full access on every place reads 'Full access here'",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: PROD_AND_STAGE([["ada", "ADMIN"]], [["ada", "ADMIN"]]),
      line: "Full access here",
    },
    {
      name: "A member given read access on every place reads 'Read only here'",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: PROD_AND_STAGE([["ada", "READ_ONLY"]], [["ada", "READ_ONLY"]]),
      line: "Read only here",
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
      line: undefined,
    },
    {
      name: "Two stages are named by their own names",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: [
        place("p-prod", "production", [["ada", "READ_ONLY"]]),
        place("p-beta", "stage", [["ada", "ADMIN"]], "Beta"),
        place("p-rc", "stage", [], "RC"),
      ],
      line: "Production: read · Beta: full",
    },
    {
      name: "A Mate that serves as stage is a place: 'Dev / Stage'",
      member: member("ada", "Ada", "NO_ACCESS"),
      places: [place("p-prod", "production"), place("p-dev", "devstage", [["ada", "ADMIN"]])],
      line: "Dev / Stage: full",
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
    expect(lineOf(view, "Ada")).toBe("Read only here");
  });
});
