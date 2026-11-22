/**
 * A person's access to one app (an HQ group of Zerops projects), in the two levels Mate offers:
 * **work** — full access to every place the app runs (production, stages, the Mate serving as
 * stage) and its other Mates to look at — or **look** — read only on all of them. Removing someone
 * shuts the app's projects to them; withdrawing an invitation does the same, and ends the
 * invitation once it opens nothing else.
 *
 * Zerops grants per project: the organization role, unless the member's own list names the project,
 * which wins in both directions. A Mate the member owns is theirs and is judged by neither level.
 * Changing a level is HQ's operation, planned there from its own read.
 *
 * Pure: the member's grants, their role and the app's projects arrive read.
 *
 * @module zerops/appAccess
 */
import { asOrgRole, projectReach, roleAtLeast } from "@t3tools/shared/zeropsRoles";

export type AppAccessLevel = "work" | "look";

export interface AppProjects {
  /** Production, stages and the Mate serving as stage: where the app runs. */
  readonly places: ReadonlyArray<string>;
  /** The app's other Mates. */
  readonly mates: ReadonlyArray<string>;
}

/** One entry of a member's own list, as `GET /client-user/{id}/roles` names it. */
export interface ProjectGrantEntry {
  readonly projectId: string;
  readonly roleCode: string;
}

/**
 * The level a member has on the app now — judged on its places, or on its Mates where it has none —
 * or `null` where it is neither (some places one way, some another, or none at all).
 */
export function appAccessLevel(input: {
  readonly orgRole: string | undefined;
  /** The member's own grant on a project, where they have one. */
  readonly grantOf: (projectId: string) => string | undefined;
  readonly projects: AppProjects;
  readonly owned: ReadonlyArray<string>;
}): AppAccessLevel | null {
  const role = asOrgRole(input.orgRole);
  const judged = (ids: ReadonlyArray<string>) =>
    ids.filter((id) => !input.owned.includes(id) && input.grantOf(id) !== "OWNER");
  const places = judged(input.projects.places);
  const considered = places.length > 0 ? places : judged(input.projects.mates);
  if (considered.length === 0) return null;
  const reaches = considered.map((id) => projectReach(input.grantOf(id) ?? role));
  if (reaches.every((one) => one === "work" || one === "administer")) return "work";
  if (reaches.every((one) => one === "read")) return "look";
  return null;
}

/**
 * What the viewer may do to a member's access to an app: choose their level, and remove them — or,
 * for an invitation not joined yet, withdraw it. `null` where they may do neither. Only an owner or
 * an admin of the organization changes access (Zerops refuses everyone else); an owner's or an
 * admin's role gives them everything, so theirs is never changed here — and nobody changes their
 * own.
 */
export function appAccessActions(input: {
  readonly viewer: { readonly roleCode?: string; readonly membershipId: string } | undefined;
  readonly member: { readonly id: string; readonly roleCode?: string; readonly pending: boolean };
}): { readonly end: "remove" | "withdraw" } | null {
  const { viewer, member } = input;
  if (viewer === undefined || !roleAtLeast(viewer.roleCode, "ADMIN")) return null;
  if (member.id === viewer.membershipId || roleAtLeast(member.roleCode, "ADMIN")) return null;
  return { end: member.pending ? "withdraw" : "remove" };
}
