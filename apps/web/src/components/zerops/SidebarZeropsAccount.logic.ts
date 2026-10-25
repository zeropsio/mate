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

import { zeropsRoleWords, type ZeropsOrganization } from "@t3tools/client-runtime/zerops";

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
 * What the viewer is in the organization the list shows — "Northwind · Owner" — under their name
 * at the top of the menu, one shape for every role; the name alone while no role is known.
 */
export function sidebarAccountRoleLine(organization: ZeropsOrganization | null): string | null {
  const name = organization?.name.trim();
  if (organization === null || name === undefined || name.length === 0) return null;
  const role = zeropsRoleWords(organization);
  return role === undefined ? name : `${name} · ${role}`;
}

/**
 * The foot's line under the viewer's name — "Acme · Owner" — in parts, the organization's name
 * its own; the name alone where the role is not known yet.
 */
export function sidebarAccountRoleParts(organization: ZeropsOrganization | null): {
  readonly before: string;
  readonly organization: string;
  readonly after: string;
} | null {
  const name = organization?.name.trim();
  if (organization === null || name === undefined || name.length === 0) return null;
  const role = zeropsRoleWords(organization);
  return { before: "", organization: name, after: role === undefined ? "" : ` · ${role}` };
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
  readonly id: "projects" | "git" | "usage" | "team" | "settings";
  readonly label: string;
  readonly to: string;
}

/**
 * The places the account menu opens.
 *
 * Ordered by how often a person goes there rather than by kind: the projects
 * screen is where a Mate is set up, Git is where a change is read, the team is
 * who works in the organization, and settings is the one nobody opens twice a day.
 */
export const SIDEBAR_ACCOUNT_DESTINATIONS: ReadonlyArray<SidebarAccountDestination> = [
  { id: "projects", label: "Overview", to: "/zerops" },
  { id: "git", label: "Git", to: "/git" },
  { id: "usage", label: "Usage", to: "/usage" },
  { id: "team", label: "Team", to: "/settings/team" },
  { id: "settings", label: "Settings", to: "/settings" },
];

/**
 * Where a switch from organization `from` to `to` goes from `pathname`: a page of the organization
 * left behind — a conversation, a change, a Mate — is not in the new one's projects, so the switch
 * lands on the home, as a fresh visit would; the account's own pages read the new organization in
 * place, and so does the home. Null: stay. A link opened to another organization's page still says
 * it is not in the person's projects; only the switch moves.
 */
export function organizationSwitchLanding(input: {
  readonly pathname: string;
  readonly from: string | undefined;
  readonly to: string;
}): "/" | null {
  if (input.to === input.from || input.pathname === "/") return null;
  return sidebarAccountDestinationOf(input.pathname) === null ? "/" : null;
}

/** Which destination a path is inside, so the menu can light it. */
export function sidebarAccountDestinationOf(
  pathname: string,
): SidebarAccountDestination["id"] | null {
  if (/^\/settings\/team(?:\/|$)/.test(pathname)) return "team";
  if (/^\/settings(?:\/|$)/.test(pathname)) return "settings";
  if (pathname === "/usage") return "usage";
  if (pathname === "/git") return "git";
  if (pathname === "/zerops") return "projects";
  return null;
}
