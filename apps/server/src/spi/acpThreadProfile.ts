/**
 * acpThreadProfile — the ACP agents' extension of the thread tool policy SPI.
 *
 * One translation for the three ACP drivers (Cursor, Grok, Antigravity): from
 * a thread's profile it builds what the driver runs that thread with. Like
 * Codex, ACP has no hook before a tool runs, so the gate is the agent's own
 * `session/request_permission`: every call the agent asks about is answered
 * by the profile's `decideTool`, never parked for a person. The profile's
 * tools are served as an MCP server the agent starts (`threadToolsMcp.ts`),
 * named `crew` so its calls reach the gate as `mcp__crew__*`, as Claude's do.
 * Its context rides on every prompt, after the driver's runtime
 * instructions; its model and effort override the thread's selection.
 *
 * One of the inbound SPI files (`spi.md` §1a): it imports nothing from
 * `provider/**`.
 *
 * @module acpThreadProfile
 */
import type { ModelSelection } from "@t3tools/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";
import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type * as Scope from "effect/Scope";

import { DECIDE_TOOL_TIMEOUT } from "./claudeThreadProfile.ts";
import { shellCommand } from "./codexThreadProfile.ts";
import {
  type InstallSlot,
  profileModelSelection,
  threadProfileFor,
  type ThreadToolPolicy,
  ThreadToolPolicyRegistry,
  type ThreadToolProfile,
  type ToolDecision,
} from "./threadToolPolicy.ts";
import { serveThreadTools } from "./threadToolsMcp.ts";
import { mcpToolOfTitle, THREAD_TOOLS_SERVER } from "./mcpToolTitle.ts";

/** One call the crew's gate judges, shaped as Claude's tools so it applies unchanged. */
export interface AcpGateCall {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
}

