/**
 * What a call's row shows, read the way V1 reads it: each tool item's event goes through V1's
 * own activity projection (`projectActivityPayload`), so an engine call carries the line, the
 * shown facts and the Zerops result a V1 row of the same call carries, for every driver. Pure.
 *
 * @module engine/bridge/callFacts
 */
import {
  CALL_INPUT_MAX,
  type OrchestrationThreadActivity,
  type SpiEvent,
  type ToolLifecycleItemType,
} from "@t3tools/contracts";

import { projectActivityPayload } from "../../orchestration/ActivityPayloadProjection.ts";
import type { ZeropsActivityResult } from "../../zerops/zeropsActivityResult.ts";

type ToolEvent = Extract<
  SpiEvent,
  { readonly type: "item.started" | "item.updated" | "item.completed" }
>;

/** A call's facts as its row shows them; each kept from an earlier event when a later omits it. */
export interface CallFacts {
  /** What it was given, as one line (V1's activity detail, cut as V1 cuts it). */
  readonly line?: string;
  /** V1's projected activity data, but its result and the driver's own id. */
  readonly shows?: Readonly<Record<string, unknown>>;
  /** A `zerops_*` call's result, its pictures still as the driver gave them. */
  readonly result?: ZeropsActivityResult;
}

const ACTIVITY_KIND = {
  "item.started": "tool.started",
  "item.updated": "tool.updated",
  "item.completed": "tool.completed",
} as const;

/** As V1's `truncateDetail`. */
const cutLine = (detail: string): string =>
  detail.length > CALL_INPUT_MAX ? `${detail.slice(0, CALL_INPUT_MAX - 3)}...` : detail;

/** The summary V1 gives each lifecycle activity: the projection names an untitled call by it. */
const summaryOf = (event: ToolEvent): string => {
  const title = event.payload.title;
  switch (event.type) {
    case "item.started":
      return `${title ?? "Tool"} started`;
    case "item.updated":
      return title ?? "Tool updated";
    case "item.completed":
      return title ?? "Tool";
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One event's facts, over the facts the call's earlier events gave. */
export function callFacts(event: ToolEvent, previous: CallFacts = {}): CallFacts {
  const payload = event.payload;
  const line = payload.detail ? cutLine(payload.detail) : undefined;
  const activity = {
    id: event.eventId,
    createdAt: event.createdAt,
    tone: "tool",
    kind: ACTIVITY_KIND[event.type],
    summary: summaryOf(event),
    turnId: null,
    payload: {
      itemType: payload.itemType,
      ...(payload.status === undefined ? {} : { status: payload.status }),
      ...(line === undefined ? {} : { detail: line }),
      ...(payload.data === undefined ? {} : { data: payload.data }),
    },
  } as unknown as OrchestrationThreadActivity;
  const projected = (projectActivityPayload(activity).payload as { readonly data?: unknown }).data;
  const data = isRecord(projected) ? projected : {};
  const { zerops, toolCallId: _native, ...shown } = data;
  const shows = { ...previous.shows, ...shown };
  const result = (zerops as ZeropsActivityResult | undefined) ?? previous.result;
  const kept = line ?? previous.line;
  return {
    ...(kept === undefined ? {} : { line: kept }),
    ...(Object.keys(shows).length === 0 ? {} : { shows }),
    ...(result === undefined ? {} : { result }),
  };
}

/** A call's step by the kind of item its driver made it: one step per kind, read back exactly. */
const KIND_STEPS: Readonly<Record<ToolLifecycleItemType, string>> = {
  command_execution: "command",
  file_change: "edit",
  web_search: "web",
  image_view: "look",
  collab_agent_tool_call: "helper",
  mcp_tool_call: "mcp",
  dynamic_tool_call: "tool",
};

/** The tools a generic call reads a file or searches code with, as every driver names them. */
const NAMED_STEPS: Readonly<Record<string, string>> = {
  read: "read",
  "read file": "read",
  grep: "search",
  glob: "search",
  search: "search",
  codesearch: "search",
  list: "search",
  ls: "search",
};

/**
 * The step a call takes: its item's kind, and for a generic call what it did where its tool says
 * so — a file read, a code search — as V1's effort counts it (Claude's `Read: {…}` line, an
 * OpenCode or ACP tool's name or kind, a call titled "Read File").
 */
export function callStep(
  kind: ToolLifecycleItemType,
  facts: CallFacts,
  title: string | undefined,
): string {
  const step = KIND_STEPS[kind];
  if (kind !== "dynamic_tool_call") return step;
  const named = /^([A-Za-z][\w-]*):\s*[{[]/.exec(facts.line ?? "")?.[1];
  const toolName = facts.shows?.toolName;
  const own =
    named ??
    (typeof toolName === "string" && !toolName.startsWith("mcp__") ? toolName : undefined) ??
    (typeof facts.shows?.kind === "string" ? facts.shows.kind : undefined) ??
    title;
  return (own === undefined ? undefined : NAMED_STEPS[own.trim().toLowerCase()]) ?? step;
}
