import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import {
  draftChoose,
  draftPrefill,
  draftSummary,
  draftView,
  type DraftInput,
} from "./accessDraft.logic";

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

const MEMBERS = [
  member("me", "Mia Moss", "BASIC_USER"),
  member("own", "Olga", "OWNER"),
  member("dev", "Dana", "BASIC_USER"),
  member("na", "Ned", "NO_ACCESS"),
  member("ro", "Rob", "NO_ACCESS"),
  member("far", "Fay", "NO_ACCESS"),
  member("tok", "", "NO_ACCESS", {
    user: { id: "u-tok", email: "token-AbCdEfGhIjKlMnOpQrStUv@zerops.io" },
  }),
];

type Grants = ReadonlyArray<readonly [who: string, roleCode: string]>;
const ready = (grants: Grants) => ({
  status: "ready" as const,
  grants: grants.map(([who, roleCode]) => ({ clientUserId: `cu-${who}`, roleCode })),
});

/** An app with production and stage, Ned full on production and read on stage, Rob read. */
const APP: DraftInput["app"] = {
  projects: [
    { projectId: "prod", kind: "production" },
    { projectId: "stage", kind: "stage" },
    { projectId: "m-fay", kind: "mate" },
  ],
  grants: {
    prod: ready([
      ["na", "ADMIN"],
      ["ro", "READ_ONLY"],
      ["dev", "READ_ONLY"],
    ]),
    stage: ready([
      ["na", "READ_ONLY"],
      ["ro", "READ_ONLY"],
    ]),
    "m-fay": ready([["far", "OWNER"]]),
  },
  owners: { "m-fay": "u-far" },
};

const draft = (overrides: Partial<DraftInput> = {}): DraftInput => ({
  members: { known: true, status: "ready", refused: false, list: MEMBERS },
  kind: "stage",
  app: APP,
  pictures: {},
  creator: { membershipId: "cu-me", userId: "u-me" },
  list: [],
  ...overrides,
});

describe("a new project's access, before it exists", () => {
  it("A new project's access starts with the people who reach the app's places, at their level there", () => {
    // Their highest level there; Dana's is her role's own, so she needs no entry.
    expect(draftPrefill(draft())).toEqual([
      { clientUserId: "cu-na", roleCode: "ADMIN" },
      { clientUserId: "cu-ro", roleCode: "READ_ONLY" },
    ]);
  });

  it("An app with no place prefills from its Mates, never from a Mate's own owner", () => {
    const app: DraftInput["app"] = {
      projects: [
        { projectId: "m-fay", kind: "mate" },
        { projectId: "m-ned", kind: "mate" },
      ],
      grants: {
        "m-fay": ready([
          ["far", "OWNER"],
          ["ro", "READ_ONLY"],
        ]),
        "m-ned": ready([]),
      },
      owners: { "m-fay": "u-far", "m-ned": "u-na" },
    };
    expect(draftPrefill(draft({ app }))).toEqual([
      { clientUserId: "cu-ro", roleCode: "READ_ONLY" },
    ]);
  });

  it("A brand new app's project has only its creator and whom the organization's roles give", () => {
    expect(draftPrefill(draft({ app: { projects: [], grants: {}, owners: {} } }))).toEqual([]);
  });

  it("The prefill waits for the app's places to be read", () => {
    expect(
      draftPrefill(
        draft({
          app: {
            ...APP,
            grants: { ...APP.grants, stage: { status: "loading", grants: undefined } },
          },
        }),
      ),
    ).toBeNull();
  });

  it("The creator is pinned first as you, full access, with no menu", () => {
    const view = draftView(draft());
    const first = view.kind === "people" ? view.people[0] : undefined;
    expect(first).toMatchObject({
      creator: true,
      level: "full",
      role: "Project creator",
      change: null,
    });
  });

  it.each([
    { creatorRole: "OWNER", changesOwner: true },
    { creatorRole: "ADMIN", changesOwner: false },
    { creatorRole: "BASIC_USER", changesOwner: false },
    { creatorRole: "NO_ACCESS", changesOwner: false },
  ])(
    "A $creatorRole creator gives the new project its people, and changes an owner's access only as an owner",
    ({ creatorRole, changesOwner }) => {
      const list = MEMBERS.map((one) =>
        one.id === "cu-me" ? { ...one, roleCode: creatorRole } : one,
      );
      const view = draftView(
        draft({
          members: { known: true, status: "ready", refused: false, list },
          list: [{ clientUserId: "cu-ro", roleCode: "READ_ONLY" }],
        }),
      );
      if (view.kind !== "people") throw new Error("the draft is not drawn");
      const chip = (name: string) => view.people.find((person) => person.name === name);
      expect(chip("Olga")?.change !== null).toBe(changesOwner);
      // Whom the creator brings in stays theirs to change, and more can be added.
      expect(chip("Rob")?.change).not.toBeNull();
      expect(view.invite).toBe(true);
    },
  );

  it("The draft shows everyone the project will reach: roles and chosen grants alike", () => {
    const view = draftView(draft({ list: [{ clientUserId: "cu-ro", roleCode: "READ_ONLY" }] }));
    expect(view.kind === "people" && view.people.map(({ name, level }) => [name, level])).toEqual([
      ["Mia Moss", "full"],
      ["Olga", "full"],
      ["Dana", "basic"],
      ["Rob", "read"],
    ]);
    expect(view.kind === "people" && view.candidates.map(({ name }) => name)).toEqual([
      "Fay",
      "Ned",
    ]);
  });

  it("Choosing a level the organization role already gives drops the entry", () => {
    const list = [{ clientUserId: "cu-dev", roleCode: "READ_ONLY" }];
    expect(draftChoose(list, MEMBERS, "cu-dev", "full")).toEqual([
      { clientUserId: "cu-dev", roleCode: "ADMIN" },
    ]);
    expect(draftChoose(list, MEMBERS, "cu-ro", "read")).toEqual([
      ...list,
      { clientUserId: "cu-ro", roleCode: "READ_ONLY" },
    ]);
    expect(draftChoose(list, MEMBERS, "cu-dev", "remove")).toEqual([]);
    expect(
      draftChoose([{ clientUserId: "cu-ro", roleCode: "ADMIN" }], MEMBERS, "cu-own", "full"),
    ).toEqual([{ clientUserId: "cu-ro", roleCode: "ADMIN" }]);
  });
});

