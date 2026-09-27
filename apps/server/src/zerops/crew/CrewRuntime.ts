/**
 * CrewRuntime — Show on dev (ARCHITECTURE §5 *Show on dev*, CONCEPT §3.3):
 * one claim per dev service lets a crewmate's copy run on the service's own
 * dev server and URL, in place of the tree.
 *
 * A crewmate asks with `crew_show_on_dev`; the person grants; a short claim
 * turn in the holder's thread restarts the dev server from the copy, and a
 * release turn restarts it from the tree. Whether a turn did it is never
 * taken from the engine's own record: what dev serves is read from the
 * working directory of zcp's dev-server process (`servedFrom`), and that
 * reading moves the claim (`claimEventFromServed`, then `claimTransition`).
 *
 * @module CrewRuntime
 */
import type { CrewClaimState, CrewServed } from "@t3tools/contracts";

import type { ClaimEvent } from "./crewMachines.ts";
import type { CrewToolText } from "./crewSeams.ts";

/** A host's Show-on-dev claim: its state and its holder or requester. */
export interface CrewClaim {
  readonly state: CrewClaimState;
  readonly handle: string | null;
}

const DELETED_SUFFIX = " (deleted)";

const isWithin = (path: string, root: string): boolean =>
  path === root || path.startsWith(`${root}/`);

/**
 * What a dev service's dev server serves, from the working directory of its
 * process (`readlink /proc/<pid>/cwd`): the tree, a crewmate's copy under
 * `.crew/<handle>`, or — for no process, a deleted directory, a copy no
 * crewmate owns or anywhere else — unknown.
 */
export const servedFrom = (
  cwd: string | undefined,
  remoteRoot: string,
  handles: ReadonlyArray<string>,
): CrewServed => {
  if (cwd === undefined || cwd.endsWith(DELETED_SUFFIX) || !isWithin(cwd, remoteRoot)) {
    return { by: "unknown" };
  }
  const lanes = `${remoteRoot}/.crew`;
  if (!isWithin(cwd, lanes)) return { by: "tree" };
  const handle = cwd.slice(lanes.length + 1).split("/")[0];
  return handle !== undefined && handles.includes(handle)
    ? { by: "crewmate", handle }
    : { by: "unknown" };
};

/**
 * The claim event that what dev serves stands for, read after a claim or a
 * release turn, or at boot. Starting: the holder's copy means held, anything
 * else that the claim turn did not take. Held: dev no longer serving the
 * holder's copy means someone else restarted it, and the person wins.
 * Releasing: only the tree ends it; anything else means the release failed.
 */
export const claimEventFromServed = (
  state: CrewClaimState,
  served: CrewServed,
  holder: string,
): ClaimEvent | undefined => {
  const servesHolder = served.by === "crewmate" && served.handle === holder;
  switch (state) {
    case "starting":
      return servesHolder ? "serves-lane" : "serves-other";
    case "held":
      return servesHolder ? undefined : "person-dev-server";
    case "releasing":
      return served.by === "tree" ? "serves-tree" : "turn-failed";
    case "release-failed":
      return served.by === "tree" ? "serves-tree" : undefined;
    default:
      return undefined;
  }
};

/** The crewmate whose copy dev serves under a held claim; the gate's `holdsClaim`. */
export const holdsClaim = (claim: CrewClaim | undefined, handle: string): boolean =>
  claim?.state === "held" && claim.handle === handle;

export type ShowOnDevOutcome =
  | { readonly kind: "requested" }
  | { readonly kind: "pending" }
  | { readonly kind: "shown" }
  | { readonly kind: "busy"; readonly by: string }
  | { readonly kind: "releasing" }
  | { readonly kind: "no-lane" };

/**
 * `crew_show_on_dev` against the host's claim: one claim per dev service, so
 * a request waits for nobody — it is refused while another crewmate's work
 * is asked for, shown, or on its way back to the tree.
 */
export const claimRequest = (
  claim: CrewClaim | undefined,
  handle: string,
  hasLane: boolean,
): ShowOnDevOutcome => {
  if (!hasLane) return { kind: "no-lane" };
  const state = claim?.state ?? "none";
  if (state === "none") return { kind: "requested" };
  if (state === "releasing" || state === "release-failed") return { kind: "releasing" };
  if (claim?.handle !== handle) return { kind: "busy", by: claim?.handle ?? "" };
  return state === "held" ? { kind: "shown" } : { kind: "pending" };
};

export const showOnDevAnswer = (outcome: ShowOnDevOutcome, host: string): CrewToolText => {
  switch (outcome.kind) {
    case "requested":
      return {
        text: `Asked the person to show your copy on ${host}. If they grant it, a short turn in this conversation restarts ${host}'s dev server from your copy.`,
        isError: false,
      };
    case "pending":
      return {
        text: `Your request to show your copy on ${host} is already with the person.`,
        isError: false,
      };
    case "shown":
      return { text: `${host} already shows your copy.`, isError: false };
    case "busy":
      return {
        text: `${host} is taken by @${outcome.by}'s work; ask again once it is released.`,
        isError: true,
      };
    case "releasing":
      return {
        text: `${host}'s dev server is going back to the tree; ask again once it has.`,
        isError: true,
      };
    case "no-lane":
      return { text: "You have no copy of the code to show.", isError: true };
  }
};
