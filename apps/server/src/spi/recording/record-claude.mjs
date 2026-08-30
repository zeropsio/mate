#!/usr/bin/env node
/**
 * record-claude.mjs — SPI-3 fixture recorder.
 *
 * Drives `@anthropic-ai/claude-agent-sdk` `query()` directly (no z3/T3 server
 * in the loop) with the same streaming-input SDK options
 * `ClaudeAdapter.ts`'s `makeClaudeAdapter` passes (see `queryOptions` around
 * apps/server/src/provider/Layers/ClaudeAdapter.ts:4305-4345), and tees every
 * `SDKMessage` plus every control callback the adapter registers on `query()`
 * — `canUseTool` (apps/server/src/provider/Layers/ClaudeAdapter.ts:4255) and
 * `onUserDialog` (same file, :4256-4260) — to a JSONL file in arrival order.
 *
 * Deliberately mirrors only what the adapter itself sets. Left out because
 * the adapter itself leaves them out in the "no active mcpSession" branch
 * (the common case — MCP tools reach the session through `settingSources`
 * picking up the container's own `~/.claude.json`, not an explicit
 * `mcpServers` option): `mcpServers`, `allowedTools` (the SDK option — the
 * adapter never sets it; access control is `permissionMode` + `canUseTool`
 * only), `model`/`effort`/`settings`, `resume`/`sessionId`, `extraArgs`.
 *
 * Output line shapes (one JSON object per line, arrival order):
 *   {"kind":"message","message":<SDKMessage>}
 *   {"kind":"control","name":"canUseTool","args":{toolName,input},"answer":<PermissionResult>}
 *   {"kind":"control","name":"onUserDialog","args":<UserDialogRequest>,"answer":<UserDialogResult|null>}
 *   {"kind":"control","name":"interrupt","args":null,"answer":<SDKControlInterruptResponse|undefined>}
 *
 * No "kind":"meta" line is ever written to the JSONL — meta lives in the
 * `<out>.meta.json` sidecar this script writes next to `--out` when it exits.
 *
 * Usage:
 *   node record-claude.mjs --prompt "..." --out fixture.jsonl [options]
 *
 * Options:
 *   --prompt <text>            required. The single user turn to send.
 *   --cwd <path>                default /var/www.
 *   --out <file>                required. JSONL output path.
 *   --allowed-tools <a,b,c>     recorder-side safety allowlist consulted by
 *                               THIS script's canUseTool (NOT an SDK option
 *                               — the adapter never sets one either). Tools
 *                               not on the list are denied. Default: the
 *                               read-only zerops status tools.
 *   --answer <first|last|json> strategy for AskUserQuestion answers.
 *                               Default "first". A JSON object maps question
 *                               text -> chosen option label.
 *   --abort-after <tool_use|N> "tool_use" calls query.interrupt() the moment
 *                               the first tool_use content block starts
 *                               streaming; a bare integer N calls it N ms
 *                               after the query is created. Omit for no abort.
 *   --permission-mode <mode>   default "auto" (matches the adapter's default
 *                               `input.runtimeMode: "auto"` mapping).
 *   --claude-binary <path>     default: resolved via `which claude`.
 *   --sdk-path <path>          default:
 *                               /home/zerops/.zcp/z3/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs
 *   --max-wait-ms <n>          safety cap from query start to forced close.
 *                               Default 120000.
 *   --notes <text>             free-text note recorded in the meta sidecar.
 */

