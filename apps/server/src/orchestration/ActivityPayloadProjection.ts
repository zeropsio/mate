import type {
  OrchestrationEvent,
  OrchestrationThreadActivity,
  OrchestrationThreadDetailSnapshot,
} from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import {
  isToolCallEcho,
  toolCallEchoKey,
  toolLifecycleIdentity,
} from "@t3tools/shared/toolCallEcho";

import { sniffToolCallShape } from "../spi/toolCall.ts";
import { hasFileWrites } from "../zerops/fileWrites.ts";
import {
  projectZeropsToolCall,
  type ZeropsActivityResult,
} from "../zerops/zeropsActivityResult.ts";
import { isZeropsToolName } from "../zerops/zeropsToolResult.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The `zerops` copy an already-projected payload carries, when it is one this
 * server would have written: a bare tool name plus, optionally, the verbatim
 * result text and the over-limit marker. Anything else is not a card.
 */
function readStoredZeropsResult(value: unknown): ZeropsActivityResult | undefined {
  const stored = asRecord(value);
  if (!stored || typeof stored.toolName !== "string" || stored.toolName.length === 0) {
    return undefined;
  }
  if (stored.resultText !== undefined && typeof stored.resultText !== "string") {
    return undefined;
  }
  const images: ZeropsActivityResult["images"] = Array.isArray(stored.images)
    ? (stored.images as ZeropsActivityResult["images"])
    : undefined;
  return {
    toolName: stored.toolName,
    ...(stored.resultText === undefined ? {} : { resultText: stored.resultText }),
    ...(stored.truncated === true ? { truncated: true } : {}),
    ...(images === undefined ? {} : { images }),
    ...(stored.imagesDropped === true ? { imagesDropped: true } : {}),
  };
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown): void {
  const normalized = asTrimmedString(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function collectChangedFiles(
  value: unknown,
  target: string[],
  seen: Set<string>,
  depth: number,
): void {
  if (depth > 4 || target.length >= 12) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= 12) {
        return;
      }
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  pushChangedFile(target, seen, record.path);
  pushChangedFile(target, seen, record.filePath);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.oldPath);

  for (const nestedKey of [
    "item",
    "result",
    "input",
    "rawInput",
    "locations",
    "data",
    "changes",
    "files",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= 12) {
      return;
    }
  }
}

function projectCommandData(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const item = asRecord(data.item);
  if (!item) {
    return undefined;
  }

  const projectedItem: Record<string, unknown> = {};
  if ("command" in item) {
    projectedItem.command = item.command;
  }

  const aggregatedOutput = asTrimmedString(item.aggregatedOutput);
  if (aggregatedOutput) {
    const summary = summarizeToolTextOutput(aggregatedOutput);
    if (summary) {
      projectedItem.aggregatedOutput = summary;
    }
  }

  const input = asRecord(item.input);
  if (input && "command" in input) {
    projectedItem.input = { command: input.command };
  }

  const result = asRecord(item.result);
  if (result) {
    const projectedResult: Record<string, unknown> = {};
    if ("command" in result) {
      projectedResult.command = result.command;
    }
    const content = asTrimmedString(result.content);
    if (content) {
      const summary = summarizeToolTextOutput(content);
      if (summary) {
        projectedResult.content = summary;
      }
    }
    if (Object.keys(projectedResult).length > 0) {
      projectedItem.result = projectedResult;
    }
  }

  return Object.keys(projectedItem).length > 0 ? projectedItem : undefined;
}

function projectCommandValue(data: Record<string, unknown>): unknown {
  if (data.command !== undefined) {
    return data.command;
  }

  const input = asRecord(data.input);
  if (input?.command !== undefined) {
    return input.command;
  }

  const stateInput = asRecord(asRecord(data.state)?.input);
  if (stateInput?.command !== undefined) {
    return stateInput.command;
  }

  return undefined;
}

