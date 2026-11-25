/**
 * The people the identity playgrounds draw: a picture that needs no network, and an address that
 * fails, so the letter it falls back to can be tried. Not a playground: the registry reads `.tsx`.
 */

/** A flat disc standing in for a photo. */
const PORTRAIT = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#3b5b7a"/><circle cx="8" cy="6" r="3" fill="#e8c4a8"/><ellipse cx="8" cy="15" rx="6" ry="5" fill="#e8c4a8"/></svg>',
)}`;

/** `none`: no picture on the account; `broken`: one whose address does not load. */
export const PICTURES = ["none", "picture", "broken"] as const;
export type KitPicture = (typeof PICTURES)[number];

export function pictureOf(picture: KitPicture): string | null {
  return picture === "picture" ? PORTRAIT : picture === "broken" ? "/kit-missing-avatar.png" : null;
}

/** How the JSX names the picture it was given. */
export function pictureSource(picture: KitPicture): string | undefined {
  return picture === "picture" ? "{avatarUrl}" : picture === "broken" ? "{brokenUrl}" : undefined;
}
