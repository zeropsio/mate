/**
 * A colleague's Mate's face, as the menu, the rail and a card wear it: the seat of its owner's
 * mark (`MateOwnerMark`) cut out of the face — a 2 px gap all round the 16 px badge, centred 30 px
 * across and down the 36 px face, whatever the face's shape reaches into that corner — rather than
 * laid on it, so it holds on the hover band and the open Mate's band alike.
 */
export const FACE_CUT =
  "[mask-image:radial-gradient(circle_10px_at_30px_30px,transparent_9.5px,currentColor_10px)]";

/** Under its project's row the face stands 28 px, 4 px into its column: the seat moves with it. */
export const FACE_CUT_KID =
  "[mask-image:radial-gradient(circle_10px_at_26px_26px,transparent_9.5px,currentColor_10px)]";

/**
 * A Mate that is not the viewer's — a colleague's, or nobody's yet — wears its colour at 55 %, its
 * eyes and mouth in full ink, so the owner's picture is the strongest mark on its row (the owner's
 * board, 2026-09-30, A).
 */
export const FACE_PALE = "[&_[data-mate-face-body]_path]:[fill-opacity:0.55]";
