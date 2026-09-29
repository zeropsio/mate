/**
 * Changing a Mate's face, in words and rules: what its dialog says, which Mates a menu offers it
 * on, and the face a Mate wears now.
 *
 * A Mate's face is a tag on its project (`mate:face:`), so everybody who sees the Mate sees the
 * face its person picks, and changing it is a write of that project's tags: offered where Rename
 * is, and nowhere else.
 */
import { hasMate, mateShapeOf, type ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { MateTintId } from "@t3tools/shared/brand";

/** The verb in a Mate's menus, beside Rename. */
export const CHANGE_FACE_VERB = "Change face…";

/** What the Change face dialog says. */
export interface ChangeFaceWords {
  /** "Change Fen's face" */
  readonly title: string;
  /** That the face is everybody's view of the Mate, not the viewer's own. */
  readonly description: string;
  readonly submit: string;
  /** The button while the platform answers. */
  readonly pending: string;
}

export function changeFaceWords(name: string): ChangeFaceWords {
  return {
    title: `Change ${name}'s face`,
    description: `Everyone sees ${name} with this face.`,
    submit: "Save",
    pending: "Saving…",
  };
}

/**
 * Whether a Mate's menus offer *Change face…*: on a Mate, where this viewer may rename it — the
 * same write of the project's own tags (`resolveMateVerbs`), so a face the platform would refuse
 * is never offered.
 */
export function changeFaceOffered(input: {
  readonly candidate: ZeropsCandidate;
  /** `resolveMateVerbs(...).rename`, or the menus' own fallback where no viewer is read. */
  readonly mayRename: boolean;
}): boolean {
  return input.mayRename && hasMate(input.candidate);
}

/**
 * The face a Mate wears now, as every surface draws it: its tint among the account's
 * (`assignCandidateMateTints`) and the shape its person picked, else that tint's own.
 */
export function mateFaceOf(
  tints: ReadonlyMap<string, MateTintId>,
  project: Pick<ZeropsCandidate["project"], "id" | "tagList">,
): ZeropsMateFace {
  const tint = tints.get(project.id) ?? "slate";
  return { tint, shape: mateShapeOf(project.tagList, tint) };
}

export function sameFace(a: ZeropsMateFace, b: ZeropsMateFace): boolean {
  return a.tint === b.tint && a.shape === b.shape;
}
