/**
 * One call-heavy turn per driver, recorded through its real adapter: a command with output, a
 * file read, an edit and a Zerops deploy with its result (and, on Claude, a Zerops picture) —
 * the calls a run card draws. Claude and Codex from an authored wire through their replay seams,
 * OpenCode through its runtime double, Cursor, Grok and Antigravity against the ACP mock agent.
 *
 * Nothing here is imported by production code.
 */
import type { BridgeDriver } from "../../bridge/spi3.ts";
import type { BridgeInput } from "../../bridge/translate.ts";
import { recordOpenCodeTurn } from "../../../spi/replay/openCodeReplay.ts";
import { replayCodex } from "../../../spi/replay/codexReplay.ts";
import { asSessionRoutes } from "./goldens.ts";
import { authored, commandLogAround, recordAcp, recordClaude } from "./record.ts";

export const COMMAND = "npm run build";
export const OUTPUT = "built in 41 s\n3 files written";
export const READ_PATH = "/var/www/api/package.json";
export const EDIT_PATH = "/var/www/api/src/main.ts";
export const DEPLOYED = '{"status":"DEPLOYED","serviceHostname":"api"}';
/** A 1×1 PNG, as a Zerops browser call returns its screenshot. */
export const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export interface Recording {
  readonly threadId: string;
  readonly log: ReadonlyArray<BridgeInput>;
}

// ── Claude: the SDK's messages ────────────────────────────────────────

const CLAUDE_SESSION = "c1a0de00-0000-4000-8000-000000000001";
let claudeUuid = 0;
const claudeMessage = (message: Record<string, unknown>) => ({
  ...message,
  session_id: CLAUDE_SESSION,
  parent_tool_use_id: null,
  uuid: `00000000-0000-4000-8000-${String((claudeUuid += 1)).padStart(12, "0")}`,
});
const stream = (event: Record<string, unknown>) => claudeMessage({ type: "stream_event", event });
const assistant = (id: string, content: ReadonlyArray<unknown>) =>
  claudeMessage({
    type: "assistant",
    message: {
      model: "claude-opus-5",
      id,
      type: "message",
      role: "assistant",
      content,
      stop_reason: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  });

/** One model response that calls one tool, and the tool's result. */
const claudeCall = (
  n: number,
  name: string,
  input: Record<string, unknown>,
  result: string | ReadonlyArray<unknown>,
) => {
  const id = `toolu_heavy_${n}`;
  const message = `msg_heavy_${n}`;
  return [
    stream({
      type: "message_start",
      message: {
        model: "claude-opus-5",
        id: message,
        type: "message",
        role: "assistant",
        content: [],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }),
    stream({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id, name, input: {} },
    }),
    stream({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
    }),
    assistant(message, [{ type: "tool_use", id, name, input }]),
    stream({ type: "content_block_stop", index: 0 }),
    stream({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: {} }),
    stream({ type: "message_stop" }),
    claudeMessage({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: id, content: result, is_error: false }],
      },
    }),
  ];
};

export const claudeCallHeavy = (): ReadonlyArray<unknown> => [
  claudeMessage({
    type: "system",
    subtype: "init",
    cwd: "/var/www",
    tools: ["Bash", "Read", "Edit"],
    mcp_servers: [{ name: "zerops", status: "connected" }],
    model: "claude-opus-5",
    permissionMode: "bypassPermissions",
    apiKeySource: "none",
  }),
  ...claudeCall(1, "Bash", { command: COMMAND, description: "Build the api" }, OUTPUT),
  ...claudeCall(2, "Read", { file_path: READ_PATH }, '1\t{"name":"api"}'),
  ...claudeCall(
    3,
    "Edit",
    { file_path: EDIT_PATH, old_string: "listen(3000)", new_string: "listen(8080)" },
    "The file was updated.",
  ),
  ...claudeCall(4, "mcp__zerops__zerops_deploy", { targetService: "api" }, [
    { type: "text", text: DEPLOYED },
  ]),
  ...claudeCall(5, "mcp__zerops__zerops_browser", { url: "https://api.example" }, [
    { type: "text", text: '{"status":"ok"}' },
    { type: "image", source: { type: "base64", media_type: "image/png", data: PIXEL } },
  ]),
  stream({
    type: "message_start",
    message: {
      model: "claude-opus-5",
      id: "msg_heavy_answer",
      type: "message",
      role: "assistant",
      content: [],
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  }),
  stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
  stream({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "Deployed the api." },
  }),
  assistant("msg_heavy_answer", [{ type: "text", text: "Deployed the api." }]),
  stream({ type: "content_block_stop", index: 0 }),
  stream({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: {} }),
  stream({ type: "message_stop" }),
  claudeMessage({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 1000,
    duration_api_ms: 900,
    num_turns: 5,
    result: "Deployed the api.",
    stop_reason: "end_turn",
    total_cost_usd: 0.01,
    usage: { input_tokens: 5, output_tokens: 5 },
  }),
];

// ── Codex: the app-server's notifications ─────────────────────────────

const CODEX_THREAD = "spi-replay-codex-thread";
const CODEX_TURN = "turn-heavy";
const codexItem = (phase: "started" | "completed", item: Record<string, unknown>) => ({
  method: `item/${phase}`,
  params: {
    item,
    threadId: CODEX_THREAD,
    turnId: CODEX_TURN,
    ...(phase === "started"
      ? { startedAtMs: 1_791_412_977_640 }
      : { completedAtMs: 1_791_412_977_774 }),
  },
});

const codexAnswer = (text: string) => ({
  type: "agentMessage",
  id: "msg-heavy",
  text,
  phase: "final_answer",
  memoryCitation: null,
  delivery: null,
  questions: null,
});

