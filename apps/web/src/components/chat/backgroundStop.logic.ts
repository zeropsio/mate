/** A press of the background work's Stop, and the turn it was pressed under. */
export interface BackgroundStopPress {
  readonly turnId: string | null;
}

/**
 * Whether the background work's Stop reads "Stopping…": only under the turn it was pressed
 * under. A later turn's wait on its helpers is its own, with its own Stop.
 */
export const backgroundStopShows = (
  press: BackgroundStopPress | null,
  turnId: string | null,
): boolean => press !== null && press.turnId === turnId;
