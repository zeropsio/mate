/**
 * One Stop for a Mate's conversation, whichever control sends it — the menu row's ■, the
 * composer's ■, the keybinding — and what every surface says of it: "Stopping…" from the press,
 * before the Mate answers, and on every device once the Mate's row says a Stop is in force;
 * "Stopped — nothing more will change." once nothing runs; and the Stop given back, with why,
 * when the Mate refused it (S21-02: three presses on two controls, and still no telling whether
 * the app was being changed).
 *
 * @module zerops/conversationStop.logic
 */
import { backgroundStopShows } from "../components/chat/backgroundStop.logic";

/** A press of a conversation's Stop on this page: the turn it was pressed under, and its answer. */
export interface StopPress {
  readonly turnId: string | null;
  /** Why the Mate refused it; null while it is taken or still on its way. */
  readonly refused: string | null;
}

export type ConversationStop =
  | { readonly kind: "none" }
  | { readonly kind: "stopping" }
  | { readonly kind: "stopped" }
  | { readonly kind: "refused"; readonly reason: string };

export const STOPPING_WORDS = "Stopping…";
export const STOPPED_WORDS = "Stopped — nothing more will change.";

const NONE: ConversationStop = { kind: "none" };
const STOPPING: ConversationStop = { kind: "stopping" };
const STOPPED: ConversationStop = { kind: "stopped" };

/**
 * What a conversation's Stop says now. The Mate's word that a person's Stop is in force reads as
 * stopping wherever it was pressed; a press here reads as stopping until nothing runs, then as
 * stopped. A press under an earlier turn says nothing of a later one: that turn is its own.
 */
export function conversationStop(input: {
  readonly press: StopPress | null;
  /** The Mate's row says a person's Stop is in force. */
  readonly stopping: boolean;
  /** Something of the conversation still runs: a turn, or work a turn left. */
  readonly working: boolean;
  /** The conversation's latest turn. */
  readonly turnId: string | null;
}): ConversationStop {
  if (input.stopping && input.working) return STOPPING;
  if (!backgroundStopShows(input.press, input.turnId)) return NONE;
  const press = input.press!;
  if (press.refused !== null) return { kind: "refused", reason: press.refused };
  return input.working ? STOPPING : STOPPED;
}

/**
 * The Mate's refusals that are no refusal of a Stop: another control or device asked first, or
 * what it would stop had already ended. The record says what runs.
 */
const NOT_REFUSED: ReadonlySet<string> = new Set([
  "stop-already-asked",
  "run-not-running",
  "run-ended",
]);

/** Why a Stop failed, in the person's words; null when its failure leaves nothing to say. */
export function stopRefusal(failure: unknown): string | null {
  if (typeof failure !== "object" || failure === null) return "The Mate could not be stopped.";
  const { code, message } = failure as { readonly code?: unknown; readonly message?: unknown };
  if (typeof code === "string" && NOT_REFUSED.has(code)) return null;
  return typeof message === "string" && message.trim() !== ""
    ? message
    : "The Mate could not be stopped.";
}

/**
 * A Mate's activity with this tab's press of its Stop laid over it: stopping from the press, before
 * the Mate's row says so.
 */
export function withStopPress<
  A extends {
    readonly kind: string;
    readonly turnId?: string | undefined;
    readonly stopping?: true | undefined;
  },
>(activity: A | undefined, press: StopPress | null): A | undefined {
  if (activity === undefined || press === null || activity.stopping === true) return activity;
  const stop = conversationStop({
    press,
    stopping: false,
    working: activity.kind === "working",
    turnId: activity.turnId ?? null,
  });
  return stop.kind === "stopping" ? { ...activity, stopping: true } : activity;
}
