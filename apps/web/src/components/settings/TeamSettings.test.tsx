// @vitest-environment happy-dom
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { TeamList } from "./TeamSettings";
import { teamPeople, type TeamInput } from "./teamSettings.logic";

vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual<typeof import("@tanstack/react-router")>()),
  Link: ({
    children,
    params,
    to,
  }: {
    readonly children?: ReactNode;
    readonly params: { readonly groupId: string };
    readonly to: string;
  }) => <a href={to.replace("$groupId", params.groupId)}>{children}</a>,
  useNavigate: () => () => {},
}));

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

const TEAM = [
  member("ada", "Ada Owner", "OWNER"),
  member("al", "Al Admin", "ADMIN"),
  member("bob", "Bob Guest", "NO_ACCESS"),
  member("iva", "Iva Invited", "NO_ACCESS", { status: "WAITING_AUTHORIZATION" }),
  {
    id: "cu-token",
    status: "ACTIVE",
    roleCode: "BASIC_USER",
    user: { id: "t", email: "token-abc@zerops.io" },
  },
];

const input = (viewer?: TeamInput["viewer"], viewerUserId = "ada"): TeamInput => ({
  members: { known: true, status: "ready", refused: false, list: TEAM },
  grants: {
    "cu-bob": { status: "ready", value: [{ projectId: "snap-prod", roleCode: "READ_ONLY" }] },
  },
  places: { "snap-prod": { key: "g-snap", name: "Snap", groupId: "g-snap" } },
  pictures: {},
  viewerUserId,
  viewer,
});

/** The page as a person reads it: the count, each row's lines and menu, and the invitation. */
function drawn(viewer?: TeamInput["viewer"], viewerUserId?: string) {
  const markup = renderToStaticMarkup(
    <TeamList
      onEnd={() => {}}
      onInvite={() => {}}
      onRole={() => {}}
      organizationName="Acme"
      view={teamPeople(input(viewer, viewerUserId))}
    />,
  );
  const body = new DOMParser().parseFromString(markup, "text/html").body;
  return {
    heading: body.querySelector("h2")?.parentElement?.textContent,
    rows: [...body.querySelectorAll("li")].map((row) => ({
      name: row.querySelector(".ov-mate-name")?.textContent,
      line: row.querySelector(".ov-mate-l2")?.textContent,
      pending: row.hasAttribute("data-pending"),
      menu: row.querySelector('[aria-label$="\'s role"]') !== null,
      links: [...row.querySelectorAll("a")].map((link) => link.getAttribute("href")),
    })),
    invite: body.querySelector('[data-zerops-surface="invite-team"]') !== null,
  };
}

describe("the organization's team", () => {
  it("Everyone in the organization is a row, never a token: who, their role, what they reach", () => {
    const page = drawn();
    expect(page.heading).toBe("Team4 people");
    expect(page.rows.map(({ name, line }) => [name, line])).toEqual([
      ["Ada Owner", "Owner · everything"],
      ["Al Admin", "Admin · everything"],
      ["Bob Guest", "Guest · on Snap"],
      ["Iva Invited", "Invited · not joined yet · Guest"],
    ]);
  });

  it("A person's project leads to that project's page", () => {
    expect(drawn().rows.find(({ name }) => name === "Bob Guest")?.links).toEqual([
      "/group/g-snap/flow",
    ]);
  });

  it("An invitation not joined yet is dimmed", () => {
    expect(drawn().rows.map(({ pending }) => pending)).toEqual([false, false, false, true]);
  });

  it.each([
    {
      sentence: "An owner invites, and finds a menu on everyone but themselves",
      viewer: { roleCode: "OWNER", membershipId: "cu-ada" },
      who: "ada",
      invite: true,
      menus: { "Ada Owner": false, "Al Admin": true, "Bob Guest": true, "Iva Invited": true },
    },
    {
      sentence: "An admin invites, and finds no menu on an owner or an admin",
      viewer: { roleCode: "ADMIN", membershipId: "cu-al" },
      who: "al",
      invite: true,
      menus: { "Ada Owner": false, "Al Admin": false, "Bob Guest": true, "Iva Invited": true },
    },
    {
      sentence: "A guest neither invites nor finds a menu",
      viewer: { roleCode: "NO_ACCESS", membershipId: "cu-bob" },
      who: "bob",
      invite: false,
      menus: { "Ada Owner": false, "Al Admin": false, "Bob Guest": false, "Iva Invited": false },
    },
    {
      sentence: "Nobody is invited or changed while the viewer's role is not known",
      viewer: undefined,
      who: "ada",
      invite: false,
      menus: { "Ada Owner": false, "Al Admin": false, "Bob Guest": false, "Iva Invited": false },
    },
  ])("$sentence", ({ viewer, who, invite, menus }) => {
    const page = drawn(viewer, who);
    expect(page.invite).toBe(invite);
    expect(Object.fromEntries(page.rows.map(({ name, menu }) => [name, menu]))).toEqual(menus);
  });
});
