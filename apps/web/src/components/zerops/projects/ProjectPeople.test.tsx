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
        { text: ["Petr NovákYou", "Production: read · Stage: full · 1 Mate"], pending: false },
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