/**
 * What a non-MCP tool call says it is doing, in its own input: Claude's
 * one-line Bash `description`, a Read/Edit/Write `file_path`, a Grep/Glob
 * `pattern`/`path`/`glob`, a WebFetch `url`, a WebSearch `query`. Only string
 * values survive, trimmed and capped. The rest of an input stays in
 * persistence only — `content`, `old_string`, `new_string` and `prompt` can
 * each run to megabytes — and `command` already rides at `data.command`.
 */
const TOOL_INPUT_KEPT_FIELDS = [
  "description",
  "file_path",
  "path",
  "pattern",
  "glob",
  "url",
  "query",
] as const;

/**
 * A helper's launch keeps the name the Mate gave it, where its driver takes one (Claude's Agent
 * `name`): what the Mate's own text calls that helper, and the card with it (F6).
 */
const AGENT_LAUNCH_KEPT_FIELDS = ["name"] as const;

const TOOL_INPUT_FIELD_MAX_LENGTH = 300;

/** The keys another driver spells a kept field with, in Claude's spelling: OpenCode's `filePath`. */
const TOOL_INPUT_ALIASES: Readonly<Record<string, (typeof TOOL_INPUT_KEPT_FIELDS)[number]>> = {
  filePath: "file_path",
};

/** ACP kinds whose `locations` name the file the call read or changed. */
const ACP_FILE_KINDS: ReadonlySet<unknown> = new Set(["read", "edit", "delete", "move"]);

/**
 * A call's input as every driver gives it, in Claude's keys: Claude's and
 * Codex's `data.input`, OpenCode's `state.input`, an ACP agent's `rawInput`
 * — and, for an ACP call on a file, the first of its `locations`.
 */
function callInputOf(data: Record<string, unknown>): Record<string, unknown> | null {
  const given =
    asRecord(data.input) ?? asRecord(asRecord(data.state)?.input) ?? asRecord(data.rawInput);
  const input: Record<string, unknown> = { ...given };
  for (const [alias, key] of Object.entries(TOOL_INPUT_ALIASES)) {
    if (input[key] === undefined && input[alias] !== undefined) {
      input[key] = input[alias];
    }
  }
  if (input.file_path === undefined && ACP_FILE_KINDS.has(data.kind)) {
    const located = Array.isArray(data.locations)
      ? data.locations.map((location) => asTrimmedString(asRecord(location)?.path)).find(Boolean)
      : undefined;
    if (located) {
      input.file_path = located;
    }
  }
  return given === null && Object.keys(input).length === 0 ? null : input;
}