/** An organization of eighteen: you and sixteen admins, and Karlos, a developer. */
const TEAM = [
  member("me", "Mia Moss", "ADMIN"),
  ...[
    "Ada Lind",
    "Bo Hale",
    "Cy Nord",
    "Di Park",
    "Ed Moon",
    "Fay Lin",
    "Gus Orr",
    "Hal Pike",
    "Ivy Rowe",
    "Jo Sand",
    "Kit Tate",
    "Lu Vale",
    "Mo West",
    "Ned Yoke",
    "Ola Zorn",
    "Pia Ames",
  ].map((name) => member(name.split(" ")[0]!.toLowerCase(), name, "ADMIN")),
  member("karlos", "Karlos", "BASIC_USER"),
];

const team = (extra: ReadonlyArray<ZeropsOrganizationMember>, list: DraftInput["list"] = []) =>
  draft({
    members: { known: true, status: "ready", refused: false, list: [...TEAM, ...extra] },
    app: { projects: [], grants: {}, owners: {} },
    list,
  });

describe("a new project's access, in one line", () => {
  it.each([
    {
      title: "Everyone in the organization, counted by level, the exception named",
      input: team([]),
      organization: "Mate s.r.o.",
      line: "Everyone in Mate s.r.o. can open it: 17 with Full access, Karlos with Edit access.",
    },
    {
      title: "Everyone at one level is said once",
      input: draft({
        members: {
          known: true,
          status: "ready",
          refused: false,
          list: TEAM.filter((one) => one.id !== "cu-karlos"),
        },
        app: { projects: [], grants: {}, owners: {} },
      }),
      organization: "Mate s.r.o.",
      line: "Everyone in Mate s.r.o. can open it with Full access.",
    },
    {
      title: "Two at a level are named, three are counted",
      input: team(
        [member("x1", "Xu One", "BASIC_USER"), member("x2", "Xi Two", "BASIC_USER")],
        [
          { clientUserId: "cu-ada", roleCode: "READ_ONLY" },
          { clientUserId: "cu-bo", roleCode: "READ_ONLY" },
        ],
      ),
      organization: "Mate s.r.o.",
      line: "Everyone in Mate s.r.o. can open it: 15 with Full access, 3 with Edit access, Ada L. and Bo H. with Read access.",
    },
    {
      title: "Whoever cannot open it is left out of everyone",
      input: team([member("nobody", "Nora Quill", "NO_ACCESS")]),
      organization: "Mate s.r.o.",
      line: "18 of 19 people in Mate s.r.o. can open it: 17 with Full access, Karlos with Edit access.",
    },
    {
      title: "Alone on it, the creator reads only you",
      input: draft({
        members: {
          known: true,
          status: "ready",
          refused: false,
          list: [member("me", "Mia Moss", "ADMIN"), member("na", "Ned", "NO_ACCESS")],
        },
        app: { projects: [], grants: {}, owners: {} },
      }),
      organization: "Mate s.r.o.",
      line: "Only you can open it.",
    },
    {
      title: "An organization not yet named is the organization",
      input: team([]),
      organization: null,
      line: "Everyone in the organization can open it: 17 with Full access, Karlos with Edit access.",
    },
  ])("$title", ({ input, organization, line }) => {
    expect(
      draftSummary({ view: draftView(input), organization, prefill: [], list: input.list })?.line,
    ).toBe(line);
  });

  it.each([
    { title: "No change from where it started says none", list: [], changes: null },
    {
      title: "One person changed says one change",
      list: [{ clientUserId: "cu-ada", roleCode: "READ_ONLY" }],
      changes: "1 change",
    },
    {
      title: "Two people changed say two changes",
      list: [
        { clientUserId: "cu-ada", roleCode: "READ_ONLY" },
        { clientUserId: "cu-bo", roleCode: "NO_ACCESS" },
      ],
      changes: "2 changes",
    },
    {
      title: "A prefilled grant taken back counts as a change",
      list: [],
      prefill: [{ clientUserId: "cu-ada", roleCode: "READ_ONLY" }],
      changes: "1 change",
    },
  ])("$title", ({ list, changes, ...rest }) => {
    const prefill = "prefill" in rest ? rest.prefill : [];
    const input = team([], list);
    expect(
      draftSummary({ view: draftView(input), organization: "Mate s.r.o.", prefill, list })?.changes,
    ).toBe(changes);
  });

  it("Says nothing while the people are read", () => {
    expect(
      draftSummary({ view: { kind: "reading" }, organization: "Mate", prefill: null, list: [] }),
    ).toBeNull();
  });
});
