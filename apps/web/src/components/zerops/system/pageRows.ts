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

/**
 * How a list's rows stand on what holds them (`ChangeList look`):
 * - `card` — a card's or a panel's list, its hover hanging past the column's edge;
 * - `flush` — a list on its own card's edge (a project page's waits);
 * - `ruled` — the project's Changes card: roomier rows, a hairline between them;
 * - `record` — what is live, on the page's own ground: a hairline over every row, titles and beads
 *   quiet;
 * - `release` — the changes an opened release put live: set in, a hairline over each, no ground of
 *   their own under the pointer, their title underlined instead.
 */
export type ChangeLook = "card" | "flush" | "ruled" | "record" | "release";

export const ChangeLookRows = createContext<ChangeLook>("card");
