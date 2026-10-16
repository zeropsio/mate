/**
 * The first minute after an invitation: the overview opens on the organization's projects the
 * person can reach, with one line naming their role there and the one thing that role can do —
 * a Developer starts their own Mate on the team's project, a Guest follows the work and creates
 * nothing. Said once, on the first visit that finds projects someone else started; later visits
 * are quiet, and someone who started a Mate here is no newcomer. Pure: the viewer's membership
 * and what each project offers them arrive read.
 */
import { teamRoleOf } from "@t3tools/client-runtime/zerops/teamRoles";
import { asOrgRole } from "@t3tools/shared/zeropsRoles";

/** One project the person can see, as the overview lists it. */
export interface ArrivalApp {
  readonly groupId: string;
  readonly name: string;
  /** A Mate of it is the viewer's own, as HQ records it. */
  readonly mine: boolean;
  /** HQ lets the viewer add a Mate of their own to it. */
  readonly addMate: boolean;
}

export interface ArrivalWelcome {
  /** "Welcome to Acme. You're a Developer on Snap." */
  readonly line: string;
  /** What the role can do where it has no action of its own. */
  readonly detail: string | null;
  readonly action: { readonly label: string; readonly groupId: string } | null;
}

/** "Snap", "Snap and Beviro", "Snap and 2 more projects". */
function projectsPhrase(apps: ReadonlyArray<ArrivalApp>): string {
  const [first, second] = apps;
  if (apps.length === 2) return `${first!.name} and ${second!.name}`;
  return apps.length > 2 ? `${first!.name} and ${apps.length - 1} more projects` : first!.name;
}

/** Whether the welcome is said now: a first visit, to projects someone else started. */
export function welcomeOwed(input: {
  readonly welcomed: boolean;
  readonly apps: ReadonlyArray<ArrivalApp>;
}): boolean {
  return !input.welcomed && input.apps.length > 0 && !input.apps.some(({ mine }) => mine);
}

/**
 * Where the welcome stands on a render, until it has decided for this visit. It decides under the
 * overview's one wait (`overviewPaints`), so it paints with the page; a page that painted before
 * the welcome's reads settled stays as it painted, and the welcome is quiet on this visit — and
 * still owed on the next, since nobody saw it. With nothing shared yet it waits for a project.
 */
export function welcomeStep(input: {
  /** The projects, who started their Mates and what HQ offers are read. */
  readonly settled: boolean;
  readonly hasApps: boolean;
  /** The overview shows now. */
  readonly painted: boolean;
}): "wait" | "decide" | "late" {
  if (!input.settled) return input.painted ? "late" : "wait";
  return input.hasApps ? "decide" : "wait";
}

export function arrivalWelcome(input: {
  readonly organizationName: string;
  readonly viewer: { readonly roleCode?: string | undefined; readonly canCreateProjects?: boolean };
  /** The projects the person sees, in the overview's order; at least one. */
  readonly apps: ReadonlyArray<ArrivalApp>;
}): ArrivalWelcome {
  const welcome = `Welcome to ${input.organizationName}.`;
  const start = input.apps.find(({ addMate }) => addMate);
  const action =
    start === undefined
      ? null
      : { label: `Start your own Mate on ${start.name}`, groupId: start.groupId };
  const on = projectsPhrase(input.apps);
  switch (teamRoleOf(input.viewer)) {
    case "owner":
      return {
        line: `${welcome} You're an Owner: everything here, billing and the team included.`,
        detail: null,
        action,
      };
    case "admin":
      return {
        line: `${welcome} You're an Admin: every project and its Mates, and you invite people.`,
        detail: null,
        action,
      };
    case "developer":
      return { line: `${welcome} You're a Developer on ${on}.`, detail: null, action };
    case "guest":
      return {
        line: `${welcome} You're a Guest on ${on}.`,
        detail: "You can follow the work and open the app.",
        action: null,
      };
    case null:
      return asOrgRole(input.viewer.roleCode) === "BASIC_USER"
        ? { line: `${welcome} You work on every project.`, detail: null, action }
        : {
            line: `${welcome} You see every project.`,
            detail: "You can follow the work and open the app.",
            action: null,
          };
  }
}
