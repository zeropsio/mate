/**
 * A Mate's state and the verbs a person is offered on it: one pure answer that the menu (the
 * projects screen's and the left menu's), the left menu's row and the Mate's page render. None of
 * them decides it again.
 *
 * One rule for the whole screen (guide 0.8): **a verb a person cannot finish is not offered**. A
 * platform write the platform refuses from the person's role, or an HQ write HQ refuses, is never
 * drawn: an offer that fails afterwards turns a permission into an error message.
 */
import {
  isMateKind,
  projectReach,
  type RoleMateVisibility,
  type ZeropsOrgRole,
} from "@t3tools/shared/zeropsRoles";
import type { HqOfferState } from "@t3tools/shared/hqOffers";

import type { ZeropsCandidate } from "./candidates.ts";
import type { ContainerLevel } from "./environments/containerMachine.ts";
import { heldOf, type HqMateOfferStates } from "./hq/placement.ts";
import { hasMate, PROJECT_GOING_STATUSES } from "./mateEnvironments.ts";
import { readZeropsMembership } from "./groups.ts";

/** The container machine's level for a Mate's target, and whether its cap ran out. */
export interface MateContainerLevel {
  readonly level: ContainerLevel["level"];
  readonly overdue: boolean;
}

/** Who is looking, as much as their verbs need. */
export interface MateViewerFacts {
  /** Their effective role on its project (`resolveMateProjectRole`). */
  readonly role: ZeropsOrgRole;
  /** Whether they may see or open it (`mateVisibility`); absent while it is not judged. */
  readonly visibility: RoleMateVisibility | undefined;
  /** HQ's offers of its record and its place (`hqMateOffers`); absent while HQ has not said. */
  readonly offers: HqMateOfferStates | undefined;
  /** An owner or admin of the organization, who hands Mates over (`handsOverMates`). */
  readonly handsOver: boolean;
}

/**
 * How far a Mate has come into being: a shared birth HQ holds open for its project (`birth`),
 * coming up (`coming`), stopped with a container that has no deployment (`redeploy`), stopped
 * otherwise (`failed`), or come (`none`).
 */
export type MateArrival = "none" | "birth" | "coming" | "redeploy" | "failed";

/** A Mate's arrival from its coming (`mateComing`): a shared birth's carries its birth. */
export function mateArrivalOf(
  coming:
    | { readonly kind: "coming"; readonly birth?: unknown }
    | { readonly kind: "failed"; readonly verb: string }
    | undefined,
): MateArrival {
  if (coming === undefined) return "none";
  if (coming.kind === "coming") return coming.birth === undefined ? "coming" : "birth";
  return coming.verb === "redeploy" ? "redeploy" : "failed";
}

export interface MateFacts {
  /** Its row in the listing: group, platform statuses, its project's placement and tags. */
  readonly candidate: ZeropsCandidate;
  /** Its container machine's level; absent while no machine reads its target. */
  readonly level: MateContainerLevel | undefined;
  readonly arrival: MateArrival;
  /** HQ's deletion of it runs or waits for its maker (`mateGoing` over `mateDeletionOf`), on every device. */
  readonly deletionGoing: boolean;
  /** HQ's placement is current: a project it does not place is placed nowhere. */
  readonly placementKnown: boolean;
  /** Who is looking; `null` where the surface does not read them, and then no verb is offered. */
  readonly viewer: MateViewerFacts | null;
}

/** A verb of HQ's: offered, held while HQ has not said or does not answer (drawn, not pressable), or not drawn. */
export type HqVerb = "offered" | "held" | "no";

export interface MateVerbs {
  readonly start: boolean;
  readonly restart: boolean;
  readonly redeploy: boolean;
  /** Renaming its project, whose name is the Mate's: a platform write for its OWNER or ADMIN. */
  readonly rename: boolean;
  readonly face: HqVerb;
  /** Handing it over: an organization owner's or admin's. */
  readonly assign: boolean;
  /** Who reaches its project: anyone may look. */
  readonly access: boolean;
  readonly move: HqVerb;
  readonly leave: HqVerb;
  /** Taking it off Zerops: where HQ offers the viewer its record (`edit_mate_record`). */
  readonly delete: boolean;
}

