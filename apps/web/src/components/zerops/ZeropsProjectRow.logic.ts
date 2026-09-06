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
  readZeropsToolKind,
  type ZeropsEnvironmentRole,
  type ZeropsEnvironmentServices,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
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
  /** Which verbs the caller can actually perform; a verb it cannot is never offered. */
  readonly can: {
    readonly open: boolean;
    readonly connect: boolean;
    readonly enable: boolean;
    readonly wait: boolean;
    readonly setUpMate: boolean;
  };
}

export type ZeropsRowAction =
  | { readonly kind: "open"; readonly label: "Open" }
  | { readonly kind: "connect"; readonly label: "Connect" }
  | { readonly kind: "enable"; readonly label: "Enable Zerops Mate" }
  | { readonly kind: "wait"; readonly label: "Wait for it" }
  | { readonly kind: "set-up-mate"; readonly label: "Set up Mate" }
  /** Health "initializing": no verb, a quiet word. */
  | { readonly kind: "starting"; readonly label: "Starting…" }
  /** The probe or the socket is still busy: no verb yet. */
  | { readonly kind: "pending" }
  | { readonly kind: "none" };

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

export function deriveZeropsRowPresentation(input: ZeropsRowInput): ZeropsRowPresentation {
  const { candidate, health } = input;

  if (candidate.group === "connected") {
    return { status: { label: "Connected", tone: "ok" } };
  }
  if (candidate.group === "provisioning") {
    return {
      status: { label: "Preparing", pulse: true, tone: "busy" },
      ...(candidate.reason === undefined ? {} : { detail: zeropsReasonSentence(candidate.reason) }),
    };
  }
  if (candidate.group === "unavailable") {
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
        detail: "Zerops Mate is starting.",
        status: { label: "Starting", pulse: true, tone: "busy" },
      };
    case "ready":
      return { status: { label: "Ready", tone: "ok" } };
    default:
      return { status: { label: "Checking", pulse: true, tone: "busy" } };
  }
}

export function deriveZeropsRowAction(input: ZeropsRowInput): ZeropsRowAction {
  const { candidate, health, can, role } = input;
  if (isZeropsToolCandidate(candidate)) return { kind: "none" };

  switch (candidate.group) {
    case "connected":
      return can.open ? { kind: "open", label: "Open" } : { kind: "none" };
    case "provisioning":
      return can.wait ? { kind: "wait", label: "Wait for it" } : { kind: "none" };
    case "unavailable":
      return candidate.missingContainer === true && can.setUpMate && mateSetupOffered(role)
        ? { kind: "set-up-mate", label: "Set up Mate" }
        : { kind: "none" };
    case "ready":
      break;
  }

  // A container from before Zerops Mate answers no route with a CORS header,
  // so from a browser it looks exactly like one that is away — and the
  // platform says the service is ACTIVE. A restart helps in both cases, so it
  // is offered in both, even while a socket is still trying.
  if (health === "predates-mate" || health === "unreachable") {
    return can.enable ? { kind: "enable", label: "Enable Zerops Mate" } : { kind: "none" };
  }
  if (isConnectionInFlight(candidate) || health === undefined) return { kind: "pending" };
  if (health === "initializing") return { kind: "starting", label: "Starting…" };
  return can.connect ? { kind: "connect", label: "Connect" } : { kind: "none" };
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
