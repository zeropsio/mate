/** One failed attempt is spoken immediately, with a manual action. */
export interface InventoryTroubleInput {
  /** The product is mounted on the epoch's first grant; before it, the gate's own wait speaks. */
  readonly mounted: boolean;
  /** The grant the product runs on has lapsed: the lapse's one banner speaks for the account. */
  readonly lapsed: boolean;
  /** The sign-in itself ended (a 401 it could not refresh): the sign-in screen speaks. */
  readonly sessionEnded: boolean;
  /** A grant round failing, or an organization whose data failed or stalled; null when neither. */
  readonly trouble: "grant" | "organization" | null;
}

export interface InventoryTroubleVoice {
  readonly sentence: string;
  /** "Try now": a grant round and the troubled organizations' reads at once. */
  readonly tryNow: true;
}

const UNANSWERED: InventoryTroubleVoice = {
  sentence: "Zerops isn't answering.",
  tryNow: true,
};

/**
 * A failed read speaks immediately, unless a lapse or an ended sign-in speaks for it. It never offers
 * Sign out: a sign-in that ended is the session's to say, and nothing else here is fixed by one.
 */
export function inventoryTroubleVoice(input: InventoryTroubleInput): InventoryTroubleVoice | null {
  if (!input.mounted || input.lapsed || input.sessionEnded || input.trouble === null) return null;
  return UNANSWERED;
}

/**
 * What the account's one line does: a grant round and the troubled reads now, or sign out. A
 * `trying` is Try now while it runs, which takes no second press.
 */
export type AccountFootAction = "try-now" | "trying" | "sign-out";

export interface AccountFootLine {
  readonly sentence: string;
  readonly actions: ReadonlyArray<AccountFootAction>;
}

/** Try now as the person last pressed it: not since, running, or run with the trouble still on. */
export type TryNowAttempt = "idle" | "trying" | "still";

/** How long Try now shows it is trying before the line says whether that helped. */
export const TRY_NOW_SETTLE_MS = 8_000;

/**
 * The account's one line at the menu's foot: a lapse of the grant the product runs on first, with
 * Try now once a renewal failed and always the way out of the account (A9), since nothing the
 * account holds can be read meanwhile; else the inventory's lasting trouble, with Try now only.
 * Try now is never a silent no-op: it says it is trying while it runs, and a trouble that outlived
 * it says so in the line.
 */
export function accountFootLine(input: {
  readonly lapse: { readonly sentence: string; readonly retry: boolean } | null;
  readonly trouble: InventoryTroubleVoice | null;
  readonly attempt: TryNowAttempt;
}): AccountFootLine | null {
  const tryNow: AccountFootAction = input.attempt === "trying" ? "trying" : "try-now";
  const still = input.attempt === "still";
  if (input.lapse !== null) {
    return {
      sentence: input.lapse.retry && still ? STILL_NOT_ANSWERING : input.lapse.sentence,
      actions: input.lapse.retry ? [tryNow, "sign-out"] : ["sign-out"],
    };
  }
  if (input.trouble === null) return null;
  return { sentence: still ? STILL_NOT_ANSWERING : input.trouble.sentence, actions: [tryNow] };
}

const STILL_NOT_ANSWERING = "Still not answering. Trying again…";

/**
 * What isn't answering, for the line's tooltip, so a report names it: the one project when it
 * alone is in trouble, else the organization's projects and services.
 */
export function troubleSubject(input: {
  readonly organization: string;
  readonly projects: ReadonlyArray<string>;
  readonly organizationList: boolean;
}): string {
  return !input.organizationList && input.projects.length === 1
    ? `${input.projects[0]} in ${input.organization}`
    : `${input.organization}'s projects and services`;
}

/**
 * What the inventory reports of the organization in view — what the menu, the routes and the
 * pages read: still loading while its own reads are unread or in trouble, and its own trouble.
 * Another organization's trouble is not this one's, so it changes nothing here; with no
 * organization chosen, every one is in view. A failing grant round leaves nothing known.
 */
export function organizationKnowledge(input: {
  readonly grantFailed: boolean;
  /** The organizations whose demanded reads failed or stalled. */
  readonly blocked: ReadonlyArray<string>;
  /** The organizations some of whose projects or services are not read yet. */
  readonly unread: ReadonlyArray<string>;
  readonly active: string | null;
}): { readonly loading: boolean; readonly trouble: "grant" | "organization" | null } {
  if (input.grantFailed) return { loading: true, trouble: "grant" };
  const inView = (organizationId: string) =>
    input.active === null || organizationId === input.active;
  const trouble = input.blocked.some(inView) ? ("organization" as const) : null;
  return { loading: trouble !== null || input.unread.some(inView), trouble };
}
