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
 * HQ lets only org owners and admins create an application, as main let only
 * them write the registry (D3), and says so beside its structure (`create_app`)
 * — so an offered verb a member cannot finish would be an error message after
 * the fact (guide 0.8). The gate is therefore stricter than Zerops' own *can
 * create projects* (`mayCreateProjects`): a `READ_ONLY` member with the flag
 * may add a **Mate** to a group that exists, and may not make a group.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module groupCreation
 */

import type { HqOfferState } from "@t3tools/shared/hqOffers";

import { hqOfferWords } from "./hq/refusals.ts";
import type { ZeropsRegistry } from "./hq/registry.ts";
import { mateMemberName, type MateOwnerCandidate } from "./mateAccess.ts";

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
  /** The org's owners and admins, for the refusal that names them. */
  readonly admins?: ReadonlyArray<MateOwnerCandidate> | undefined;
  /** Words a wall time, for since when HQ does not answer. */
  readonly at: (ms: number) => string;
}): GroupVerb {
  if (input.offer.kind === "allowed") return OFFERED;
  if (input.offer.kind === "refused") {
    return { offered: false, reason: onlyTheseCanAddAProject(input.admins ?? []) };
  }
  return {
    offered: false,
    reason: hqOfferWords(input.offer, { at: input.at, rolesAnsweredAt: null }),
  };
}

/**
 * The one line a member sees in place of the verb.
 *
 * Names them when the member list can be read for names, because "ask an owner"
 * with no owner to ask is the kind of sentence that sends somebody to support.
 * With no names it says the same thing without pretending to know who.
 */
export function onlyTheseCanAddAProject(admins: ReadonlyArray<MateOwnerCandidate>): string {
  const names = admins
    .map((admin) => mateMemberName(admin))
    .filter((name): name is string => name !== undefined);
  if (names.length === 0) return "Only an owner or admin adds a project.";
  if (names.length === 1) return `Only ${names[0]} adds a project.`;
  const last = names.at(-1);
  return `Only ${names.slice(0, -1).join(", ")} and ${last} add a project.`;
}

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

/**
 * *Finish setup*, on a half-made Mate's ⋯ menu (pass 28): the press's own steps run again on a
 * Mate whose press did not finish — its container imported with its key where it has none, its
 * project closed off, its registration written. A press cut short before its registration — a
 * closed tab — or a Mate made before HQ runs in no application until somebody who may write the
 * registry finishes it: an org owner or admin, in any browser. A Mate HQ holds no record of has its
 * record written, and its birth with it, by whoever HQ offers writing that record.
 *
 * `undefined` for everybody else, and for a Mate already whole: a disabled entry on a row a person
 * can do nothing about is noise.
 */
export function finishMateSetupVerb(input: {
  readonly registration: MateRegistration;
  /** Its project has no container: its import never went through. */
  readonly containerMissing: boolean;
  /** A press this tab made for it stopped at a step. */
  readonly pressStopped: boolean;
  /**
   * Its container carries the press's marker (`MATE_SETUP_RUNTIMES`) and HQ does not know its
   * project closed off — or HQ says it is not, and the marker is not read or cannot be: a press
   * interrupted before its close-off, whose runtimes zcp holds back (`interruptedPresses`).
   */
  readonly closedOffMissing: boolean;
  /**
   * A press in another browser may still be at it (`pressElsewhere`): HQ holds its press, or has
   * not said — an unregistered or unmarked Mate is then that press running, and finishing it would
   * race it. A press this tab made and saw stop holds nothing.
   */
  readonly pressedElsewhere: boolean;
  /** The viewer added this Mate: closing it off needs no registry rights. */
  readonly viewerIsAdder: boolean;
  /** Its project has its container: without one there is nothing for a close-off to finish. */
  readonly hasContainer: boolean;
  /** Its services have proved whether a container is present, even while a press holds it. */
  readonly containerKnown: boolean;
  /**
   * HQ offers the viewer writing the registry (`create_app`); `undefined` while HQ has not said,
   * or does not answer: then what the viewer finishes is not known, and nothing is offered.
   */
  readonly writer: boolean | undefined;
  /**
   * HQ, its structure known, holds no record of this Mate: the record's write failed mid-way, or
   * it sits in no application with none — and its birth with it.
   */
  readonly recordMissing: boolean;
  /** HQ's rule lets the viewer create its record (`create_mate_record`). */
  readonly mayCreateRecord: boolean;
  /**
   * HQ says its key reads other projects too (`keyWider`, ADR 0003's fallout): *Finish setup*'s
   * harden takes those grants off, by the key's id HQ tells (`mayEditRecord`).
   */
  readonly keyWider?: boolean;
  /**
   * HQ offers the viewer editing the Mate's record (`edit_mate_record`): HQ tells them its key's
   * id, which the harden narrows.
   */
  readonly mayEditRecord?: boolean;
}): string | undefined {
  // An unread service listing proves neither a container nor its absence. Finishing then could
  // register and close off the birth while silently skipping its container import.
  if (!input.containerKnown) return undefined;
  if (input.keyWider === true && input.mayEditRecord === true) return FINISH_MATE_SETUP_VERB;
  // Its record, and its birth after it, are whoever HQ's rule lets create the record.
  if (
    input.recordMissing &&
    input.mayCreateRecord &&
    (input.pressStopped || !input.pressedElsewhere)
  ) {
    return FINISH_MATE_SETUP_VERB;
  }
  if (input.writer === undefined) return undefined;
  if (input.writer) {
    const halfMade =
      input.pressStopped ||
      (!input.pressedElsewhere &&
        (input.registration === "unplaced" || input.containerMissing || input.closedOffMissing));
    return halfMade ? FINISH_MATE_SETUP_VERB : undefined;
  }
  // The Mate's own adder may close it off — nothing more: its registration and a container to
  // make are an owner's or an admin's. With no container there is nothing to close off.
  if (
    input.viewerIsAdder &&
    input.hasContainer &&
    (input.pressStopped || (!input.pressedElsewhere && input.closedOffMissing))
  ) {
    return FINISH_MATE_SETUP_VERB;
  }
  return undefined;
}

/** What a viewer's *Finish setup* runs: all of it for a registry writer, else the close-off. */
export function finishMateSetupScope(writer: boolean): "whole" | "close-off" {
  return writer ? "whole" : "close-off";
}

export const FINISH_MATE_SETUP_VERB = "Finish setup";