function projectToolInput(
  input: Record<string, unknown> | null,
  agentLaunch: boolean,
): Record<string, string> | undefined {
  if (!input) {
    return undefined;
  }
  const projected: Record<string, string> = {};
  for (const key of agentLaunch
    ? [...TOOL_INPUT_KEPT_FIELDS, ...AGENT_LAUNCH_KEPT_FIELDS]
    : TOOL_INPUT_KEPT_FIELDS) {
    const value = asTrimmedString(input[key]);
    if (!value) {
      continue;
    }
    // A cut copies its characters, as `summarizeToolTextOutput` does, so the
    // kept prefix does not pin the whole input string in memory.
    projected[key] =
      value.length <= TOOL_INPUT_FIELD_MAX_LENGTH
        ? value
        : Array.from(`${value.slice(0, TOOL_INPUT_FIELD_MAX_LENGTH - 1).trimEnd()}…`).join("");
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}

function projectViewedImagePath(
  data: Record<string, unknown>,
  toolName: string | undefined,
  input: Record<string, unknown> | null,
  itemType: unknown,
): string | undefined {
  const directPath = asTrimmedString(data.imagePath);
  if (
    directPath &&
    (/^mate-asset:[a-f0-9-]{36}(?::(?:source-missing|source-changed|storage-full|unsupported|persistence-failed))?$/.test(
      directPath,
    ) ||
      isWorkspaceImagePreviewPath(directPath))
  ) {
    return directPath;
  }

  if (itemType === "image_view") {
    const path = asTrimmedString(asRecord(data.item)?.path);
    if (path && isWorkspaceImagePreviewPath(path)) return path;
  }
  const name = toolName?.toLowerCase();
  if (name !== "read" && name !== "read file") {
    return undefined;
  }
  const inputPath = asTrimmedString(input?.file_path) ?? asTrimmedString(input?.path);
  return inputPath && isWorkspaceImagePreviewPath(inputPath) ? inputPath : undefined;
}

function summarizeToolTextOutput(value: string): string | null {
  let meaningfulLineCount = 0;
  let offset = 0;

  while (offset <= value.length) {
    const newlineIndex = value.indexOf("\n", offset);
    const lineEnd = newlineIndex === -1 ? value.length : newlineIndex;
    const line = value.slice(offset, lineEnd).replace(/\s+/g, " ").trim();
    if (line.length > 0) {
      meaningfulLineCount += 1;
      if (line !== "```") {
        const summary = line.length <= 84 ? line : `${line.slice(0, 83).trimEnd()}…`;
        // V8 can retain the full tool output behind a short sliced string.
        // Join a tiny character array so the returned preview owns its bytes.
        return Array.from(summary).join("");
      }
    }
    if (newlineIndex === -1) {
      break;
    }
    offset = newlineIndex + 1;
  }

  return meaningfulLineCount > 1 ? `${meaningfulLineCount.toLocaleString()} lines` : null;
}

/**
 * Fields of an MCP tool-call item both clients render in the expanded
 * work-log row. Everything else — notably `result`, which carries the full
 * tool output and dominates wire size on MCP-heavy threads — is summarized
 * or dropped. Full payloads remain in persistence.
 */
const MCP_ITEM_KEPT_FIELDS = [
  "type",
  "id",
  "tool",
  "server",
  "status",
  "arguments",
  "appContext",
  "error",
  "durationMs",
] as const;

/**
 * Pulls renderable text out of an MCP tool result: either a Codex-style
 * `{content: [{type: "text", text}, ...]}` record or a raw Claude
 * `tool_result` block whose `content` is a string or block array.
 */
function extractMcpResultText(result: unknown): string | null {
  const record = asRecord(result);
  if (!record) {
    return typeof result === "string" ? result : null;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  if (Array.isArray(record.content)) {
    const texts: string[] = [];
    for (const entry of record.content) {
      const text = asRecord(entry)?.text;
      if (typeof text === "string" && text.trim().length > 0) {
        texts.push(text);
      }
    }
    if (texts.length > 0) {
      return texts.join("\n");
    }
  }
  return null;
}

function summarizeMcpResult(result: unknown): Record<string, unknown> | undefined {
  if (result === undefined || result === null) {
    return undefined;
  }
  const text = extractMcpResultText(result);
  const summary = text ? summarizeToolTextOutput(text) : null;
  return summary ? { content: summary } : undefined;
}

/**
 * MCP tool calls carry full tool results (`data.item.result` on Codex,
 * `data.result` on Claude/OpenCode) that used to bypass slimming entirely to
 * keep the expanded-row UI working. Keep the fields the UI actually renders
 * and summarize the result like regular tool output.
 */
function projectMcpToolCallData(data: Record<string, unknown>): Record<string, unknown> {
  const projectedData: Record<string, unknown> = {};

  const item = asRecord(data.item);
  if (item) {
    const projectedItem: Record<string, unknown> = {};
    for (const key of MCP_ITEM_KEPT_FIELDS) {
      if (key in item) {
        projectedItem[key] = item[key];
      }
    }
    const result = summarizeMcpResult(item.result);
    if (result) {
      projectedItem.result = result;
    }
    projectedData.item = projectedItem;
  }

  if ("toolName" in data) {
    projectedData.toolName = data.toolName;
  }
  if ("input" in data) {
    projectedData.input = data.input;
  }
  if (!item) {
    const result = summarizeMcpResult(data.result);
    if (result) {
      projectedData.result = result;
    }
  }

  if ("toolCallId" in data) {
    projectedData.toolCallId = data.toolCallId;
  }
  if ("kind" in data) {
    projectedData.kind = data.kind;
  }

  const changedFiles: string[] = [];
  collectChangedFiles(data, changedFiles, new Set<string>(), 0);
  if (changedFiles.length > 0) {
    projectedData.files = changedFiles.map((path) => ({ path }));
  }

  return projectedData;
}

function projectRawOutput(value: unknown): Record<string, unknown> | undefined {
  const direct = asTrimmedString(value);
  if (direct) {
    const summary = summarizeToolTextOutput(direct);
    return summary ? { content: summary } : undefined;
  }

  const rawOutput = asRecord(value);
  if (!rawOutput) {
    return undefined;
  }

  if (typeof rawOutput.totalFiles === "number" && Number.isFinite(rawOutput.totalFiles)) {
    return {
      totalFiles: rawOutput.totalFiles,
      ...(rawOutput.truncated === true ? { truncated: true } : {}),
    };
  }

  const content = asTrimmedString(rawOutput.content);
  if (content) {
    const summary = summarizeToolTextOutput(content);
    return summary ? { content: summary } : undefined;
  }

  const stdout = asTrimmedString(rawOutput.stdout);
  if (stdout) {
    const summary = summarizeToolTextOutput(stdout);
    return summary ? { content: summary } : undefined;
  }

  const stderr = asTrimmedString(rawOutput.stderr);
  if (stderr) {
    const summary = summarizeToolTextOutput(stderr);
    return summary ? { content: summary } : undefined;
  }

  return undefined;
}

function projectAcpContent(value: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const text = value
    .map((entryValue) => {
      const entry = asRecord(entryValue);
      const content = asRecord(entry?.content);
      return entry?.type === "content" && content?.type === "text"
        ? asTrimmedString(content.text)
        : null;
    })
    .filter((entry): entry is string => entry !== null)
    .join("\n");
  const summary = summarizeToolTextOutput(text);
  return summary ? { content: summary } : undefined;
}

/**
 * Removes activity payload fields that no current client reads while retaining
 * the full payload in persistence and the event store.
 */
export function projectActivityPayload(
  activity: OrchestrationThreadActivity,
): OrchestrationThreadActivity {
  const payload = asRecord(activity.payload);
  const data = asRecord(payload?.data);
  if (!payload || !data) {
    return activity;
  }

  const itemStatus = asRecord(data.item)?.status;
  const projectedPayload =
    payload.status === "completed" && (itemStatus === "failed" || itemStatus === "declined")
      ? { ...payload, status: itemStatus }
      : payload;

  /**
   * A `zerops_*` result is a document the client decodes into a card, not
   * output to skim, so a bounded copy survives the slimming below. The gate is
   * the tool NAME and it sits HERE rather than inside the mcp branch, because
   * Claude types `mcp__zerops__zerops_delete` as `file_change` — an
   * mcp-branch-only hook would drop exactly the calls that rename around it.
   *
   * This activity has no `provider` field (`OrchestrationThreadActivity` is
   * driver-agnostic) to call the SPI's provider-keyed `readToolCall` with, so
   * it shape-sniffs instead — see `sniffToolCallShape`'s doc comment.
   */
  // Idempotence: a payload that was already projected has its `result`
  // slimmed to the 84-character teaser and its card text in `zerops`. The
  // history path re-projects every stored row on read, and a row persisted
  // in projected form (every streamed `tool.updated`) must keep the copy it
  // carries: recomputing from the teaser would replace the document with its
  // first line, and a row with no result left has nothing to recompute from.
  //
  // The title an ACP call is named by is the activity's summary (a start's,
  // without its " started").
  const title =
    asTrimmedString(payload.title) ??
    (activity.kind === "tool.started"
      ? activity.summary.replace(/ started$/u, "")
      : activity.summary);
  // A title that is only the item type is a placeholder, not the agent's
  // own title: it names no call.
  const sniffed = sniffToolCallShape(
    data,
    title === payload.itemType ? undefined : title,
    payload.status,
  );
  const call = sniffed.kind === "toolCall" ? sniffed.call : undefined;
  const zeropsCall = call !== undefined && isZeropsToolName(call.name) ? call : undefined;
  const zerops = readStoredZeropsResult(data.zerops) ?? projectZeropsToolCall(zeropsCall);
  // Every driver's call in one form: the tool's name where Claude's is, a
  // driver that names none (OpenCode, the ACP agents) by the name the SPI
  // read — an MCP tool in Claude's `mcp__<server>__<tool>`, so it is never
  // taken for a native tool of its name; Codex's own items carry theirs in
  // `item`.
  const toolName =
    asTrimmedString(data.toolName) ??
    (asRecord(data.item) || !call
      ? undefined
      : call.server === undefined
        ? call.name
        : `mcp__${call.server}__${call.name}`);

  if (payload.itemType === "mcp_tool_call") {
    return {
      ...activity,
      payload: {
        ...projectedPayload,
        data: {
          ...projectMcpToolCallData(data),
          ...(toolName !== undefined && data.toolName === undefined && !asRecord(data.item)
            ? { toolName }
            : {}),
          ...(zerops === undefined ? {} : { zerops }),
        },
      },
    };
  }

  const projectedData: Record<string, unknown> = {};
  const item = projectCommandData(data);
  if (item) {
    projectedData.item = item;
  }
  const command = projectCommandValue(data);
  if (command !== undefined) {
    projectedData.command = command;
  }
  const callInput = callInputOf(data);
  // A Zerops call's arguments are its card's: kept whole, as an MCP call's are.
  const zeropsArguments = asRecord(zeropsCall?.arguments);
  const input =
    zeropsArguments ?? projectToolInput(callInput, payload.itemType === "collab_agent_tool_call");
  if (input) {
    projectedData.input = input;
  }
  const imagePath = projectViewedImagePath(data, toolName, callInput, payload.itemType);
  if (imagePath) {
    projectedData.imagePath = imagePath;
    const imageName = asTrimmedString(data.imageName);
    if (imageName) projectedData.imageName = imageName;
    const dimensions = asRecord(data.imageDimensions);
    if (
      typeof dimensions?.width === "number" &&
      dimensions.width > 0 &&
      Number.isFinite(dimensions.width) &&
      typeof dimensions.height === "number" &&
      dimensions.height > 0 &&
      Number.isFinite(dimensions.height)
    )
      projectedData.imageDimensions = { width: dimensions.width, height: dimensions.height };
  }

  const changedFiles: string[] = [];
  collectChangedFiles(
    callInput === null ? data : { ...data, input: callInput },
    changedFiles,
    new Set<string>(),
    0,
  );
  if (changedFiles.length > 0) {
    // Both clients discover file names by walking objects with path-like keys.
    projectedData.files = changedFiles.map((path) => ({ path }));
  }

  // What a call wrote stays here; the mark says its row opens onto it
  // (`threads.fileWrites`). A row stored projected keeps the mark it has.
  if (data.wrote === true || hasFileWrites(data)) {
    projectedData.wrote = true;
  }

  if ("toolCallId" in data) {
    projectedData.toolCallId = data.toolCallId;
  }
  if ("kind" in data) {
    projectedData.kind = data.kind;
  }
  if ("toolName" in data) {
    projectedData.toolName = data.toolName;
  } else if (toolName !== undefined) {
    projectedData.toolName = toolName;
  }

  const rawOutput =
    projectRawOutput(data.rawOutput) ??
    projectAcpContent(data.content) ??
    (payload.itemType === "command_execution" ? summarizeMcpResult(data.result) : undefined);
  if (rawOutput) {
    projectedData.rawOutput = rawOutput;
  }

  if (zerops !== undefined) {
    projectedData.zerops = zerops;
  }

  return {
    ...activity,
    payload: {
      ...projectedPayload,
      data: projectedData,
    },
  };
}

/**
 * Matches the validity rule in the web client's
 * `deriveLatestContextWindowSnapshot`: rows without a finite, non-negative
 * `usedTokens` are skipped during its backward walk, so they must not shadow
 * an earlier resolvable row here.
 */
function isResolvableContextWindowActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "context-window.updated") {
    return false;
  }
  const payload = asRecord(activity.payload);
  const usedTokens = payload?.usedTokens;
  return typeof usedTokens === "number" && Number.isFinite(usedTokens) && usedTokens >= 0;
}

