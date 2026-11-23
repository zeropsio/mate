import type { MateDeletion } from "@t3tools/client-runtime/data";

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
