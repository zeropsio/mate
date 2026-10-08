/**
 * A call reads on the engine as V1's row of the same call reads: each driver's call-heavy turn,
 * recorded through its real adapter, through the bridge's fold and the pump's mapping — against
 * V1's own ingestion and projection of the same events.
 */
import {
  type ItemBody,
  type OrchestrationThreadActivity,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { assert, describe, it } from "vite-plus/test";

import { projectActivityPayload } from "../../orchestration/ActivityPayloadProjection.ts";
import { runtimeEventToActivities } from "../../orchestration/Layers/ProviderRuntimeIngestion.ts";
import { makeToCore } from "../pump/toCore.ts";
import { recordCallHeavy, type Recording } from "../testing/bridge/callHeavy.ts";
import type { BridgeDriver } from "./spi3.ts";
import { makeTranslator } from "./translate.ts";

type CallBody = Extract<ItemBody, { kind: "call" }>;

interface Closed {
  readonly body: CallBody;
  readonly pictures: number;
}

/** Each call's record as it closed, in the order the calls opened. */
function engineCalls(driver: BridgeDriver, recording: Recording): ReadonlyArray<Closed> {
  const translator = makeTranslator({ driver, threadId: recording.threadId });
  const toCore = makeToCore();
  const closed = new Map<string, Closed>();
  for (const input of recording.log)
    for (const signal of translator.step(input)) {
      const step = toCore.step(signal, 0);
      for (const one of step.signals)
        if (one.kind === "item-closed" && one.body.kind === "call")
          closed.set(one.key, {
            body: one.body,
            pictures: step.pictures.find((each) => each.key === one.key)?.images.length ?? 0,
          });
    }
  return [...closed.values()];
}

interface V1Call {
  readonly itemType: string;
  readonly detail: string | undefined;
  readonly shows: Record<string, unknown> | undefined;
  readonly result: Record<string, unknown> | undefined;
}

/** The same calls as V1 writes and projects them: its activities, merged per call. */
function v1Calls(recording: Recording): ReadonlyArray<V1Call> {
  const calls = new Map<string, V1Call>();
  for (const input of recording.log) {
    if (input.kind !== "event") continue;
    for (const activity of runtimeEventToActivities(input.event as ProviderRuntimeEvent)) {
      if (!activity.kind.startsWith("tool.")) continue;
      const payload = projectActivityPayload(activity as OrchestrationThreadActivity)
        .payload as Record<string, unknown>;
      const id = String(payload.toolCallId);
      const known = calls.get(id);
      const { zerops, toolCallId: _id, ...data } = (payload.data ?? {}) as Record<string, unknown>;
      const shows = { ...known?.shows, ...data };
      const result = (zerops as Record<string, unknown> | undefined) ?? known?.result;
      calls.set(id, {
        itemType: String(payload.itemType),
        detail: (payload.detail as string | undefined) ?? known?.detail,
        shows: Object.keys(shows).length === 0 ? undefined : shows,
        result,
      });
    }
  }
  return [...calls.values()];
}

/** The kind of item each step reads back as on a client (the run card's inverse). */
const STEP_KINDS: Readonly<Record<string, string>> = {
  command: "command_execution",
  edit: "file_change",
  web: "web_search",
  look: "image_view",
  helper: "collab_agent_tool_call",
  mcp: "mcp_tool_call",
  tool: "dynamic_tool_call",
  read: "dynamic_tool_call",
  search: "dynamic_tool_call",
};

/** One call as a line: its step and tool, its input, what can be read of it, its result. */
const callLine = ({ body, pictures }: Closed): string =>
  [
    `${body.step} ${body.tool.server === undefined ? "" : `${body.tool.server} · `}${body.tool.name}`,
    body.input === undefined ? undefined : `"${body.input.split("\n")[0]}"`,
    body.parts === undefined ? undefined : `reads ${body.parts.join(", ")}`,
    body.shows?.wrote === true ? "wrote" : undefined,
    body.result === undefined
      ? undefined
      : `result ${body.result.toolName}: ${body.result.resultText ?? "none"}`,
    pictures === 0 ? undefined : `${pictures} picture`,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

const DEPLOY_RESULT = 'result zerops_deploy: {"status":"DEPLOYED","serviceHostname":"api"}';
/** Cursor and Grok's line for a command is what it printed; Antigravity's is the command. */
const acpCalls = (commandLine: string) => [
  `command execute · "${commandLine}"`,
  'read read · "{"name":"api"}"',
  'edit edit · "/var/www/api/src/main.ts" · wrote',
  `tool zerops · zerops_deploy · "{"status":"DEPLOYED","serviceHostname":"api"}" · ${DEPLOY_RESULT}`,
];

const CASES: ReadonlyArray<{
  readonly driver: BridgeDriver;
  readonly lines: ReadonlyArray<string>;
}> = [
  {
    driver: "claudeAgent",
    lines: [
      'command Bash · "Bash: npm run build" · reads detail',
      'read Read · "Read: {"file_path":"/var/www/api/package.json"}"',
      'edit Edit · "Edit: {"file_path":"/var/www/api/src/main.ts","old_string":"listen(3000)","new_string":"listen(8080)"}" · reads detail · wrote',
      `mcp zerops · zerops_deploy · "mcp__zerops__zerops_deploy: {"targetService":"api"}" · ${DEPLOY_RESULT}`,
      'mcp zerops · zerops_browser · "mcp__zerops__zerops_browser: {"url":"https://api.example"}" · result zerops_browser: {"status":"ok"} · 1 picture',
    ],
  },
  {
    driver: "codex",
    lines: [
      `command Ran command · "/usr/bin/zsh -lc 'npm run build'" · reads detail`,
      "edit File change · wrote",
      `mcp zerops · zerops_deploy · ${DEPLOY_RESULT}`,
    ],
  },
  {
    driver: "opencode",
    lines: [
      'command bash · "built in 41 s"',
      'read read · "{"name":"api"}"',
      'edit edit · "main.ts" · wrote',
      `tool zerops · zerops_deploy · "{"status":"DEPLOYED","serviceHostname":"api"}" · ${DEPLOY_RESULT}`,
    ],
  },
  { driver: "cursor", lines: acpCalls("built in 41 s") },
  { driver: "grok", lines: acpCalls("built in 41 s") },
  { driver: "antigravity", lines: acpCalls("npm run build") },
];

describe("a call reads on the engine as V1's row of the same call", () => {
  for (const { driver, lines } of CASES) {
    it(
      `${driver} [recorded]: a command, a read, an edit and a deploy carry their step, input line, whole parts and result`,
      { timeout: 30_000 },
      async () => {
        const calls = engineCalls(driver, await recordCallHeavy(driver));
        assert.deepStrictEqual(calls.map(callLine), lines);
      },
    );

    it(
      `${driver} [recorded]: each call's record carries the line, the facts and the result V1's activity carries`,
      { timeout: 30_000 },
      async () => {
        const recording = await recordCallHeavy(driver);
        const engine = engineCalls(driver, recording);
        const v1 = v1Calls(recording);
        assert.strictEqual(engine.length, v1.length);
        engine.forEach(({ body }, n) => {
          const call = v1[n]!;
          assert.strictEqual(STEP_KINDS[body.step], call.itemType, `${body.tool.name}'s kind`);
          assert.strictEqual(body.input, call.detail, `${body.tool.name}'s line`);
          assert.deepStrictEqual(body.shows, call.shows, `${body.tool.name}'s facts`);
          const { images: _images, ...result } = call.result ?? {};
          assert.deepStrictEqual(
            body.result,
            call.result === undefined ? undefined : result,
            `${body.tool.name}'s result`,
          );
        });
      },
    );
  }
});