/**
 * Drops all but the last resolvable context-window activity per turn from a
 * snapshot. Clients only ever read the latest usage value (walking the array
 * backwards), so shipping the full history — often thousands of rows on long
 * threads — buys nothing. Retention is per turn rather than per thread because
 * a live `thread.reverted` makes the client discard whole turns; keeping each
 * turn's latest row means the meter can still resolve a value from the turns
 * that survive. Malformed rows pass through untouched rather than shadowing a
 * valid earlier row. Live `thread.activity-appended` events are untouched:
 * newer updates still stream through and supersede the retained rows on the
 * client.
 */
function dropStaleContextWindowActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<OrchestrationThreadActivity> {
  const latestIndexByTurn = new Map<string | null, number>();
  for (let index = 0; index < activities.length; index += 1) {
    if (isResolvableContextWindowActivity(activities[index]!)) {
      latestIndexByTurn.set(activities[index]!.turnId, index);
    }
  }
  if (latestIndexByTurn.size === 0) {
    return activities;
  }
  return activities.filter(
    (activity, index) =>
      !isResolvableContextWindowActivity(activity) ||
      latestIndexByTurn.get(activity.turnId) === index,
  );
}

/**
 * Drops `tool.updated` rows a `tool.completed` row already supersedes —
 * except a call's first sight, where it has no `tool.started` before it. An
 * update is the in-flight snapshot of a call; once the call completes, the
 * completion carries the final state and the clients fold every matching
 * update into it, so shipping the updates buys nothing — 47k such rows exist
 * in one real database, and a single thread carries 2,291 of them totalling
 * ~1MB post-slimming.
 *
 * Matching is per turn for the same reason `dropStaleContextWindowActivities`
 * retains per turn: a live `thread.reverted` makes the client discard whole
 * turns, so a completion in a different turn could vanish and leave the
 * dropped update unrepresented. The completion must also come *after* the
 * update within the turn — a later update belongs to a subsequent call that
 * reuses the same identity and is still in flight — but for a completion's
 * echo, which goes wherever it sorts (see below). Rows without a lifecycle
 * identity pass through, matching the clients, which never collapse them.
 * Deliberate divergence from client collapse: clients fold only *adjacent*
 * lifecycle rows, so a superseded update separated from its completion by an
 * interleaved parallel call renders as its own row today, and this drop
 * removes it. Measured against a real database, that affects 1.5% of dropped
 * rows (553 of 36,581), all pure in-flight state whose final result the
 * retained completion still shows. Dropping them is intentional; matching
 * adjacency server-side would forfeit most of the win for parallel-heavy
 * threads, which are exactly the heavy ones. Superseding completions always
 * carry a payload superset of their updates (verified across all 49,515
 * update rows: zero dropped rows held a client-merged field — detail, title,
 * command, item, kind, files — their completion lacked), so no expanded-row
 * content is lost.
 */
function dropSupersededToolUpdatedActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<OrchestrationThreadActivity> {
  const completionIndicesByKey = new Map<string, number[]>();
  const completionsByEchoKey = new Map<string, OrchestrationThreadActivity[]>();
  for (let index = 0; index < activities.length; index += 1) {
    const activity = activities[index]!;
    if (activity.kind !== "tool.completed") {
      continue;
    }
    const echoKey = toolCallEchoKey(activity);
    if (echoKey !== null) {
      completionsByEchoKey.set(echoKey, [...(completionsByEchoKey.get(echoKey) ?? []), activity]);
    }
    const identity = toolLifecycleIdentity(activity);
    if (!identity) {
      continue;
    }
    const key = `${activity.turnId ?? ""}\u0000${identity}`;
    const indices = completionIndicesByKey.get(key);
    if (indices) {
      indices.push(index);
    } else {
      completionIndicesByKey.set(key, [index]);
    }
  }
  if (completionIndicesByKey.size === 0) {
    return activities;
  }

  // A call's first sight: where the live run started its step and stood it.
  // An ACP call never sends a start — its first update is its first sight —
  // so that update stays, or a reload would start the step at its end.
  const seen = new Set<string>();
  // A completion's echo — its update stamped with the same instant and the
  // same payload but its status (`isToolCallEcho`) — goes wherever it sorts,
  // first sight or not. Both rows are compared projected, the form the client
  // receives: the snapshot query hands most rows here projected already, but
  // a raw read hands a stored completion as it was written, and projecting a
  // projected row again changes nothing.
  const projected = new Map<OrchestrationThreadActivity, OrchestrationThreadActivity>();
  const projectedOf = (row: OrchestrationThreadActivity) => {
    const known = projected.get(row);
    if (known !== undefined) return known;
    const next = projectActivityPayload(row);
    projected.set(row, next);
    return next;
  };
  const isEcho = (activity: OrchestrationThreadActivity) => {
    if (activity.kind !== "tool.updated") return false;
    const echoKey = toolCallEchoKey(activity);
    const completions = echoKey === null ? undefined : completionsByEchoKey.get(echoKey);
    return (
      completions?.some((completion) =>
        isToolCallEcho(projectedOf(activity), projectedOf(completion)),
      ) === true
    );
  };
  return activities.filter((activity, index) => {
    if (isEcho(activity)) {
      return false;
    }
    const lifecycle =
      activity.kind === "tool.started" ||
      activity.kind === "tool.updated" ||
      activity.kind === "tool.completed";
    const identity = lifecycle ? toolLifecycleIdentity(activity) : null;
    if (!identity) {
      return true;
    }
    const key = `${activity.turnId ?? ""}\u0000${identity}`;
    const firstSight = !seen.has(key);
    seen.add(key);
    if (activity.kind !== "tool.updated" || firstSight) {
      return true;
    }
    const indices = completionIndicesByKey.get(key);
    return !indices?.some((completionIndex) => completionIndex > index);
  });
}

