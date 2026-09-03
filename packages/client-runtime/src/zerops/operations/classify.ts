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

function isBootstrapRouteMenuStart(input: Record<string, unknown> | undefined): boolean {
  const action = readString(input?.action);
  const workflow = readString(input?.workflow);
  const route = readString(input?.route);
  return action === "start" && workflow === "bootstrap" && route === undefined;
}

/** A `zerops_workflow` call that is part of a bootstrap session's lifecycle. */
function isBootstrapSessionCall(input: Record<string, unknown> | undefined): boolean {
  const action = readString(input?.action);
  const workflow = readString(input?.workflow);
  const route = readString(input?.route);
  if (action === "start" && workflow === "bootstrap" && route !== undefined) {
    return true;
  }
  if (action !== undefined && BOOTSTRAP_CONTINUATION_ACTIONS.has(action)) {
    return true;
  }
  return workflow === "bootstrap";
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
