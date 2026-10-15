// @vitest-environment happy-dom
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { TeamMemberView, type TeamMemberActions } from "./TeamMemberPage";
import type { AccessDraft } from "./teamMember.logic";
import { teamPeople, type TeamPerson } from "./teamSettings.logic";

vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to }: { readonly children?: ReactNode; readonly to: string }) => (
    <a href={to}>{children}</a>
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
  member("petra", "Petra Kralova", "OWNER"),
  member("ota", "Ota Benes", "ADMIN"),
  member("zora", "Zora Mala", "NO_ACCESS", { canCreateProjects: true }),
  member("ivo", "Ivo Novy", "NO_ACCESS", { status: "WAITING_AUTHORIZATION" }),
];

const PROJECTS = [
  { projectId: "snap-prod", label: "Snap · production" },
  { projectId: "snap-stage", label: "Snap · stage" },
  { projectId: "beviro-prod", label: "Beviro · production" },
];

const ACTIONS: TeamMemberActions = {
  updateMembership: async () => {},
  saveAccess: async () => {},
  remove: async () => {},
};

/** One person's page as `viewer` reads it. */
function page(
  who: string,
  viewer: { readonly roleCode: string; readonly id: string },
  grants: AccessDraft | null = {},
) {
  const view = teamPeople({
    members: { known: true, status: "ready", refused: false, list: TEAM },
    grants: {},
    places: {},
    pictures: {},
    viewerUserId: viewer.id,
    viewer: { roleCode: viewer.roleCode, membershipId: `cu-${viewer.id}` },
  });
  const person = (view.kind === "people" ? view.people : []).find(
    ({ key }) => key === `cu-${who}`,
  ) as TeamPerson;
  const body = new DOMParser().parseFromString(
    renderToStaticMarkup(
      <TeamMemberView
        actions={ACTIONS}
        grants={grants}
        organizationName="Acme"
        person={person}
        projects={PROJECTS}
        viewerRole={viewer.roleCode}
      />,
    ),
    "text/html",
  ).body;
  const buttons = [...body.querySelectorAll("button")];
  const button = (words: string) => buttons.find((one) => one.textContent?.includes(words));
  return {
    head: body.querySelector("header")?.textContent,
    cards: [...body.querySelectorAll('[role="radio"]')].map((card) => ({
      name: card.querySelector(".tm-role-card-name")?.textContent,
      lit: card.getAttribute("aria-checked") === "true",
      disabled: card.hasAttribute("disabled"),
    })),
    update: button("Update user"),
    chips: [...body.querySelectorAll('ul[aria-label="Their projects"] > li.ov-chip')].map((chip) =>
      [...chip.querySelectorAll("[data-part]")].map((part) => part.textContent),
    ),
    setCustom: body.querySelector('[data-zerops-surface="set-custom-access"]') !== null,
    save: button("Save project access"),
    danger: button("Remove from Acme") ?? button("Withdraw invite"),
  };
}

const OWNER = { roleCode: "OWNER", id: "petra" };
const ADMIN = { roleCode: "ADMIN", id: "ota" };

describe("a person's own page", () => {
  it("Their face, name and e-mail head the page", () => {
    expect(page("zora", OWNER).head).toBe("ZMZora Malazora@example.com");
  });

  it("Their role is four cards in legacy's order, theirs lit; Update waits until something changed", () => {
    const shown = page("zora", OWNER);
    expect(shown.cards.map(({ name, lit }) => [name, lit])).toEqual([
      ["Owner", false],
      ["Admin", false],
      ["Developer", true],
      ["Guest", false],
    ]);
    expect(shown.update?.hasAttribute("disabled")).toBe(true);
  });

  it("An admin can't give Owner or Admin: those cards are disabled", () => {
    expect(page("zora", ADMIN).cards.map(({ disabled }) => disabled)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("Their own grants are project chips by Mate names, then Choose projects", () => {
    const shown = page("zora", OWNER, { "snap-prod": "ADMIN", "snap-stage": "READ_ONLY" });
    expect(shown.chips).toEqual([
      ["Snap · production", "Full"],
      ["Snap · stage", "Read"],
    ]);
    expect(shown.setCustom).toBe(true);
    expect(shown.save?.hasAttribute("disabled")).toBe(true);
  });

  it("An admin looking at an owner reads the page with no control", () => {
    const shown = page("petra", ADMIN);
    expect(shown.cards.every(({ disabled }) => disabled)).toBe(true);
    expect([shown.update, shown.save, shown.danger, shown.setCustom]).toEqual([
      undefined,
      undefined,
      undefined,
      false,
    ]);
  });

  it("An admin's own page changes no role and offers no danger zone, but keeps their project access", () => {
    const shown = page("ota", ADMIN);
    expect([shown.update, shown.danger]).toEqual([undefined, undefined]);
    expect(shown.save).toBeDefined();
  });

  it.each([
    { sentence: "A member's danger zone removes them", who: "zora", words: "Remove from Acme" },
    { sentence: "An invitation's danger zone withdraws it", who: "ivo", words: "Withdraw invite" },
  ])("$sentence", ({ who, words }) => {
    expect(page(who, OWNER).danger?.textContent).toBe(words);
  });
});
