import { claudeToolUseMeta, mcpToolPresentation } from "@t3tools/shared/toolActivity";
import type { ToolPresentation, CanonicalItemType, CanonicalRequestType } from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import {
  encodeJsonStringForDiagnostics,
  decodeUnknownJsonStringExit,
} from "./ClaudeSdkMessages.ts";
import * as Exit from "effect/Exit";
import type { ClaudeToolResultStreamKind } from "./ClaudeSessionState.ts";

/** An MCP call's presentation from Claude Code's `tool_use_meta` for it, if any. */
export function claudeCallPresentation(
  meta: ReturnType<typeof claudeToolUseMeta>,
  toolName: string,
  itemId: string,
): ToolPresentation | undefined {
  const said = meta.get(itemId);
  return said === undefined ? undefined : mcpToolPresentation({ toolName, ...said });
}

function readToolImagePath(toolName: string, input: Record<string, unknown>): string | undefined {
  const normalized = toolName.trim().toLowerCase();
  if (normalized !== "read" && normalized !== "read file") {
    return undefined;
  }
  const pathValue = input.file_path ?? input.path;
  if (typeof pathValue !== "string") {
    return undefined;
  }
  const path = pathValue.trim();
  return path.length > 0 && isWorkspaceImagePreviewPath(path) ? path : undefined;
}

export function classifyToolItemType(
  toolName: string,
  input: Record<string, unknown> = {},
): CanonicalItemType {
  const normalized = toolName.toLowerCase();
  if (readToolImagePath(toolName, input)) {
    return "image_view";
  }
  if (normalized.includes("agent")) {
    return "collab_agent_tool_call";
  }
  if (
    normalized === "task" ||
    normalized === "agent" ||
    normalized.includes("subagent") ||
    normalized.includes("sub-agent")
  ) {
    return "collab_agent_tool_call";
  }
  if (
    normalized.includes("bash") ||
    normalized.includes("command") ||
    normalized.includes("shell") ||
    normalized.includes("terminal")
  ) {
    return "command_execution";
  }
  // A scheduled wake (CronCreate, CronDelete) creates no file.
  if (normalized.startsWith("cron")) {
    return "dynamic_tool_call";
  }
  if (
    normalized.includes("edit") ||
    normalized.includes("write") ||
    normalized.includes("file") ||
    normalized.includes("patch") ||
    normalized.includes("replace") ||
    normalized.includes("create") ||
    normalized.includes("delete")
  ) {
    return "file_change";
  }
  if (normalized.includes("mcp")) {
    return "mcp_tool_call";
  }
  if (normalized.includes("websearch") || normalized.includes("web search")) {
    return "web_search";
  }
  if (normalized.includes("image")) {
    return "image_view";
  }
  return "dynamic_tool_call";
}

function isReadOnlyToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return (
    normalized === "read" ||
    normalized.includes("read file") ||
    normalized.includes("view") ||
    normalized.includes("grep") ||
    normalized.includes("glob") ||
    normalized.includes("search")
  );
}

export function classifyRequestType(toolName: string): CanonicalRequestType {
  if (isReadOnlyToolName(toolName)) {
    return "file_read_approval";
  }
  const itemType = classifyToolItemType(toolName);
  return itemType === "command_execution"
    ? "command_execution_approval"
    : itemType === "file_change"
      ? "file_change_approval"
      : "dynamic_tool_call";
}

export function isTodoTool(toolName: string): boolean {
  return toolName.toLowerCase().includes("todowrite");
}

export function summarizeToolRequest(toolName: string, input: Record<string, unknown>): string {
  const imagePath = readToolImagePath(toolName, input);
  if (imagePath) {
    return imagePath;
  }

  const commandValue = input.command ?? input.cmd;
  const command = typeof commandValue === "string" ? commandValue : undefined;
  if (command && command.trim().length > 0) {
    return `${toolName}: ${command.trim().slice(0, 400)}`;
  }

  // For agent/subagent tools, prefer the human-readable description or prompt
  // over raw JSON. The structured subagent_type is carried separately on the
  // task.* payloads (role) — the label is display-only.
  const itemType = classifyToolItemType(toolName);
  if (itemType === "collab_agent_tool_call") {
    const description =
      typeof input.description === "string" ? input.description.trim() : undefined;
    const prompt = typeof input.prompt === "string" ? input.prompt.trim() : undefined;
    const label = description || (prompt ? prompt.slice(0, 200) : undefined);
    if (label) {
      return label;
    }
  }

  const serialized = encodeJsonStringForDiagnostics(input) ?? "[unserializable input]";
  if (serialized.length <= 400) {
    return `${toolName}: ${serialized}`;
  }
  return `${toolName}: ${serialized.slice(0, 397)}...`;
}

export function titleForTool(itemType: CanonicalItemType): string {
  switch (itemType) {
    case "command_execution":
      return "Command run";
    case "file_change":
      return "File change";
    case "mcp_tool_call":
      return "MCP tool call";
    case "collab_agent_tool_call":
      return "Subagent task";
    case "web_search":
      return "Web search";
    case "image_view":
      return "Image view";
    case "dynamic_tool_call":
      return "Tool call";
    default:
      return "Item";
  }
}

export function extractExitPlanModePlan(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as {
    plan?: unknown;
  };
  return typeof record.plan === "string" && record.plan.trim().length > 0
    ? record.plan.trim()
    : undefined;
}

export function exitPlanCaptureKey(input: {
  readonly toolUseId?: string | undefined;
  readonly planMarkdown: string;
}): string {
  return input.toolUseId && input.toolUseId.length > 0
    ? `tool:${input.toolUseId}`
    : `plan:${input.planMarkdown}`;
}

export function tryParseJsonRecord(value: string): Record<string, unknown> | undefined {
  const result = decodeUnknownJsonStringExit(value);
  if (!Exit.isSuccess(result)) {
    return undefined;
  }
  const parsed = result.value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

export function toolInputFingerprint(input: Record<string, unknown>): string | undefined {
  return encodeJsonStringForDiagnostics(input);
}

export function toolResultStreamKind(
  itemType: CanonicalItemType,
): ClaudeToolResultStreamKind | undefined {
  switch (itemType) {
    case "command_execution":
      return "command_output";
    case "file_change":
      return "file_change_output";
    default:
      return undefined;
  }
}
