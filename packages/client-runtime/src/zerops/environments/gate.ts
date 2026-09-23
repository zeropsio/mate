/**
 * The route gate for `/$environmentId/$threadId` (DESIGN §4.8): what the route renders, from the
 * route target's reachability and whether its shell has content. A pure projection.
 *
 * Mounting never follows data liveness: once the route's environment has content, only a
 * terminal verdict (RG3–RG6) replaces the outlet. A restart, a reconnect or any other verdict on
 * its way somewhere renders as a banner over the mounted route.
 */
import type { EnvironmentShellStatus } from "../../state/shell.ts";
import type { Instant, ScopeAuthority } from "../data/access/grant.ts";
import type { WithheldReason } from "../knowledge/known.ts";
import { knownPresentation } from "../knowledge/presentation.ts";
import type { EnvironmentMachine } from "./environmentMachine.ts";
import {
  isTerminalReachability,
  reachabilityPhrase,
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

export type RouteTarget =
  | { readonly kind: "unresolved"; readonly discovery: RouteDiscovery }
  | {
      readonly kind: "resolved";
      readonly reachability: Reachability;
      readonly content: RouteContent;
    };

export type RouteGate =
  /** RG1, RG7, RG9: the route's own view, with the verdict as a banner when it has words. */
  | {
      readonly kind: "outlet";
      readonly banner: Reachability | null;
      readonly composer: "enabled" | "disabled";
    }
  /** RG2 while the environment is still being looked for (null), RG8 with its verdict. */
  | { readonly kind: "wait"; readonly reachability: Reachability | null }
  /** A5: nothing named the environment, and no organization is chosen yet. */
  | { readonly kind: "choose-organization" }
  /** RG3 when no project holds the environment (null), RG4–RG6 with the terminal verdict. */
  | { readonly kind: "unavailable"; readonly reachability: Reachability | null };

const OUTLET: RouteGate = { kind: "outlet", banner: null, composer: "enabled" };

/** DESIGN §4.8's rows for the route's target; null when the route targets no environment (RG1). */
export function selectRouteGate(target: RouteTarget | null): RouteGate {
  if (target === null) return OUTLET;
  if (target.kind === "unresolved") {
    switch (target.discovery) {
      case "pending":
        return { kind: "wait", reachability: null };
      case "settled":
        return { kind: "unavailable", reachability: null };
      case "no-organization":
        return { kind: "choose-organization" };
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
      return gate.reachability === null
        ? { text: "Opening this conversation…", actions: [] }
        : reachabilityPhrase(gate.reachability, context);
    case "choose-organization":
      return {
        text: "Choose an organization to open this conversation.",
        actions: ["choose-organization"],
      };
    case "unavailable":
      return gate.reachability === null
        ? { text: "This conversation isn't in your Zerops projects.", actions: ["go-to-projects"] }
        : reachabilityPhrase(gate.reachability, context);
  }
}

// ── C1b: the conversation without verified access ─────────────────────────────────────────────

/**
 * How long a conversation stays shown after its link dropped while its project's access is not
 * verified (DESIGN §9 C1b). While the link is connected, the Mate's own membership watch is the
 * authority; once it dropped, this bound replaces it.
 */
export const CONVERSATION_UNVERIFIED_BOUND_MS = 10 * 60_000;

/** The route project's access as the grant last published it, or its loss confirmed (G6). */
export type ConversationAccess = ScopeAuthority | { readonly kind: "lost" };

export type ConversationView =
  /** `until`: the instant the bound ends it, to be judged again then; null while nothing does. */
  | { readonly kind: "shown"; readonly until: Instant | null }
  /** Its content and drafts are hidden, mounted, until the access is verified again. */
  | { readonly kind: "suppressed"; readonly reason: WithheldReason };

/**
 * Whether the route's conversation shows (DESIGN §9 C1b): always under verified access; without
 * it, only while the target's link is connected or less than the bound after it dropped, on either
 * clock. A link that never connected, or no target at all, vouches for nothing; a confirmed loss
 * suppresses it at once.
 */
export function selectConversation(input: {
  readonly access: ConversationAccess;
  /** The route target's machine; undefined while no target names the route's environment. */
  readonly machine: Pick<EnvironmentMachine, "link" | "linkLostAt"> | undefined;
  readonly now: Instant;
}): ConversationView {
  const { access, machine, now } = input;
  if (access.kind === "authorized") return { kind: "shown", until: null };
  if (access.kind === "lost") return { kind: "suppressed", reason: "access-denied" };
  if (machine?.link.phase === "connected") return { kind: "shown", until: null };
  const lostAt = machine?.linkLostAt ?? null;
  if (lostAt !== null) {
    const until = {
      wall: lostAt.wall + CONVERSATION_UNVERIFIED_BOUND_MS,
      mono: lostAt.mono + CONVERSATION_UNVERIFIED_BOUND_MS,
    };
    if (now.wall < until.wall && now.mono < until.mono) return { kind: "shown", until };
  }
  return { kind: "suppressed", reason: access.reason };
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