export const codexCallHeavy = (): ReadonlyArray<unknown> => {
  const command = (status: string, output: string | null) => ({
    type: "commandExecution",
    id: "exec-heavy",
    pluginId: null,
    scriptPath: null,
    processId: "47292",
    source: "unifiedExecStartup",
    command: `/usr/bin/zsh -lc '${COMMAND}'`,
    cwd: "/var/www/api",
    status,
    commandActions: [{ type: "unknown", command: COMMAND }],
    aggregatedOutput: output,
    exitCode: output === null ? null : 0,
    durationMs: output === null ? null : 41_000,
  });
  const edit = (status: string) => ({
    type: "fileChange",
    id: "patch-heavy",
    status,
    changes: [
      {
        path: EDIT_PATH,
        kind: { type: "update", move_path: null },
        diff: "@@ -1 +1 @@\n-listen(3000)\n+listen(8080)",
      },
    ],
  });
  const deploy = (status: string, result: unknown) => ({
    type: "mcpToolCall",
    id: "mcp-heavy",
    server: "zerops",
    tool: "zerops_deploy",
    status,
    arguments: { targetService: "api" },
    appContext: null,
    mcpAppUi: null,
    pluginId: null,
    readOnlyHint: false,
    result,
    error: null,
    durationMs: result === null ? null : 3000,
  });
  return [
    {
      method: "turn/started",
      params: {
        threadId: CODEX_THREAD,
        turn: {
          id: CODEX_TURN,
          items: [],
          itemsView: "notLoaded",
          status: "inProgress",
          error: null,
          startedAt: 1785898342,
          completedAt: null,
          durationMs: null,
        },
      },
    },
    codexItem("started", command("inProgress", null)),
    {
      method: "item/commandExecution/outputDelta",
      params: { threadId: CODEX_THREAD, turnId: CODEX_TURN, itemId: "exec-heavy", delta: OUTPUT },
    },
    codexItem("completed", command("completed", OUTPUT)),
    codexItem("started", edit("inProgress")),
    codexItem("completed", edit("completed")),
    codexItem("started", deploy("inProgress", null)),
    codexItem(
      "completed",
      deploy("completed", { content: [{ type: "text", text: DEPLOYED }], structuredContent: null }),
    ),
    codexItem("started", codexAnswer("")),
    codexItem("completed", codexAnswer("Deployed the api.")),
    {
      method: "turn/completed",
      params: {
        threadId: CODEX_THREAD,
        turn: { id: CODEX_TURN, items: [], status: "completed", error: null },
      },
    },
  ];
};

// ── OpenCode: the server's SSE events ─────────────────────────────────

const OPENCODE_SESSION = "http://127.0.0.1:9999/session";
const openCodeTool = (
  n: number,
  tool: string,
  input: Record<string, unknown>,
  output: string,
  title: string,
) => {
  const part = (state: Record<string, unknown>, at: number) => ({
    type: "message.part.updated",
    properties: {
      sessionID: OPENCODE_SESSION,
      time: at,
      part: {
        id: `part-heavy-${n}`,
        sessionID: OPENCODE_SESSION,
        messageID: "msg-heavy",
        type: "tool",
        callID: `call-heavy-${n}`,
        tool,
        state,
      },
    },
  });
  return [
    part({ status: "running", input, title, time: { start: n } }, n),
    part(
      { status: "completed", input, output, title, metadata: {}, time: { start: n, end: n + 1 } },
      n + 1,
    ),
  ];
};

export const openCodeCallHeavy = (): ReadonlyArray<unknown> => [
  {
    type: "session.status",
    properties: { sessionID: OPENCODE_SESSION, status: { type: "busy" } },
  },
  {
    type: "message.updated",
    properties: { sessionID: OPENCODE_SESSION, info: { id: "msg-heavy", role: "assistant" } },
  },
  ...openCodeTool(1, "bash", { command: COMMAND, description: "Build the api" }, OUTPUT, COMMAND),
  ...openCodeTool(3, "read", { filePath: READ_PATH }, '{"name":"api"}', "package.json"),
  ...openCodeTool(
    5,
    "edit",
    { filePath: EDIT_PATH, oldString: "listen(3000)", newString: "listen(8080)" },
    "",
    "main.ts",
  ),
  ...openCodeTool(7, "zerops_zerops_deploy", { targetService: "api" }, DEPLOYED, "zerops_deploy"),
  {
    type: "message.part.updated",
    properties: {
      sessionID: OPENCODE_SESSION,
      time: 9,
      part: {
        id: "part-heavy-text",
        sessionID: OPENCODE_SESSION,
        messageID: "msg-heavy",
        type: "text",
        text: "Deployed the api.",
        time: { start: 9, end: 10 },
      },
    },
  },
  {
    type: "session.status",
    properties: { sessionID: OPENCODE_SESSION, status: { type: "idle" } },
  },
];

// ── every driver ──────────────────────────────────────────────────────

/** The call-heavy turn as the host would log it for one driver. */
export async function recordCallHeavy(driver: BridgeDriver): Promise<Recording> {
  switch (driver) {
    case "claudeAgent":
      return recordClaude(claudeCallHeavy());
    case "codex": {
      const events = asSessionRoutes(await replayCodex(authored("codex", codexCallHeavy())));
      return { threadId: String(events[0]!.threadId), log: commandLogAround("codex", events) };
    }
    case "opencode": {
      const events = await recordOpenCodeTurn(openCodeCallHeavy());
      return { threadId: String(events[0]!.threadId), log: commandLogAround("opencode", events) };
    }
    case "cursor":
    case "grok":
    case "antigravity":
      return recordAcp(driver, { T3_ACP_EMIT_CALL_HEAVY_TURN: "1" }, { kind: "until-end" });
  }
}