import { writeFileSync, appendFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";

const DEFAULT_SDK_PATH = "/home/zerops/.zcp/z3/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs";
const DEFAULT_ALLOWED_TOOLS = [
  "mcp__zerops__zerops_workflow",
  "mcp__zerops__zerops_mount",
  "mcp__zerops__zerops_discover",
];
const CLAUDE_SETTING_SOURCES = ["user", "project", "local"];

function parseArgs(argv) {
  const args = {
    cwd: "/var/www",
    answer: "first",
    permissionMode: "auto",
    sdkPath: DEFAULT_SDK_PATH,
    maxWaitMs: 120000,
    notes: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => argv[++i];
    switch (flag) {
      case "--prompt":
        args.prompt = next();
        break;
      case "--cwd":
        args.cwd = next();
        break;
      case "--out":
        args.out = next();
        break;
      case "--allowed-tools":
        args.allowedTools = next()
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "--answer":
        args.answer = next();
        break;
      case "--abort-after":
        args.abortAfter = next();
        break;
      case "--permission-mode":
        args.permissionMode = next();
        break;
      case "--claude-binary":
        args.claudeBinary = next();
        break;
      case "--sdk-path":
        args.sdkPath = next();
        break;
      case "--max-wait-ms":
        args.maxWaitMs = Number(next());
        break;
      case "--notes":
        args.notes = next();
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  if (!args.prompt) throw new Error("--prompt is required");
  if (!args.out) throw new Error("--out is required");
  if (!args.allowedTools) args.allowedTools = DEFAULT_ALLOWED_TOOLS;
  return args;
}

function resolveClaudeBinary(explicit) {
  if (explicit) return explicit;
  try {
    return execFileSync("which", ["claude"], { encoding: "utf8" }).trim();
  } catch {
    return "/home/zerops/.local/bin/claude";
  }
}

function homeRedactor() {
  const home = process.env.HOME;
  if (!home) return (s) => s;
  return (s) => (typeof s === "string" ? s.split(home).join("~") : s);
}

/** Strip non-serializable / secret-bearing fields for the meta sidecar. */
function sanitizeOptionsForMeta(options, redact) {
  const out = {};
  for (const [key, value] of Object.entries(options)) {
    if (key === "env") {
      out[key] = "<omitted>";
    } else if (typeof value === "function") {
      out[key] = "<function>";
    } else if (Array.isArray(value)) {
      out[key] = value.map((v) => (typeof v === "string" ? redact(v) : v));
    } else if (typeof value === "string") {
      out[key] = redact(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function isToolUseStart(message) {
  if (
    message.type === "stream_event" &&
    message.event?.type === "content_block_start" &&
    message.event?.content_block?.type === "tool_use"
  ) {
    return true;
  }
  if (message.type === "assistant" && Array.isArray(message.message?.content)) {
    return message.message.content.some((block) => block?.type === "tool_use");
  }
  return false;
}

function buildAnswerForQuestions(questions, strategy) {
  // Mirrors the SDK's expected AskUserQuestion answer shape: a map keyed by
  // the full question text (not an index — see ClaudeAdapter.ts:1877-1880,
  // "id MUST equal the full question text").
  let pick;
  if (strategy === "first") {
    pick = (q) => q.options?.[0]?.label;
  } else if (strategy === "last") {
    pick = (q) => q.options?.[q.options.length - 1]?.label;
  } else {
    const parsed = JSON.parse(strategy);
    pick = (q) => parsed[q.question];
  }
  const answers = {};
  for (const q of questions) {
    const label = pick(q);
    if (label !== undefined) answers[q.question] = label;
  }
  return answers;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const redact = homeRedactor();

  const claudeBinaryPath = resolveClaudeBinary(args.claudeBinary);
  const sdkAbsPath = path.resolve(args.sdkPath);
  if (!existsSync(sdkAbsPath)) {
    throw new Error(`SDK not found at ${sdkAbsPath} (pass --sdk-path)`);
  }
  const sdkPackageJson = JSON.parse(
    execFileSync("cat", [path.join(path.dirname(sdkAbsPath), "package.json")], {
      encoding: "utf8",
    }),
  );
  const sdkVersion = sdkPackageJson.version;

  const { query } = await import(pathToFileURL(sdkAbsPath).href);

  // Reset the output file.
  writeFileSync(args.out, "");
  const counters = { message: 0, control: 0 };
  const writeLine = (obj) => {
    counters[obj.kind] += 1;
    appendFileSync(args.out, `${JSON.stringify(obj)}\n`);
  };

  const typeSubtypeSeq = [];

  const canUseTool = async (toolName, input, callbackOptions) => {
    let answer;
    if (toolName === "AskUserQuestion") {
      const questions = Array.isArray(input.questions) ? input.questions : [];
      const answers = buildAnswerForQuestions(questions, args.answer);
      answer = {
        behavior: "allow",
        updatedInput: { questions: input.questions, answers },
      };
    } else if (toolName === "ExitPlanMode") {
      answer = {
        behavior: "deny",
        message: "recorder: ExitPlanMode not exercised by this fixture.",
      };
    } else if (args.allowedTools.includes(toolName)) {
      answer = { behavior: "allow", updatedInput: input };
    } else {
      answer = {
        behavior: "deny",
        message: `recorder default-deny: ${toolName} is not in --allowed-tools`,
      };
    }
    writeLine({
      kind: "control",
      name: "canUseTool",
      args: { toolName, input, toolUseID: callbackOptions.toolUseID ?? null },
      answer,
    });
    return answer;
  };

  const onUserDialog = async (request, _callbackOptions) => {
    // No fixture in this batch resumes a prior session, so `resume_return`
    // (the only kind we declare via supportedDialogKinds) should never fire.
    // Wired anyway to tee it faithfully if it ever does.
    const answer = { behavior: "cancelled" };
    writeLine({ kind: "control", name: "onUserDialog", args: request, answer });
    return answer;
  };

  const queryOptions = {
    cwd: args.cwd,
    pathToClaudeCodeExecutable: claudeBinaryPath,
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: [...CLAUDE_SETTING_SOURCES],
    permissionMode: args.permissionMode,
    includePartialMessages: true,
    canUseTool,
    onUserDialog,
    supportedDialogKinds: ["resume_return"],
    env: process.env,
    additionalDirectories: [args.cwd],
  };

  async function* singleMessagePrompt() {
    yield {
      type: "user",
      message: { role: "user", content: args.prompt },
      parent_tool_use_id: null,
    };
    // Streaming-input sessions stay open for further turns; this recorder
    // sends exactly one and later force-ends the session via runtime.close().
    await new Promise(() => {});
  }

  const startedAt = Date.now();
  const runtime = query({ prompt: singleMessagePrompt(), options: queryOptions });

  let interruptFired = false;
  const fireInterrupt = () => {
    if (interruptFired) return;
    interruptFired = true;
    runtime
      .interrupt()
      .then((result) => {
        writeLine({ kind: "control", name: "interrupt", args: null, answer: result ?? null });
      })
      .catch((err) => {
        writeLine({
          kind: "control",
          name: "interrupt",
          args: null,
          answer: null,
          error: String(err?.message ?? err),
        });
      });
  };

  if (args.abortAfter && /^\d+$/.test(args.abortAfter)) {
    setTimeout(fireInterrupt, Number(args.abortAfter));
  }

  const maxWaitTimer = setTimeout(() => {
    process.stderr.write("record-claude: max-wait-ms exceeded, forcing close\n");
    runtime.close();
  }, args.maxWaitMs);

  let system = { model: undefined, cliVersion: undefined };
  let gotResult = false;

  for await (const message of runtime) {
    typeSubtypeSeq.push(message.subtype ? `${message.type}:${message.subtype}` : message.type);
    writeLine({ kind: "message", message });

    if (message.type === "system" && message.subtype === "init") {
      system.model = message.model;
    }
    if (message.type === "result") {
      gotResult = true;
    }

    if (args.abortAfter === "tool_use" && isToolUseStart(message)) {
      fireInterrupt();
    }

    if (gotResult) {
      // Give any in-flight interrupt() control-response a moment to land
      // before we tear the process down.
      if (interruptFired) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      break;
    }
  }

  clearTimeout(maxWaitTimer);
  runtime.close();

  try {
    system.cliVersion = execFileSync(claudeBinaryPath, ["--version"], {
      encoding: "utf8",
    }).trim();
  } catch (err) {
    system.cliVersion = `<unavailable: ${String(err?.message ?? err)}>`;
  }

  const meta = {
    driver: "claude",
    cliVersion: system.cliVersion,
    sdkVersion,
    model: system.model,
    capturedAt: new Date().toISOString(),
    capturedOn: "z3-eval/zcp",
    capturedBy: "spi-3",
    cwd: args.cwd,
    prompt: args.prompt,
    allowedTools: args.allowedTools,
    notes: args.notes,
    sdkOptions: sanitizeOptionsForMeta(queryOptions, redact),
  };
  writeFileSync(
    `${args.out.replace(/\.jsonl$/, "")}.meta.json`,
    `${JSON.stringify(meta, null, 2)}\n`,
  );

  const durationMs = Date.now() - startedAt;
  process.stdout.write(
    `${JSON.stringify({
      out: args.out,
      counters,
      typeSubtypeSeq,
      durationMs,
      model: system.model,
      cliVersion: system.cliVersion,
      sdkVersion,
    })}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`record-claude: ${err?.stack ?? err}\n`);
  process.exitCode = 1;
});
