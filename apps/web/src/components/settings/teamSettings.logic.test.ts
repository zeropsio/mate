import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import {
  shownTeam,
  teamGrantIds,
  teamPeople,
  type TeamInput,
  type TeamPlace,
} from "./teamSettings.logic";

const member = (
  id: string,
  name: string,
  roleCode: string,
  extra: Partial<ZeropsOrganizationMember> = {},
): ZeropsOrganizationMember => ({
  id: `cu-${id}`,
  status: "ACTIVE",
  roleCode,
  user: { id, fullName: name, email: `${id}@example.com` },
  ...extra,
});

const SNAP: TeamPlace = { key: "g-snap", name: "Snap", groupId: "g-snap" };
const BEVIRO: TeamPlace = { key: "g-beviro", name: "Beviro", groupId: "g-beviro" };
const SHOP: TeamPlace = { key: "g-shop", name: "Shop", groupId: "g-shop" };
const LOOSE: TeamPlace = { key: "p-loose", name: "Old site", groupId: null };

const PLACES: TeamInput["places"] = {
  "snap-prod": SNAP,
  "snap-stage": SNAP,
  "beviro-prod": BEVIRO,
  "shop-prod": SHOP,
  "p-loose": LOOSE,
};

const ready = (entries: Record<string, string>) => ({
  status: "ready" as const,
  value: Object.entries(entries).map(([projectId, roleCode]) => ({ projectId, roleCode })),
});

const input = (
  list: ReadonlyArray<ZeropsOrganizationMember>,
  extra: Partial<TeamInput> = {},
): TeamInput => ({
  members: { known: true, status: "ready", refused: false, list },
  grants: {},
  places: PLACES,
  pictures: {},
  viewerUserId: "me",
  ...extra,
});

const people = (view: ReturnType<typeof teamPeople>) => (view.kind === "people" ? view.people : []);

describe("a person's role and what they reach, in words", () => {
  it.each([
    {
      sentence: "An owner reaches everything",
      roleCode: "OWNER",
      grants: undefined,
      line: "Owner · everything",
    },
    {
      sentence: "An admin reaches everything",
      roleCode: "ADMIN",
      grants: undefined,
      line: "Admin · everything",
    },
    {
      sentence: "Someone who works on every project says so, and no more",
      roleCode: "BASIC_USER",
      grants: undefined,
      line: "Works on every project",
    },
    {
      sentence: "Someone who sees every project says so, and no more",
      roleCode: "READ_ONLY",
      grants: undefined,
      line: "Sees every project",
    },
    {
      sentence: "A developer is on the Mate projects their grants name, each once",
      roleCode: "NO_ACCESS",
      extra: { canCreateProjects: true },
      grants: ready({
        "snap-prod": "BASIC_USER",
        "snap-stage": "READ_ONLY",
        "beviro-prod": "READ_ONLY",
      }),
      line: "Developer · on Beviro and Snap",
    },
    {
      sentence: "A guest on more than two projects is said by their count",
      roleCode: "NO_ACCESS",
      grants: ready({
        "snap-prod": "READ_ONLY",
        "beviro-prod": "READ_ONLY",
        "shop-prod": "BASIC_USER",
      }),
      line: "Guest · on 3 projects",
    },
    {
      sentence: "A project outside any Mate project is named by its own name",
      roleCode: "NO_ACCESS",
      grants: ready({ "p-loose": "READ_ONLY" }),
      line: "Guest · on Old site",
    },
    {
      sentence: "A grant of no access reaches nothing",
      roleCode: "NO_ACCESS",
      grants: ready({ "snap-prod": "NO_ACCESS" }),
      line: "Guest · no projects yet",
    },
    {
      sentence: "A project the viewer can't name is still counted",
      roleCode: "NO_ACCESS",
      grants: ready({ "snap-prod": "READ_ONLY", "p-hidden": "READ_ONLY" }),
      line: "Guest · on 2 projects",
    },
    {
      sentence: "While their grants are read, only their role is said",
      roleCode: "NO_ACCESS",
      grants: { status: "loading" as const },
      line: "Guest",
    },
    {
      sentence: "Grants that couldn't be read leave their role alone",
      roleCode: "NO_ACCESS",
      grants: { status: "failed" as const },
      line: "Guest",
    },
  ])("$sentence", ({ roleCode, extra, grants, line }) => {
    const view = teamPeople(
      input([member("eva", "Eva Dvořáková", roleCode, extra)], {
        grants: grants === undefined ? {} : { "cu-eva": grants },
      }),
    );
    expect(people(view)[0]?.line).toBe(line);
  });

  it("A person's projects are named where they lead: each Mate project's page", () => {
    const view = teamPeople(
      input([member("eva", "Eva", "NO_ACCESS")], {
        grants: { "cu-eva": ready({ "snap-prod": "READ_ONLY", "p-loose": "READ_ONLY" }) },
      }),
    );
    expect(people(view)[0]?.reach).toEqual({
      kind: "projects",
      projects: [LOOSE, SNAP],
      unnamed: 0,
    });
  });

  it("An invitation not joined yet says so first", () => {
    const view = teamPeople(
      input([member("iva", "iva@example.com", "NO_ACCESS", { status: "WAITING_AUTHORIZATION" })], {
        grants: { "cu-iva": ready({ "snap-prod": "READ_ONLY" }) },
      }),
    );
    expect(people(view)[0]).toMatchObject({
      pending: true,
      line: "Invited · waiting for them to join · Guest · on Snap",
    });
  });
});

