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
    const { complete: baselined, ...freshness } = scopeFreshness(read, orgId, scope);
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
