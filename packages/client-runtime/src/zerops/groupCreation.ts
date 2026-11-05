/**
 * *Add project* — who is offered it (guide 4.1), and where a Mate stands in the registry.
 *
 * ## A group is an application in HQ, not a project
 *
 * Nothing is created in Zerops when a person adds a project. A group is an
 * application in the organization's HQ (ADR 0002), which holds the registry
 * and is its only writer (`hq/registry.ts`).
 *
 * ## Who may
 *
 * HQ follows Zerops project creation for applications and streams the resulting create_app offer.
 * A refusal is displayed with its actual capability reason.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module groupCreation
 */

import type { HqOfferState } from "@t3tools/shared/hqOffers";

import { hqOfferWords } from "./hq/refusals.ts";
import type { ZeropsRegistry } from "./hq/registry.ts";

/** A verb is either offered, or refused in words that name who can do it. */
export type GroupVerb =
  | { readonly offered: true }
  | { readonly offered: false; readonly reason: string };

const OFFERED: GroupVerb = { offered: true };

/**
 * Whether this person is offered *Add project* — HQ's offer of making an application
 * (`create_app`) — and what the row says instead: a member HQ refuses simply is not the one who
 * does this; before HQ has said, or while it does not answer, that.
 */
export function resolveAddProjectVerb(input: {
  readonly offer: HqOfferState;
  /** Words a wall time, for since when HQ does not answer. */
  readonly at: (ms: number) => string;
}): GroupVerb {
  if (input.offer.kind === "allowed") return OFFERED;
  if (input.offer.kind === "refused") {
    return {
      offered: false,
      reason:
        input.offer.reason === "not_structure_writer"
          ? ONLY_ADMINS_ADD_A_PROJECT
          : hqOfferWords(input.offer, { at: input.at }),
    };
  }
  return {
    offered: false,
    reason: hqOfferWords(input.offer, { at: input.at }),
  };
}

/** The one line a member sees in place of the verb. */
const ONLY_ADMINS_ADD_A_PROJECT = "Only an owner or admin adds a project.";

/**
 * Whether HQ holds a Mate in one of its applications yet (guide 4.2).
 *
 * A press registers the Mate it makes, and a refused registration stops it, so
 * no Mate is left out of its application on purpose: one HQ holds in none
 * (`unplaced`) is a press cut short before its registration — a closed tab —
 * or a Mate made before HQ. That is a real state with a real consequence (HQ
 * gives a repository only to a Mate it holds in an application), and the row
 * says it rather than showing a Mate that looks finished and cannot deliver.
 */
export type MateRegistration = "registered" | "unplaced";

export function resolveMateRegistration(input: {
  readonly registry: ZeropsRegistry;
  readonly projectId: string;
}): MateRegistration {
  const registered = input.registry.groups.some((group) =>
    group.projects.some((project) => project.projectId === input.projectId),
  );
  return registered ? "registered" : "unplaced";
}
