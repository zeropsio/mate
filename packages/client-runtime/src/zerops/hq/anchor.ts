/**
 * Which HQ is the organization's official one, as every member can read it (SPEC §3.3).
 *
 * An org Admin or Owner marks the official HQ with its **anchor**: an integration token with the
 * org role Admin, named `mate-hq:<projectId>:<address>`, its value dropped the moment it is
 * minted. The org's member list carries every token as a member, with its name and role, to every
 * member — a Developer included — while the token list does not (T0 §2). So the anchor is read off
 * `GET /client/{org}/user/list`, never off the token list.
 *
 * The verdict mirrors Core's own (`apps/hq/src/official.ts`): a name below Admin is no anchor;
 * Admin names that point at two projects make none of them official, and nothing is born over
 * them; the official one is the project an active Admin token names.
 *
 * Pure: no network (rule R1).
 *
 * @module hq/anchor
 */
import type { ZeropsOrganizationMember } from "../api.ts";

const ANCHOR_PREFIX = "mate-hq:";

/** A member row is a token when its address is the token's own (`token-<id>@zerops.io`). */
const TOKEN_EMAIL = /^token-[^@]+@zerops\.io$/iu;

/** The anchor's name: what Core reads to know it is the official HQ. */
export function hqAnchorName(projectId: string, address: string): string {
  return `${ANCHOR_PREFIX}${projectId}:${address}`;
}

/** Core's working credential, by name: org Read only, no grant (`HQ_ORG_TOKEN`). */
export function hqOrgTokenName(projectId: string): string {
  return `mate-hq-org:${projectId}`;
}

export type OfficialHq =
  /** No Admin member names an HQ: an org owner or admin may set one up. */
  | { readonly kind: "none" }
  | { readonly kind: "official"; readonly projectId: string; readonly address: string }
  /** Admin names point at more than one project, or none of them is an active token yet. */
  | { readonly kind: "unclear"; readonly projectIds: ReadonlyArray<string> };

/** `<projectId>` and `<address>` of an anchor name; the address holds `:` itself. */
function parseAnchor(name: string): { readonly projectId: string; readonly address: string } {
  const rest = name.slice(ANCHOR_PREFIX.length);
  const split = rest.indexOf(":");
  return split < 0
    ? { projectId: rest, address: "" }
    : { projectId: rest.slice(0, split), address: rest.slice(split + 1).replace(/\/+$/u, "") };
}

export function findOfficialHq(members: ReadonlyArray<ZeropsOrganizationMember>): OfficialHq {
  const anchors = members.flatMap((member) => {
    const name = member.user?.fullName ?? "";
    return member.roleCode === "ADMIN" && name.startsWith(ANCHOR_PREFIX)
      ? [{ member, ...parseAnchor(name) }]
      : [];
  });
  if (anchors.length === 0) return { kind: "none" };
  const projectIds = [...new Set(anchors.map((anchor) => anchor.projectId))].sort();
  const active = anchors.find(
    (anchor) =>
      anchor.member.status === "ACTIVE" &&
      TOKEN_EMAIL.test(anchor.member.user?.email ?? "") &&
      anchor.address.length > 0,
  );
  if (projectIds.length > 1 || active === undefined) return { kind: "unclear", projectIds };
  return { kind: "official", projectId: active.projectId, address: active.address };
}

/**
 * The org's owners and admins who are people, active: who sets an HQ up, and whom a Developer in
 * an organization with none is told to ask.
 */
export function ownersAndAdmins(
  members: ReadonlyArray<ZeropsOrganizationMember>,
): ReadonlyArray<ZeropsOrganizationMember> {
  return members.filter(
    (member) =>
      (member.roleCode === "OWNER" || member.roleCode === "ADMIN") &&
      member.status === "ACTIVE" &&
      !TOKEN_EMAIL.test(member.user?.email ?? ""),
  );
}
