/**
 * Which of three things a tool call becomes in the client: a card the
 * operations reducer folds into a `ZeropsOperation`, a generic transcript
 * row, or hidden from the timeline entirely.
 *
 * `toolName` is already normalized (no `mcp__<server>__` prefix) — see
 * `ZeropsCallEntry`.
 */
import type { ZeropsCallStatus } from "./types.ts";

export type ZeropsCallClass = "hidden" | "generic" | "card";

/** Tool calls that never contribute a transcript row, on any status. */
export const TIMELINE_HIDDEN_TOOL_NAMES: ReadonlySet<string> = new Set(["ToolSearch", "Skill"]);

const HIDDEN_WORKFLOW_ACTIONS: ReadonlySet<string> = new Set(["status", "list", "close-mode"]);

const BOOTSTRAP_CONTINUATION_ACTIONS: ReadonlySet<string> = new Set([
  "complete",
  "skip",
  "resume",
  "reset",
]);

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** `action=start workflow=bootstrap` with a route already chosen — the bootstrap session's founder. */
export function isBootstrapStartWithRoute(input: Record<string, unknown> | undefined): boolean {
  const action = readString(input?.action);
  const workflow = readString(input?.workflow);
  const route = readString(input?.route);
  return action === "start" && workflow === "bootstrap" && route !== undefined;
}

/** `action=start workflow=bootstrap` with no route yet — the route-menu reply, hidden from the timeline. */
export function isBootstrapRouteMenuStart(input: Record<string, unknown> | undefined): boolean {
  const action = readString(input?.action);
  const workflow = readString(input?.workflow);
  const route = readString(input?.route);
  return action === "start" && workflow === "bootstrap" && route === undefined;
}

/**
 * A `zerops_workflow` call that is part of a bootstrap session's lifecycle —
 * the single source of truth both `classifyZeropsCall` (hidden/generic/card)
 * and the operations reducer (which calls become kind `bootstrap`, on any
 * status) read to agree on what a bootstrap call is.
 *
 * The route-menu reply is excluded explicitly: it has `workflow: "bootstrap"`
 * too, but it is never itself a session call — successfully it is the hidden
 * menu prompt, and on failure (no session ever established) it is its own
 * `error` operation, never a bootstrap one.
 */
export function isBootstrapSessionCall(input: Record<string, unknown> | undefined): boolean {
  if (isBootstrapRouteMenuStart(input)) {
    return false;
  }
  if (isBootstrapStartWithRoute(input)) {
    return true;
  }
  const action = readString(input?.action);
  if (action !== undefined && BOOTSTRAP_CONTINUATION_ACTIONS.has(action)) {
    return true;
  }
  return readString(input?.workflow) === "bootstrap";
}

/** Called only when the call did not fail — the caller returns "card" on failure first. */
function classifyZeropsWorkflow(input: Record<string, unknown> | undefined): ZeropsCallClass {
  const action = readString(input?.action);
  if (action !== undefined && HIDDEN_WORKFLOW_ACTIONS.has(action)) {
    return "hidden";
  }
  if (isBootstrapRouteMenuStart(input)) {
    return "hidden";
  }
  return isBootstrapSessionCall(input) ? "card" : "generic";
}

/** Called only when the call did not fail — the caller returns "card" on failure first. */
function classifyZeropsMount(input: Record<string, unknown> | undefined): ZeropsCallClass {
  return readString(input?.action) === "status" ? "hidden" : "card";
}

const CARD_ZEROPS_TOOLS: ReadonlySet<string> = new Set([
  "zerops_deploy",
  "zerops_deploy_batch",
  "zerops_import",
  "zerops_verify",
  "zerops_subdomain",
  "zerops_delete",
  "zerops_scale",
  "zerops_manage",
  "zerops_env",
]);

/**
 * Whether a call becomes a hidden row, a generic transcript row, or a card
 * the operations reducer folds — never which `ZeropsOperationKind` it is;
 * that is the reducer's own job, since folding needs more than this.
 */
export function classifyZeropsCall(
  toolName: string,
  input: Record<string, unknown> | undefined,
  status: ZeropsCallStatus,
): ZeropsCallClass {
  const failed = status === "failed";
  if (!toolName.startsWith("zerops_")) {
    return TIMELINE_HIDDEN_TOOL_NAMES.has(toolName) ? "hidden" : "generic";
  }
  if (failed) {
    return "card";
  }
  if (toolName === "zerops_workflow") {
    return classifyZeropsWorkflow(input);
  }
  if (toolName === "zerops_mount") {
    return classifyZeropsMount(input);
  }
  return CARD_ZEROPS_TOOLS.has(toolName) ? "card" : "generic";
}
