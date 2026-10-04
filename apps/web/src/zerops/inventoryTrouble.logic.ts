/**
 * When the inventory's own trouble speaks, once the product is mounted (DESIGN §3.4): a grant round
 * or an organization's data that fails while the grant the product runs on still holds changes
 * nothing anyone can do — the rows keep what they have and the retry runs on its own backoff — so
 * it stays silent until it has lasted, and never covers or freezes the product.
 */

/**
 * How long a failure keeps silent: past the one voice's 1.5 s, and past the runtime's own retries
 * (a refused registration recovers within its backoff, a stalled one is called a stall 30 s after
 * its deadline), so only a failure that is lasting is spoken of.
 */
export const INVENTORY_TROUBLE_HOLD_MS = 20_000;

export interface InventoryTroubleInput {
  /** The product is mounted on the epoch's first grant; before it, the gate's own wait speaks. */
  readonly mounted: boolean;
  /** The grant the product runs on has lapsed: the lapse's one banner speaks for the account. */
  readonly lapsed: boolean;
  /** The sign-in itself ended (a 401 it could not refresh): the sign-in screen speaks. */
  readonly sessionEnded: boolean;
  /** A grant round failing, or an organization whose data failed or stalled; null when neither. */
  readonly trouble: "grant" | "organization" | null;
  /** How long `trouble` has held without a break. */
  readonly troubledForMs: number;
  /** Every failure in it has a retry coming; otherwise one waits for a person's Try now. */
  readonly retrying: boolean;
}

export interface InventoryTroubleVoice {
  readonly sentence: string;
  /** "Try now": a grant round and the troubled organizations' reads at once. */
  readonly tryNow: true;
  readonly retrying: boolean;
}

const UNANSWERED: InventoryTroubleVoice = {
  sentence: "Zerops isn't answering. Trying again…",
  tryNow: true,
  retrying: true,
};

/** A failure no timer repairs says what does: the person's Try now. */
const UNANSWERED_FOR_GOOD: InventoryTroubleVoice = {
  sentence: "Zerops isn't answering. Try now to ask again.",
  tryNow: true,
  retrying: false,
};

/** What a demanded interest's state says of its trouble (`troubleLatch`). */
export interface DemandedInterestTrouble {
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly interest:
    | { readonly status: "failed"; readonly retryAtMs: number | null; readonly retryable: boolean }
    | { readonly status: "establishing" | "observing" | "paused" }
    | undefined;
}

export interface TroubleEntry {
  /** Every failing read of it has a retry coming. */
  readonly retrying: boolean;
  /** The reads that failed, for the line's tooltip. */
  readonly reads: ReadonlyArray<{
    readonly organizationId: string;
    readonly projectId: string | null;
  }>;
}

/**
 * Each organization whose demanded data failed and has not observed again since: a retry that
 * re-establishes is the same trouble, not a fresh start, so the line holding it never flickers at
 * an attempt's edge. It ends once each failed read observes, pauses or is no longer demanded; a
 * read it never failed starting meanwhile does not hold it.
 */
export function troubleLatch(
  previous: ReadonlyMap<string, TroubleEntry>,
  demanded: ReadonlyArray<DemandedInterestTrouble>,
): ReadonlyMap<string, TroubleEntry> {
  const next = new Map<string, TroubleEntry>();
  const byOrganization = new Map<string, Array<DemandedInterestTrouble>>();
  for (const entry of demanded) {
    const group = byOrganization.get(entry.organizationId) ?? [];
    group.push(entry);
    byOrganization.set(entry.organizationId, group);
  }
  for (const [organizationId, group] of byOrganization) {
    const failing = group.filter(({ interest }) => interest?.status === "failed");
    if (failing.length > 0) {
      next.set(organizationId, {
        retrying: failing.every(
          ({ interest }) =>
            interest?.status === "failed" && (interest.retryAtMs !== null || interest.retryable),
        ),
        reads: failing.map(({ projectId }) => ({ organizationId, projectId })),
      });
      continue;
    }
    // Only a failed read's own retry keeps its trouble: another read starting, or a project no
    // longer demanded, is not it.
    const held = previous.get(organizationId);
    if (held === undefined) continue;
    const retried = held.reads.filter((read) =>
      group.some(
        ({ projectId, interest }) =>
          projectId === read.projectId && interest?.status === "establishing",
      ),
    );
    if (retried.length > 0) next.set(organizationId, { ...held, reads: retried });
  }
  return next;
}

/**
 * What the mounted product says of its inventory's trouble: nothing unless it has lasted
 * `INVENTORY_TROUBLE_HOLD_MS`, and nothing a lapse or an ended sign-in speaks for. It never offers
 * Sign out: a sign-in that ended is the session's to say, and nothing else here is fixed by one.
 */
export function inventoryTroubleVoice(input: InventoryTroubleInput): InventoryTroubleVoice | null {
  if (!input.mounted || input.lapsed || input.sessionEnded || input.trouble === null) return null;
  if (input.troubledForMs < INVENTORY_TROUBLE_HOLD_MS) return null;
  return input.retrying ? UNANSWERED : UNANSWERED_FOR_GOOD;
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
      sentence: input.lapse.retry && still ? STILL_RETRYING : input.lapse.sentence,
      actions: input.lapse.retry ? [tryNow, "sign-out"] : ["sign-out"],
    };
  }
  if (input.trouble === null) return null;
  return {
    sentence: still
      ? input.trouble.retrying
        ? STILL_RETRYING
        : "Still not answering. Try now to ask again."
      : input.trouble.sentence,
    actions: [tryNow],
  };
}

const STILL_RETRYING = "Still not answering. Trying again…";

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
