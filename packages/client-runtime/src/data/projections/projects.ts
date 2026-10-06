/**
 * The organization's projects as the roster lists them: every project it admits now, whether the
 * list is whole, and how current it is. A project that left the roster stays listed until its
 * owner proves it deleted or withholds it; an outage keeps what was read and says it is catching
 * up. Where HQ places a project is HQ's: a project nobody placed yet is listed all the same.
 *
 * @module data/projections/projects
 */
import { projectsScope, type ProjectValue } from "../families/project.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { scopeFreshness, type ScopeFreshness } from "./freshness.ts";

/** Where the roster's read stands: not asked for, its first baseline under way, or read. */
export type RosterRead = "unread" | "reading" | "read";

export interface OrganizationProjects extends Omit<ScopeFreshness, "complete"> {
  /**
   * The listed projects whose row is read, by name: one leaving or joining moves no other.
   */
  readonly projects: ReadonlyArray<ProjectValue>;
  readonly read: RosterRead;
  /**
   * The roster is read and nothing of it is still open: every member's row is read and no
   * departure waits for its owner's word. Only a complete roster may say "no such project".
   */
  readonly complete: boolean;
}

const byName = (left: ProjectValue, right: ProjectValue) =>
  left.name.localeCompare(right.name) || left.id.localeCompare(right.id);

export const organizationProjects: Projection<string, OrganizationProjects> = {
  name: "organizationProjects",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const scope = projectsScope(orgId);
    const { complete: baselined, ...freshness } = scopeFreshness(read, scope);
    const { ids, unverified } = read.members(scope);
    const projects: ProjectValue[] = [];
    let unreadRows = false;
    for (const id of [...ids, ...unverified]) {
      const fact = read.fact("project", id);
      if (fact.kind === "known") projects.push(fact.value);
      else if (fact.kind === "unknown") unreadRows = true;
    }
    const phase = read.stream(scope).phase;
    return {
      projects: projects.sort(byName),
      read: baselined ? "read" : phase === "idle" || phase === "paused" ? "unread" : "reading",
      complete: baselined && !unreadRows && unverified.length === 0,
      ...freshness,
    };
  },
  equals: sameValue,
};

/** One project as the account's store holds it; `null` while it holds no value of it. */
export const listedProject: Projection<
  { readonly orgId: string; readonly projectId: string },
  ProjectValue | null
> = {
  name: "listedProject",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, { projectId }) => {
    const fact = read.fact("project", projectId);
    return fact.kind === "known" ? fact.value : null;
  },
  equals: sameValue,
};

/** Whether the owner proved a project deleted: what HQ still places of it is drawn no more. */
export const projectGone: Projection<
  { readonly orgId: string; readonly projectId: string },
  boolean
> = {
  name: "projectGone",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, { projectId }) => read.fact("project", projectId).kind === "deleted",
  equals: sameValue,
};

/**
 * Where one project stands with the viewer, as the account's store holds it: its row while the
 * roster lists it — Zerops filters the organization's listing by the viewer's token, so a listed
 * project is the viewer's — denied once its owner refused it, deleted once proven, otherwise not
 * known.
 */
export type ProjectStanding =
  | { readonly kind: "listed"; readonly project: ProjectValue }
  | { readonly kind: "denied" }
  | { readonly kind: "deleted" }
  | { readonly kind: "unknown" };

export const projectStanding: Projection<
  { readonly orgId: string; readonly projectId: string },
  ProjectStanding
> = {
  name: "projectStanding",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, { projectId }) => {
    const fact = read.fact("project", projectId);
    switch (fact.kind) {
      case "known":
        return { kind: "listed", project: fact.value };
      case "deleted":
        return { kind: "deleted" };
      case "withheld":
        return fact.reason === "denied" ? { kind: "denied" } : { kind: "unknown" };
      case "unknown":
        return { kind: "unknown" };
    }
  },
  equals: sameValue,
};

/**
 * Whether a project's own row is read, by its id, while its Mate is drawn: only where it decides
 * the viewer's access — a NO_ACCESS member's project whose listing row names no grant of theirs
 * (or that the roster does not list yet). An organization member is judged on their membership,
 * and whose a Mate is comes from HQ's person facts; neither asks Zerops per project.
 * Held `userRoles` came from the own row and never release this demand: only the listing
 * naming the viewer's grant makes the own read unnecessary.
 */
export const ownRowWanted = (
  viewerRole: string | undefined,
  listed: Pick<ProjectValue, "listingNamesGrants"> | null,
): boolean => viewerRole === "NO_ACCESS" && listed?.listingNamesGrants !== true;
