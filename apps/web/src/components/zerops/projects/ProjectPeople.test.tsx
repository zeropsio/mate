// @vitest-environment happy-dom
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProjectPeopleList } from "./ProjectPeople";
import { projectPeople, type ProjectPeopleInput } from "./projectPeople.logic";

const ANNA: ZeropsOrganizationMember = {
  id: "cu-anna",
  status: "ACTIVE",
  roleCode: "OWNER",
  user: { id: "u-anna", fullName: "Anna Berg" },
};
const PETR: ZeropsOrganizationMember = {
  id: "cu-petr",
  status: "ACTIVE",
  roleCode: "NO_ACCESS",
  user: { id: "u-petr", fullName: "Petr Novák" },
};
const IVA: ZeropsOrganizationMember = {
  id: "cu-iva",
  status: "WAITING_AUTHORIZATION",
  roleCode: "BASIC_USER",
  user: { id: "u-iva", email: "iva@example.com" },
};

const input = (members: ProjectPeopleInput["members"]): ProjectPeopleInput => ({
  members,
  projects: [
    { projectId: "p-prod", kind: "production" },
    { projectId: "p-stage", kind: "stage" },
    { projectId: "m-1", kind: "mate" },
  ],
  grants: {
    "p-prod": { status: "ready", grants: [{ clientUserId: "cu-petr", roleCode: "READ_ONLY" }] },
    "p-stage": { status: "ready", grants: [{ clientUserId: "cu-petr", roleCode: "ADMIN" }] },
  },
  owners: { "m-1": "u-petr" },
  pictures: {},
  viewerUserId: "u-petr",
});

/** The section's rows as a person reads them: name (and You), then the line under it. */
function rowsOf(members: ProjectPeopleInput["members"]) {
  const markup = renderToStaticMarkup(<ProjectPeopleList view={projectPeople(input(members))} />);
  const body = new DOMParser().parseFromString(markup, "text/html").body;
  const section = body.querySelector('section[aria-label="People"]');
  return {
    heading: section?.querySelector("h3")?.textContent,
    rows: [...(section?.querySelectorAll("li") ?? [])].map((row) => ({
      text: [...row.querySelectorAll(".ov-mate-l1, .ov-mate-l2")].map((line) => line.textContent),
      pending: row.hasAttribute("data-pending"),
    })),
    note: section?.querySelector("p")?.textContent,
  };
}

describe("a project's People section", () => {
  it("Each member who can reach the project is a row: who, then what they may do here", () => {
    expect(
      rowsOf({ known: true, status: "ready", refused: false, list: [ANNA, PETR, IVA] }),
    ).toEqual({
      heading: "People",
      rows: [
        {
          text: ["Petr NovákYou", "Works on stage · only looks at production · 1 Mate"],
          pending: false,
        },
        { text: ["Anna Berg", "Owner · everything"], pending: false },
        {
          text: ["iva@example.com", "Invited · not joined yet · Works on every project"],
          pending: true,
        },
      ],
      note: undefined,
    });
  });

  it("A member list Zerops refuses the viewer is one line where the rows would be", () => {
    expect(rowsOf({ known: false, status: "failed", refused: true, list: [] })).toEqual({
      heading: "People",
      rows: [],
      note: "Zerops doesn’t show you this organization’s members.",
    });
  });
});

describe("changing who can work on a project", () => {
  const people = (viewer: ProjectPeopleInput["viewer"]) =>
    projectPeople({
      ...input({ known: true, status: "ready", refused: false, list: [ANNA, PETR, IVA] }),
      viewerUserId: "u-anna",
      ...(viewer === undefined ? {} : { viewer }),
    });
  const sectionOf = (markup: string) =>
    new DOMParser()
      .parseFromString(markup, "text/html")
      .body.querySelector('section[aria-label="People"]');
  const drawn = (
    viewer: ProjectPeopleInput["viewer"],
    extra: Partial<Parameters<typeof ProjectPeopleList>[0]> = {},
  ) =>
    sectionOf(
      renderToStaticMarkup(
        <ProjectPeopleList
          onChange={() => {}}
          onInvite={() => {}}
          projectName="Shop"
          view={people(viewer)}
          {...extra}
        />,
      ),
    );

  it.each([
    { role: "OWNER", invite: true },
    { role: "ADMIN", invite: true },
    { role: "BASIC_USER", invite: false },
    { role: undefined, invite: false },
  ])(
    "Invite is offered at the foot of People to an owner or admin alone: $role",
    ({ role, invite }) => {
      const section = drawn(
        role === undefined ? undefined : { roleCode: role, membershipId: "cu-anna" },
      );
      expect(section?.querySelector("button.ov-add")?.textContent ?? null).toBe(
        invite ? "Invite" : null,
      );
    },
  );

  it("An owner finds a menu on each person whose access they may change: an invitation's too, never their own", () => {
    const section = drawn({ roleCode: "OWNER", membershipId: "cu-anna" });
    expect(
      [...(section?.querySelectorAll('[aria-label$="\'s access"]') ?? [])].map((menu) =>
        menu.getAttribute("aria-label"),
      ),
    ).toEqual(["Change Petr Novák's access", "Change iva@example.com's access"]);
  });

  it("A change under way says so on the row, and a refused one is said under it", () => {
    const section = drawn(
      { roleCode: "OWNER", membershipId: "cu-anna" },
      {
        saving: new Set(["cu-petr"]),
        troubles: { "cu-iva": "Only an organization owner or admin can change who has access." },
      },
    );
    const lines = [...(section?.querySelectorAll("li") ?? [])].map((row) =>
      [...row.querySelectorAll(".ov-mate-l2")].map((line) => line.textContent),
    );
    expect(lines).toEqual([
      ["Owner · everything"],
      ["Saving…"],
      [
        "Invited · not joined yet · Works on every project",
        "Only an organization owner or admin can change who has access.",
      ],
    ]);
  });
});
