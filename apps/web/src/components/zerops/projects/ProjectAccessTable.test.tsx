// @vitest-environment happy-dom
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { accessTable, columnPeople } from "./accessTable.logic";
import { PlaceAccessSummary, ProjectAccessTable } from "./ProjectAccessTable";
import type { ProjectPeopleInput } from "./projectPeople.logic";

const member = (id: string, fullName: string, roleCode: string): ZeropsOrganizationMember => ({
  id: `cu-${id}`,
  status: "ACTIVE",
  roleCode,
  user: { id: `u-${id}`, fullName },
});

const INPUT: ProjectPeopleInput = {
  members: {
    known: true,
    status: "ready",
    refused: false,
    list: [member("ada", "Ada Lindqvist", "OWNER"), member("bo", "Bo Tamura", "NO_ACCESS")],
  },
  projects: [
    { projectId: "p-prod", kind: "production" },
    { projectId: "p-stage", kind: "stage" },
    { projectId: "m-fen", kind: "mate", name: "Fen" },
  ],
  grants: {
    "p-prod": { status: "ready", grants: [{ clientUserId: "cu-bo", roleCode: "READ_ONLY" }] },
    "p-stage": { status: "ready", grants: [] },
    "m-fen": { status: "ready", grants: [] },
  },
  owners: { "m-fen": "u-bo" },
  pictures: {},
  viewerUserId: null,
  viewer: { roleCode: "OWNER", membershipId: "cu-ada" },
};

/** What a screen reader says of an element: its words, without what is hidden from it. */
const spoken = (element: Element) => {
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy.textContent;
};

const parse = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body;

describe("an app's access table", () => {
  it("Each person's row says their level on each place, the organization's default said as such", () => {
    const body = parse(
      renderToStaticMarkup(
        <ProjectAccessTable onCell={() => {}} onEverywhere={() => {}} view={accessTable(INPUT)} />,
      ),
    );
    expect(
      [...body.querySelectorAll("thead th")].map(
        (th) => th.querySelector('[data-part="label"]')?.textContent ?? th.textContent,
      ),
    ).toEqual(["Person", "Production", "Stage", "Fen"]);
    expect(
      [...body.querySelectorAll("tbody tr")].map((tr) =>
        [...tr.querySelectorAll("td")].map(spoken),
      ),
    ).toEqual([
      ["Full, organization default", "Full, organization default", "Full, organization default"],
      ["Read", "None", "Owner"],
    ]);
  });

  it("One line under the table says what plain and highlighted levels mean", () => {
    const body = parse(renderToStaticMarkup(<ProjectAccessTable view={accessTable(INPUT)} />));
    expect(body.textContent).toContain(
      "Plain: what the organization gives. Highlighted: set for this place.",
    );
  });

  it("A Mate's owner cell and a viewer who changes nothing get no menu", () => {
    const editable = parse(
      renderToStaticMarkup(<ProjectAccessTable onCell={() => {}} view={accessTable(INPUT)} />),
    );
    expect(editable.querySelector('[aria-label^="Bo Tamura on Fen"]')).toBeNull();
    expect(editable.querySelector('[aria-label^="Bo Tamura on Production"]')).not.toBeNull();
    const readOnly = parse(
      renderToStaticMarkup(
        <ProjectAccessTable
          view={accessTable({ ...INPUT, viewer: { roleCode: "BASIC_USER", membershipId: "x" } })}
        />,
      ),
    );
    expect(readOnly.querySelectorAll("tbody button")).toHaveLength(0);
  });
});

describe("one place's access, read only", () => {
  it("A place's page shows who reaches it with their level, and links to change it on the app's page", () => {
    const body = parse(
      renderToStaticMarkup(
        <PlaceAccessSummary
          change={<a href="/group/g/flow#access-p-prod">Change on kite.works’s page</a>}
          line={null}
          summary={columnPeople(accessTable(INPUT), "p-prod")}
        />,
      ),
    );
    expect(
      [...body.querySelectorAll("li")].map((li) =>
        [...li.querySelectorAll("[data-part]")].map((part) => part.textContent),
      ),
    ).toEqual([
      ["Ada L.", "Full, organization default"],
      ["Bo T.", "Read"],
    ]);
    expect(body.querySelector("button")).toBeNull();
    expect(body.querySelector("a")?.textContent).toBe("Change on kite.works’s page");
  });
});
