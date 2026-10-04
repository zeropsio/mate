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
 * them write the registry (D3) — so an offered verb a member cannot finish
 * would be an error message after the fact (guide 0.8). The gate here is
 * therefore stricter than `canCreateMates`: a `READ_ONLY` member with *can
 * create projects* may add a **Mate** to a group that exists, and may not make
 * a group.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module groupCreation
 */

import type { ZeropsRegistry } from "./hq/registry.ts";
import { mateMemberName, type MateOwnerCandidate } from "./mateAccess.ts";
import { mayOffer, offerAsker, type OfferViewer } from "./offers.ts";

/** A verb is either offered, or refused in words that name who can do it. */
export type GroupVerb =
  | { readonly offered: true }
  | { readonly offered: false; readonly reason: string };

const OFFERED: GroupVerb = { offered: true };

/** Who may write the registry: whom HQ's rule lets make an application (`create_app`). */
export function canWriteRegistry(viewer: OfferViewer | undefined): boolean {
  return mayOffer(offerAsker(viewer, []), "create_app", null);
}

/**
 * Whether this person is offered *Add project*, and what the row says instead: a member simply is
 * not the one who does this.
 */
export function resolveAddProjectVerb(input: {
  /** Nobody where the session names nobody: then it is not offered. */
  readonly viewer: OfferViewer | undefined;
  /** The org's owners and admins, for the refusal that names them. */
  readonly admins?: ReadonlyArray<MateOwnerCandidate> | undefined;
}): GroupVerb {
  if (!canWriteRegistry(input.viewer)) {
    return { offered: false, reason: onlyTheseCanAddAProject(input.admins ?? []) };
  }
  return OFFERED;
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
 * Whether the registry knows about a Mate yet (guide 4.2).
 *
 * A member with *can create projects* may make a Mate, and may not write the
 * registry — so their new Mate exists and runs, and HQ holds it in no
 * application until an owner or admin adds it. That is a real state with a real
 * consequence (HQ gives a repository only to a Mate it holds in an
 * application), and the row says it rather than showing a Mate that looks
 * finished and cannot deliver.
 *
 * An owner's own creation writes the entry in the same breath, so this is
 * `registered` before the row is ever painted.
 */
export type MateRegistration = "registered" | "awaiting-owner";

export function resolveMateRegistration(input: {
  readonly registry: ZeropsRegistry;
  readonly projectId: string;
}): MateRegistration {
  const registered = input.registry.groups.some((group) =>
    group.projects.some((project) => project.projectId === input.projectId),
  );
  return registered ? "registered" : "awaiting-owner";
}

/**
 * *Finish setup*, on a half-made Mate's ⋯ menu (pass 28): the press's own steps run again on a
 * Mate whose press did not finish — its container imported with its key where it has none, its
 * project closed off, its registration written. A member with *can create projects* makes a Mate
 * and cannot write the registry, so their Mate runs in no application until somebody who can
 * finishes it; a press a closed tab cut short leaves the same. That somebody is an org owner or
 * admin, in any browser. A Mate HQ holds no record of has its record written, and its birth with it, by
 * whoever HQ's rule lets create the record.
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
   * project closed off: a press interrupted before its close-off, whose runtimes zcp holds back.
   */
  readonly closedOffMissing: boolean;
  /**
   * Its project is older than the grace a press in another browser has (`MATE_CONTAINER_GRACE_MS`):
   * before it, an unregistered or unmarked Mate may be a press still running, and finishing it
   * would race that press. A press this tab made and saw stop needs no grace.
   */
  readonly pastGrace: boolean;
  /** The viewer added this Mate: closing it off needs no registry rights. */
  readonly viewerIsAdder: boolean;
  /** Its project has its container: without one there is nothing for a close-off to finish. */
  readonly hasContainer: boolean;
  /** The viewer writes the registry (`canWriteRegistry`). */
  readonly writer: boolean;
  /**
   * HQ, its structure known, holds no record of this Mate: the record's write failed mid-way, or
   * it sits in no application with none — and its birth with it.
   */
  readonly recordMissing: boolean;
  /** HQ's rule lets the viewer create its record (`create_mate_record`). */
  readonly mayCreateRecord: boolean;
  /**
   * HQ says its key reads other projects too (`keyWider`, ADR 0003's fallout): *Finish setup*'s
   * harden takes those grants off — for a registry writer, who may write the key.
   */
  readonly keyWider?: boolean;
}): string | undefined {
  if (input.keyWider === true && input.writer) return FINISH_MATE_SETUP_VERB;
  // Its record, and its birth after it, are whoever HQ's rule lets create the record.
  if (input.recordMissing && input.mayCreateRecord && (input.pressStopped || input.pastGrace)) {
    return FINISH_MATE_SETUP_VERB;
  }
  if (input.writer) {
    const halfMade =
      input.pressStopped ||
      (input.pastGrace &&
        (input.registration === "awaiting-owner" ||
          input.containerMissing ||
          input.closedOffMissing));
    return halfMade ? FINISH_MATE_SETUP_VERB : undefined;
  }
  // The Mate's own adder may close it off — nothing more: its registration and a container to
  // make are an owner's or an admin's. With no container there is nothing to close off.
  if (
    input.viewerIsAdder &&
    input.hasContainer &&
    (input.pressStopped || (input.pastGrace && input.closedOffMissing))
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
