/**
 * Inviting someone from Settings → Team, on one page: the address checked with Zerops as it is
 * left or Invite pressed, a name asked only where the address has no Zerops account, the role
 * cards, the projects they get at Full or Read; each answer awaited on the page, a refusal said
 * there.
 */
import type { InviteeCheck } from "@t3tools/client-runtime/data";
import type { ReactNode } from "react";
import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TeamInviteView, type TeamInviteActions } from "./TeamInvitePage";

vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual<typeof import("@tanstack/react-router")>()),
  Link: ({
    children,
    params = {},
    to,
  }: {
    readonly children?: ReactNode;
    readonly params?: Readonly<Record<string, string>>;
    readonly to: string;
  }) => <a href={to.replace(/\$(\w+)/g, (_, key: string) => params[key] ?? "")}>{children}</a>,
}));

vi.mock("../ui/input", () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}));

// The kit's checkbox, as a plain one: ticking it says so as the kit's does.
vi.mock("../ui/checkbox", () => ({
  Checkbox: (props: {
    readonly checked?: boolean;
    readonly onCheckedChange?: (checked: boolean) => void;
  }) => (
    <input
      checked={props.checked === true}
      onChange={() => props.onCheckedChange?.(props.checked !== true)}
      type="checkbox"
    />
  ),
}));

const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

const PROJECTS = [
  { key: "g-beviro", name: "Beviro", projectIds: ["beviro-prod"] },
  { key: "g-snap", name: "Snap", projectIds: ["snap-prod", "snap-fen"] },
];

function mount(
  viewerRole = "OWNER",
  actions: Partial<TeamInviteActions> = {},
  options: { readonly from?: string; readonly projects?: typeof PROJECTS } = {},
) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const check = vi.fn(actions.check ?? (async (): Promise<InviteeCheck> => ({ kind: "new" })));
  const send = vi.fn(actions.send ?? (async () => {}));
  const onSent = vi.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <TeamInviteView
        actions={{ check, send }}
        from={options.from}
        onSent={onSent}
        organizationName="Acme"
        projects={options.projects ?? PROJECTS}
        viewerRole={viewerRole}
      />,
    );
  });
  mounted.push(tree);
  const root = tree.root;
  const text = (node: ReactTestInstance): string =>
    node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
  const section = (label: string) =>
    root.find((node) => node.type === "section" && node.props["aria-label"] === label);
  const field = (id: string) =>
    root.find((node) => node.type === "input" && String(node.props.id).endsWith(id));
  const radios = (label: string) =>
    section(label).findAll((node) => node.type === "button" && node.props.role === "radio");
  const nameOf = (card: ReactTestInstance) =>
    text(card.findByProps({ className: "tm-role-card-name" }));
  const projectRows = () =>
    section("Projects").findAll(
      (node) => node.type === "label" && node.props.className === "tm-invite-project",
    );
  return {
    check,
    send,
    onSent,
    heading: () => text(root.findByType("h1")),
    type: (id: string, value: string) => act(() => field(id).props.onChange({ target: { value } })),
    leave: (id: string) =>
      act(async () => {
        field(id).props.onBlur();
      }),
    hasField: (id: string) =>
      root.findAll((node) => node.type === "input" && String(node.props.id).endsWith(id)).length >
      0,
    submit: () =>
      act(async () => {
        root.findByType("form").props.onSubmit({ preventDefault: () => {} });
      }),
    cards: () =>
      radios("Role").map((card) => ({
        name: nameOf(card),
        disabled: card.props.disabled === true,
      })),
    pickRole: (name: string) =>
      act(() => {
        radios("Role")
          .find((card) => nameOf(card) === name)!
          .props.onClick();
      }),
    levels: () => radios("Projects").map(nameOf),
    pickLevel: (name: string) =>
      act(() => {
        radios("Projects")
          .find((card) => nameOf(card) === name)!
          .props.onClick();
      }),
    projects: () =>
      projectRows().map((row) => ({
        name: text(row.findByProps({ className: "tm-pick-name" })),
        picked: row.findByType("input").props.checked === true,
      })),
    toggleProject: (name: string) =>
      act(() => {
        projectRows()
          .find((row) => text(row.findByProps({ className: "tm-pick-name" })) === name)!
          .findByType("input")
          .props.onChange();
      }),
    projectsLine: () => text(section("Projects")),
    alerts: () =>
      root
        .findAll((node) => node.type === "p" && node.props.role === "alert")
        .map(text)
        .filter((line) => line !== ""),
  };
}

