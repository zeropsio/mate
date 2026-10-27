/**
 * The line every Zerops surface draws work on.
 *
 * One spine, top to bottom; a node sits *between* two pieces of it rather than
 * on top of one, because the nodes are tinted and a line drawn behind a face
 * shows through it. An end keeps its space and gives up only its paint — drop
 * the span and the node re-centres and jumps sideways by half a row.
 *
 * The colour is opaque (`--zerops-rail`) rather than a tint of the foreground:
 * two 30%-alpha strokes meeting at a row boundary paint ~51% and leave a
 * visible notch down the line.
 *
 * The left menu, a history and a change's conversation are the same drawing at
 * different zooms, so the pieces are defined once and imported — "same
 * principles as with the history graph" (the owner, 2026-09-19).
 */

/** A piece of the spine. */
export const RAIL_LINE = "w-px flex-1 bg-[var(--zerops-rail)]";

/** The same space, unpainted: what an end of the line gives up. */
export const RAIL_BLANK = "w-px flex-1";

/** The column a node is centred in, wide enough for the widest of them. */
export const RAIL_COLUMN = "relative flex w-5 shrink-0 flex-col items-center self-stretch";
