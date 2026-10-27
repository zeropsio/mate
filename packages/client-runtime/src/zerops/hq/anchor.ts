/**
 * The HQ every organization shares, as a client names it from its configuration (SPEC §3.3).
 *
 * Pure: no network (rule R1).
 *
 * @module hq/anchor
 */
import type { HqEndpoint } from "./client.ts";

/**
 * The door of the shared HQ, as a throwaway names it: `mate-door:hq:<nonce>` (mate-hq
 * `apps/hq/src/door.ts`). The HQ lives in no project of the organization.
 */
const SHARED_HQ_DOOR = "hq";

/** The HQ at `address` that every organization shares, named by its door. */
export function sharedHq(address: string): HqEndpoint {
  return { projectId: SHARED_HQ_DOOR, address: address.replace(/\/+$/u, "") };
}
