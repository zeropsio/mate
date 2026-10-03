/**
 * Which pose a Mate's face wears for where it is in its life — the one rule every surface that
 * draws a Mate's face reads (its row in the menu, the ⌘K list, its coming-up page, a crewmate's
 * row), so no two places draw a Mate on its way up differently.
 *
 * | its life                                   | the pose                        |
 * | ------------------------------------------ | ------------------------------- |
 * | coming up: from the press until it answers | waking                          |
 * | up, its agent not answering yet (sign-in)  | waking, where it would rest     |
 * | up, answered                               | the face its conversation gives |
 * | did not come up                            | asleep (the red dot says why)   |
 * | on its way off Zerops                      | asleep                          |
 *
 * Waking is asleep's closed eyes, alive: it breathes, so a Mate on its way up never stands still
 * like one at rest or one that stopped (run 6, 2026-10-03). A Mate that is up but not running —
 * its socket shut — stays asleep whether or not it was ever signed in: nothing is on its way.
 *
 * Pure; the renderers map the pose to their motion.
 */
import type { MateMarkState } from "@t3tools/shared/brand";

/** Where a Mate is in its life, as its faces need it. */
export type MateLife =
  /** On its way up: from its press until its container answers (`mateComing`). */
  | "coming"
  /** It did not come up. */
  | "failed"
  /** On its way off Zerops. */
  | "deleting"
  /** Listed and past its first minutes. */
  | "up";

export function matePose(input: {
  readonly life: MateLife;
  /**
   * Its agent has answered: somebody signed it in (`mateOwnerRecords`), or it has been asked
   * something — a Mate born before the sign-in tag was talked to all the same.
   */
  readonly answered: boolean;
  /** The face its conversation gives it as read: asleep while its socket is shut. */
  readonly face: MateMarkState;
}): MateMarkState {
  switch (input.life) {
    case "coming":
      return "waking";
    case "failed":
    case "deleting":
      return "sleep";
    case "up":
      return !input.answered && input.face === "idle" ? "waking" : input.face;
  }
}
