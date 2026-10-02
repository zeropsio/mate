/**
 * What a write to a project's `tagList` means (DESIGN §2.B B2, §6.5): a patch, applied by the
 * TagWriter to a list it has just read, never a list a caller computed from an older copy.
 *
 * `PUT /project/{id}` replaces the list wholesale, so a caller that sent the list it held would
 * delete every tag written since it read. A patch says only what it changes; every other tag —
 * a person's own, another writer's, one this client cannot parse — is carried through.
 *
 * Each patch is idempotent: applied to a list it already holds, it changes nothing. That is how
 * the writer tells a write that landed from one another writer replaced.
 *
 * Pure: no I/O, no clock.
 */
import { withZeropsClosedOffTag, withZeropsMateTag, withoutZeropsStandUpTag } from "../groups.ts";
import { withMateSignerTag } from "../mateAccess.ts";

export type ProjectTagPatch =
  /** Declares the Mate: the `mate` marker, for the Zerops GUI and this client alike. */
  | { readonly kind: "mate" }
  /** Records who signed an agent in (D6). */
  | { readonly kind: "agent-signer"; readonly agentId: string; readonly userId: string }
  /** The Mate was asked to stand the project's development up: the ask (`mate:standup:`) goes. */
  | { readonly kind: "stand-up-done" }
  /** The press closed the project off and read it back closed (`mate:closed-off`). */
  | { readonly kind: "closed-off" };

/** The list the patch leaves. */
export function applyProjectTagPatch(
  tags: ReadonlyArray<string>,
  patch: ProjectTagPatch,
): ReadonlyArray<string> {
  switch (patch.kind) {
    case "mate":
      return withZeropsMateTag(tags);
    case "agent-signer":
      return withMateSignerTag(tags, patch.agentId, patch.userId);
    case "stand-up-done":
      return withoutZeropsStandUpTag(tags);
    case "closed-off":
      return withZeropsClosedOffTag(tags);
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