describe("inviting someone to the team", () => {
  it("A new address is asked for a name, then a role and projects, then sent", async () => {
    const page = mount();
    expect(page.heading()).toBe("Invite someone to Acme");
    page.type("email", "petra.kralova@example.com");
    expect(page.hasField("first")).toBe(false);
    await page.submit();
    expect(page.check).toHaveBeenCalledWith("petra.kralova@example.com");
    expect(page.send).not.toHaveBeenCalled();
    page.type("first", "Petra");
    page.type("last", "Kralova");
    page.pickRole("Guest");
    page.toggleProject("Snap");
    await page.submit();
    expect(page.check).toHaveBeenCalledTimes(1);
    expect(page.send).toHaveBeenCalledWith({
      email: "petra.kralova@example.com",
      invitee: { kind: "new", firstName: "Petra", lastName: "Kralova" },
      membership: {
        roleCode: "NO_ACCESS",
        canCreateProjects: false,
        canViewFinances: false,
        canEditFinances: false,
      },
      grants: [
        { projectId: "snap-prod", roleCode: "READ_ONLY" },
        { projectId: "snap-fen", roleCode: "READ_ONLY" },
      ],
    });
    expect(page.onSent).toHaveBeenCalledWith("petra.kralova@example.com");
  });

  it("An address with a Zerops account is asked no name", async () => {
    const page = mount("OWNER", { check: async () => ({ kind: "existing", userId: "u-petra" }) });
    page.type("email", "petra.kralova@example.com");
    await page.submit();
    expect(page.hasField("first")).toBe(false);
    expect(page.send.mock.calls[0]?.[0].invitee).toEqual({ kind: "existing", userId: "u-petra" });
  });

  it("A new account's names are asked before anything is sent", async () => {
    const page = mount();
    page.type("email", "petra.kralova@example.com");
    await page.submit();
    await page.submit();
    expect(page.send).not.toHaveBeenCalled();
    expect(page.alerts()).toEqual(["Enter their first and last name."]);
  });

  it("An admin is offered only the roles an admin may give", async () => {
    const page = mount("ADMIN");
    page.type("email", "petra.kralova@example.com");
    await page.submit();
    expect(page.cards()).toEqual([
      { name: "Owner", disabled: true },
      { name: "Admin", disabled: true },
      { name: "Developer", disabled: false },
      { name: "Guest", disabled: false },
    ]);
  });

  it("An address already in the organization stays on the e-mail, the field saying so", async () => {
    const page = mount("OWNER", {
      check: async () => ({ kind: "member", clientUserId: "cu-petra", roleCode: "NO_ACCESS" }),
    });
    page.type("email", "petra.kralova@example.com");
    await page.submit();
    expect(page.alerts()).toEqual(["petra.kralova@example.com is in Acme already."]);
    expect(page.send).not.toHaveBeenCalled();
  });

  it("Zerops's refusal is said on the page, and the invitation stays", async () => {
    const page = mount("OWNER", {
      check: async () => ({ kind: "existing", userId: "u-petra" }),
      send: async () => {
        throw new Error("Only an organization owner or admin can invite.");
      },
    });
    page.type("email", "petra.kralova@example.com");
    await page.submit();
    expect(page.alerts()).toEqual(["Only an organization owner or admin can invite."]);
    expect(page.heading()).toBe("Invite someone to Acme");
    expect(page.onSent).not.toHaveBeenCalled();
  });

  it("An address that isn't one is said so before Zerops is asked", async () => {
    const page = mount();
    page.type("email", "petra");
    await page.submit();
    expect(page.check).not.toHaveBeenCalled();
    expect(page.alerts()).toEqual(["That isn't an e-mail address."]);
  });

  it("Leaving the e-mail checks it with Zerops: a new address asks for names before Invite is pressed", async () => {
    const page = mount();
    page.type("email", "petra.kralova@example.com");
    await page.leave("email");
    expect(page.check).toHaveBeenCalledWith("petra.kralova@example.com");
    expect(page.hasField("first")).toBe(true);
    await page.submit();
    expect(page.check).toHaveBeenCalledTimes(1);
    expect(page.alerts()).toEqual(["Enter their first and last name."]);
  });

  it.each([
    {
      sentence: "An invitation opened from a project starts with it picked",
      from: "g-snap",
      projects: PROJECTS,
      picked: ["Snap"],
    },
    {
      sentence: "The organization's only project starts picked",
      from: undefined,
      projects: PROJECTS.slice(1),
      picked: ["Snap"],
    },
    {
      sentence: "With several projects and none to start from, nothing is picked",
      from: undefined,
      projects: PROJECTS,
      picked: [],
    },
  ])("$sentence", ({ from, projects, picked }) => {
    const page = mount("OWNER", {}, { ...(from === undefined ? {} : { from }), projects });
    expect(
      page
        .projects()
        .filter((row) => row.picked)
        .map(({ name }) => name),
    ).toEqual(picked);
  });

  it.each([
    { role: "Developer", list: true, levels: ["Full", "Read"], line: "the ones they start" },
    {
      role: "Guest",
      list: true,
      levels: [],
      line: "Read access: follows the work and opens the app",
    },
    { role: "Admin", list: false, levels: [], line: "An admin reaches every project." },
    { role: "Owner", list: false, levels: [], line: "An owner reaches every project." },
  ])(
    "a $role's projects say what they get, Full and Read each explained where chosen",
    ({ role, list, levels, line }) => {
      const page = mount();
      page.pickRole(role);
      expect(page.projects().length > 0).toBe(list);
      expect(page.levels()).toEqual(levels);
      expect(page.projectsLine()).toContain(line);
    },
  );

  it("A Developer given Read gets each picked project read only", async () => {
    const page = mount(
      "OWNER",
      { check: async () => ({ kind: "existing", userId: "u-petra" }) },
      {
        from: "g-beviro",
      },
    );
    page.pickLevel("Read");
    expect(page.projectsLine()).toContain("Follows the work and opens the app; changes nothing.");
    page.type("email", "petra.kralova@example.com");
    await page.submit();
    expect(page.send.mock.calls[0]?.[0].grants).toEqual([
      { projectId: "beviro-prod", roleCode: "READ_ONLY" },
    ]);
  });
});
