/**
 * Reachability (DESIGN §4.4): the one verdict every surface reads about a Mate target — the route
 * gate, sidebar rows and link targets, the palette, project rows, notifications and the ChatView
 * banner. A pure projection over the environment machine's four regions; the first matching row
 * of the table wins.
 *
 * `gone`, `replaced`, `refused-role` and `update-unavailable` withhold the target. A failed
 * Connect keeps its result and offers a manual action without unmounting content.
 */
import type { EnvironmentId } from "@t3tools/contracts";

import type { AbsenceEvidence } from "../knowledge/known.ts";
import { MINIMUM_MATE_SERVER_VERSION, mateServerCompatibility } from "../serverCompatibility.ts";
import {
  identityRestartOffered,
  type ContainerVerdict,
  type DescriptorFacts,
  type EnvironmentMachine,
  type ExchangeCause,
  type Credential,
  type NoOriginReason,
  type WaitingOn,
} from "./environmentMachine.ts";

/** What a connecting target waits on, for its copy. */
export type ConnectingOn = Exclude<WaitingOn, "zerops"> | "descriptor" | "exchange";

/** The container levels that are a verdict of their own (row 7). */
export type ContainerReachability = Exclude<
  ContainerVerdict,
  { readonly level: "unknown" } | { readonly level: "ready" }
>;

/** What a live link keeps showing as a notice while the container restarts under it (row 5). */
export type ContainerNotice = Extract<
  ContainerVerdict,
  { readonly level: "restarting" } | { readonly level: "updating" }
>;

export type Reachability =
  | { readonly kind: "gone"; readonly because: AbsenceEvidence }
  | { readonly kind: "replaced"; readonly by: EnvironmentId }
  | { readonly kind: "refused-role" }
  /** The link kept refusing its configuration; waits for the user or an input change. */
  | { readonly kind: "refused-configuration" }
  | { readonly kind: "update-required"; readonly actual: string; readonly minimum: string }
  | { readonly kind: "update-unavailable" }
  | { readonly kind: "connecting"; readonly waitingOn: ConnectingOn }
  | { readonly kind: "ready"; readonly notice: ContainerNotice | null }
  | { readonly kind: "no-address"; readonly reason: NoOriginReason }
  | { readonly kind: "container"; readonly container: ContainerReachability }
  | { readonly kind: "waiting-for-zerops" }
  | {
      readonly kind: "failed";
      readonly stage: Extract<Credential, { kind: "failed" }>["stage"];
      readonly last: ExchangeCause;
      /** Restart is offered only for identity `failed`, under its rule (`identityRestartOffered`). */
      readonly restart: boolean;
    }
  | { readonly kind: "reconnecting" }
  | { readonly kind: "resolving" };

const TERMINAL: ReadonlySet<Reachability["kind"]> = new Set([
  "gone",
  "replaced",
  "refused-role",
  "update-unavailable",
]);

export const isTerminalReachability = (verdict: Reachability): boolean =>
  TERMINAL.has(verdict.kind);

/** Whether a link to this target is still worth offering: everything but gone and replaced. */
export const environmentLinkable = (verdict: Reachability): boolean =>
  verdict.kind !== "gone" && verdict.kind !== "replaced";

/**
 * A server below the client floor: `update-required` when zcp's newest Mate clears the floor —
 * the upgrade restart installs it — and the terminal `update-unavailable` when it does not or zcp
 * says nothing (MU-1, MU-3). Both versions are judged by `mateServerCompatibility`, the one
 * comparison against the floor.
 */
export const floorVerdict = (
  descriptor: DescriptorFacts,
): Extract<Reachability, { readonly kind: "update-required" | "update-unavailable" }> =>
  descriptor.update !== null && mateServerCompatibility(descriptor.update.latest) === "supported"
    ? {
        kind: "update-required",
        actual: descriptor.serverVersion,
        minimum: MINIMUM_MATE_SERVER_VERSION,
      }
    : { kind: "update-unavailable" };

const CONTAINER_VERDICT_LEVELS: ReadonlySet<ContainerVerdict["level"]> = new Set([
  "creating",
  "provisioning",
  "booting",
  "restarting",
  "updating",
  "inactive",
  "needs-enable",
  "needs-update",
  "not-yet-available",
]);

const isContainerReachability = (container: ContainerVerdict): container is ContainerReachability =>
  CONTAINER_VERDICT_LEVELS.has(container.level);

