/**
 * The trailers a landing carries, and how a script reads them back.
 *
 * A landing is one squash commit on the integration branch whose message ends
 * in one trailer paragraph: `Crew-Lane: <handle>` and `Crew-Assignment: <task>`.
 * Trailers survive zcp's rebase where shas do not, so the integration branch
 * is inspected by its selected assignment trailer in H's first-parent history.
 * Reading that exact assignment makes a landing idempotent.
 *
 * @module crewTrailers
 */

export const LANE_TRAILER = "Crew-Lane";
export const ASSIGNMENT_TRAILER = "Crew-Assignment";

/** The trailer paragraph of a landing's message. */
export const landingTrailers = (lane: string, assignment: string): string =>
  `${LANE_TRAILER}: ${lane}\n${ASSIGNMENT_TRAILER}: ${assignment}`;