describe("an invitation not joined yet, by the name its inviter typed", () => {
  const waiting = (user: NonNullable<ZeropsOrganizationMember["user"]>) =>
    member("iva", "", "NO_ACCESS", { status: "WAITING_AUTHORIZATION", user });
  it.each([
    {
      sentence: "Zerops lists only the address: the name typed is shown, the address under it",
      user: { id: "iva", email: "Iva@example.com" },
      name: "Iva Novak",
      email: "Iva@example.com",
    },
    {
      sentence: "Nothing was typed for it here: the address is its name",
      user: { id: "iva", email: "other@example.com" },
      name: "other@example.com",
      email: "other@example.com",
    },
    {
      sentence: "Zerops names the person: their own name wins",
      user: { id: "iva", email: "iva@example.com", fullName: "Iva N." },
      name: "Iva N.",
      email: "iva@example.com",
    },
  ])("$sentence", ({ user, name, email }) => {
    const [person] = people(
      teamPeople(input([waiting(user)], { invitedNames: { "iva@example.com": "Iva Novak" } })),
    );
    expect(person).toMatchObject({ name, email, pending: true });
  });

  it("A typed name never renames someone who joined", () => {
    const [person] = people(
      teamPeople(
        input([member("iva", "", "NO_ACCESS", { user: { id: "iva", email: "iva@example.com" } })], {
          invitedNames: { "iva@example.com": "Iva Novak" },
        }),
      ),
    );
    expect(person?.name).toBe("iva@example.com");
  });
});

describe("who is on the team", () => {
  const TEAM = [
    member("zoe", "Zoe Admin", "ADMIN"),
    member("ada", "Ada Owner", "OWNER"),
    member("iva", "Iva Invited", "NO_ACCESS", { status: "WAITING_AUTHORIZATION" }),
    member("bob", "Bob Guest", "NO_ACCESS"),
    member("me", "Me Myself", "BASIC_USER"),
    member("al", "Al Admin", "ADMIN"),
    {
      id: "cu-token",
      status: "ACTIVE",
      roleCode: "BASIC_USER",
      user: { id: "t", email: "token-abc@zerops.io" },
    },
  ];

  it("Integration tokens are never people", () => {
    expect(people(teamPeople(input(TEAM))).map(({ name }) => name)).not.toContain(
      "token-abc@zerops.io",
    );
  });

  it("You first; then owners, admins, the rest by name; invitations last", () => {
    expect(people(teamPeople(input(TEAM))).map(({ name }) => name)).toEqual([
      "Me Myself",
      "Ada Owner",
      "Al Admin",
      "Zoe Admin",
      "Bob Guest",
      "Iva Invited",
    ]);
  });

  it("The team is counted in people", () => {
    const view = teamPeople(input(TEAM));
    expect(view.kind === "people" && view.count).toBe("6 people");
    const one = teamPeople(input([member("me", "Me", "OWNER")]));
    expect(one.kind === "people" && one.count).toBe("1 person");
  });

  it("Only people whose role reaches no project by itself have their grants read", () => {
    expect(teamGrantIds(TEAM)).toEqual(["cu-iva", "cu-bob"]);
  });

  it.each([
    {
      members: { known: false, status: "loading" as const, refused: false, list: [] },
      view: { kind: "reading" },
    },
    {
      members: { known: false, status: "failed" as const, refused: true, list: [] },
      view: { kind: "unreadable", line: "Zerops doesn’t show you this organization’s members." },
    },
    {
      members: { known: false, status: "failed" as const, refused: false, list: [] },
      view: { kind: "unreadable", line: "Couldn’t read this organization’s members." },
    },
  ])("A member list not read is said as People says it: $view.kind", ({ members, view }) => {
    expect(teamPeople({ ...input([]), members })).toEqual(view);
  });
});

