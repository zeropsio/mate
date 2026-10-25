/**
 * Zerops-native capabilities: one derivation for controls and operation admission. Every surface
 * that offers a verb by the viewer's role reads it here, so the menu, the overview and a dialog
 * never disagree about what a role may do, and an offered control is one its write admits.
 *
 * - `membershipKnown` — the viewer's membership in the organization is read: until it is, a
 *   capability that reads `false` is not a refusal, and a control already drawn stays drawn.
 * - `createProject` — Zerops' own *can create projects* (`mayCreateProjects`): New project.
 * - `setUpChief` — a Chief is a new project an Owner or Admin marks as the organization's (HQ's
 *   `not_structure_writer` otherwise), so it takes `createProject` and `manageOrganization`.
 * - `reachesEveryProject` — the organization role reaches every project by itself (Read only or
 *   above); below it, a person sees only the projects they are given.
 * - `manageOrganization` — an owner or an admin: the team, and who has access to what.
 * - `editFinances` — an owner, or a member Zerops lets edit finances: the organization's billing,
 *   its credit included.
 * - `read`, `operate`, `administer` — the viewer's effective role on `projectId`, and
 *   `projectAccessKnown` whether that project's access is read: until it is, `false` is no refusal.
 */
import { mayCreateProjects, roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { zeropsClientsFromUser, type ZeropsOrganization } from "../../zerops/api.ts";
import type { Projection } from "../store.ts";
import { platformAccess } from "./platformAccess.ts";
import { sameValue } from "./equal.ts";

export interface PlatformMembership {
  readonly kind: "known" | "unavailable";
  readonly viewer: ZeropsOrganization | undefined;
}
export const platformMembership: Projection<string, PlatformMembership> = {
  name: "platformMembership",
  keyOf: (id) => id,
  derive: (read, orgId) => {
    const fact = read.fact("organizationUser", orgId);
    if (fact.kind !== "known") return { kind: "unavailable", viewer: undefined };
    return {
      kind: "known",
      viewer: zeropsClientsFromUser(fact.value).find((org) => org.id === orgId),
    };
  },
  equals: sameValue,
};
/**
 * Whose membership the capabilities read: the organization's membership as read, else the one the
 * signed-in session last knew for this organization (its identity), so a reload paints from the
 * role the person last had and takes nothing back once the read lands. A remembered membership
 * without a role is no evidence; the read always outranks it.
 */
export function platformViewer(input: {
  readonly orgId: string;
  readonly read: ZeropsOrganization | undefined;
  readonly lastKnown: ZeropsOrganization | null | undefined;
}): ZeropsOrganization | undefined {
  if (input.read !== undefined) return input.read;
  const lastKnown = input.lastKnown;
  return lastKnown?.id === input.orgId && lastKnown.roleCode !== undefined ? lastKnown : undefined;
}
export interface PlatformCapabilitiesKey {
  readonly orgId: string;
  readonly projectId?: string | undefined;
  readonly viewer: ZeropsOrganization | undefined;
}
export interface PlatformCapabilities {
  readonly membershipKnown: boolean;
  readonly createProject: boolean;
  readonly setUpChief: boolean;
  readonly reachesEveryProject: boolean;
  readonly manageOrganization: boolean;
  readonly editFinances: boolean;
  readonly projectAccessKnown: boolean;
  readonly read: boolean;
  readonly operate: boolean;
  readonly administer: boolean;
}
export const platformCapabilities: Projection<PlatformCapabilitiesKey, PlatformCapabilities> = {
  name: "platformCapabilities",
  keyOf: (key) => JSON.stringify(key),
  derive: (read, { orgId, projectId, viewer }) => {
    const access =
      projectId === undefined
        ? undefined
        : platformAccess.derive(read, { orgId, projectId, viewer });
    const role = access?.kind === "allowed" ? access.role : undefined;
    const member = viewer !== undefined && viewer.id === orgId ? viewer : undefined;
    const createProject = member !== undefined && mayCreateProjects(member);
    const manageOrganization = member !== undefined && roleAtLeast(member.roleCode, "ADMIN");
    return {
      membershipKnown: member !== undefined,
      createProject,
      setUpChief: createProject && manageOrganization,
      reachesEveryProject: member !== undefined && roleAtLeast(member.roleCode, "READ_ONLY"),
      manageOrganization,
      editFinances:
        member !== undefined && (member.roleCode === "OWNER" || member.canEditFinances === true),
      projectAccessKnown: access !== undefined && access.kind !== "unknown",
      read: roleAtLeast(role, "READ_ONLY"),
      operate: roleAtLeast(role, "BASIC_USER"),
      administer: roleAtLeast(role, "ADMIN"),
    };
  },
  equals: sameValue,
};

/**
 * What the organization's own surfaces offer by the viewer's role — the menu's +, the overview's
 * header, an empty organization's first screen, the Chief's row: a verb the role is known to
 * forbid is not offered at all, and while the membership is not read what is drawn stays drawn,
 * so a reload takes nothing back from a role that may.
 */
export function roleOffers(
  capabilities: Pick<PlatformCapabilities, "membershipKnown" | "createProject" | "setUpChief">,
): { readonly newProject: boolean; readonly setUpChief: boolean } {
  const unknown = !capabilities.membershipKnown;
  return {
    newProject: unknown || capabilities.createProject,
    setUpChief: unknown || capabilities.setUpChief,
  };
}

/**
 * Whether the viewer brings people into the organization — Invite on the team page and on a
 * project's ···: only an owner or an admin, whom Zerops lets invite. While the membership is not
 * read, what is drawn stays drawn, as with `roleOffers`.
 */
export function teamOffers(
  capabilities: Pick<PlatformCapabilities, "membershipKnown" | "manageOrganization">,
): { readonly invite: boolean } {
  return { invite: !capabilities.membershipKnown || capabilities.manageOrganization };
}

/**
 * Whether the organization's credit is the viewer's to add in HQ: only for someone who may edit
 * its finances; anyone else asks an owner. While the membership is not read, what is drawn stays
 * drawn, as with `roleOffers`.
 */
export function creditOffers(
  capabilities: Pick<PlatformCapabilities, "membershipKnown" | "editFinances">,
): { readonly addCredit: boolean } {
  return { addCredit: !capabilities.membershipKnown || capabilities.editFinances };
}

/**
 * What a project's own surfaces offer by the viewer's role there: its addresses to manage — a
 * domain of its own, its public access — only where the role operates it (Basic user or Full);
 * Read access shows the addresses and offers no door that a write would refuse. While the project's
 * access is not read, its doors stay drawn.
 */
export function projectRoleOffers(
  capabilities: Pick<PlatformCapabilities, "projectAccessKnown" | "operate">,
): { readonly manageAddresses: boolean } {
  return { manageAddresses: !capabilities.projectAccessKnown || capabilities.operate };
}
