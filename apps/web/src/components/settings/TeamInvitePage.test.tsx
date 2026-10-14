/**
 * Inviting someone from Settings → Team: the address checked with Zerops; then "Adding <e-mail>",
 * a name asked only where the address has no Zerops account, the role cards and the project
 * access of a person's own page; each answer awaited on the page, a refusal said there.
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

// The picker's popover is the shared component's; here its choices arrive as they would.
vi.mock("./MemberProjectAccess", () => ({
  MemberProjectAccess: (props: {
    readonly chips: ReadonlyArray<{ readonly label: string }>;
    readonly onAdd: (picks: Readonly<Record<string, string>>) => void;
  }) => (
    <div data-add={props.onAdd} data-zerops-surface="project-access">
      {props.chips.map(({ label }) => label).join(", ")}
    </div>
  ),
}));

const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

const PROJECTS = [
  { projectId: "snap-prod", label: "Snap · production" },
  { projectId: "beviro-prod", label: "Beviro · production" },
];

function mount(viewerRole = "OWNER", actions: Partial<TeamInviteActions> = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const check = vi.fn(actions.check ?? (async (): Promise<InviteeCheck> => ({ kind: "new" })));
  const send = vi.fn(actions.send ?? (async () => {}));
  const onSent = vi.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <TeamInviteView
        actions={{ check, send }}
        onSent={onSent}
        organizationName="Acme"
        projects={PROJECTS}
        viewerRole={viewerRole}
      />,
    );
  });
  mounted.push(tree);
  const root = tree.root;
  const text = (node: ReactTestInstance): string =>
    node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
  const field = (id: string) =>
    root.find((node) => node.type === "input" && String(node.props.id).endsWith(id));
  const cards = () => root.findAll((node) => node.type === "button" && node.props.role === "radio");
  return {
    check,
    send,
    onSent,
    heading: () => text(root.findByType("h1")),
    type: (id: string, value: string) => act(() => field(id).props.onChange({ target: { value } })),
    hasField: (id: string) =>
      root.findAll((node) => node.type === "input" && String(node.props.id).endsWith(id)).length >
      0,
    submit: () =>
      act(async () => {
        root.findByType("form").props.onSubmit({ preventDefault: () => {} });
      }),
    cards: () =>
      cards().map((card) => ({
        name: text(card.findByProps({ className: "tm-role-card-name" })),
        disabled: card.props.disabled === true,
      })),
    pickRole: (name: string) =>
      act(() => {
        cards()
          .find((card) => text(card.findByProps({ className: "tm-role-card-name" })) === name)!
          .props.onClick();
      }),
    addProjects: (picks: Readonly<Record<string, string>>) =>
      act(() => {
        (
          root.findByProps({ "data-zerops-surface": "project-access" }).props["data-add"] as (
            picks: Readonly<Record<string, string>>,
          ) => void
        )(picks);
      }),
    links: () => root.findAllByType("a").map((link) => link.props.href as string),
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
    page.type("email", "petra.kralova@example.com");
    await page.submit();
    expect(page.check).toHaveBeenCalledWith("petra.kralova@example.com");
    expect(page.heading()).toBe("Adding petra.kralova@example.com");
    page.type("first", "Petra");
    page.type("last", "Kralova");
    page.pickRole("Guest");
    page.addProjects({ "snap-prod": "full", "beviro-prod": "read" });
    await page.submit();
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
        { projectId: "snap-prod", roleCode: "ADMIN" },
        { projectId: "beviro-prod", roleCode: "READ_ONLY" },
      ],
    });
    expect(page.onSent).toHaveBeenCalled();
  });

  it("An address with a Zerops account is asked no name", async () => {
    const page = mount("OWNER", { check: async () => ({ kind: "existing", userId: "u-petra" }) });
    page.type("email", "petra.kralova@example.com");
    await page.submit();
    expect(page.hasField("first")).toBe(false);
    await page.submit();
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

  it("Someone on the team already is said so, with a way to their page", async () => {
    const page = mount("OWNER", {
      check: async () => ({ kind: "member", clientUserId: "cu-petra", roleCode: "NO_ACCESS" }),
    });
    page.type("email", "petra.kralova@example.com");
    await page.submit();
    expect(page.heading()).toBe("Already on the team");
    expect(page.links()).toEqual(["/settings/team/cu-petra"]);
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
    await page.submit();
    expect(page.alerts()).toEqual(["Only an organization owner or admin can invite."]);
    expect(page.heading()).toBe("Adding petra.kralova@example.com");
    expect(page.onSent).not.toHaveBeenCalled();
  });

  it("An address that isn't one is said so before Zerops is asked", async () => {
    const page = mount();
    page.type("email", "petra");
    await page.submit();
    expect(page.check).not.toHaveBeenCalled();
    expect(page.alerts()).toEqual(["That isn't an e-mail address."]);
  });
});