const noticeOf = (container: ContainerVerdict): ContainerNotice | null =>
  container.level === "restarting" || container.level === "updating" ? container : null;

/** DESIGN §4.4's table for the environment `asked` about on this target; first match wins. */
export function selectReachability(
  machine: EnvironmentMachine,
  asked: EnvironmentId | null,
): Reachability {
  const { presence, credential, link, container } = machine;
  // 1
  if (presence.kind === "gone") return { kind: "gone", because: presence.evidence };
  if (credential.kind === "retired") return { kind: "gone", because: credential.evidence };
  // 2
  const by = asked === null ? undefined : machine.superseded.get(asked);
  if (by !== undefined) return { kind: "replaced", by };
  // 3
  if (credential.kind === "refused") {
    switch (credential.reason.kind) {
      case "role":
        return { kind: "refused-role" };
      case "version":
        // The machine refuses a version only on a descriptor it has read.
        return machine.descriptor === null
          ? { kind: "connecting", waitingOn: "descriptor" }
          : floorVerdict(machine.descriptor);
      case "project-mismatch":
        return {
          kind: "failed",
          stage: "descriptor",
          last: { kind: "project-mismatch" },
          restart: false,
        };
      case "access":
        return {
          kind: "failed",
          stage: "admission",
          last: { kind: "access", reason: credential.reason.reason },
          restart: false,
        };
      case "configuration":
        return { kind: "refused-configuration" };
    }
  }
  // 9
  if (credential.kind === "failed") {
    return {
      kind: "failed",
      stage: credential.stage,
      last: credential.last,
      restart: credential.last.kind === "identity-failed" && identityRestartOffered(machine),
    };
  }
  const held = credential.kind === "held";
  // 4
  if (held && credential.rereading !== null && link.phase === "blocked") {
    return { kind: "connecting", waitingOn: "descriptor" };
  }
  // 5
  if (held && link.phase === "connected" && container.level !== "inactive") {
    return { kind: "ready", notice: noticeOf(container) };
  }
  // 6
  if (presence.kind === "no-origin") return { kind: "no-address", reason: presence.reason };
  // 7
  if (isContainerReachability(container)) return { kind: "container", container };
  // 8
  if (credential.kind === "waiting" && credential.on === "zerops") {
    return { kind: "waiting-for-zerops" };
  }
  // 10 — a reconnect only once something was lost: a held credential whose link never
  // connected is still a first connect (row 12).
  if (
    (held && machine.linkLostAt !== null) ||
    ((credential.kind === "none" ||
      credential.kind === "waiting" ||
      credential.kind === "exchanging") &&
      credential.reconnect)
  ) {
    return { kind: "reconnecting" };
  }
  // 11
  if (presence.kind === "unknown") return { kind: "resolving" };
  // 12
  return {
    kind: "connecting",
    // Row 8 has already taken a wait on Zerops.
    waitingOn:
      credential.kind === "waiting" && credential.on !== "zerops" ? credential.on : "exchange",
  };
}

// ── Copy ──────────────────────────────────────────────────────────────────────────────────────

/** A verb the surface renders exactly once beside the verdict's message. */
export type ReachabilityAction =
  | "go-to-projects"
  | "restart"
  | "try-now"
  | "open-in-zerops"
  | "enable"
  | "start";

export interface ReachabilityPhrase {
  /** The cause only; null when the verdict needs no words (a ready Mate). */
  readonly text: string | null;
  readonly actions: ReadonlyArray<ReachabilityAction>;
}

const phrase = (
  text: string | null,
  actions: ReadonlyArray<ReachabilityAction> = [],
): ReachabilityPhrase => ({ text, actions });

const CAUSE: Record<ExchangeCause["kind"], string> = {
  network: "This Mate isn't answering.",
  timeout: "This Mate isn't answering.",
  "descriptor-unreachable": "This Mate isn't answering.",
  server: "This Mate's server answered an error.",
  mint: "Zerops isn't answering.",
  "identity-unavailable": "This Mate can't reach Zerops to check who you are.",
  "identity-failed": "This Mate can't reach Zerops to check who you are.",
  rejected: "This Mate didn't accept the sign-in.",
  install: "This tab couldn't set up the connection to this Mate.",
  "project-mismatch": "This address belongs to another Zerops project.",
  access: "Your Zerops access does not allow this connection.",
};

