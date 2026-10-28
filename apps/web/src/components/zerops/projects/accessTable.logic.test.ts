import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import {
  accessTable,
  cellChange,
  columnPeople,
  everywhereChanges,
  rowSummary,
  type AccessRow,
  type AccessTableView,
} from "./accessTable.logic";
import type { ProjectPeopleInput } from "./projectPeople.logic";

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

interface Project {
  readonly projectId: string;
  readonly kind: Kind;
  readonly name?: string;
  readonly grants?: Grants | "reading" | "failed";
  readonly owner?: string;
}

const PROD: Project = { projectId: "p-prod", kind: "production", name: "kite-works-prod" };
const STAGE: Project = { projectId: "p-stage", kind: "stage", name: "kite-works-stage" };
const FEN: Project = { projectId: "m-fen", kind: "mate", name: "Fen", owner: "u-ada" };
const JUNO: Project = { projectId: "m-juno", kind: "mate", name: "Juno", owner: "u-bo" };

const with_ = (project: Project, grants: Grants): Project => ({ ...project, grants });

const input = (
  list: ReadonlyArray<ZeropsOrganizationMember>,
  projects: ReadonlyArray<Project> = [PROD, STAGE, FEN, JUNO],
  viewer?: ProjectPeopleInput["viewer"],
): ProjectPeopleInput => ({
  members: { known: true, status: "ready", refused: false, list },
  pictures: {},
  viewerUserId: null,
  ...(viewer === undefined ? {} : { viewer }),
  projects: projects.map(({ projectId, kind, name }) => ({
    projectId,
    kind,
    ...(name === undefined ? {} : { name }),
  })),
  grants: Object.fromEntries(
    projects.map(({ projectId, grants = [] }) => [
      projectId,
      grants === "reading"
        ? { status: "loading" as const, grants: undefined }
        : grants === "failed"
          ? { status: "failed" as const, grants: undefined }
          : {
              status: "ready" as const,
              grants: grants.map(([who, roleCode]) => ({ clientUserId: `cu-${who}`, roleCode })),
            },
    ]),
  ),
  owners: Object.fromEntries(
    projects.flatMap(({ projectId, owner }) => (owner === undefined ? [] : [[projectId, owner]])),
  ),
});

const ADA = member("ada", "Ada Lindqvist", "BASIC_USER");
const BO = member("bo", "Bo Tamura", "NO_ACCESS");
const OWNER_VIEWER = { roleCode: "OWNER", membershipId: "cu-own" };
const ADMIN_VIEWER = { roleCode: "ADMIN", membershipId: "cu-adm" };

const table = (view: AccessTableView) => {
  if (view.kind !== "table") throw new Error(`expected a table, got ${view.kind}`);
  return view;
};
const rowOf = (view: AccessTableView, name: string): AccessRow | undefined =>
  table(view).rows.find((row) => row.name === name);
/** A row as a person reads it: each column's word, "·" marking the organization's default. */
const said = (view: AccessTableView, name: string) =>
  rowOf(view, name)?.cells.map(({ level, byDefault }) => `${level}${byDefault ? "·" : ""}`);

