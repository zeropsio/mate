/**
 * Which projects a grant's evidence admits, read by both the account's inventory demand and the
 * environments' listings — kept below both, in the access layer, so neither depends on the other.
 */
import type { Evidence } from "./grant.ts";
import { projectKeyOf, type AccessState, type ProjectRef } from "../types.ts";

/**
 * The projects admitted evidence names: verified ones, those whose latest
 * read failed, and those a denial withholds until a confirming read (G6).
 * A confirmed denial is the only way a project leaves. One only an
 * organization's list has named joins once its own read has answered.
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
  for (const { project, confirmation } of evidence.closedProjects.values()) {
    if (confirmation.status === "due") refs.set(projectKeyOf(project), project);
  }
  return [...refs.values()];
}

/** The projects a denial withholds until its confirming read (G6), by `projectKeyOf`. */
export function pendingDenials(evidence: Evidence | null): ReadonlySet<string> {
  if (evidence === null) return new Set();
  return new Set(
    [...evidence.closedProjects.values()]
      .filter(({ confirmation }) => confirmation.status === "due")
      .map(({ project }) => projectKeyOf(project)),
  );
}

/** Evidence projects plus those a command established since, from the runtime's grant. */
export function inventoryProjectRefs(
  granted: ReadonlyArray<ProjectRef>,
  access: AccessState | undefined,
): ReadonlyArray<ProjectRef> {
  const refs = new Map(granted.map((ref) => [projectKeyOf(ref), ref]));
  const established =
    access?.status === "verified"
      ? access.projects
      : access?.status === "verifying" || access?.status === "failed"
        ? (access.previous?.projects ?? [])
        : [];
  for (const { project: ref, role } of established) {
    if (role !== "NO_ACCESS") refs.set(projectKeyOf(ref), ref);
  }
  return [...refs.values()];
}
