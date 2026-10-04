/**
 * The trailers a landing carries, and how a script reads them back.
 *
 * A landing is one squash commit on the integration branch whose message ends
 * in one trailer paragraph: `Crew-Lane: <handle>` and `Crew-Assignment: <task>`.
 * Trailers survive zcp's rebase where shas do not, so the integration branch
 * is judged by content: every recorded landing's `Crew-Assignment:` must stay
 * in H's first-parent history, and reading one assignment makes a landing
 * idempotent.
 *
 * @module crewTrailers
 */
import { git, script, type CrewScript } from "./CrewShell.ts";

export const LANE_TRAILER = "Crew-Lane";
export const ASSIGNMENT_TRAILER = "Crew-Assignment";

/** The trailer paragraph of a landing's message. */
export const landingTrailers = (lane: string, assignment: string): string =>
  `${LANE_TRAILER}: ${lane}\n${ASSIGNMENT_TRAILER}: ${assignment}`;

/** Prints `landed<TAB><task>` for every task landed in `revision`'s first-parent history. */
export const landedAssignmentsScript = (revision: string): CrewScript =>
  script(
    `${git("integration", [
      "log",
      "--first-parent",
      `--format=%(trailers:key=${ASSIGNMENT_TRAILER},valueonly,separator=%x0A)`,
      revision,
    ])} | sed -n 's/^\\(..*\\)$/landed\t\\1/p'\n`,
  );
