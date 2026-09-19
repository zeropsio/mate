/**
 * What the menu's foot says about the account, and what it offers.
 *
 * The foot is the one place the client states whose work this is and which
 * organization's projects are listed above it — a fact the menu never carried
 * before, although the organization decides every row in it.
 *
 * Nothing here invents a value. An organization still being resolved is
 * absent rather than a placeholder, because the foot must paint nothing a
 * moment later takes back.
 */

import type { ZeropsOrganization } from "@t3tools/client-runtime/zerops";

export interface SidebarAccountLines {
  /** The person, as the bar already says them elsewhere. */
  readonly name: string;
  /** The organization the rows above belong to; `null` until one is known. */
  readonly organization: string | null;
}

export function sidebarAccountLines(input: {
  readonly name: string;
  readonly organization: ZeropsOrganization | null;
}): SidebarAccountLines {
  const organization = input.organization?.name.trim();
  return {
    name: input.name,
    organization: organization !== undefined && organization.length > 0 ? organization : null,
  };
}

/**
 * The organizations the foot offers.
 *
 * A single membership used to be dropped on the grounds that one organization
 * is a fact rather than a decision. But the row that opens this menu names the
 * organization and wears the two-way chevron, which promises somewhere to go —
 * and the menu then had no organization in it at all (the owner, 2026-09-19:
 * "this should include org switcher"). An affordance that leads nowhere is
 * worse than a row that confirms where you are.
 *
 * So every membership is listed, and the current one is the checked row. Only
 * an account whose memberships have not been read yet offers nothing, because
 * a list of one that is about to be a list of three is a lie with a shorter
 * life.
 */
export function sidebarAccountOrganizationChoices(
  organizations: ReadonlyArray<ZeropsOrganization>,
): ReadonlyArray<ZeropsOrganization> {
  return organizations;
}

/** One destination the foot folds away, in the order the menu lists them. */
export interface SidebarAccountDestination {
  readonly id: "projects" | "gitea" | "usage" | "settings";
  readonly label: string;
  readonly to: string;
}

/**
 * The four places the foot used to spend a glyph each on.
 *
 * Ordered by how often a person goes there rather than by kind: the projects
 * screen is where a Mate is set up, Gitea is where a change is read, and
 * settings is the one nobody opens twice a day.
 */
export const SIDEBAR_ACCOUNT_DESTINATIONS: ReadonlyArray<SidebarAccountDestination> = [
  { id: "projects", label: "Projects", to: "/zerops" },
  { id: "gitea", label: "Git", to: "/gitea" },
  { id: "usage", label: "Usage", to: "/usage" },
  { id: "settings", label: "Settings", to: "/settings" },
];

/** Which destination a path is inside, so the menu can light it. */
export function sidebarAccountDestinationOf(
  pathname: string,
): SidebarAccountDestination["id"] | null {
  if (/^\/settings(?:\/|$)/.test(pathname)) return "settings";
  if (pathname === "/usage") return "usage";
  if (pathname === "/gitea") return "gitea";
  if (pathname === "/zerops") return "projects";
  return null;
}
