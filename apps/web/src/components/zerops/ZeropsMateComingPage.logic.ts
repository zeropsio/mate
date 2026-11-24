import type { MateDeletion } from "@t3tools/client-runtime/data";
import type { ScopedThreadRef } from "@t3tools/contracts";

import type { MateOpening } from "~/zerops/mateOpening.logic";
import { buildThreadRouteParams } from "~/threadRoutes";

/** What a Mate's deletion does to its coming page, for the person reading it. */
export interface ComingDeletionStage {
  /**
   * The deletion takes the page: it shows how the deletion stands, and the page neither connects,
   * reads its setup nor hands over to a conversation while it does.
   */
  readonly takesPage: boolean;
  /** The menu entry the page offers, by its id: Delete again, or the maker's Continue. */
  readonly action: "delete" | "continue-operation" | null;
}

const NONE: ComingDeletionStage = { takesPage: false, action: null };

/**
 * A running deletion offers nothing; one waiting for its maker offers them Continue; one that
 * failed offers Delete again to a person HQ offers the Mate's record (`remove`).
 */
export function comingDeletionStage(
  deletion: MateDeletion | undefined,
  remove: boolean,
): ComingDeletionStage {
  if (deletion === undefined || deletion.kind === "none") return NONE;
  if (deletion.kind === "deleting") return { takesPage: true, action: null };
  if (deletion.kind === "waiting")
    return { takesPage: true, action: deletion.yours ? "continue-operation" : null };
  return { takesPage: true, action: remove ? "delete" : null };
}

/**
 * Where a coming Mate's page hands over once its conversation is up: that conversation's own
 * route, in place of the coming page in history, so the person stays on the Mate they opened.
 */
export function comingHandOverDestination(threadRef: ScopedThreadRef) {
  return {
    to: "/$environmentId/$threadId" as const,
    params: buildThreadRouteParams(threadRef),
    replace: true,
  };
}

/**
 * Whether the page's start of a Mate's first conversation still stands. An answer that left it on
 * its own view started nothing, so the next change of what opening reads asks again; a shell that
 * stopped being live ends the start, whose read may have gone with its socket.
 */
export function comingOpenStands(input: {
  readonly asked: boolean;
  readonly noConversation: boolean;
  readonly answer?: MateOpening<unknown>["kind"];
}): boolean {
  if (!input.noConversation) return false;
  return input.answer === undefined ? input.asked : input.answer !== "own-view";
}
