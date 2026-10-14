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
    params = {},
    to,
    ...rest
  }: {
    readonly children?: ReactNode;
    readonly params?: Readonly<Record<string, string>>;
    readonly to: string;
  }) => (
    <a href={to.replace(/\$(\w+)/g, (_, key: string) => params[key] ?? "")} {...rest}>
      {children}
    </a>
  ),
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

/** The page as a person reads it: the count, each card's parts and where it leads, Invite. */
function drawn(viewer?: TeamInput["viewer"], viewerUserId?: string) {
  const markup = renderToStaticMarkup(<TeamList view={teamPeople(input(viewer, viewerUserId))} />);
  const body = new DOMParser().parseFromString(markup, "text/html").body;
  const part = (card: Element, name: string) =>
    card.querySelector(`[data-part="${name}"]`)?.textContent ?? null;
  return {
    heading: body.querySelector("h2")?.parentElement?.textContent,
    cards: [...body.querySelectorAll("ul[aria-label=People] > li > a")].map((card) => ({
      name: part(card, "name"),
      role: part(card, "role"),
      email: part(card, "email"),
      pending: card.hasAttribute("data-pending"),
      href: card.getAttribute("href"),
    })),
    invite: body.querySelector('[data-zerops-surface="invite-team"]') !== null,
  };
}

describe("the organization's team", () => {
  it("Everyone in the organization is a card, never a token: their name, role and e-mail", () => {
    const page = drawn();
    expect(page.heading).toBe("Team4 people");
    expect(page.cards.map(({ name, role, email }) => [name, role, email])).toEqual([
      ["Ada Owner", "Owner", "ada@example.com"],
      ["Al Admin", "Admin", "al@example.com"],
      ["Bob Guest", "Guest", "bob@example.com"],
      ["Iva Invited", "Guest", "iva@example.com"],
    ]);
  });

  it("A card opens that person's own page", () => {
    expect(drawn().cards.map(({ href }) => href)).toEqual([
      "/settings/team/cu-ada",
      "/settings/team/cu-al",
      "/settings/team/cu-bob",
      "/settings/team/cu-iva",
    ]);
  });

  it("An invitation not joined yet is dimmed", () => {
    expect(drawn().cards.map(({ pending }) => pending)).toEqual([false, false, false, true]);
  });

  it.each([
    { sentence: "An owner finds Invite beside the search", viewer: "OWNER", invite: true },
    { sentence: "An admin finds Invite beside the search", viewer: "ADMIN", invite: true },
    { sentence: "A guest finds no Invite", viewer: "NO_ACCESS", invite: false },
    {
      sentence: "Nobody is invited or changed while the viewer's role is not known",
      viewer: undefined,
      invite: false,
    },
  ])("$sentence", ({ viewer, invite }) => {
    expect(
      drawn(viewer === undefined ? undefined : { roleCode: viewer, membershipId: "cu-x" }).invite,
    ).toBe(invite);
  });
});
