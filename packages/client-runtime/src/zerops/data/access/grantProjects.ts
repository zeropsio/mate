/**
 * Which projects a grant's evidence admits, read by both the account's inventory demand and the
 * environments' listings — kept below both, in the access layer, so neither depends on the other.
 */
import type { Evidence } from "./grant.ts";
import { projectKeyOf, type AccessState, type ProjectRef } from "../types.ts";

/**
 * The projects admitted evidence names: verified ones, and those whose latest read failed. A
 * denial is the only way a project leaves. One only an organization's list has named joins once
 * its own read has answered.
 */
export function evidenceProjectRefs(evidence: Evidence | null): ReadonlyArray<ProjectRef> {
  if (evidence === null) return [];
  const refs = new Map<string, ProjectRef>();
  for (const { access } of evidence.projects.values()) {
    if (access.role !== "NO_ACCESS") refs.set(projectKeyOf(access.project), access.project);
  }
  for (const { project, failure } of evidence.unverified.values()) {
    // A project only a list has named waits for its own read: one still being created or
    // deleted is never registered for before the platform has answered for it.
    if (failure === null) continue;
    if (!evidence.projects.has(project.projectId)) refs.set(projectKeyOf(project), project);
  }
  return [...refs.values()];
}

/**
 * The roles a command established since the evidence's round: the grant's verified projects, or —
 * while it is verified again, or its read failed — the ones it held before. An expired or denied
 * grant establishes nothing; the evidence decides.
 */
function establishedRoles(access: AccessState | undefined): ReadonlyArray<{
  readonly project: ProjectRef;
  readonly role: string;
}> {
  return access?.status === "verified"
    ? access.projects
    : access?.status === "verifying" || access?.status === "failed"
      ? (access.previous?.projects ?? [])
      : [];
}

/**
 * Evidence projects plus those a command established since, from the runtime's grant; one a
 * command established NO_ACCESS on leaves (`projectsNeverSeen` reads the same rule).
 */
export function inventoryProjectRefs(
  granted: ReadonlyArray<ProjectRef>,
  access: AccessState | undefined,
): ReadonlyArray<ProjectRef> {
  const refs = new Map(granted.map((ref) => [projectKeyOf(ref), ref]));
  for (const { project: ref, role } of establishedRoles(access)) {
    if (role === "NO_ACCESS") refs.delete(projectKeyOf(ref));
    else refs.set(projectKeyOf(ref), ref);
  }
  return [...refs.values()];
}

/**
 * Which projects this person can never see: the grant withholds them, they were denied, or their
 * role is NO_ACCESS — as a command established it since, else as the evidence's round
 * verified it. The inventory admits by the same rule (`inventoryProjectRefs`), so a listing never
 * counts as never seen a project the inventory reads. One only named so far, or whose read
 * failed, is still on its way.
 */
export function projectsNeverSeen(input: {
  readonly evidence: Evidence | null;
  readonly access: AccessState | undefined;
  /** The grant withholds the project from this account (`ScopeAuthority` withheld). */
  readonly withheld?: (projectId: string) => boolean;
}): (projectId: string) => boolean {
  const roles = new Map<string, string>();
  for (const [projectId, { access }] of input.evidence?.projects ?? []) {
    roles.set(projectId, access.role);
  }
  for (const { project, role } of establishedRoles(input.access)) {
    roles.set(project.projectId, role);
  }
  const denied = new Set<string>(input.evidence?.closedProjects.keys() ?? []);
  return (projectId) =>
    roles.get(projectId) === "NO_ACCESS" ||
    denied.has(projectId) ||
    input.withheld?.(projectId) === true;
}
