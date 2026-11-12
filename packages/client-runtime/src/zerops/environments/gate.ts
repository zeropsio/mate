import { conversationAccess } from "../../data/projections/conversationAccess.ts";
import { HQ_SLOW } from "../../data/projections/freshness.ts";
/**
 * The route gate for `/$environmentId/$threadId` (DESIGN §4.8): what the route renders, from the
 * route target's reachability and whether its shell has content. A pure projection.
 *
 * Mounting never follows data liveness: once the route's environment has content, only a
 * terminal verdict (RG3–RG6) replaces the outlet. A restart, a reconnect or any other verdict on
 * its way somewhere renders as a banner over the mounted route.
 */
import type { EnvironmentShellStatus } from "../../state/shell.ts";
import type { Instant } from "./exchange.ts";
import type { ScopeAuthority } from "../data/types.ts";
import type { WithheldReason } from "../knowledge/known.ts";
import { knownPresentation } from "../knowledge/presentation.ts";
import type { EnvironmentMachine } from "./environmentMachine.ts";
import {
  isTerminalReachability,
  opensQuietly,
  reachabilityPhrase,
  reachabilityRefusalWords,
  type Reachability,
  type ReachabilityAction,
} from "./reachability.ts";

/** What the route environment's shell holds; `empty` has nothing to show. */
export type RouteContent = EnvironmentShellStatus;

/** How far finding the route's environment has got while no Mate target is known for it. */
export type RouteDiscovery =
  /** A source that could still name the environment has neither answered nor failed yet. */
  | "pending"
  /** Every source that could name the environment has answered or failed, and none named it. */
  | "settled"
  /** Every source answered or failed without naming it, and no organization is chosen (A5). */
  | "no-organization";

/**
 * What the wait says while only HQ can name the environment and has not: HQ slow (`scopeSlow`),
 * HQ's answer still due past the route's deadline, or HQ's outage in the menu's own words and
 * with its *Try again* only where the menu offers it (`hqOutage`). Past the deadline the route
 * always offers the way back to the projects, an outage too (`overdue`).
 */
export type RouteHqWait =
  | { readonly kind: "slow" }
  | { readonly kind: "unconfirmed" }
  | {
      readonly kind: "outage";
      readonly line: string;
      readonly again: boolean;
      readonly overdue: boolean;
    };

/**
 * Why a route's opening ended without its conversation, once the wait for it outlasted its
 * deadline or its absence was read (`openingEndPhrase`).
 */
export type OpeningEnd =
  /** The route's environment is known, and its Mate has not answered with the conversation. */
  | "not-answering"
  /** Nothing has named the route's environment. */
  | "not-found"
  /** The Mate's whole list of conversations, or the server, says it is not there. */
  | "missing";

export type RouteTarget =
  | { readonly kind: "unresolved"; readonly discovery: RouteDiscovery }
  /** Only HQ can name the environment, and what the wait says of HQ meanwhile. */
  | { readonly kind: "unresolved"; readonly discovery: "hq"; readonly hq: RouteHqWait }
  | {
      readonly kind: "resolved";
      readonly reachability: Reachability;
      readonly content: RouteContent;
    }
  /**
   * The route's deadline passed on a wait with no words of its own (`routeTargetPastDeadline`);
   * `refusal`: HQ's words on the last attempt to enter its Mate (`reachabilityRefusalWords`).
   */
  | { readonly kind: "overdue"; readonly end: OpeningEnd; readonly refusal?: string };

/**
 * Whether the route's deadline runs for this target: while it would wait for its environment to
 * be found, or hold its opening over a verdict with no words of its own (`opensQuietly`) and
 * nothing to show. Every other wait says its cause with its verbs.
 */
export function routeDeadlineRuns(target: RouteTarget | null): boolean {
  if (target === null || target.kind === "overdue") return false;
  if (target.kind === "unresolved")
    return target.discovery === "pending" || target.discovery === "hq";
  return target.content === "empty" && opensQuietly(target.reachability);
}

/**
 * The target once the route's deadline passed: a quiet wait ends, saying why; HQ's own waits say
 * their overdue words (`RouteHqWait`), and every other target stands.
 */
export function routeTargetPastDeadline(target: RouteTarget): RouteTarget {
  if (target.kind === "unresolved")
    return target.discovery === "pending" ? { kind: "overdue", end: "not-found" } : target;
  if (target.kind !== "resolved" || !routeDeadlineRuns(target)) return target;
  const refusal = reachabilityRefusalWords(target.reachability);
  return refusal === undefined
    ? { kind: "overdue", end: "not-answering" }
    : { kind: "overdue", end: "not-answering", refusal };
}

export type RouteGate =
  /** RG1, RG7, RG9: the route's own view, with the verdict as a banner when it has words. */
  | {
      readonly kind: "outlet";
      readonly banner: Reachability | null;
      readonly composer: "enabled" | "disabled";
    }
  /**
   * RG2 while the environment is still being looked for (null), RG8 with its verdict; `hq` when
   * only HQ can name it, saying where HQ stands.
   */
  | {
      readonly kind: "wait";
      readonly reachability: Reachability | null;
      readonly hq?: RouteHqWait;
    }
  /** A5: nothing named the environment, and no organization is chosen yet. */
  | { readonly kind: "choose-organization" }
  /** The route's opening ended without its conversation, saying why (`openingEndPhrase`). */
  | { readonly kind: "ended"; readonly end: OpeningEnd; readonly refusal?: string }
  /** RG3 when no project holds the environment (null), RG4–RG6 with the terminal verdict. */
  | { readonly kind: "unavailable"; readonly reachability: Reachability | null };

const OUTLET: RouteGate = { kind: "outlet", banner: null, composer: "enabled" };

