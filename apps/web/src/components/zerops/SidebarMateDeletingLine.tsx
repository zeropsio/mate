import { MATE_DELETING_WORD } from "./ZeropsDeleteMateDialog.logic";

/**
 * The row's last line while its Mate is on its way off Zerops
 * (`mateDeletingView`): the fact, in the muted ink, where its words stood.
 */
export function MateDeletingLine() {
  return (
    <span
      className="truncate menu-line2 text-muted-foreground"
      data-zerops-surface="sidebar-mate-deleting"
    >
      {MATE_DELETING_WORD}
    </span>
  );
}
