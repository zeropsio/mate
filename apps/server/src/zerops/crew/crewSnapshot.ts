/**
 * crewSnapshot — the crew feed's frame where crew mode is off. The engine
 * crew's frames are its projection's (`engine/project.ts`).
 *
 * @module crewSnapshot
 */
import type { CrewSnapshot } from "@t3tools/contracts";

/** What the feed sends where crew mode is not on. */
export const CREW_OFF_SNAPSHOT: CrewSnapshot = {
  status: "off",
  seq: 0,
  crew: null,
  crewmates: [],
  hosts: [],
  board: { tasks: [] },
  run: null,
  attention: [],
  devHosts: [],
  landedNotDelivered: 0,
  lastError: null,
};
