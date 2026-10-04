/**
 * A page of a thread's history holds whole turns. A turn is one card: cut
 * inside it and the card loses its first steps, its counts and its helpers
 * on every reload, so the page's edge always falls between turns — the oldest
 * ones wait behind "load earlier", whole.
 *
 * A user turn opens a group: the fan-out turns after it (a helper's, a
 * background result's — turns with no user message of their own) belong to
 * it, so a group is cut whole or not at all.
 */
export interface TurnWindowCandidate {
  readonly isUserTurn: boolean;
  /** The rows the turn shows: its own and the turnless ones that follow it. */
  readonly steps: number;
}

/**
 * How many of the newest `candidates` (newest first) the page takes: up to
 * `userTurnLimit` user turns, as many whole groups as fit in `stepBudget`,
 * and always the newest group, however long it is.
 */
export function fitTurnWindow(
  candidates: ReadonlyArray<TurnWindowCandidate>,
  options: { readonly userTurnLimit: number; readonly stepBudget: number },
): number {
  let steps = 0;
  let userTurns = 0;
  let taken = 0;
  for (const [index, candidate] of candidates.entries()) {
    steps += candidate.steps;
    if (!candidate.isUserTurn) continue;
    userTurns += 1;
    if (userTurns > 1 && steps > options.stepBudget) return taken;
    taken = index + 1;
    if (userTurns >= options.userTurnLimit) return taken;
  }
  // Older fan-out with no user turn before it in reach — the thread's first
  // turns, or a fan-out longer than one read walks: it rides along when it
  // fits, and with no group at all the page takes turn by turn.
  if (steps <= options.stepBudget) return candidates.length;
  if (taken > 0) return taken;
  let fanOutSteps = 0;
  for (const [index, candidate] of candidates.entries()) {
    fanOutSteps += candidate.steps;
    if (index > 0 && fanOutSteps > options.stepBudget) return index;
  }
  return candidates.length;
}
