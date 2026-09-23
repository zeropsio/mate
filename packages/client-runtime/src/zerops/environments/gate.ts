/**
 * The route gate for `/$environmentId/$threadId` (DESIGN §4.8): what the route renders, from the
 * route target's reachability and whether its shell has content. A pure projection.
 *
 * Mounting never follows data liveness: once the route's environment has content, only a
 * terminal verdict (RG3–RG6) replaces the outlet. A restart, a reconnect or any other verdict on
 * its way somewhere renders as a banner over the mounted route.
 */
import type { EnvironmentShellStatus } from "../../state/shell.ts";
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
