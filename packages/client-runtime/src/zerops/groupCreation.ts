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
import { mateMemberName, type MateAccessViewer, type MateOwnerCandidate } from "./mateAccess.ts";

/** A verb is either offered, or refused in words that name who can do it. */
export type GroupVerb =
  | { readonly offered: true }
  | { readonly offered: false; readonly reason: string };

const OFFERED: GroupVerb = { offered: true };

/** Who may write the registry: an org owner or admin, and nobody else (D3, HQ's own rule). */
export function canWriteRegistry(viewer: { readonly roleCode?: string | undefined }): boolean {
  return viewer.roleCode === "OWNER" || viewer.roleCode === "ADMIN";
}

/**
 * Whether this person is offered *Add project*, and what the row says instead: a member simply is
 * not the one who does this.
 */
export function resolveAddProjectVerb(input: {
  readonly viewer: MateAccessViewer;
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
 * How far the broker has got with a group's Gitea side.
 *
 * `asking` is not a spinner state to hide — the group is usable as a place to
 * put a Mate from the moment its tag lands, and the org matters only when
 * somebody wants the repositories. It is the difference between "we asked for
 * this" and "this exists", which is the line guide 4.5 draws through the whole
 * screen.
 */
export type GroupGiteaState = "ready" | "being-set-up" | "unknown";

export function resolveGroupGitea(input: {
  /** What `GET /orgs/{slug}` answered as the person: the org, or nothing. */
  readonly organizationExists: boolean | undefined;
}): GroupGiteaState {
  if (input.organizationExists === undefined) return "unknown";
  return input.organizationExists ? "ready" : "being-set-up";
}

/**
 * Whether the registry knows about a Mate yet (guide 4.2).
 *
 * A member with *can create projects* may make a Mate, and may not write the
 * registry — so their new Mate exists, runs, and has neither group reach nor a
 * Gitea bot until an owner or admin adds it. That is a real state with a real
 * consequence (the broker refuses `POST /mate/credential` with
 * `not_registered`), and the row says it rather than showing a Mate that looks
 * finished and cannot push.
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
 * The one line such a Mate carries, in place of its Gitea facts.
 *
 * It names the consequence, not the plumbing: "not in the registry" means
 * nothing to the person who made it, and "cannot push yet" is what they will
 * actually run into.
 */
export function mateAwaitingRegistryLine(admins: ReadonlyArray<MateOwnerCandidate> = []): string {
  const names = admins
    .map((admin) => mateMemberName(admin))
    .filter((name): name is string => name !== undefined);
  const who = names.length === 0 ? "an owner or admin" : names.join(" or ");
  return `Waiting for ${who} to add it to the project — until then it cannot push.`;
}

/**
 * *Finish setup*, on a half-made Mate's ⋯ menu (pass 28): the press's own steps run again on a
 * Mate whose press did not finish — its container imported with its key where it has none, its
 * project closed off, its registration written. A member with *can create projects* makes a Mate
 * and cannot write the registry, so their Mate runs with no group reach and no bot until somebody
 * who can finishes it; a press a closed tab cut short leaves the same. That somebody is an org
 * owner or admin — the only people the platform lets write the Gitea project's tags (D3) — in any
 * browser.
 *
 * `undefined` for everybody else, and for a Mate already whole: a disabled entry on a row a person
 * can do nothing about is noise, and the row already says who it is waiting for
 * (`mateAwaitingRegistryLine`).
 */
export function finishMateSetupVerb(input: {
  readonly registration: MateRegistration;
  /** Its project has no container: its import never went through. */
  readonly containerMissing: boolean;
  /** A press this tab made for it stopped at a step. */
  readonly pressStopped: boolean;
  /**
   * Its container carries the press's marker (`MATE_SETUP_RUNTIMES`) and its project no
   * `mate:closed-off`: a press interrupted before its close-off, whose runtimes zcp holds back.
   */
  readonly closedOffMissing: boolean;
  /**
   * Its project is older than the grace a press in another browser has (`MATE_CONTAINER_GRACE_MS`):
   * before it, an unregistered or unmarked Mate may be a press still running, and finishing it
   * would race that press. A press this tab made and saw stop needs no grace.
   */
  readonly pastGrace: boolean;
  /**
   * The platform's token list shows every key of its still `ADMIN` on its own project, and this
   * viewer may write them — an org owner, or their creator (`mateHardenableBy`): a pool-claimed
   * or older Mate whose harden never ran.
   */
  readonly needsHarden: boolean;
  /** The viewer added this Mate: closing it off needs no registry rights. */
  readonly viewerIsAdder: boolean;
  /** Its project has its container: without one there is nothing for a close-off to finish. */
  readonly hasContainer: boolean;
  /** The viewer's org role, as the platform spells it. */
  readonly viewerRole?: string | undefined;
}): string | undefined {
  if (input.viewerRole === "OWNER" || input.viewerRole === "ADMIN") {
    const halfMade =
      input.pressStopped ||
      (input.pastGrace &&
        (input.registration === "awaiting-owner" ||
          input.containerMissing ||
          input.closedOffMissing ||
          input.needsHarden));
    return halfMade ? FINISH_MATE_SETUP_VERB : undefined;
  }
  // The key's creator may harden it.
  if (input.pastGrace && input.needsHarden) return FINISH_MATE_SETUP_VERB;
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

/** What a viewer's *Finish setup* runs: all of it for an owner or an admin, else the close-off. */
export function finishMateSetupScope(viewerRole: string | undefined): "whole" | "close-off" {
  return viewerRole === "OWNER" || viewerRole === "ADMIN" ? "whole" : "close-off";
}

export const FINISH_MATE_SETUP_VERB = "Finish setup";