const ACCESS_CAUSE: Record<Extract<ExchangeCause, { kind: "access" }>["reason"], string> = {
  "access-unverified": "Your Zerops access could not be checked.",
  "access-lapsed": "Your Zerops access needs to be checked again.",
  "project-unverified": "Your access to this project could not be checked.",
  "role-denies": "You can see this project in Zerops but can't operate its Mate.",
  "project-closed":
    "This project is no longer available. It was deleted, or you no longer have access.",
  "epoch-closed": "Sign in with Zerops to connect to this Mate.",
};

const CONNECTING: Record<ConnectingOn, string> = {
  presence: "Looking for this Mate…",
  container: "Waiting for this Mate to start…",
  access: "Checking your Zerops access…",
  visible: "Paused while this tab is in the background.",
  budget: "Connecting…",
  descriptor: "Connecting…",
  exchange: "Connecting…",
};

/**
 * A restart that names no one: the one announced, and the projects row's line for any restart
 * the platform runs, ours or anyone's.
 */
export const RESTARTING_PHRASE = "This Mate is restarting.";

const RESTARTING_BY: Record<
  Extract<ContainerVerdict, { readonly level: "restarting" }>["by"],
  string
> = {
  platform: "Zerops is restarting this Mate.",
  you: "Restarting this Mate.",
  announced: RESTARTING_PHRASE,
};

const noticePhrase = (notice: ContainerNotice): string =>
  notice.level === "restarting" ? RESTARTING_BY[notice.by] : "Updating this Mate.";

const containerPhrase = (
  container: ContainerReachability,
  mateName: string,
): ReachabilityPhrase => {
  if ("overdue" in container && container.overdue) {
    return phrase(`${mateName} is taking longer than usual to start.`, ["restart"]);
  }
  switch (container.level) {
    case "creating":
    case "provisioning":
      return phrase("Coming up. A few minutes.");
    case "booting":
      return phrase("Almost there.");
    case "restarting":
    case "updating":
      return phrase(noticePhrase(container));
    case "inactive":
      return phrase("This Mate isn't running.", ["start"]);
    case "needs-enable":
      return phrase("Zerops Mate is not enabled on this container yet.", ["enable"]);
    case "needs-update":
      return phrase("This Mate needs an update before it can start.", ["restart"]);
    case "not-yet-available":
      return phrase("Zerops Mate is not part of this container's zcp release yet.");
  }
};

/** The verdict's words and verbs: the cause only, each verb once (§4.4's table, §3.4 R-K3). */
export function reachabilityPhrase(
  verdict: Reachability,
  context: { readonly nowMs: number; readonly mateName: string },
): ReachabilityPhrase {
  switch (verdict.kind) {
    case "gone":
      return phrase(
        "This project is no longer available. It was deleted, or you no longer have access.",
        ["go-to-projects"],
      );
    case "replaced":
      return phrase("This Mate was redeployed. Its earlier conversations are not on it.", [
        "go-to-projects",
      ]);
    case "refused-role":
      return phrase("You can see this project in Zerops but can't operate its Mate.");
    case "refused-configuration":
      return phrase("This Mate refused its connection settings.", ["try-now"]);
    case "update-required":
      return phrase(
        `This Mate runs ${verdict.actual}; this app needs ${verdict.minimum} or newer. Restarting it installs a newer one.`,
        ["restart"],
      );
    case "update-unavailable":
      return phrase("This project's Zerops tooling installs an older Mate than this app supports.");
    case "connecting":
      return phrase(CONNECTING[verdict.waitingOn]);
    case "ready":
      return phrase(verdict.notice === null ? null : noticePhrase(verdict.notice));
    case "no-address":
      return phrase("This Mate has no public address.", ["open-in-zerops"]);
    case "container":
      return containerPhrase(verdict.container, context.mateName);
    case "waiting-for-zerops":
      return phrase("Zerops isn't answering. This Mate reconnects when it's back.");
    case "failed":
      return phrase(
        verdict.last.kind === "access"
          ? ACCESS_CAUSE[verdict.last.reason]
          : CAUSE[verdict.last.kind],
        verdict.restart ? ["try-now", "restart"] : ["try-now"],
      );
    case "reconnecting":
      return phrase("Reconnecting…");
    case "resolving":
      return phrase("Looking for this Mate…");
  }
}