describe("an app's access, people by places", () => {
  it("Columns are Production, each Stage by its title, then each Mate by name with its owner's face", () => {
    const view = accessTable(
      input([ADA, BO], [FEN, { ...STAGE, name: "Client demo" }, PROD, STAGE, JUNO]),
    );
    expect(table(view).columns.map(({ label, owner }) => [label, owner?.name ?? null])).toEqual([
      ["Production", null],
      ["Client demo", null],
      ["Stage", null],
      ["Fen", "Ada Lindqvist"],
      ["Juno", "Bo Tamura"],
    ]);
  });

  it("A production that doesn't exist yet has no column", () => {
    expect(
      table(accessTable(input([ADA], [STAGE, FEN]))).columns.map(({ label }) => label),
    ).toEqual(["Stage", "Fen"]);
  });

  it.each<{
    readonly sentence: string;
    readonly member: ZeropsOrganizationMember;
    readonly projects: ReadonlyArray<Project>;
    readonly cells: ReadonlyArray<string>;
  }>([
    {
      sentence: "An organization owner has Full everywhere, by the organization's default",
      member: member("cy", "Cy", "OWNER"),
      projects: [PROD, STAGE, FEN],
      cells: ["full·", "full·", "full·"],
    },
    {
      sentence: "A developer of the organization has more than Read everywhere, by default",
      member: member("cy", "Cy", "BASIC_USER"),
      projects: [PROD, STAGE, FEN],
      cells: ["basic·", "basic·", "basic·"],
    },
    {
      sentence:
        "An admin lowered to Read on production has Read set there and Full by default elsewhere",
      member: member("cy", "Cy", "ADMIN"),
      projects: [with_(PROD, [["cy", "READ_ONLY"]]), STAGE, FEN],
      cells: ["read", "full·", "full·"],
    },
    {
      sentence: "Someone the organization gives nothing has what each place sets, none elsewhere",
      member: member("cy", "Cy", "NO_ACCESS"),
      projects: [PROD, with_(STAGE, [["cy", "ADMIN"]]), with_(FEN, [["cy", "READ_ONLY"]])],
      cells: ["none·", "full", "read"],
    },
    {
      sentence: "A place kept from someone who sees every project is none, set there",
      member: member("cy", "Cy", "READ_ONLY"),
      projects: [with_(PROD, [["cy", "NO_ACCESS"]]), STAGE, FEN],
      cells: ["none", "read·", "read·"],
    },
    {
      sentence: "A Mate's owner is its Owner, whatever their role",
      member: member("ada", "Ada", "NO_ACCESS"),
      projects: [with_(STAGE, [["ada", "READ_ONLY"]]), FEN],
      cells: ["read", "owner"],
    },
  ])("$sentence", ({ member: one, projects, cells }) => {
    expect(said(accessTable(input([one], projects)), one.user!.fullName!)).toEqual(cells);
  });

  it("A row is a member who reaches something here, invitations too; the rest are offered to add, tokens never", () => {
    const view = table(
      accessTable(
        input(
          [
            ADA,
            member("iva", "Iva Rhee", "NO_ACCESS", { status: "WAITING_AUTHORIZATION" }),
            member("dan", "Dan Ortiz", "NO_ACCESS"),
            member("key", "CI", "ADMIN", {
              user: { id: "u-key", email: "token-AbCdEfGhIjKlMnOpQrStUv@zerops.io" },
            }),
          ],
          [with_(PROD, [["iva", "READ_ONLY"]]), STAGE],
          OWNER_VIEWER,
        ),
      ),
    );
    expect(view.rows.map(({ name, pending }) => [name, pending])).toEqual([
      ["Ada Lindqvist", false],
      ["Iva Rhee", true],
    ]);
    expect(view.candidates.map(({ name }) => name)).toEqual(["Dan Ortiz"]);
  });

  it("A Mate's people still being read keep the table waiting; ones Zerops won't show are unknown cells", () => {
    expect(accessTable(input([ADA], [PROD, { ...FEN, grants: "reading" }])).kind).toBe("reading");
    const view = accessTable(input([ADA, BO], [PROD, { ...JUNO, grants: "failed" }]));
    expect([said(view, "Ada Lindqvist"), said(view, "Bo Tamura")]).toEqual([
      ["basic·", "unknown"],
      // A Mate's owner is HQ's to name: known while its people are not.
      ["none·", "owner"],
    ]);
    expect(table(view).columns[1]?.unread).toBe(true);
  });
});

describe("changing one place's access from its cell", () => {
  const choices = (view: AccessTableView, name: string, column: number) =>
    rowOf(view, name)?.cells[column]?.choices.map(({ label, checked }) =>
      checked ? `[${label}]` : label,
    );

  it("Someone who isn't an organization owner or admin changes no cell", () => {
    const view = accessTable(input([ADA], [PROD], { roleCode: "BASIC_USER", membershipId: "x" }));
    expect(table(view).editable).toBe(false);
    expect(choices(view, "Ada Lindqvist", 0)).toEqual([]);
  });

  it.each<{
    readonly sentence: string;
    readonly member: ZeropsOrganizationMember;
    readonly project: Project;
    readonly viewer: { readonly roleCode: string; readonly membershipId: string };
    readonly offered: ReadonlyArray<string>;
  }>([
    {
      sentence: "A developer's cell offers each level, the organization default checked",
      member: member("cy", "Cy", "BASIC_USER"),
      project: PROD,
      viewer: OWNER_VIEWER,
      offered: ["Full", "Read", "None", "[Organization default (More than Read)]"],
    },
    {
      sentence: "A level set on a place is checked, the default a way back",
      member: member("cy", "Cy", "NO_ACCESS"),
      project: with_(PROD, [["cy", "READ_ONLY"]]),
      viewer: OWNER_VIEWER,
      offered: ["Full", "[Read]", "Organization default (None)"],
    },
    {
      sentence:
        "An owner or admin is never offered None: Zerops keeps every project visible to them",
      member: member("cy", "Cy", "ADMIN"),
      project: PROD,
      viewer: OWNER_VIEWER,
      offered: ["Read", "[Organization default (Full)]"],
    },
    {
      sentence: "An admin changes no organization owner's or admin's cell: Zerops refuses it",
      member: member("cy", "Cy", "OWNER"),
      project: PROD,
      viewer: ADMIN_VIEWER,
      offered: [],
    },
  ])("$sentence", ({ member: one, project, viewer, offered }) => {
    expect(choices(accessTable(input([one], [project], viewer)), "Cy", 0)).toEqual(offered);
  });

  it("A Mate's owner cell is fixed, and says why", () => {
    const cell = rowOf(accessTable(input([ADA], [FEN], OWNER_VIEWER)), "Ada Lindqvist")?.cells[0];
    expect(cell).toMatchObject({
      level: "owner",
      choices: [],
      fixed: "Fen is Ada Lindqvist’s Mate.",
    });
  });

  it.each([
    { choice: "full", roleCode: "ADMIN" },
    { choice: "read", roleCode: "READ_ONLY" },
    { choice: "none", roleCode: "NO_ACCESS" },
    { choice: "default", roleCode: null },
    // Picking what the organization gives already drops the place's own.
    { choice: "full", role: "ADMIN", roleCode: null },
  ] as const)(
    "A cell's choice is one write, for that place only: $choice",
    ({ choice, roleCode, ...rest }) => {
      expect(
        cellChange({
          clientUserId: "cu-cy",
          memberRole: "role" in rest ? rest.role : "BASIC_USER",
          projectId: "p-stage",
          choice,
        }),
      ).toEqual({ clientUserId: "cu-cy", projectId: "p-stage", roleCode });
    },
  );
});

