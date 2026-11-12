/**
 * The composer's box as the person sees it at this moment, its height in px; `undefined` where
 * none is seen. Read once as a conversation's view is entered: on a switch the foot holds what
 * stood there until the next conversation's own foot is known, so the box a person was looking at
 * never leaves and comes back with the conversation. A document that has drawn nothing yet (a
 * reload) has none standing, and the device's memory of the conversation decides alone.
 *
 * Said by whoever draws the box, as it measures it anyway (`footStands`): asking costs no layout,
 * so a switch between two open conversations reads a number and nothing else.
 */
let standing: { readonly owner: object; readonly height: number } | null = null;

/** `owner` draws a box `height` tall that is seen now; `null` once it is not, or is gone. */
export function footStands(owner: object, height: number | null): void {
  if (height !== null && height > 0) standing = { owner, height: Math.round(height) };
  else if (standing?.owner === owner) standing = null;
}

export function footStanding(): number | undefined {
  return standing?.height;
}