describe("what the viewer may change of the team", () => {
  const TEAM = [
    member("ada", "Ada", "OWNER"),
    member("al", "Al", "ADMIN"),
    member("bob", "Bob", "NO_ACCESS", { canCreateProjects: true }),
    member("cy", "Cy", "BASIC_USER"),
    member("iva", "Iva", "NO_ACCESS", { status: "WAITING_AUTHORIZATION" }),
  ];
  const as = (who: string, roleCode: string) =>
    teamPeople(
      input(TEAM, {
        viewerUserId: who,
        viewer: { roleCode, membershipId: `cu-${who}` },
      }),
    );
  const changes = (view: ReturnType<typeof teamPeople>) =>
    Object.fromEntries(people(view).map((person) => [person.name, person.change]));

  it("An owner may change everyone but themselves, every role offered", () => {
    const view = as("ada", "OWNER");
    expect(view.kind === "people" && view.invite).toEqual(["admin", "developer", "guest", "owner"]);
    expect(changes(view)).toEqual({
      Ada: null,
      Al: {
        clientUserId: "cu-al",
        current: "admin",
        roles: ["admin", "developer", "guest", "owner"],
        end: "remove",
      },
      Bob: {
        clientUserId: "cu-bob",
        current: "developer",
        roles: ["admin", "developer", "guest", "owner"],
        end: "remove",
      },
      Cy: {
        clientUserId: "cu-cy",
        current: null,
        roles: ["admin", "developer", "guest", "owner"],
        end: "remove",
      },
      Iva: {
        clientUserId: "cu-iva",
        current: "guest",
        roles: ["admin", "developer", "guest", "owner"],
        end: "withdraw",
      },
    });
  });

  it("An admin changes nobody who is an owner or an admin, and gives only developer or guest", () => {
    const view = as("al", "ADMIN");
    expect(view.kind === "people" && view.invite).toEqual(["developer", "guest"]);
    const byName = changes(view);
    expect(byName.Ada).toBeNull();
    expect(byName.Al).toBeNull();
    expect(byName.Bob?.roles).toEqual(["developer", "guest"]);
  });

  it("Someone who isn't an owner or admin invites nobody and changes nobody", () => {
    const view = as("cy", "BASIC_USER");
    expect(view.kind === "people" && view.invite).toEqual([]);
    expect(Object.values(changes(view)).every((change) => change === null)).toBe(true);
  });
});

describe("finding someone on the team", () => {
  const TEAM = people(
    teamPeople(
      input([
        member("petra", "Petra Kralova", "OWNER"),
        member("ota", "Ota Benes", "ADMIN"),
        member("zora", "Zora Mala", "NO_ACCESS"),
        member("ivo", "Ivo Novy", "NO_ACCESS", { status: "WAITING_AUTHORIZATION" }),
        member("ada", "Ada Cerna", "NO_ACCESS"),
      ]),
    ),
  );
  const names = (list: ReturnType<typeof shownTeam>) => list.map(({ name }) => name);

  it("The team is listed by name, invitations not joined yet last", () => {
    expect(names(shownTeam(TEAM, ""))).toEqual([
      "Ada Cerna",
      "Ota Benes",
      "Petra Kralova",
      "Zora Mala",
      "Ivo Novy",
    ]);
  });

  it.each([
    { query: "petra", found: ["Petra Kralova"] },
    { query: "  MALA ", found: ["Zora Mala"] },
    { query: "ota@example", found: ["Ota Benes"] },
    { query: "nobody", found: [] },
  ])("The search finds by name or e-mail, any case: $query", ({ query, found }) => {
    expect(names(shownTeam(TEAM, query))).toEqual(found);
  });

  it("A card's badge is the preset's name, else Zerops's role in words", () => {
    expect(
      people(
        teamPeople(
          input([
            member("a", "A", "OWNER"),
            member("d", "D", "NO_ACCESS", { canCreateProjects: true }),
            member("g", "G", "NO_ACCESS"),
            member("b", "B", "BASIC_USER"),
          ]),
        ),
      ).map(({ name, badge }) => [name, badge]),
    ).toEqual([
      ["A", "Owner"],
      ["B", "Basic user"],
      ["D", "Developer"],
      ["G", "Guest"],
    ]);
  });
});
