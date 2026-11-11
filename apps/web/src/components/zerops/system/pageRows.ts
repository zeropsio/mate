/**
 * Whether a row stands in a page's own list — a project's Mates and Changes, a place's next
 * release — where it is as wide as the page's column. There, when it last moved stands after its
 * title, and a row that opens something ends in a chevron while it is pointed at or focused (always
 * where nothing hovers). A card's or a panel's rows keep their columns.
 */
import { createContext } from "react";

export const PageRows = createContext(false);

/**
 * Whether a row stands in a ledger of changes (`ChangeList ledger`, a project's Changes): one line
 * a change, marked by its bead as the line over it draws it, what stops it and whose and when in
 * columns of their own, *Review* only where a review is due, and where it leads always shown.
 */
export const LedgerRows = createContext(false);
