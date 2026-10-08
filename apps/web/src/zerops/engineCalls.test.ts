/**
 * An engine Mate's calls read in the run card as a V1 Mate's calls do: the records the server
 * writes for a call-heavy Claude and Codex run (`apps/server/src/engine/bridge/calls.test.ts`
 * pins them against V1's own projection) drawn through the engine's thread, against the same
 * calls as V1's activities.
 */
import type { Item, OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  callItem,
  engineRun,
  engineThreadOfRecords,
  personItem,
} from "@t3tools/client-runtime/data/fixtures";
import { deriveZeropsThreadModel } from "@t3tools/client-runtime/zerops/model";
import { describe, expect, it } from "vite-plus/test";

import { activityCounts } from "../components/chat/conversation.logic";
import { deriveWorkLogEntries, type WorkLogEntry } from "../session-logic";

const key = { environmentId: "env-ada", conversationId: "thread-ada" };
const run = "thread-ada/r/1";
const DEPLOYED = '{"status":"DEPLOYED","serviceHostname":"api"}';

type Call = Partial<Extract<Item, { kind: "call" }>> & { readonly itemType: string };

/** Claude's call-heavy run as the engine records it. */
const CLAUDE: ReadonlyArray<Call> = [
  {
    itemType: "command_execution",
    step: "command",
    tool: { name: "Bash" },
    words: "Command run",
    input: "Bash: npm run build",
    shows: {
      toolName: "Bash",
      command: "npm run build",
      input: { description: "Build the api" },
      rawOutput: { content: "built in 41 s" },
    },
    parts: ["detail"],
  },
  {
    itemType: "dynamic_tool_call",
    step: "read",
    tool: { name: "Read" },
    words: "Tool call",
    input: 'Read: {"file_path":"/var/www/api/package.json"}',
    shows: { toolName: "Read", input: { file_path: "/var/www/api/package.json" } },
  },
  {
    itemType: "file_change",
    step: "edit",
    tool: { name: "Edit" },
    words: "File change",
    input:
      'Edit: {"file_path":"/var/www/api/src/main.ts","old_string":"listen(3000)","new_string":"listen(8080)"}',
    shows: { toolName: "Edit", input: { file_path: "/var/www/api/src/main.ts" }, wrote: true },
    parts: ["detail", "data"],
  },
  {
    itemType: "mcp_tool_call",
    step: "mcp",
    tool: { name: "zerops_deploy", server: "zerops" },
    words: "MCP tool call",
    input: 'mcp__zerops__zerops_deploy: {"targetService":"api"}',
    shows: {
      toolName: "mcp__zerops__zerops_deploy",
      input: { targetService: "api" },
      result: { content: DEPLOYED },
    },
    result: { toolName: "zerops_deploy", resultText: DEPLOYED },
  },
];

/** Codex's, whose calls carry their own item and name no tool. */
const CODEX: ReadonlyArray<Call> = [
  {
    itemType: "command_execution",
    step: "command",
    tool: { name: "Ran command" },
    words: "Ran command",
    input: "/usr/bin/zsh -lc 'npm run build'",
    shows: {
      item: { command: "/usr/bin/zsh -lc 'npm run build'", aggregatedOutput: "built in 41 s" },
    },
    parts: ["detail"],
  },
  {
    itemType: "file_change",
    step: "edit",
    tool: { name: "File change" },
    words: "File change",
    shows: { files: [{ path: "/var/www/api/src/main.ts" }], wrote: true },
  },
  {
    itemType: "mcp_tool_call",
    step: "mcp",
    tool: { name: "zerops_deploy", server: "zerops" },
    words: "zerops · zerops_deploy",
    shows: {
      item: {
        type: "mcpToolCall",
        tool: "zerops_deploy",
        server: "zerops",
        status: "completed",
        arguments: { targetService: "api" },
        result: { content: DEPLOYED },
      },
    },
    result: { toolName: "zerops_deploy", resultText: DEPLOYED },
  },
];

const records = (calls: ReadonlyArray<Call>) =>
  calls.map(({ itemType: _kind, ...call }, n) => callItem(run, n + 2, call));

/** The engine's records, drawn through its thread. */
const engineActivities = (calls: ReadonlyArray<Call>) =>
  engineThreadOfRecords(key, {
    runs: [engineRun("thread-ada", 1)],
    items: [personItem(run, 1, "Deploy the api"), ...records(calls)],
  })?.activities ?? [];

/** The same calls as V1's server sends them: a start and a completion per call. */
const v1Activities = (calls: ReadonlyArray<Call>): OrchestrationThreadActivity[] =>
  records(calls).flatMap((item, n) => {
    if (item.kind !== "call") return [];
    const call = calls[n]!;
    const payload = {
      itemType: call.itemType,
      toolCallId: `native-${n}`,
      ...(item.input === undefined ? {} : { detail: item.input }),
      data: { ...item.shows, ...(item.result === undefined ? {} : { zerops: item.result }) },
    };
    const at = new Date(item.at).toISOString();
    return (["tool.started", "tool.completed"] as const).map((kind) => ({
      id: `${kind}-${n}` as OrchestrationThreadActivity["id"],
      tone: "tool" as const,
      kind,
      summary: kind === "tool.started" ? `${item.words} started` : (item.words ?? "Tool"),
      payload: { ...payload, status: kind === "tool.started" ? "inProgress" : "completed" },
      turnId: run as OrchestrationThreadActivity["turnId"],
      sequence: item.seq,
      createdAt: at,
    }));
  });

/** Where a row's own record is, never what it shows. */
const IDENTITY = new Set(["id", "createdAt", "startedAt", "updatedAt", "toolCallId", "turnId"]);

/** What a call's row shows, without the ids and times only its own record has. */
const shown = (entry: WorkLogEntry) =>
  Object.fromEntries(Object.entries(entry).filter(([field]) => !IDENTITY.has(field)));

const calls = (activities: ReadonlyArray<OrchestrationThreadActivity>) =>
  deriveWorkLogEntries(activities).filter((entry) => entry.tone === "tool");

describe("an engine Mate's call reads in the run card as V1's", () => {
  it.each([
    { driver: "Claude", run: CLAUDE },
    { driver: "Codex", run: CODEX },
  ])("$driver: each call's row shows what V1's row of the same call shows", ({ run }) => {
    expect(calls(engineActivities(run)).map(shown)).toEqual(calls(v1Activities(run)).map(shown));
  });

  it("a command's row names its command and opens onto what it printed", () => {
    const [command] = calls(engineActivities(CLAUDE));
    expect(command).toMatchObject({ command: "npm run build", detail: "built in 41 s" });
  });

  it("the effort says what the calls did, a file read as a read", () => {
    expect(activityCounts(calls(engineActivities(CLAUDE)))).toEqual(
      activityCounts(calls(v1Activities(CLAUDE))),
    );
    expect(activityCounts(calls(engineActivities(CLAUDE)))).toContainEqual({
      kind: "read",
      count: 1,
    });
  });

  it.each([
    { driver: "Claude", run: CLAUDE },
    { driver: "Codex", run: CODEX },
  ])("$driver: a deploy is the deploy result row V1 draws", ({ run }) => {
    const operations = (activities: ReadonlyArray<OrchestrationThreadActivity>) =>
      deriveZeropsThreadModel({ activities })
        .entries.filter((entry) => entry.kind === "operation")
        .map((entry) => (entry.kind === "operation" ? entry.operation.kind : null));
    expect(operations(engineActivities(run))).toEqual(operations(v1Activities(run)));
    expect(operations(engineActivities(run))).toContain("deploy");
  });
});