describe("the same level everywhere for one person", () => {
  it("Same everywhere writes every place and Mate but the person's own Mates", () => {
    const view = table(
      accessTable(
        input([ADA, BO], [PROD, with_(STAGE, [["ada", "ADMIN"]]), FEN, JUNO], OWNER_VIEWER),
      ),
    );
    const ada = rowOf(view, "Ada Lindqvist")!;
    expect(ada.everywhere.map(({ label }) => label)).toEqual([
      "Full",
      "Read",
      "None",
      "Organization default (More than Read)",
    ]);
    expect(everywhereChanges({ row: ada, columns: view.columns, choice: "read" })).toEqual([
      { clientUserId: "cu-ada", projectId: "p-prod", roleCode: "READ_ONLY" },
      { clientUserId: "cu-ada", projectId: "p-stage", roleCode: "READ_ONLY" },
      { clientUserId: "cu-ada", projectId: "m-juno", roleCode: "READ_ONLY" },
    ]);
  });

  it("Organization default is offered only to someone with a level of their own here", () => {
    const view = table(accessTable(input([ADA], [PROD, STAGE], OWNER_VIEWER)));
    expect(rowOf(view, "Ada Lindqvist")?.everywhere.map(({ label }) => label)).toEqual([
      "Full",
      "Read",
      "None",
    ]);
  });

  it("An invitation's row can withdraw it", () => {
    const iva = rowOf(
      accessTable(
        input(
          [member("iva", "Iva Rhee", "NO_ACCESS", { status: "WAITING_AUTHORIZATION" })],
          [with_(PROD, [["iva", "READ_ONLY"]])],
          OWNER_VIEWER,
        ),
      ),
      "Iva Rhee",
    );
    expect(iva?.withdraw).toBe(true);
  });
});

describe("a person's places on a phone", () => {
  it("A row says each level once, with the places they have it on", () => {
    const view = table(
      accessTable(input([ADA], [PROD, with_(STAGE, [["ada", "READ_ONLY"]]), FEN, JUNO])),
    );
    expect(rowSummary(rowOf(view, "Ada Lindqvist")!, view.columns)).toBe(
      "Owner: Fen · More than Read: Production, Juno · Read: Stage",
    );
  });
});

describe("who reaches one place, read only", () => {
  it("A place's page lists who reaches it with their level there, none left out", () => {
    const view = accessTable(
      input(
        [member("cy", "Cy Park", "OWNER"), ADA, BO],
        [PROD, with_(STAGE, [["bo", "READ_ONLY"]]), FEN],
      ),
    );
    expect(
      columnPeople(view, "p-stage")?.people.map(({ name, level, byDefault }) => [
        name,
        level,
        byDefault,
      ]),
    ).toEqual([
      ["Cy Park", "full", true],
      ["Ada Lindqvist", "basic", true],
      ["Bo Tamura", "read", false],
    ]);
    expect(columnPeople(view, "p-stage")?.label).toBe("Stage");
    expect(columnPeople(view, "m-fen")?.people.map(({ name, level }) => [name, level])).toEqual([
      ["Cy Park", "full"],
      ["Ada Lindqvist", "owner"],
    ]);
  });
});