export function projectThreadDetailSnapshot(
  snapshot: OrchestrationThreadDetailSnapshot,
  reasoningMessages = true,
): OrchestrationThreadDetailSnapshot {
  return {
    ...snapshot,
    thread: {
      ...snapshot.thread,
      messages: reasoningMessages
        ? snapshot.thread.messages
        : snapshot.thread.messages.map((message) =>
            message.role === "reasoning" ? { ...message, role: "system" as const } : message,
          ),
      activities: dropSupersededToolUpdatedActivities(
        dropStaleContextWindowActivities(snapshot.thread.activities),
      ).map(projectActivityPayload),
    },
  };
}

export function projectActivityEvent(
  event: OrchestrationEvent,
  reasoningMessages = true,
): OrchestrationEvent {
  // Preserve sequence watermarks and message identities for clients whose role
  // decoder predates reasoning. Filtering would strand their history pages.
  if (
    !reasoningMessages &&
    event.type === "thread.message-sent" &&
    event.payload.role === "reasoning"
  ) {
    return { ...event, payload: { ...event.payload, role: "system" } };
  }
  if (event.type !== "thread.activity-appended") {
    return event;
  }
  return {
    ...event,
    payload: {
      ...event.payload,
      activity: projectActivityPayload(event.payload.activity),
    },
  };
}
