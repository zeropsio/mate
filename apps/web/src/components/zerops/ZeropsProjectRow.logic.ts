/**
 * What a row on the projects screen says and offers — the words and the verb,
 * not the pixels.
 *
 * This is the picker's judgement moved into one pure place: the four-way
 * bucket `candidates.ts` already made, the container's health probe, and the
 * socket's phase for a registered environment, folded into a status, a
 * one-line detail and at most one action. The tree renders whatever this
 * returns and decides nothing itself (R5).
 */

import {
  connectionBannerCopy,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import {
  formatMateFace,
  hasMate,
  isGenericPlatformError,
  newMateTint,
  readZeropsToolKind,
  readZeropsMembership,
  type ZeropsEnvironmentRole,
  type ZeropsEnvironmentServices,
  type FlowReleaseRow,
  type GroupRowTone,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  HQ_PROJECT_NAME,
  type HqMateOfferStates,
  type HqPresses,
  type HqStructure,
  type OfficialHq,
} from "@t3tools/client-runtime/zerops/hq";
import { RESTARTING_PHRASE } from "@t3tools/client-runtime/zerops/environments";
import type { CandidatePresence } from "@t3tools/client-runtime/zerops/projections";
import {
  mateOnlyOwnerOpensIt,
  type RoleMateVisibility,
} from "@t3tools/client-runtime/zerops/mateAccess";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/containerHealth";
import { MATE_SHAPE_OF_TINT, type ServiceStatusToneId } from "@t3tools/shared/brand";

export type ZeropsRowCandidate = ZeropsCandidate & {
  readonly connection?: EnvironmentConnectionPresentation;
  /**
   * Whether the inventory has read what decides this row's container
   * (`selectCandidates`). An `unknown` row sits in the unavailable bucket
   * with nothing to say against it; it is being checked, not refused.
   */
  readonly presence?: CandidatePresence;
};

/** HQ's current absence is a fact; a local birth still owns its progress. */
export function mateOutsideHq(
  project: ZeropsCandidate["project"],
  known: boolean,
  birthing: boolean,
): boolean {
  return known && project.hq === undefined && !birthing;
}

export const NOT_IN_HQ_LINE = "Not in this HQ";

export interface ZeropsRowInput {
  /** What says a project is its person's own (`plainZeropsProject`); none, and nothing is. */
  readonly plainEvidence?: PlainProjectEvidence | undefined;
  /** A current HQ structure places no record here, and no local birth is in progress. */
  readonly outsideHq?: boolean;
  readonly candidate: ZeropsRowCandidate;
  /** Absent = the health probe has not answered yet. */
  readonly health: ZeropsContainerHealth | undefined;
  /** The environment's role in its project, when it has one. */
  readonly role?: ZeropsEnvironmentRole | undefined;
  /**
   * What this viewer may do with this Mate (D5). `listed` is shown and never
   * opened; absent means the caller is not making that distinction (an
   * environment that is not a Mate, a list with no membership to judge by).
   */
  readonly visibility?: RoleMateVisibility | undefined;
  /** Who owns it, when the account can be read for a name. */
  readonly ownerName?: string | undefined;
  /**
   * The platform process, when one is known to be running against this
   * candidate's container — what an `initializing` row's detail names,
   * instead of a generic "Zerops Mate is starting."
   */
  readonly runningProcessKind?: "restart-service" | "start-service" | "start-project" | undefined;
  /**
   * `ZCP_MATE_ENABLED`'s own read (`ZeropsApiClient.isZeropsMateEnabled`),
   * for a `predates-mate` row only — the fact that tells this container
   * apart from one merely away (spec-mate §4.5, H9). `"unknown"` for a read
   * that failed; absent for one not yet made (or made for any other
   * health), read the same conservative way as `false`.
   */
  readonly mateFlag?: boolean | "unknown" | undefined;
  /**
   * This client is waiting on the container itself — the wait a creation
   * started, resumed after a reload, or the identity exchange in flight. The
   * row then offers no verb and says only how long is left; the wait ends in
   * the conversation, not on a click.
   */
  readonly waiting?: boolean | undefined;
  /**
   * Its container's first build is past its grace (`firstBuildOverdue`): still on its way, taking
   * longer than usual.
   */
  readonly firstBuildOverdue?: boolean | undefined;
  /** Which verbs the caller can actually perform; a verb it cannot is never offered. */
  readonly can: {
    /** Opening covers connecting: a ready Mate opens by connecting first. */
    readonly open: boolean;
    readonly enable: boolean;
    readonly setUpMate: boolean;
    /**
     * *Set up Mate* on an existing plain project (`plainZeropsProject`): HQ offers the viewer writing
     * the new Mate's record (`create_mate_record`), which the press registers before its container.
     */
    readonly setUpPlainProject?: boolean;
    readonly start: boolean;
    readonly restart: boolean;
    /** Deleting a project the platform failed to create. */
    readonly remove: boolean;
  };
}

const ROW_VERBS = (offered: boolean): ZeropsRowInput["can"] => ({
  open: offered,
  enable: offered,
  setUpMate: offered,
  start: offered,
  restart: offered,
  remove: offered,
});

/**
 * A row's verbs for this person, none of them HQ's to enforce: opening is its Mate's door's, the
 * rest Zerops' — each refusal shown as they word it. None where HQ refuses following its Mate
 * (`observe_mate`): the door would refuse them too. Every one otherwise — where HQ offers it, has
 * not said (an HQ from before its offers, a structure not read yet), or does not answer, and on a
 * project HQ holds as no Mate. *Set up Mate* on a plain project only where HQ offers writing its
 * Mate's record (`create_mate_record`), which the press registers and HQ enforces.
 */
export function mateRowCan(offers: HqMateOfferStates | undefined): ZeropsRowInput["can"] {
  return {
    ...ROW_VERBS(offers?.held !== true || offers.observe.kind !== "refused"),
    setUpPlainProject: offers?.held === false && offers.createRecord.kind === "allowed",
  };
}

export type ZeropsRowAction =
  /** The card's one action: a connected Mate opens, a ready one connects and then opens. */
  | { readonly kind: "open"; readonly label: "Open" }
  | { readonly kind: "enable"; readonly label: "Enable Zerops Mate" }
  | { readonly kind: "set-up-mate"; readonly label: "Set up Mate" }
  | { readonly kind: "start"; readonly label: "Start" }
  /** A project the platform failed to create is taken off the account. */
  | { readonly kind: "remove"; readonly label: "Remove" }
  /** The Mate card's menu only (`deriveZeropsRestartAction`), never the row's own verb. */
  | { readonly kind: "restart"; readonly label: "Restart" }
  /**
   * A re-probe, nothing that writes (H9) — offered for `unreachable` and
   * `stalled`, which a browser cannot tell apart from a container that
   * simply predates Zerops Mate (spec-mate §4.5). Only a read fact, never
   * this inference, may justify the restart `enable` performs.
   */
  | { readonly kind: "retry-probe"; readonly label: "Try again" }
  /** The container is on its way, the probe or the socket still busy: no verb yet. */
  | { readonly kind: "pending" }
  | { readonly kind: "not-in-hq" }
  | { readonly kind: "none" };

/**
 * How a Mate's "Set up Mate" verb reads while a setup is running.
 *
 * Setting up a half-made Mate is serialised — one import at a time, because
 * the provisioning wait is a single slot. Only the row being set up was
 * disabled, so every other Mate kept a verb that looked pressable and did
 * nothing at all: the guard returned before it reached the platform and said
 * nothing on the way out.
 *
 * Serialising is fine. A control that lies about it is not, so a row waiting
 * its turn is unpressable and keeps its own name — it is not "Setting up…",
 * because it is not.
 */
export function setUpMateVerb(input: {
  readonly candidateKey: string;
  readonly settingUpKey: string | null;
}): { readonly disabled: boolean; readonly label: "Set up Mate" | "Setting up…" } {
  if (input.settingUpKey === null) return { disabled: false, label: "Set up Mate" };
  return input.settingUpKey === input.candidateKey
    ? { disabled: true, label: "Setting up…" }
    : { disabled: true, label: "Set up Mate" };
}

/**
 * The record *Set up Mate* writes to HQ (`POST /api/mates`): the face a new Mate is born with —
 * the tint its name gets among the account's (`newMateTint`) and that tint's shape. Its name is its
 * project's in Zerops (D3). None for a project whose Mate HQ holds already.
 */
export function setUpMateRecord(input: {
  readonly project: ZeropsCandidate["project"];
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
}): { readonly face: string } | undefined {
  if (input.project.hq?.mate != null) return undefined;
  const tint = newMateTint(input.candidates, input.project.name);
  return { face: formatMateFace({ tint, shape: MATE_SHAPE_OF_TINT[tint] }) };
}

export interface ZeropsRowPresentation {
  readonly status: {
    readonly label: string;
    readonly pulse?: boolean;
    readonly tone: ServiceStatusToneId;
  };
  /** One muted line: an error, the health prose, or the bucket's reason. */
  readonly detail?: string;
  /** True when the detail is a failure and should read as one. */
  readonly detailIsError?: boolean;
}

const RUNNING_PROCESS_DETAIL: Readonly<
  Record<NonNullable<ZeropsRowInput["runningProcessKind"]>, string>
> = {
  "restart-service": "Restarting the container",
  "start-service": "Starting the container",
  "start-project": "Starting the project",
};

/**
 * The two lines under a Mate that is on its way. Expectations, not status
 * verbs: the face is asleep for the whole boot and these only say how long
 * — the container being made takes minutes, Mate answering takes seconds.
 */
export const COMING_UP_LINE = "Coming up. A few minutes.";
export const ALMOST_THERE_LINE = "Almost there.";
/** A birth's step outlasted its cap: words, never a stop (B-2). */
export const TAKING_LONGER_LINE = "Taking longer than usual.";
/** A creation this tab made stopped on a step, and says no more of why. */
export const NOT_SET_UP_LINE = "Could not be set up.";

/** Service statuses the inventory files under provisioning that restart a container it has. */
export const RESTARTING_SERVICE_STATUSES: ReadonlySet<string> = new Set([
  "RESTARTING",
  "UPGRADING",
]);

/**
 * The line under a project the platform failed to create, with the
 * platform's own words when it gave any worth repeating. Its empty internal
 * error says nothing a person can act on, so the line stays at the fact.
 */
export function creationFailedLine(message: string | undefined): string {
  const said = message?.trim();
  if (!said || isGenericPlatformError(said)) return "Could not be created.";
  const sentence = said.charAt(0).toUpperCase() + said.slice(1);
  return `Could not be created. ${/[.!?]$/u.test(sentence) ? sentence : `${sentence}.`}`;
}

/**
 * The sentence `connection/errors.ts` gives a 500 from the door — an
 * `EnvironmentInternalError` read as `remote-unavailable`. The words say
 * "not allowed" where the server fell over, so the row says what happened.
 */
const DOOR_INTERNAL_ERROR_SENTENCE = "The environment could not authorize the connection.";
const EXCHANGE_PREFIX = "Could not connect to this container. ";

/**
 * A connect failure as the Mate's own line. The exchange writes "Could not
 * connect to this container. <reason>"; the row already names the Mate, so
 * the sentence shortens to the reason — and a 500 gets the honest sentence
 * instead of one that reads as a refusal.
 */
export function connectFailureLine(error: string): string {
  if (!error.startsWith(EXCHANGE_PREFIX)) return error;
  const reason = error.slice(EXCHANGE_PREFIX.length);
  return reason === DOOR_INTERNAL_ERROR_SENTENCE
    ? "Could not connect. The Mate's server answered an error."
    : `Could not connect. ${reason}`;
}

/**
 * Whether a Mate is up: connected, or its container answered ready. What
 * the add verbs of a group wait for — a group is offered more only once its
 * first Mate has booted.
 */
export function mateIsUp(input: {
  readonly candidate: Pick<ZeropsCandidate, "group">;
  readonly health: ZeropsContainerHealth | undefined;
}): boolean {
  return (
    input.candidate.group === "connected" ||
    (input.candidate.group === "ready" && input.health === "ready")
  );
}

/**
 * Whether a group is offered more — its menu, its card's add verbs and *Add
 * production* — which it is once its first Mate is up, and not a minute
 * before.
 */
export function groupAddsOffered(
  environments: ReadonlyArray<{ readonly item: ZeropsCandidate }>,
  health: ReadonlyMap<string, ZeropsContainerHealth>,
): boolean {
  return environments.some(
    ({ item }) => hasMate(item) && mateIsUp({ candidate: item, health: health.get(item.key) }),
  );
}

function isConnectionInFlight(candidate: ZeropsRowCandidate): boolean {
  const phase = candidate.connection?.phase;
  return phase === "available" || phase === "connecting" || phase === "reconnecting";
}

export function isZeropsToolCandidate(candidate: ZeropsCandidate): boolean {
  return readZeropsToolKind(candidate.project) !== undefined;
}

/**
 * The bucket's reason, phrased for a person. `candidates.ts` writes reasons
 * for the log — "container is STOPPED", "container is starting (ACTIVE)" — and
 * a row is not a log: platform status tokens read in lowercase words, a
 * trailing parenthesis goes, "container" gets its article, and the line ends
 * as a sentence does.
 */
export function zeropsReasonSentence(reason: string): string {
  const withoutParenthesis = reason.replace(/\s*\([^)]*\)\s*$/u, "").trim();
  const worded = withoutParenthesis.replace(/\b[A-Z][A-Z_]+\b/gu, (token) =>
    token.toLowerCase().replaceAll("_", " "),
  );
  const withArticle = /^container\b/u.test(worded) ? `the ${worded}` : worded;
  const sentence = withArticle.charAt(0).toUpperCase() + withArticle.slice(1);
  return /[.!?]$/u.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * Whether an environment without a Mate is offered one. A Mate is a coding
 * agent with a shell in the environment; that is what a dev box is for, and
 * not what stage or production are for — those get their code from dev, not
 * from an agent typing into them. An environment with no role is not
 * judged: it may well be somebody's dev box.
 */
export function mateSetupOffered(role: ZeropsEnvironmentRole | undefined): boolean {
  return role !== "stage" && role !== "prod";
}

/**
 * What says a project is its person's own — evidence the caller gathers once for the page: HQ's
 * records, its anchor and this tab's own presses (`plainZeropsProject`).
 */
export interface PlainProjectEvidence {
  /** Every project HQ holds any record of (`hqRecordedProjects`), a press's included. */
  readonly hqRecords: ReadonlySet<string>;
  /** The project the organization's official HQ anchor names: the HQ carries no record of itself. */
  readonly hqAnchors: ReadonlySet<string>;
  /** The projects this tab is making or finishing. */
  readonly local: ReadonlySet<string>;
}

/**
 * An existing plain Zerops project, on HQ's word (security review 1, 11; ADR 0002, HQ holds the
 * structure): no Mate, no place in HQ and no record of it there at all, not the organization's HQ
 * by its anchor or its name, and not one this tab is making. A project's tags and its age decide
 * nothing. Anything nothing can tell apart — HQ's structure not known — is not plain.
 */
export function plainZeropsProject(
  project: ZeropsCandidate["project"],
  evidence: PlainProjectEvidence | undefined,
): boolean {
  if (evidence === undefined) return false;
  return (
    project.hq === undefined &&
    project.name !== HQ_PROJECT_NAME &&
    !evidence.hqRecords.has(project.id) &&
    !evidence.hqAnchors.has(project.id) &&
    !evidence.local.has(project.id)
  );
}

/**
 * The page's evidence for `plainZeropsProject`: none while HQ's structure is not known, or the
 * organization has no official HQ — with none, or an unclear one, nothing is plain. A press HQ holds
 * a record of, running elsewhere or stopped, is its Mate being made: never plain.
 */
export function plainEvidenceOf(input: {
  readonly hqKnown: boolean;
  readonly structure: HqStructure | null;
  /** Each press HQ holds a record of, by project (`hq_press`); none before HQ said. */
  readonly presses: HqPresses | null;
  readonly hq: OfficialHq;
  /** The projects this tab is making or finishing. */
  readonly local: Iterable<string>;
}): PlainProjectEvidence | undefined {
  if (!input.hqKnown || input.structure === null || input.hq.kind !== "official") return undefined;
  return {
    hqRecords: new Set([
      ...hqRecordedProjects(input.structure),
      ...Object.keys(input.presses ?? {}),
    ]),
    hqAnchors: new Set([input.hq.projectId]),
    local: new Set(input.local),
  };
}

/**
 * Every project HQ's structure holds any record of: placed in an application or none, a tool, a
 * birth bound to it, an environment, or one whose removal HQ has not finished.
 */
export function hqRecordedProjects(structure: HqStructure): ReadonlySet<string> {
  const recorded = new Set<string>();
  for (const tool of structure.tools ?? []) recorded.add(tool.projectId);
  for (const mate of structure.ungrouped) recorded.add(mate.projectId);
  for (const app of structure.apps) {
    for (const project of app.projects) recorded.add(project.projectId);
    for (const id of app.contents?.deletingProjectIds ?? []) recorded.add(id);
    // Environments HQ refused this reader are still among its projects above.
    const environments = Array.isArray(app.environments) ? app.environments : [];
    for (const environment of environments) recorded.add(environment.projectId);
    for (const birth of app.births ?? []) {
      if (birth.projectId != null) recorded.add(birth.projectId);
    }
  }
  return recorded;
}

/**
 * Platform transition — the project or its zcp service is on its way to or
 * from STOPPED. Neither has a verb: the platform is already doing the work,
 * offering one would only race it.
 */
function transitionalStatus(candidate: ZeropsRowCandidate): "starting" | "stopping" | undefined {
  const projectStatus = candidate.project.status;
  const serviceStatus = candidate.service?.status;
  if (projectStatus === "STARTING" || serviceStatus === "STARTING") return "starting";
  if (projectStatus === "STOPPING" || serviceStatus === "STOPPING") return "stopping";
  return undefined;
}

/** The project, or its zcp service while the project is ACTIVE, is STOPPED. */
function isStopped(candidate: ZeropsRowCandidate): boolean {
  return candidate.project.status === "STOPPED" || candidate.service?.status === "STOPPED";
}

export function deriveZeropsRowPresentation(input: ZeropsRowInput): ZeropsRowPresentation {
  const { candidate, health, runningProcessKind } = input;
  if (input.outsideHq) {
    return { status: { label: NOT_IN_HQ_LINE, tone: "off" }, detail: NOT_IN_HQ_LINE };
  }

  // Whose Mate it is outranks whatever its container is doing. A person who
  // cannot open it is not waiting for it to start, and telling them it is
  // "Ready" would be an invitation the door refuses.
  if (input.visibility === "listed") {
    return {
      status: { label: "Not yours", tone: "off" },
      detail: mateOnlyOwnerOpensIt(input.ownerName),
    };
  }

  if (candidate.group === "connected") {
    return { status: { label: "Connected", tone: "ok" } };
  }
  if (candidate.group === "provisioning") {
    if (RESTARTING_SERVICE_STATUSES.has(candidate.service?.status ?? "")) {
      return {
        status: { label: "Restarting", pulse: true, tone: "busy" },
        // The container already exists; "Coming up" would say it is being made.
        detail: RESTARTING_PHRASE,
      };
    }
    return {
      status: { label: "Preparing", pulse: true, tone: "busy" },
      detail: input.firstBuildOverdue === true ? TAKING_LONGER_LINE : COMING_UP_LINE,
    };
  }
  if (candidate.group === "unavailable") {
    // The platform failed to make the project: it will sit in NEW for good,
    // so the row says so in the failed tone rather than "coming up" forever.
    if (candidate.creationFailed !== undefined) {
      return {
        status: { label: "Not created", tone: "failed" },
        detail: creationFailedLine(candidate.creationFailed.message),
        detailIsError: true,
      };
    }
    // A project that merely has no container is not unavailable. Read on a
    // Mate's card this is a Mate whose body is gone — the tag declares it,
    // nothing runs it — and the verb beside it sets it up again; an
    // environment's row never shows this word at all, because for stage and
    // production a missing container is the default and not a fault.
    if (candidate.missingContainer === true && !isZeropsToolCandidate(candidate)) {
      return {
        status: { label: "No container", tone: "off" },
        detail: "This Mate has no container yet.",
      };
    }
    const transitional = transitionalStatus(candidate);
    if (transitional !== undefined) {
      return {
        status: {
          label: transitional === "stopping" ? "Stopping" : "Starting",
          pulse: true,
          tone: "busy",
        },
      };
    }
    if (isStopped(candidate)) {
      return { status: { label: "Stopped", tone: "off" }, detail: "Stopped" };
    }
    // A container still being made answers with whatever it is busy with —
    // "The container is ready to deploy.", "Public access is off for this
    // container." — and neither is progress towards a Mate: one is a deploy
    // state and the other is a routing setting, shown to somebody waiting to
    // be told their Mate is up.
    //
    // Worse, the inventory moves a creating candidate between `provisioning`
    // and `unavailable`, so the row flipped between the two vocabularies:
    // measured 2026-09-19, `Coming up.` → `ready to deploy.` → `Coming up.` →
    // `ready to deploy.` inside 0.8 s. Progress that goes backwards. While the
    // creation is on its way this says exactly what the provisioning branch
    // says, so there is nothing for it to disagree with.
    if (input.waiting === true) {
      return { status: { label: "Preparing", pulse: true, tone: "busy" }, detail: COMING_UP_LINE };
    }
    // Unknown is not unavailable: the inventory has not yet said whether a
    // container is there, so the row is still being checked (DESIGN §3.4).
    // A plain project offered Set up Mate is not being checked: nothing reads its services until
    // something leases it, and its Set up Mate reads them as it runs.
    if (candidate.presence === "unknown" && deriveZeropsRowAction(input).kind !== "set-up-mate") {
      return { status: { label: "Checking", pulse: true, tone: "busy" } };
    }
    return {
      status: { label: "Not available", tone: "off" },
      ...(candidate.reason === undefined ? {} : { detail: zeropsReasonSentence(candidate.reason) }),
    };
  }

  // Ready: what the socket, then the probe, have to say. A failed socket
  // names its cause (`connectionBannerCopy`), never the failure's own words,
  // which carry the container's host and URL.
  const connection = candidate.connection;
  const failed =
    connection !== undefined &&
    (connection.phase === "error" ||
      (connection.phase === "reconnecting" && connection.error !== null));
  if (failed) {
    const cause = connectionBannerCopy(connection, null)?.description ?? null;
    return {
      status:
        connection.phase === "error"
          ? { label: "Connection failed", tone: "failed" }
          : { label: "Reconnecting", tone: "attention" },
      ...(cause === null ? {} : { detail: cause }),
      detailIsError: true,
    };
  }
  if (isConnectionInFlight(candidate)) {
    // The status cell says it; a second line saying it again would only
    // arrive and leave with the socket, moving every row below.
    return {
      status: {
        label: connection?.phase === "reconnecting" ? "Reconnecting" : "Connecting",
        pulse: true,
        tone: "busy",
      },
    };
  }
  switch (health) {
    case "predates-mate":
      // The flag reads on: this is a container mid-init, not one waiting on
      // Enable — `ZCP_MATE_ENABLED` is what zcp keys every mate-shaped
      // effect off, so an install not finished yet answers exactly like a
      // container that never had it (H9).
      if (input.mateFlag === true) {
        return {
          detail: "Zerops Mate is starting.",
          status: { label: "Starting", pulse: true, tone: "busy" },
        };
      }
      if (input.mateFlag === "unknown") {
        return {
          detail: "Could not tell whether Zerops Mate is enabled here.",
          status: { label: "Not answering", tone: "attention" },
        };
      }
      return {
        detail: "Zerops Mate is not enabled on this container yet.",
        status: { label: "Needs Zerops Mate", tone: "attention" },
      };
    case "unreachable":
      return {
        detail: "Not answering right now.",
        status: { label: "Not answering", tone: "attention" },
      };
    case "initializing":
      return {
        detail:
          runningProcessKind === undefined
            ? ALMOST_THERE_LINE
            : RUNNING_PROCESS_DETAIL[runningProcessKind],
        status: { label: "Starting", pulse: true, tone: "busy" },
      };
    case "stalled":
      return {
        detail: "Not answering right now.",
        status: { label: "Not answering", tone: "attention" },
      };
    case "ready":
      return {
        status: { label: "Ready", tone: "ok" },
        ...(input.waiting === true ? { detail: ALMOST_THERE_LINE } : {}),
      };
    default:
      return {
        status: { label: "Checking", pulse: true, tone: "busy" },
        ...(input.waiting === true ? { detail: ALMOST_THERE_LINE } : {}),
      };
  }
}

/**
 * The menu's Restart, offered whenever the Mate's container can be bounced:
 * the project is up and Zerops reports its container ACTIVE. One still on its
 * first build, or already restarting, is the platform's to bring up — a restart
 * would race it. Not a row verb — a running Mate's primary action is to open or
 * connect, and a restart is a quiet recovery for the menu.
 */
export function deriveZeropsRestartAction(input: ZeropsRowInput): ZeropsRowAction {
  const { candidate, can } = input;
  if (isZeropsToolCandidate(candidate)) return { kind: "none" };
  if (input.visibility === "listed") return { kind: "none" };
  return can.restart &&
    candidate.project.status === "ACTIVE" &&
    candidate.service?.status === "ACTIVE"
    ? { kind: "restart", label: "Restart" }
    : { kind: "none" };
}

export function deriveZeropsRowAction(input: ZeropsRowInput): ZeropsRowAction {
  const { candidate, health, can } = input;
  const role = input.role ?? readZeropsMembership(candidate.project).role;
  if (input.outsideHq) return { kind: "not-in-hq" };
  if (isZeropsToolCandidate(candidate)) return { kind: "none" };
  // A verb the door would refuse is not offered (D5). The row says why in
  // place of it.
  if (input.visibility === "listed") return { kind: "none" };

  switch (candidate.group) {
    case "connected":
      return can.open ? { kind: "open", label: "Open" } : { kind: "none" };
    // The container is being made; the face is asleep and the line says how
    // long. Nothing to click: the wait is the page's, not the person's.
    case "provisioning":
      return { kind: "none" };
    case "unavailable":
      // Nothing will ever run here; the one thing to do is take it away.
      if (candidate.creationFailed !== undefined) {
        return can.remove ? { kind: "remove", label: "Remove" } : { kind: "none" };
      }
      // An explicit dev role or a declared Mate with no container, or an existing plain project its
      // viewer may bring a Mate into (`plainZeropsProject`) — its services read with none, or not
      // read at all: 0.13 reads them only once something leases the project, and Set up Mate reads
      // them as it runs, importing nothing where a container is there already. Never an
      // environment an earlier group tagged, whose role nothing here can read.
      if (
        can.setUpMate &&
        mateSetupOffered(role) &&
        ((candidate.missingContainer === true &&
          (role === "dev" || role === "devstage" || hasMate(candidate))) ||
          ((candidate.missingContainer === true ||
            (candidate.service === undefined && candidate.presence === "unknown")) &&
            can.setUpPlainProject === true &&
            plainZeropsProject(candidate.project, input.plainEvidence)))
      ) {
        return { kind: "set-up-mate", label: "Set up Mate" };
      }
      if (transitionalStatus(candidate) !== undefined) return { kind: "none" };
      return can.start && isStopped(candidate)
        ? { kind: "start", label: "Start" }
        : { kind: "none" };
    case "ready":
      break;
  }

  // A container from before Zerops Mate answers no route with a CORS header,
  // so from a browser it looks exactly like one that is merely away — the
  // platform still says the service is ACTIVE. Only `predates-mate` offers
  // the restart: `unreachable` and `stalled` get a harmless re-probe instead
  // (H9) — a browser cannot justify a restart from an inferred state, only
  // from a read fact (spec-mate §4.5).
  if (health === "unreachable" || health === "stalled") {
    return { kind: "retry-probe", label: "Try again" };
  }
  if (health === "predates-mate") {
    // The flag says this container is mid-init, or the flag could not be
    // read at all: neither is "not enabled", so neither offers the restart
    // — only a harmless re-probe (H9). Enable is offered on the one read
    // fact that means it: the flag off.
    if (input.mateFlag === true || input.mateFlag === "unknown") {
      return { kind: "retry-probe", label: "Try again" };
    }
    if (input.mateFlag === undefined) return { kind: "pending" };
    return can.enable ? { kind: "enable", label: "Enable Zerops Mate" } : { kind: "none" };
  }
  if (isConnectionInFlight(candidate) || health === undefined || health === "initializing") {
    return { kind: "pending" };
  }
  if (input.waiting === true) return { kind: "pending" };
  return can.open ? { kind: "open", label: "Open" } : { kind: "none" };
}

/**
 * What an environment holds, as the row's one muted line: the developer's
 * services by hostname and when code last landed — `app, db · deployed 2h
 * ago` — or "No services yet" for a project holding only the platform's.
 * Undefined while the services are unread, so the row can leave the place
 * empty rather than claim there is nothing.
 */
export function environmentSummaryLine(
  services: ZeropsEnvironmentServices | undefined,
  age: (isoDate: string) => string,
): string | undefined {
  if (services === undefined) return undefined;
  if (services.hostnames.length === 0) return "No services yet";
  const names = services.hostnames.join(", ");
  return services.deployedAt === undefined
    ? names
    : `${names} · deployed ${age(services.deployedAt)}`;
}

/**
 * A release row's tone as a dot's: where it stands against production first —
 * running there, or its deploy failed — else HQ's verdict on it; none before
 * it spoke.
 */
export function releaseRowTone(
  release: Pick<FlowReleaseRow, "verdict" | "standing">,
): ServiceStatusToneId {
  if (release.standing === "live") return "ok";
  if (release.standing === "deploy-failed") return "failed";
  return release.verdict === "approved" ? "ok" : "failed";
}

/**
 * A deploy's tone as a dot's, for a group environment's row.
 *
 * `undefined` where the row model says `neutral`: nothing has been deployed
 * there, or nothing has said yet how it went, and a dot
 * without a word is exactly what rule R5 forbids. A row that has nothing to
 * say about its deploy says nothing.
 */
export function deployRowTone(tone: GroupRowTone): ServiceStatusToneId | undefined {
  switch (tone) {
    case "good":
      return "ok";
    case "pending":
      return "busy";
    case "bad":
      return "failed";
    case "neutral":
      return undefined;
  }
}
