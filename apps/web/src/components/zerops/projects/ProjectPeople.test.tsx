// @vitest-environment happy-dom
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { draftSpeaks, draftView } from "./accessDraft.logic";
import { AddAccessPicker, ProjectAccessChips, type AccessPick } from "./ProjectAccessChips";
import {
  projectPeople,
  type AccessCandidate,
  type ProjectPeopleInput,
} from "./projectPeople.logic";

vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual<typeof import("@tanstack/react-router")>()),
  Link: ({
    children,
    params,
    to,
  }: {
    readonly children?: ReactNode;
    readonly params: Readonly<Record<string, string>>;
    readonly to: string;
  }) => <a href={to.replace(/\$(\w+)/g, (_, key: string) => params[key] ?? "")}>{children}</a>,
}));

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
const JAN: ZeropsOrganizationMember = {
  id: "cu-jan",
  status: "ACTIVE",
  roleCode: "NO_ACCESS",
  user: { id: "u-jan", fullName: "Jan Svoboda", email: "jan@example.com" },
};

const input = (members: ProjectPeopleInput["members"]): ProjectPeopleInput => ({
  members,
  projects: [
    { projectId: "p-prod", kind: "production" },
    { projectId: "p-stage", kind: "stage" },
    { projectId: "m-1", kind: "mate" },
  ],
  grants: {
    "p-prod": { status: "ready", grants: [{ clientUserId: "cu-petr", roleCode: "ADMIN" }] },
    "p-stage": { status: "ready", grants: [{ clientUserId: "cu-petr", roleCode: "ADMIN" }] },
  },
  owners: { "m-1": "u-petr" },
  pictures: {},
  viewerUserId: "u-petr",
});

const KNOWN = (list: ReadonlyArray<ZeropsOrganizationMember>): ProjectPeopleInput["members"] => ({
  known: true,
  status: "ready",
  refused: false,
  list,
});

const sectionOf = (markup: string, label: string) =>
  new DOMParser()
    .parseFromString(markup, "text/html")
    .body.querySelector(`section[aria-label="${label}"]`);

/** The chips as a person reads them: the name, then the badge. */
const chipsOf = (section: Element | null | undefined) =>
  [...(section?.querySelectorAll("ul > li") ?? [])].map((chip) => ({
    text: [...chip.querySelectorAll("[data-part]")].map((part) => part.textContent),
    pending: chip.hasAttribute("data-pending"),
  }));

function rowsOf(members: ProjectPeopleInput["members"]) {
  const section = sectionOf(
    renderToStaticMarkup(
      <ProjectAccessChips label="People" view={projectPeople(input(members))} />,
    ),
    "People",
  );
  return {
    heading: section?.querySelector("h3")?.textContent,
    rows: chipsOf(section),
    note: section?.querySelector("p")?.textContent,
  };
}