export interface MateState {
  /** On its way off Zerops: HQ's deletion of it runs, or the platform says so. */
  readonly deleting: boolean;
  /** HQ's current placement holds no record of it, and nothing is bringing it up. */
  readonly outsideHq: boolean;
  /**
   * What its menu holds: nothing (`none`), its shared birth's own entries (`birth`), Delete alone
   * while it comes up (`setup`), or its verbs (`verbs`).
   */
  readonly menu: "none" | "birth" | "setup" | "verbs";
  readonly verbs: MateVerbs;
}

const NO_VERBS: MateVerbs = {
  start: false,
  restart: false,
  redeploy: false,
  rename: false,
  face: "no",
  assign: false,
  access: false,
  move: "no",
  leave: "no",
  delete: false,
};

/** Levels at which the platform or our own verb is already bringing the container up. */
const COMING_UP: ReadonlySet<ContainerLevel["level"]> = new Set([
  "creating",
  "provisioning",
  "restarting",
  "updating",
]);

const hqVerb = (state: HqOfferState): HqVerb =>
  state.kind === "allowed" ? "offered" : state.kind === "refused" ? "no" : "held";

/** The project, or its container while the project is ACTIVE, is STOPPED. */
const isStopped = (candidate: ZeropsCandidate): boolean =>
  candidate.project.status === "STOPPED" || candidate.service?.status === "STOPPED";

/** The project or its container is on its way to or from STOPPED: the platform is at work. */
const inTransition = (candidate: ZeropsCandidate): boolean =>
  [candidate.project.status, candidate.service?.status].some(
    (status) => status === "STARTING" || status === "STOPPING",
  );

/** Whether a Mate is on its way off Zerops: HQ's deletion of it runs, or the platform says so. */
export function mateDeleting(status: string, going: boolean): boolean {
  return going || PROJECT_GOING_STATUSES.has(status);
}

export function mateState(facts: MateFacts): MateState {
  const { candidate, viewer } = facts;
  const deleting = mateDeleting(candidate.project.status, facts.deletionGoing);
  // A project HQ holds no record of is no Mate by HQ's word (`hasMate`); its Mate container standing
  // there is what makes it a Mate outside HQ.
  const outsideHq =
    facts.placementKnown &&
    candidate.project.hq === undefined &&
    candidate.service !== undefined &&
    facts.arrival === "none";
  const state = (menu: MateState["menu"], verbs: MateVerbs = NO_VERBS): MateState => ({
    deleting,
    outsideHq,
    menu,
    verbs,
  });
  if (deleting) return state("none");
  // A shared birth's own entries (Continue, Delete) are HQ's answer for the person.
  if (facts.arrival === "birth") return state("birth");
  if (outsideHq) return state("none");

  const reach = viewer === null ? null : projectReach(viewer.role);
  // A Mate the person may see but not open offers nothing that operates it.
  const operates =
    viewer !== null &&
    viewer.visibility !== "listed" &&
    viewer.visibility !== "hidden" &&
    (reach === "work" || reach === "administer");
  const record =
    viewer?.offers?.held === true && isMateKind(heldOf(candidate.project))
      ? viewer.offers
      : undefined;
  const mate = hasMate(candidate);
  const remove = record?.edit.kind === "allowed" && mate;
  if (facts.arrival === "coming") return state("setup", { ...NO_VERBS, delete: remove });

  const redeploy = operates && facts.arrival === "redeploy";
  const level = facts.level;
  return state("verbs", {
    start:
      operates &&
      !redeploy &&
      candidate.group === "unavailable" &&
      candidate.creationFailed === undefined &&
      candidate.missingContainer !== true &&
      !inTransition(candidate) &&
      isStopped(candidate),
    // Never while the platform or our verb already brings it up: a restart would race it.
    restart:
      operates &&
      candidate.project.status === "ACTIVE" &&
      candidate.service?.status === "ACTIVE" &&
      (level === undefined || !COMING_UP.has(level.level) || level.overdue),
    redeploy,
    rename: reach === "administer",
    face: record !== undefined && mate ? hqVerb(record.edit) : "no",
    assign: viewer?.handsOver === true,
    access: viewer !== null,
    move: record === undefined ? "no" : hqVerb(record.edit),
    leave:
      record === undefined || readZeropsMembership(candidate.project).groupId === undefined
        ? "no"
        : hqVerb(record.detach),
    delete: remove,
  });
}
