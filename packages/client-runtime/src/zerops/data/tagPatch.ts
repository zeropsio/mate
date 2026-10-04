/**
 * The only project tag this product declares is `mate`; all metadata is held by HQ. A project's
 * own tags are its person's, and stay.
 */
import { withZeropsMateTag } from "../groups.ts";

/** Declares the Mate: the `mate` marker, for the Zerops GUI and this client alike. */
export type ProjectTagPatch = { readonly kind: "mate" };

/** The list the patch leaves. */
export function applyProjectTagPatch(
  tags: ReadonlyArray<string>,
  patch: ProjectTagPatch,
): ReadonlyArray<string> {
  switch (patch.kind) {
    case "mate":
      return withZeropsMateTag(tags);
  }
}

/** Whether two lists hold the same tags, however the platform ordered them. */
export function sameProjectTags(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((tag, index) => tag === sortedRight[index]);
}
