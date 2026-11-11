/**
 * The person's access in the organization shown, as the client's own live Zerops data gives it, and
 * the one place that hears it move. A reading is their own membership (`/user/info`, read again on
 * a `client-user` frame naming them) and their effective role on each project the organization's
 * roster lists to them (`project` list `add`/`delete`, `userRoles` updates), through the one role
 * function (`resolveMateProjectRole`). Once the roster was whole, a project it lacks is none of
 * theirs.
 *
 * HQ filters every stream read by the projects the person's token reaches and reads only when
 * asked (`subscribe`, `retry`): a move between two readings is the receipt that what HQ sent may
 * no longer be theirs, or that more is. A frame moving nothing of theirs (another person's grant, a
 * status) asks nothing. A first reading, or one not read yet, changes nothing. A removal from the
 * organization pushes nothing (ZEROPS-077): it is heard only once their membership is read again.
 *
 * @module zerops/account/accessChanges
 */
import type { ZeropsOrgRole } from "@t3tools/shared/zeropsRoles";
import { Atom, type AtomRegistry } from "effect/reactivity";

import { projectsScope } from "../../data/families/project.ts";
import { sameValue } from "../../data/projections/equal.ts";
import { platformMembership } from "../../data/projections/platformCapabilities.ts";
import { accountReadsAtom } from "../../data/reads.ts";
import type { Projection } from "../../data/store.ts";
import { resolveMateProjectRole } from "../mateAccess.ts";

/** What one reading knows of the person's access in one organization. */
export interface AccessReading {
  /** What HQ answers their membership by (role and flags); `none` when they hold none there. */
  readonly membership: string;
  /** Each project the roster lists to them, with their effective role; `unknown` until its row is read. */
  readonly projects: Readonly<Record<string, ZeropsOrgRole | "unknown">>;
  /** Whether the roster is whole: a project it lacks is none of theirs. */
  readonly complete: boolean;
}

export interface AccessFrame {
  /** The organization shown; null without one. */
  readonly orgId: string | null;
  /** Null until their membership there is read. */
  readonly reading: AccessReading | null;
}

/** The person's access as last read in one organization. */
export interface AccessHeld {
  readonly orgId: string;
  readonly membership: string;
  /** Each project's role as last read; `unread` for one listed whose row was never read. */
  readonly roles: Readonly<Record<string, ZeropsOrgRole | "unread">>;
  /** The roster was whole once: a project not held is one they had no access to. */
  readonly whole: boolean;
}

const membershipOf = (viewer: {
  readonly roleCode?: string | undefined;
  readonly canCreateProjects?: boolean | undefined;
  readonly canViewFinances?: boolean | undefined;
  readonly canEditFinances?: boolean | undefined;
}): string =>
  [
    viewer.roleCode ?? "",
    viewer.canCreateProjects === true,
    viewer.canViewFinances === true,
    viewer.canEditFinances === true,
  ].join("/");

/** The person's access in an organization, from its roster and their own membership. */
export const personAccess: Projection<string, AccessReading | null> = {
  name: "personAccess",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const membership = platformMembership.derive(read, orgId);
    if (membership.kind !== "known") return null;
    const viewer = membership.viewer;
    if (viewer === undefined) return { membership: "none", projects: {}, complete: true };
    const roster = read.members(projectsScope(orgId));
    const projects: Record<string, ZeropsOrgRole | "unknown"> = {};
    for (const projectId of roster.ids) {
      const fact = read.fact("project", projectId);
      projects[projectId] =
        fact.kind === "known" ? resolveMateProjectRole({ project: fact.value, viewer }) : "unknown";
    }
    for (const projectId of roster.unverified) projects[projectId] = "unknown";
    return { membership: membershipOf(viewer), projects, complete: roster.coverage === "complete" };
  },
  equals: sameValue,
};

/**
 * One frame against the last reading of the same organization: the projects whose access moved,
 * or null when nothing of the person's did. An empty list is their membership alone moving.
 */
export function accessStep(
  held: AccessHeld | null,
  frame: AccessFrame,
): { readonly held: AccessHeld | null; readonly moved: ReadonlyArray<string> | null } {
  if (frame.orgId === null) return { held: null, moved: null };
  const same = held?.orgId === frame.orgId ? held : null;
  const reading = frame.reading;
  if (reading === null) return { held: same, moved: null };
  const before = (projectId: string): ZeropsOrgRole | "unread" =>
    same?.roles[projectId] ?? (same?.whole === true ? "NO_ACCESS" : "unread");
  const roles: Record<string, ZeropsOrgRole | "unread"> = {};
  const moved: string[] = [];
  for (const [projectId, role] of Object.entries(reading.projects)) {
    const was = before(projectId);
    if (role === "unknown") {
      roles[projectId] = was;
      continue;
    }
    roles[projectId] = role;
    if (was !== "unread" && was !== role) moved.push(projectId);
  }
  for (const [projectId, was] of Object.entries(same?.roles ?? {})) {
    if (projectId in reading.projects) continue;
    if (!reading.complete) roles[projectId] = was;
    else if (was !== "NO_ACCESS") moved.push(projectId);
  }
  const next: AccessHeld = {
    orgId: frame.orgId,
    membership: reading.membership,
    roles,
    whole: reading.complete || same?.whole === true,
  };
  const membershipMoved = same !== null && same.membership !== reading.membership;
  return {
    held: next,
    moved: same !== null && (membershipMoved || moved.length > 0) ? moved : null,
  };
}

const NO_FRAME: AccessFrame = { orgId: null, reading: null };

/** The person's access in the organization the mounted account shows. */
const shownAccessAtom = Atom.make((get): AccessFrame => {
  const account = get(accountReadsAtom);
  if (account === null || account.orgId === null) return NO_FRAME;
  return {
    orgId: account.orgId,
    reading: get(account.data.project(personAccess, account.orgId)),
  };
}).pipe(Atom.withLabel("account:shown-access"));

/** Hears each move of the person's access, with the projects it moved; the result stops hearing. */
export function followAccessChanges(
  registry: AtomRegistry.AtomRegistry,
  onChange: (projects: ReadonlyArray<string>) => void,
): () => void {
  let held: AccessHeld | null = null;
  return registry.subscribe(
    shownAccessAtom,
    (frame) => {
      const step = accessStep(held, frame);
      held = step.held;
      if (step.moved !== null) onChange(step.moved);
    },
    { immediate: true },
  );
}
