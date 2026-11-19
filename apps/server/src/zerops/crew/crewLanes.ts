/** A crewmate's lane directory and branch. */

/** A lane's directory, relative to `remotePath`. */
export const laneDirectory = (handle: string): string => `.crew/${handle}`;

/** A lane's branch. */
export const laneBranch = (handle: string): string => `crew/${handle}`;