describe("a project's People section", () => {
  it("Each member who can reach the project is a row: who, then what they may do here", () => {
    expect(rowsOf(KNOWN([ANNA, PETR, IVA]))).toEqual({
      heading: "People",
      rows: [
        { text: ["Petr N.", "Full"], pending: false },
        { text: ["Anna B.", "Full"], pending: false },
        { text: ["iva@example.com", "Edit"], pending: true },
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
      ...input(KNOWN([ANNA, PETR, IVA, JAN])),
      viewerUserId: "u-anna",
      ...(viewer === undefined ? {} : { viewer }),
    });
  const drawn = (
    viewer: ProjectPeopleInput["viewer"],
    extra: Partial<Parameters<typeof ProjectAccessChips>[0]> = {},
  ) =>
    sectionOf(
      renderToStaticMarkup(
        <ProjectAccessChips
          label="People"
          onAdd={() => {}}
          onChoose={() => {}}
          view={people(viewer)}
          {...extra}
        />,
      ),
      "People",
    );

  it.each([
    { role: "OWNER", add: true },
    { role: "ADMIN", add: true },
    { role: "BASIC_USER", add: false },
    { role: undefined, add: false },
  ])(
    "Add access is offered as the last chip to an owner or admin alone: $role",
    ({ role, add }) => {
      const section = drawn(
        role === undefined ? undefined : { roleCode: role, membershipId: "cu-anna" },
      );
      expect(
        section?.querySelector('[data-zerops-surface="add-access"]')?.textContent ?? null,
      ).toBe(add ? "Add access" : null);
    },
  );

  it("Add access is not offered when everyone in the organization already has access", () => {
    const section = sectionOf(
      renderToStaticMarkup(
        <ProjectAccessChips
          onAdd={() => {}}
          view={projectPeople({
            ...input(KNOWN([ANNA, PETR])),
            viewer: { roleCode: "OWNER", membershipId: "cu-anna" },
          })}
        />,
      ),
      "Project access",
    );
    expect(section?.querySelector('[data-zerops-surface="add-access"]')).toBeNull();
  });

  it("An owner finds a menu on each person whose access they may change: an invitation's and their own too", () => {
    const section = drawn({ roleCode: "OWNER", membershipId: "cu-anna" });
    expect(
      [...(section?.querySelectorAll('[aria-label$="\'s access"]') ?? [])].map((menu) =>
        menu.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Change Anna Berg's access",
      "Change Petr Novák's access",
      "Change iva@example.com's access",
    ]);
  });

  it("An admin finds no menu on an owner: Zerops refuses an admin that write", () => {
    const section = drawn({ roleCode: "ADMIN", membershipId: "cu-someone" });
    expect(section?.querySelector('[aria-label="Change Anna Berg\'s access"]')).toBeNull();
  });

  it("An owner or admin opens a person's own Team page from their chip", () => {
    const section = sectionOf(
      renderToStaticMarkup(
        <ProjectAccessChips
          personPage={() => true}
          view={projectPeople({
            ...input(KNOWN([ANNA, PETR])),
            viewer: { roleCode: "OWNER", membershipId: "cu-anna" },
          })}
        />,
      ),
      "Project access",
    );
    expect([...(section?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"))).toEqual([
      "/settings/team/cu-petr",
      "/settings/team/cu-anna",
    ]);
  });

  it("A change under way says so on the row, and a refused one is said under it", () => {
    const section = drawn(
      { roleCode: "OWNER", membershipId: "cu-anna" },
      {
        saving: new Set(["cu-petr"]),
        troubles: { "cu-iva": "Only an organization owner or admin can change who has access." },
      },
    );
    expect(chipsOf(section).map(({ text }) => text)).toEqual([
      ["Anna B.", "Full"],
      ["Petr N.", "Saving…"],
      ["iva@example.com", "Edit"],
    ]);
    expect(section?.querySelector('[role="alert"]')?.textContent).toBe(
      "iva@example.com: Only an organization owner or admin can change who has access.",
    );
  });
});

describe("a new project's access in a creation dialog", () => {
  it.each([
    {
      sentence: "A creator alone in the organization is asked nothing about access",
      list: [PETR],
      speaks: false,
    },
    {
      sentence: "With teammates, who reaches the new project is chosen in the dialog",
      list: [ANNA, PETR, JAN],
      speaks: true,
    },
  ])("$sentence", ({ list, speaks }) => {
    const view = draftView({
      members: KNOWN(list),
      kind: "mate",
      app: { projects: [], grants: {}, owners: {} },
      pictures: {},
      creator: { membershipId: "cu-petr", userId: "u-petr" },
      list: [],
    });
    expect(draftSpeaks(view)).toBe(speaks);
  });

  it("The creator's chip comes first as you, full access, with no menu; Add access follows the people", () => {
    const view = draftView({
      members: KNOWN([ANNA, PETR, JAN]),
      kind: "stage",
      app: { projects: [], grants: {}, owners: {} },
      pictures: {},
      creator: { membershipId: "cu-petr", userId: "u-petr" },
      list: [],
    });
    const section = sectionOf(
      renderToStaticMarkup(<ProjectAccessChips onAdd={() => {}} onChoose={() => {}} view={view} />),
      "Project access",
    );
    expect(chipsOf(section).map(({ text }) => text)).toEqual([
      ["You", "Full"],
      ["Anna B.", "Full"],
    ]);
    expect(
      section?.querySelector("ul > li")?.querySelector('[aria-label$="\'s access"]') ?? null,
    ).toBeNull();
    expect(section?.querySelector('[data-zerops-surface="add-access"]')?.textContent).toBe(
      "Add access",
    );
    expect(section?.querySelector('ul [data-zerops-surface="add-access"]')).toBeNull();
  });
});

describe("adding people already in the organization", () => {
  const CANDIDATES: ReadonlyArray<AccessCandidate> = [
    {
      clientUserId: "cu-jan",
      userId: "u-jan",
      name: "Jan Svoboda",
      short: "Jan S.",
      initials: "JS",
      avatarUrl: null,
      email: "jan@example.com",
      role: "Member",
      pending: false,
    },
    {
      clientUserId: "cu-eva",
      userId: "u-eva",
      name: "Eva Dvořáková",
      short: "Eva D.",
      initials: "ED",
      avatarUrl: null,
      email: "eva@example.com",
      role: "Member",
      pending: false,
    },
  ];
  let root: Root | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = "";
  });
  const mount = (onAdd: (picks: ReadonlyArray<AccessPick>) => void) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(<AddAccessPicker candidates={CANDIDATES} onAdd={onAdd} />));
    return host;
  };
  const box = (host: HTMLElement, label: string) =>
    host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
  const addButton = (host: HTMLElement) =>
    [...host.querySelectorAll("button")].find((one) => one.textContent?.startsWith("Add"))!;

  it("Add people waits until someone is ticked, and adds each at the level ticked", () => {
    const added: Array<ReadonlyArray<AccessPick>> = [];
    const host = mount((picks) => added.push(picks));
    expect(addButton(host).disabled).toBe(true);
    act(() => box(host, "Read access for Jan Svoboda").click());
    act(() => box(host, "Full access for Eva Dvořáková").click());
    expect(addButton(host).textContent).toBe("Add 2 people");
    act(() => addButton(host).click());
    expect(added[0]?.map(({ candidate, level }) => [candidate.clientUserId, level])).toEqual([
      ["cu-jan", "read"],
      ["cu-eva", "full"],
    ]);
  });

  it("Read and Full are one choice per person: ticking Full unticks Read", () => {
    const added: Array<ReadonlyArray<AccessPick>> = [];
    const host = mount((picks) => added.push(picks));
    act(() => box(host, "Read access for Jan Svoboda").click());
    act(() => box(host, "Full access for Jan Svoboda").click());
    act(() => addButton(host).click());
    expect(added[0]?.map(({ level }) => level)).toEqual(["full"]);
  });

  it("Read and Full are each explained in one line where they are chosen", () => {
    const host = mount(() => {});
    expect(
      [...host.querySelectorAll('[aria-label="What Read and Full give"] > div')].map(
        (line) => line.textContent,
      ),
    ).toEqual([
      "Read: Follows the work and opens the app; changes nothing.",
      "Full: Works with the project's Mates and changes the project.",
    ]);
  });

  it("The search narrows the people by name or e-mail", () => {
    const host = mount(() => {});
    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "eva@");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      [...host.querySelectorAll('ul[aria-label="People in the organization"] > li')].map(
        (row) => row.textContent,
      ),
    ).toEqual([expect.stringContaining("Eva Dvořáková")]);
  });
});
