import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import { draftChoose, draftPrefill, draftView, type DraftInput } from "./accessDraft.logic";

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
