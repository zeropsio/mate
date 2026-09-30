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
}

export interface InventoryTroubleVoice {
  readonly sentence: string;
  /** "Try now": a grant round and the troubled organizations' reads at once. */
  readonly tryNow: true;
}

const UNANSWERED: InventoryTroubleVoice = {
  sentence: "Zerops isn't answering. Trying again…",
  tryNow: true,
};

/**
 * What the mounted product says of its inventory's trouble: nothing unless it has lasted
 * `INVENTORY_TROUBLE_HOLD_MS`, and nothing a lapse or an ended sign-in speaks for. It never offers
 * Sign out: a sign-in that ended is the session's to say, and nothing else here is fixed by one.
 */
export function inventoryTroubleVoice(input: InventoryTroubleInput): InventoryTroubleVoice | null {
  if (!input.mounted || input.lapsed || input.sessionEnded || input.trouble === null) return null;
  return input.troubledForMs >= INVENTORY_TROUBLE_HOLD_MS ? UNANSWERED : null;
}
