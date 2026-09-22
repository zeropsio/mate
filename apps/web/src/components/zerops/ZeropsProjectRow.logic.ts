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
  connectionStatusText,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import {
  isGenericPlatformError,
  readZeropsToolKind,
  type ZeropsEnvironmentRole,
  type ZeropsEnvironmentServices,
  type ZeropsGiteaState,
  type GroupRowTone,
  type ReleaseVerdict,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  mateOnlyOwnerOpensIt,
  type RoleMateVisibility,
} from "@t3tools/client-runtime/zerops/mateAccess";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

export type ZeropsRowCandidate = ZeropsCandidate & {
  readonly connection?: EnvironmentConnectionPresentation;
};

export interface ZeropsRowInput {
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
   * This client is waiting on the container itself — the wait a creation
   * started, resumed after a reload, or the identity exchange in flight. The
   * row then offers no verb and says only how long is left; the wait ends in
   * the conversation, not on a click.
   */
  readonly waiting?: boolean | undefined;
  /** Which verbs the caller can actually perform; a verb it cannot is never offered. */
  readonly can: {
    /** Opening covers connecting: a ready Mate opens by connecting first. */
    readonly open: boolean;
    readonly enable: boolean;
    readonly setUpMate: boolean;
    readonly start: boolean;
    readonly restart: boolean;
    /** Deleting a project the platform failed to create. */
    readonly remove: boolean;
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
  /** The container is on its way, the probe or the socket still busy: no verb yet. */
  | { readonly kind: "pending" }
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

function isConnectionInFlight(candidate: ZeropsRowCandidate): boolean {
  const phase = candidate.connection?.phase;
  return phase === "available" || phase === "connecting" || phase === "reconnecting";
}

function connectionDetail(candidate: ZeropsRowCandidate): string | undefined {
  const connection = candidate.connection;
  if (connection === undefined || connection.phase === "connected") return undefined;
  return connection.phase === "available" ? "Connecting..." : connectionStatusText(connection);
}

export function isZeropsToolCandidate(candidate: ZeropsCandidate): boolean {
  return readZeropsToolKind(candidate.project.tagList) !== undefined;
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
    return { status: { label: "Preparing", pulse: true, tone: "busy" }, detail: COMING_UP_LINE };
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
    return {
      status: { label: "Not available", tone: "off" },
      ...(candidate.reason === undefined ? {} : { detail: zeropsReasonSentence(candidate.reason) }),
    };
  }

  // Ready: what the socket, then the probe, have to say.
  const connection = candidate.connection;
  if (connection?.error) {
    return {
      detail: connectionDetail(candidate) ?? connection.error,
      detailIsError: true,
      status:
        connection.phase === "error"
          ? { label: "Connection failed", tone: "failed" }
          : { label: "Reconnecting", tone: "attention" },
    };
  }
  if (connection?.phase === "error") {
    return {
      detail: connectionDetail(candidate) ?? "Connection failed",
      detailIsError: true,
      status: { label: "Connection failed", tone: "failed" },
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
      return {
        detail: "Zerops Mate is not enabled on this container yet.",
        status: { label: "Needs Zerops Mate", tone: "attention" },
      };
    case "unreachable":
      return {
        detail: "The container is not answering.",
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
        detail: "The container is up but Zerops Mate did not answer.",
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
 * the project is up and the container is known. Not a row verb — a running
 * Mate's primary action is to open or connect, and a restart is a quiet
 * recovery for the menu.
 */
export function deriveZeropsRestartAction(input: ZeropsRowInput): ZeropsRowAction {
  const { candidate, can } = input;
  if (isZeropsToolCandidate(candidate)) return { kind: "none" };
  if (input.visibility === "listed") return { kind: "none" };
  return can.restart && candidate.project.status === "ACTIVE" && candidate.service?.id !== undefined
    ? { kind: "restart", label: "Restart" }
    : { kind: "none" };
}

export function deriveZeropsRowAction(input: ZeropsRowInput): ZeropsRowAction {
  const { candidate, health, can, role } = input;
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
      if (candidate.missingContainer === true && can.setUpMate && mateSetupOffered(role)) {
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
  // so from a browser it looks exactly like one that is away — and the
  // platform says the service is ACTIVE. A restart helps in both cases, so it
  // is offered in both, even while a socket is still trying.
  // A wait that outlasted its bound (`stalled`) gets the same recovery: it
  // writes the flag (a no-op if already on) and restarts.
  if (health === "predates-mate" || health === "unreachable" || health === "stalled") {
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
 * A deploy's tone as a dot's, for a group environment's row.
 *
 * `undefined` where the row model says `neutral`: nothing has been deployed
 * there, or nobody is signed in to Gitea to be told how it went, and a dot
 * without a word is exactly what rule R5 forbids. A row that has nothing to
 * say about its deploy says nothing.
 */
/** The broker's verdict on a release as a dot's tone; none before it spoke. */
export function releaseRowTone(verdict: ReleaseVerdict): ServiceStatusToneId | undefined {
  switch (verdict) {
    case "approved":
      return "ok";
    case "refused":
      return "failed";
    case "pending":
      return "busy";
    case "unknown":
      return undefined;
  }
}

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

export type ZeropsToolLine =
  /** Its services are coming up, or the project itself still is. */
  | { readonly kind: "setting-up" }
  /** Up: where it is, as a link, the host as its label. */
  | { readonly kind: "link"; readonly url: string; readonly label: string }
  /** The project is there and its web service is not. */
  | { readonly kind: "unavailable" }
  /** Nothing to say yet: unread, or up without an address. */
  | { readonly kind: "none" };

/**
 * Gitea's one line on its card, from its own state (`tools.ts`) rather than
 * the platform's service list: "setting up" while it comes up, its address
 * once it is there — never the hostnames "broker, db, volume, web", which
 * say nothing about whether it is ready or where it is. The address is the
 * derived one (`deriveGiteaState`), never a guessed host.
 */
export function giteaToolLine(input: {
  readonly projectStatus: string;
  readonly phase: ZeropsGiteaState["phase"] | undefined;
  readonly url: string | undefined;
}): ZeropsToolLine {
  if (input.projectStatus !== "ACTIVE") {
    return input.phase === "unavailable" ? { kind: "unavailable" } : { kind: "setting-up" };
  }
  switch (input.phase) {
    case undefined:
      return { kind: "none" };
    case "provisioning":
      return { kind: "setting-up" };
    case "unavailable":
      return { kind: "unavailable" };
    case "running":
      return input.url === undefined
        ? { kind: "none" }
        : { kind: "link", url: input.url, label: hostOf(input.url) };
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
