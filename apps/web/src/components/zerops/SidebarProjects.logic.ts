/**
 * How the left menu lays its projects out, one after another.
 *
 * A heading never moves when it is clicked (M9). The room between two
 * projects used to sit above a heading and depend on that project's own
 * state — 4 px folded, 36 px open — so opening one dropped its heading 32 px
 * under the pointer (measured 166 → 198). The room belongs to the end of an
 * open project instead: its rows unfold below the heading with the room after
 * them, and folded projects stack as a list of names.
 *
 * Pure: no React, no clock, no store.
 */

/**
 * The room below a project's rows, in px: 44 while it is open (58 px from its
 * last row's words to the next heading's, M16), 16 at the list's end, none
 * while it is folded — its rows, and their room, fold into the heading.
 */
export function projectRoom(at: { readonly open: boolean; readonly last: boolean }): number {
  if (!at.open) return 0;
  return at.last ? 16 : 44;
}