/** DESIGN §4.8's rows for the route's target; null when the route targets no environment (RG1). */
export function selectRouteGate(target: RouteTarget | null): RouteGate {
  if (target === null) return OUTLET;
  if (target.kind === "overdue")
    return target.refusal === undefined
      ? { kind: "ended", end: target.end }
      : { kind: "ended", end: target.end, refusal: target.refusal };
  if (target.kind === "unresolved") {
    switch (target.discovery) {
      case "pending":
        return { kind: "wait", reachability: null };
      case "settled":
        return { kind: "unavailable", reachability: null };
      case "no-organization":
        return { kind: "choose-organization" };
      case "hq":
        return { kind: "wait", reachability: null, hq: target.hq };
    }
  }
  const { reachability, content } = target;
  if (isTerminalReachability(reachability)) return { kind: "unavailable", reachability };
  if (reachability.kind === "ready") {
    return reachability.notice === null
      ? OUTLET
      : { kind: "outlet", banner: reachability, composer: "enabled" };
  }
  return content === "empty"
    ? { kind: "wait", reachability }
    : { kind: "outlet", banner: reachability, composer: "disabled" };
}

// ── Copy ──────────────────────────────────────────────────────────────────────────────────────

/** A verb the gate renders exactly once beside its message. */
export type RouteGateAction = ReachabilityAction | "choose-organization";

export interface RouteGatePhrase {
  /** The cause only; null when the gate needs no words. */
  readonly text: string | null;
  /** HQ's words under the cause, verbatim, where HQ refused the last attempt with them. */
  readonly secondary?: string;
  readonly actions: ReadonlyArray<RouteGateAction>;
}

const SILENT: RouteGatePhrase = { text: null, actions: [] };

/** The gate's words and verbs; a verdict speaks through `reachabilityPhrase`, the one producer. */
export function routeGatePhrase(
  gate: RouteGate,
  context: { readonly nowMs: number; readonly mateName: string },
): RouteGatePhrase {
  switch (gate.kind) {
    case "outlet":
      return gate.banner === null ? SILENT : reachabilityPhrase(gate.banner, context);
    case "wait":
      // Slow has nothing to try again: HQ's connection holds and it is working. An outage says
      // what the menu says at that moment, with *Try again* only where the menu offers it.
      switch (gate.hq?.kind) {
        case "slow":
          return { text: HQ_SLOW, actions: [] };
        case "unconfirmed":
          return {
            text: "HQ hasn't confirmed where this conversation is yet.",
            actions: ["go-to-projects"],
          };
        case "outage":
          return {
            text: gate.hq.line,
            actions: [
              ...(gate.hq.again ? (["try-again"] as const) : []),
              ...(gate.hq.overdue ? (["go-to-projects"] as const) : []),
            ],
          };
      }
      return gate.reachability === null
        ? { text: "Opening this conversation…", actions: [] }
        : reachabilityPhrase(gate.reachability, context);
    case "choose-organization":
      return {
        text: "Choose an organization to open this conversation.",
        actions: ["choose-organization"],
      };
    case "ended":
      return openingEndPhrase(gate.end, gate.refusal);
    case "unavailable":
      return gate.reachability === null
        ? { text: "This conversation isn't in your Zerops projects.", actions: ["go-to-projects"] }
        : reachabilityPhrase(gate.reachability, context);
  }
}

/**
 * What an opening that ended without its conversation says, wherever it ended — the route gate or
 * the thread route: its cause, the way back to the projects, and asking again where the
 * conversation may still come. A Mate HQ refused to open says HQ's words under its cause.
 */
export function openingEndPhrase(end: OpeningEnd, refusal?: string): RouteGatePhrase {
  switch (end) {
    case "not-answering":
      return {
        text: "This Mate isn't answering.",
        ...(refusal === undefined ? {} : { secondary: refusal }),
        actions: ["try-again", "go-to-projects"],
      };
    case "not-found":
      return {
        text: "This conversation hasn't been found yet.",
        actions: ["try-again", "go-to-projects"],
      };
    case "missing":
      return { text: "This conversation is no longer available.", actions: ["go-to-projects"] };
  }
}

// ── C1b: the conversation without verified access ─────────────────────────────────────────────

/** The route project's access as its owner last answered, or its loss confirmed (G6). */
export type ConversationAccess = ScopeAuthority | { readonly kind: "lost" };

export type ConversationView =
  /** Current authority has no client-invented expiry. */
  | { readonly kind: "shown"; readonly until: Instant | null }
  /** Its content and drafts are hidden, mounted, until the access is verified again. */
  | { readonly kind: "suppressed"; readonly reason: WithheldReason };

/** Current authority alone decides whether retained conversation content may be shown. */
export function selectConversation(input: {
  readonly access: ConversationAccess;
  readonly machine: Pick<EnvironmentMachine, "link" | "linkLostAt"> | undefined;
  readonly now: Instant;
}): ConversationView {
  return conversationAccess(input.access);
}

const CONVERSATION_SURFACE = {
  subject: "this conversation",
  entity: "project",
  source: "zerops",
  checking: null,
  negative: null,
} as const;

/**
 * What a suppressed conversation says in its place: its cause only, as `knownPresentation` words a
 * withheld project. A lapse says nothing here: the app's one banner names it.
 */
export function conversationPhrase(view: ConversationView): RouteGatePhrase {
  if (view.kind === "shown") return SILENT;
  const presentation = knownPresentation(
    { state: "withheld", reason: view.reason, cause: null },
    CONVERSATION_SURFACE,
    { nowMs: 0, updateOffered: false },
  );
  return {
    text: presentation.message?.text ?? null,
    actions: presentation.affordance?.kind === "go-to-projects" ? ["go-to-projects"] : [],
  };
}