type AcpToolCall = EffectAcpSchema.RequestPermissionRequest["toolCall"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const COMMAND_SHELLS = new Set(["sh", "bash", "zsh"]);

/** A word as `sh` reads it back: bare when it is plain, single-quoted otherwise. */
const shellWord = (word: string): string =>
  /^[A-Za-z0-9_@%+=:,./-]+$/u.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;

/**
 * The command a call runs, as the gate judges it: a string as it is, inside
 * a `<shell> -c|-lc` wrapper; an argv the same, or its words quoted for sh.
 */
const COMMAND_KEYS = ["command", "cmd", "CommandLine", "commandLine", "command_line"] as const;
const CWD_KEYS = [
  "cwd",
  "Cwd",
  "WorkingDirectory",
  "workingDir",
  "working_dir",
  "workdir",
  "dir",
  "directory",
] as const;

const commandOf = (rawInput: unknown): string | undefined => {
  if (!isRecord(rawInput)) return undefined;
  const command = COMMAND_KEYS.map((key) => rawInput[key]).find((value) => value !== undefined);
  if (typeof command === "string") {
    return command.trim().length > 0 ? shellCommand(command.trim()) : undefined;
  }
  if (!Array.isArray(command) || command.length === 0) return undefined;
  if (!command.every((word): word is string => typeof word === "string")) return undefined;
  const [shell, flag, inner] = command;
  if (
    command.length === 3 &&
    shell !== undefined &&
    COMMAND_SHELLS.has(shell.slice(shell.lastIndexOf("/") + 1)) &&
    (flag === "-c" || flag === "-lc") &&
    inner !== undefined
  ) {
    return inner;
  }
  return command.map(shellWord).join(" ");
};

/** Every key an agent names a file by, a move's source and destination included. */
const PATH_KEYS = [
  "file_path",
  "filePath",
  "path",
  "target_file",
  "notebook_path",
  "source",
  "from",
  "old_path",
  "oldPath",
  "destination",
  "dest",
  "to",
  "new_path",
  "newPath",
  "target_path",
] as const;

/** `path` against `cwd`, `.` and `..` resolved, as POSIX resolves it. */
export const resolvePosixPath = (cwd: string, path: string): string => {
  const segments: Array<string> = [];
  for (const segment of (path.startsWith("/") ? path : `${cwd}/${path}`).split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}`;
};

/** A path as the gate reads it: a `file://` URI's path, a relative one against the session, `..` resolved. */
const absoluteIn = (cwd: string, path: string): string => {
  const plain = path.startsWith("file://") ? decodeURIComponent(new URL(path).pathname) : path;
  return resolvePosixPath(cwd, plain);
};

/** Where a command says it runs, when it says so. */
const commandCwdOf = (rawInput: unknown, cwd: string): string | undefined => {
  if (!isRecord(rawInput)) return undefined;
  const value = CWD_KEYS.map((key) => rawInput[key]).find((entry) => typeof entry === "string");
  return typeof value === "string" && value.trim().length > 0
    ? absoluteIn(cwd, value.trim())
    : undefined;
};

/** `path` is the session's directory or inside it. */
const within = (cwd: string, path: string): boolean => {
  const root = cwd.replace(/\/+$/u, "");
  const normalized = path.replace(/\/+$/u, "");
  return normalized === root || normalized.startsWith(`${root}/`);
};

/** Every file a call names: its locations and the path its input carries. */
const pathsOf = (toolCall: AcpToolCall, cwd: string): ReadonlyArray<string> => {
  const paths = new Set<string>();
  for (const location of toolCall.locations ?? []) {
    if (location.path.trim().length > 0) paths.add(absoluteIn(cwd, location.path.trim()));
  }
  const input = toolCall.rawInput;
  if (isRecord(input)) {
    const add = (value: unknown) => {
      if (typeof value === "string" && value.trim().length > 0) {
        paths.add(absoluteIn(cwd, value.trim()));
      }
    };
    for (const key of PATH_KEYS) add(input[key]);
    if (Array.isArray(input.paths)) input.paths.forEach(add);
  }
  return [...paths];
};

/** The MCP tool a call of no kind of its own names in its title, as Claude spells it. */
const mcpToolName = (title: string | null | undefined): string | undefined => {
  const named = mcpToolOfTitle(title);
  if (named === undefined) return undefined;
  return named.server === undefined ? named.tool : `mcp__${named.server}__${named.tool}`;
};

/**
 * The calls one permission request makes, shaped as Claude's tools: a
 * command is a `Bash` call, an edit, deletion or move an `Edit` of every
 * file it names, a read a `Read`, a search a `Grep`, a fetch a `WebFetch`,
 * and a call of no kind an MCP tool by its title. `undefined` when the
 * request names nothing the gate can judge, which declines it; an empty list
 * is a call that needs no gate (thinking).
 */
export const acpGateCalls = (
  toolCall: AcpToolCall,
  cwd: string,
): ReadonlyArray<AcpGateCall> | undefined => {
  const paths = pathsOf(toolCall, cwd);
  const each = (toolName: string) =>
    paths.length === 0
      ? undefined
      : paths.map((path) => ({ toolName, input: { file_path: path } }));
  switch (toolCall.kind) {
    case "execute": {
      // The gate judges a command as run in the session's directory; one
      // that runs elsewhere is not the command it judged.
      const elsewhere = commandCwdOf(toolCall.rawInput, cwd);
      if (elsewhere !== undefined && !within(cwd, elsewhere)) return undefined;
      const command = commandOf(toolCall.rawInput);
      return command === undefined ? undefined : [{ toolName: "Bash", input: { command } }];
    }
    case "edit":
    case "delete":
    case "move":
      return each("Edit");
    case "read":
      return each("Read");
    case "search":
      // Every place the search reads must be one the gate lets it read.
      return (paths.length === 0 ? [cwd] : paths).map((path) => ({
        toolName: "Grep",
        input: { path },
      }));
    case "fetch": {
      const url = isRecord(toolCall.rawInput) ? toolCall.rawInput.url : undefined;
      return [{ toolName: "WebFetch", input: typeof url === "string" ? { url } : {} }];
    }
    case "think":
      return [];
    case "switch_mode":
      // A crewmate keeps the mode Mate runs it in.
      return undefined;
    default: {
      const toolName = mcpToolName(toolCall.title);
      return toolName === undefined
        ? undefined
        : [{ toolName, input: isRecord(toolCall.rawInput) ? toolCall.rawInput : {} }];
    }
  }
};

const deny = (reason: string): ToolDecision => ({ kind: "deny", reason });

/** Same keys, same values: an allow that changes nothing about the call. */
const sameInput = (input: Record<string, unknown>, updated: Record<string, unknown>): boolean => {
  const keys = Object.keys(updated);
  return (
    keys.length === Object.keys(input).length && keys.every((key) => updated[key] === input[key])
  );
};

/**
 * One call through the gate. A failing or silent gate denies, and so does an
 * allow that rewrites the call: ACP's answer is an option, so the agent would
 * run what it asked, not what the gate allowed.
 */
const allows = (
  profile: ThreadToolProfile,
  call: AcpGateCall,
  toolUseId: string,
): Effect.Effect<boolean> =>
  profile.decideTool({ ...call, toolUseId }).pipe(
    Effect.catchCause(() => Effect.succeed(deny("The tool gate failed."))),
    Effect.timeoutOrElse({
      duration: DECIDE_TOOL_TIMEOUT,
      orElse: () => Effect.succeed(deny("The tool gate gave no decision in time.")),
    }),
    Effect.map(
      (decision) =>
        decision.kind === "allow" &&
        (decision.updatedInput === undefined || sameInput(call.input, decision.updatedInput)),
    ),
  );

/**
 * The answer to one permission request: its one-time allow when every call
 * passes the gate, else its one-time rejection. Never an "always" option,
 * which would let the agent's later calls past the gate unasked.
 */
export const decideAcpPermission = (
  profile: ThreadToolProfile,
  request: EffectAcpSchema.RequestPermissionRequest,
  cwd: string,
): Effect.Effect<EffectAcpSchema.RequestPermissionResponse> =>
  Effect.gen(function* () {
    const calls = acpGateCalls(request.toolCall, cwd);
    let allowed = calls !== undefined;
    for (const call of calls ?? []) {
      if (!(yield* allows(profile, call, request.toolCall.toolCallId))) {
        allowed = false;
        break;
      }
    }
    const option = allowed
      ? request.options.find((candidate) => candidate.kind === "allow_once")
      : (request.options.find((candidate) => candidate.kind === "reject_once") ??
        request.options.find((candidate) => candidate.kind === "reject_always"));
    return option === undefined
      ? { outcome: { outcome: "cancelled" } }
      : { outcome: { outcome: "selected", optionId: option.optionId } };
  });

/** The stop reasons that end an ACP turn for a reason of its own (ACP `StopReason`). */
const TERMINAL_STOP_REASONS: ReadonlySet<string> = new Set([
  "max_tokens",
  "max_turn_requests",
  "refusal",
]);

/**
 * A turn's terminal reason, as `turn.completed` carries one, from ACP's stop
 * reason: the context or the turn's requests ran out, or the model refused.
 * A turn that ended or was cancelled as asked has none.
 */
export const acpTerminalReason = (
  stopReason: string | null | undefined,
): { readonly terminalReason?: string } =>
  stopReason !== null && stopReason !== undefined && TERMINAL_STOP_REASONS.has(stopReason)
    ? { terminalReason: stopReason }
    : {};

/** What a profiled thread's session starts with on an ACP agent. */
export interface AcpThreadSetup {
  /** Laid into `session/new`, `session/load` and `session/resume`. */
  readonly mcpServers: ReadonlyArray<EffectAcpSchema.McpServer>;
  /** Answers the session's `session/request_permission` in the person's place. */
  readonly decidePermission: (
    request: EffectAcpSchema.RequestPermissionRequest,
  ) => Effect.Effect<EffectAcpSchema.RequestPermissionResponse>;
}

/** The text a profiled thread's prompts carry after the runtime instructions. */
export const acpProfileInstructions = (profile: ThreadToolProfile): string =>
  [profile.sessionContext, profile.exactCallsContext].filter(Boolean).join("\n\n");

/**
 * Read once, when the adapter is built. Optional on purpose, so neither a
 * driver's requirements nor its tests' change: without the registry every
 * thread simply has no profile.
 */
export const readAcpThreadPolicies: Effect.Effect<Option.Option<InstallSlot<ThreadToolPolicy>>> =
  Effect.serviceOption(ThreadToolPolicyRegistry);

type ThreadRef = Parameters<ThreadToolPolicy["profileFor"]>[0];

/**
 * A session's setup, in the session's scope: its profile's tools served for
 * it and its gate; `undefined` for a thread with no profile, which runs as
 * it would without this file.
 */
export const acpThreadSetup = (
  policies: Option.Option<InstallSlot<ThreadToolPolicy>>,
  thread: ThreadRef & { readonly cwd: string },
): Effect.Effect<AcpThreadSetup | undefined, never, Scope.Scope> =>
  Effect.gen(function* () {
    const profile = yield* threadProfileFor(policies, thread);
    if (profile === undefined) return undefined;
    const mcpServers =
      profile.tools.length === 0
        ? []
        : [{ ...(yield* serveThreadTools(THREAD_TOOLS_SERVER, profile.tools)) }];
    return {
      mcpServers,
      decidePermission: (request) => decideAcpPermission(profile, request, thread.cwd),
    };
  });

/**
 * A prompt's profile, asked again at every turn so a changed brief, job,
 * model or effort applies from the thread's next turn: the text to add after
 * the runtime instructions, and the model selection to run it with.
 */
export const acpTurnProfile = (
  policies: Option.Option<InstallSlot<ThreadToolPolicy>>,
  thread: ThreadRef,
  selection: ModelSelection | undefined,
  effortOption: string | undefined,
): Effect.Effect<{
  readonly instructions: string | undefined;
  readonly modelSelection: ModelSelection | undefined;
}> =>
  Effect.map(threadProfileFor(policies, thread), (profile) => ({
    instructions: profile === undefined ? undefined : acpProfileInstructions(profile),
    modelSelection: profileModelSelection(profile, thread.instanceId, selection, effortOption),
  }));
