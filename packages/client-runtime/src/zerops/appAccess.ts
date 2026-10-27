/**
 * A person's access to one app (an HQ group of Zerops projects), in the two levels Mate offers:
 * **work** — full access to every place the app runs (production, stages, the Mate serving as
 * stage) and its other Mates to look at — or **look** — read only on all of them. Removing someone
 * shuts the app's projects to them; withdrawing an invitation does the same, and ends the
 * invitation once it opens nothing else.
 *
 * Zerops grants per project: the organization role, unless the member's own list names the project
 * (`PUT /client-user/{id}/roles`), which wins in both directions. That list is replaced whole, so a
 * write here is the member's current list with this app's projects changed and every other
 * project's grant kept (measured 2026-10-14). A grant the organization role already gives is
 * dropped rather than written. A Mate the member owns is theirs: never touched here.
 *
 * Pure: the member's list, their role and the app's projects arrive read.
 *
 * @module zerops/appAccess
 */
import { asOrgRole, roleAtLeast, type ZeropsOrgRole } from "@t3tools/shared/zeropsRoles";

export type AppAccessLevel = "work" | "look";

/** A level, or the way out: `remove` for a member, `withdraw` for an invitation not joined yet. */
export type AppAccessChange = AppAccessLevel | "remove" | "withdraw";

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

export interface AppGrantPlan {
  /** The member's whole list to write: every project outside the app kept, in its place. */
  readonly list: ReadonlyArray<ProjectGrantEntry>;
  /** What each changed project of the app comes to hold for the member; `null` for no grant. */
  readonly touched: ReadonlyArray<{ readonly projectId: string; readonly roleCode: string | null }>;
  /** Whether the list differs from the one held. */
  readonly changed: boolean;
  /** An invitation withdrawn that opens nothing any more: the membership itself goes. */
  readonly dropMembership: boolean;
}

/** Whether `projectId` is the member's own, so nothing here may change it. */
const ownedBy = (
  owned: ReadonlyArray<string>,
  held: ReadonlyMap<string, string>,
  projectId: string,
) => owned.includes(projectId) || held.get(projectId) === "OWNER";

/** The role a project of the app is to hold for the member; `undefined` to leave it as it is. */
function targetOf(
  change: AppAccessChange,
  place: boolean,
  effective: ZeropsOrgRole,
): ZeropsOrgRole | undefined {
  switch (change) {
    case "work":
      // Someone's Mate to look at: whatever they have there already reaches that far.
      return place ? "BASIC_USER" : roleAtLeast(effective, "READ_ONLY") ? undefined : "READ_ONLY";
    case "look":
      return "READ_ONLY";
    case "remove":
    case "withdraw":
      return "NO_ACCESS";
  }
}

export function planAppGrants(input: {
  readonly current: ReadonlyArray<ProjectGrantEntry>;
  readonly orgRole: string | undefined;
  readonly projects: AppProjects;
  /** The app's Mates the member owns, as HQ names their owners. */
  readonly owned: ReadonlyArray<string>;
  readonly change: AppAccessChange;
}): AppGrantPlan {
  const role = asOrgRole(input.orgRole);
  const held = new Map(input.current.map(({ projectId, roleCode }) => [projectId, roleCode]));
  const touched: Array<{ projectId: string; roleCode: string | null }> = [];
  const each = (projectId: string, place: boolean) => {
    if (ownedBy(input.owned, held, projectId)) return;
    const was = held.get(projectId);
    const target = targetOf(input.change, place, asOrgRole(was ?? role));
    if (target === undefined) return;
    const grant = target === role ? null : target;
    if (grant === (was ?? null)) return;
    touched.push({ projectId, roleCode: grant });
  };
  for (const projectId of input.projects.places) each(projectId, true);
  for (const projectId of input.projects.mates) each(projectId, false);

  const next = new Map(touched.map(({ projectId, roleCode }) => [projectId, roleCode]));
  const list = [
    ...input.current.flatMap((entry): Array<ProjectGrantEntry> => {
      if (!next.has(entry.projectId))
        return [{ projectId: entry.projectId, roleCode: entry.roleCode }];
      const roleCode = next.get(entry.projectId);
      return roleCode == null ? [] : [{ projectId: entry.projectId, roleCode }];
    }),
    ...touched.flatMap(({ projectId, roleCode }) =>
      held.has(projectId) || roleCode === null ? [] : [{ projectId, roleCode }],
    ),
  ];
  return {
    list,
    touched,
    changed: touched.length > 0,
    dropMembership:
      input.change === "withdraw" &&
      role === "NO_ACCESS" &&
      list.every(({ roleCode }) => asOrgRole(roleCode) === "NO_ACCESS"),
  };
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
  const roles = considered.map((id) => asOrgRole(input.grantOf(id) ?? role));
  if (roles.every((one) => roleAtLeast(one, "BASIC_USER"))) return "work";
  if (roles.every((one) => one === "READ_ONLY")) return "look";
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
