/**
 * Changing a Mate's face, in words and rules: what its dialog says, which Mates a menu offers it
 * on, and the face a Mate wears now.
 *
 * A Mate's face is HQ's record of it (ADR 0002), so everybody who sees the Mate sees the face its
 * person picks, and changing it is one write to HQ: offered where Rename is, and nowhere else.
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
 * Whether a Mate's menus offer *Change face…*: on a Mate, where HQ's rule lets this viewer edit its
 * record (`edit_mate_record`), so a face HQ would refuse is never offered.
 */
export function changeFaceOffered(input: {
  readonly candidate: ZeropsCandidate;
  /** Whether HQ offers the viewer the Mate's record (`edit_mate_record`); never while unknown. */
  readonly mayEdit: boolean;
}): boolean {
  return input.mayEdit && hasMate(input.candidate);
}

/**
 * The face a Mate wears now, as every surface draws it: its tint among the account's
 * (`assignCandidateMateTints`) and the shape its person picked, else that tint's own.
 */
export function mateFaceOf(
  tints: ReadonlyMap<string, MateTintId>,
  project: Pick<ZeropsCandidate["project"], "id" | "tagList" | "hq">,
): ZeropsMateFace {
  const tint = tints.get(project.id) ?? "slate";
  return { tint, shape: mateShapeOf(project, tint) };
}

export function sameFace(a: ZeropsMateFace, b: ZeropsMateFace): boolean {
  return a.tint === b.tint && a.shape === b.shape;
}
