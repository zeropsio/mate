/**
 * The first minute after an invitation: the overview opens on the organization's projects the
 * person can reach, with one line naming their role there and the one thing that role can do —
 * a Developer starts their own Mate on the team's project, a Guest follows the work and creates
 * nothing, an invited Owner or Admin hears what is theirs to run. Said once, on the person's first
 * visit as HQ records it (their first sign-in there, on any browser) that finds projects someone
 * else started; later visits are quiet, the person who set HQ up is never welcomed, and someone who
 * started a Mate here is no newcomer. An older HQ that keeps no first sign-in leaves it to this
 * browser's memory, and an Owner or Admin unwelcomed. Pure: the viewer's membership, their first
 * sign-in and what each project offers them arrive read.
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

/** The reader's first sign-in as HQ records it (`HqOrganizationViewer`). */
export interface ArrivalSignIn {
  readonly firstSignedInAt: string | null;
  /** They were HQ's first person: the one who set it up. */
  readonly founder: boolean;
}

/** How long a first visit lasts: the life of HQ's first session (`sessions.ts`, 12 hours). */
export const FIRST_VISIT_MS = 12 * 60 * 60 * 1000;

/**
 * Whether this is the person's first Mate visit as HQ records it: within their first session's
 * life, never for the person who set HQ up. `null` where HQ does not say (an older HQ).
 */
export function firstVisit(signIn: ArrivalSignIn | undefined, nowMs: number): boolean | null {
  if (signIn === undefined) return null;
  if (signIn.founder || signIn.firstSignedInAt === null) return false;
  const at = Date.parse(signIn.firstSignedInAt);
  return Number.isFinite(at) && nowMs - at < FIRST_VISIT_MS;
}

/**
 * Whether HQ's word on a first visit is in for the welcome to decide: its organization record read
 * — or HQ down or refusing, when the browser's memory decides as for an older HQ, so the welcome is
 * never lost waiting on HQ.
 */
export function signInSettled(input: {
  readonly recordRead: boolean;
  readonly hqUnavailable: boolean;
}): boolean {
  return input.recordRead || input.hqUnavailable;
}

/** Whether the welcome is said now: a first visit, to projects someone else started. */
export function welcomeOwed(input: {
  readonly welcomed: boolean;
  readonly apps: ReadonlyArray<ArrivalApp>;
  /** HQ's word on a first visit (`firstVisit`); `null` or absent where it gives none. */
  readonly firstVisit?: boolean | null;
}): boolean {
  if (input.firstVisit === false) return false;
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

/**
 * The welcome's one thing to do, as it stands now: its Start while the project takes a Mate, else
 * why it takes none yet in the button's place (`newMateGate`'s words), until it does.
 */
export function welcomeStart(
  action: ArrivalWelcome["action"],
  gateOf: (groupId: string) => string | null,
):
  | ({ readonly kind: "start" } & NonNullable<ArrivalWelcome["action"]>)
  | { readonly kind: "waits"; readonly line: string }
  | null {
  if (action === null) return null;
  const gate = gateOf(action.groupId);
  return gate === null ? { kind: "start", ...action } : { kind: "waits", line: gate };
}

export function arrivalWelcome(input: {
  readonly organizationName: string;
  readonly viewer: { readonly roleCode?: string | undefined; readonly canCreateProjects?: boolean };
  /** The projects the person sees, in the overview's order; at least one. */
  readonly apps: ReadonlyArray<ArrivalApp>;
  /** HQ's word on a first visit (`firstVisit`): only it welcomes an Owner or an Admin. */
  readonly firstVisit?: boolean | null;
}): ArrivalWelcome | null {
  // "Acme s.r.o." already ends its sentence.
  const welcome = /[.!?]$/.test(input.organizationName)
    ? `Welcome to ${input.organizationName}`
    : `Welcome to ${input.organizationName}.`;
  const start = input.apps.find(({ addMate }) => addMate);
  const action =
    start === undefined
      ? null
      : { label: `Start your own Mate on ${start.name}`, groupId: start.groupId };
  const on = projectsPhrase(input.apps);
  switch (teamRoleOf(input.viewer)) {
    // An Owner or an Admin runs the organization: a new browser is no arrival, so only HQ's record
    // of their first sign-in welcomes them.
    case "owner":
      return input.firstVisit === true
        ? {
            line: `${welcome} You're an Owner.`,
            detail: "The organization is yours to run: every project, its billing and its team.",
            action,
          }
        : null;
    case "admin":
      return input.firstVisit === true
        ? {
            line: `${welcome} You're an Admin.`,
            detail: "You reach every project and its Mates, and you invite people.",
            action,
          }
        : null;
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
