/**
 * Whether a row stands in a page's own list — a project's Mates and Changes, a place's next
 * release — where it is as wide as the page's column. There, when it last moved stands after its
 * title, and a row that opens something ends in a chevron while it is pointed at or focused (always
 * where nothing hovers). A card's or a panel's rows keep their columns.
 */
import { createContext } from "react";

export const PageRows = createContext(false);
