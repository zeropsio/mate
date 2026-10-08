/**
 * openCodeThreadProfile — OpenCode's extension of the thread tool policy SPI.
 *
 * From a thread's profile it builds what the OpenCode driver runs that
 * thread with. OpenCode asks before a tool runs when the session's ruleset
 * says `ask`, so a profiled session asks for everything and every ask is
 * answered by the profile's `decideTool`, never parked for a person: the ask
 * names its permission (`bash`, `edit`, `read`, an MCP tool's key) and the
 * call it belongs to, whose input the driver saw stream by. The profile's
 * tools are an MCP server the session's OpenCode starts
 * (`threadToolsMcp.ts`), its context rides on every prompt's `system`, and
 * its model and effort (`variant`) override the thread's.
 *
 * One of the inbound SPI files (`spi.md` §1a): it imports nothing from
 * `provider/**`.
 *
 * @module openCodeThreadProfile
 */
import { sha256 } from "@noble/hashes/sha2";
import * as Hex from "effect/encoding/Hex";

import type { ModelSelection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type * as Scope from "effect/Scope";

import { resolvePosixPath } from "./acpThreadProfile.ts";
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

/** OpenCode's permission ask, as its event carries it. */
export interface OpenCodePermissionAsk {
  readonly id: string;
  readonly permission: string;
  readonly patterns: ReadonlyArray<string>;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly tool?: { readonly messageID: string; readonly callID: string };
}

/** What a tool call was asked to do, as its streamed part showed it. */
export interface OpenCodeToolInput {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/** One call the crew's gate judges, shaped as Claude's tools. */
export interface OpenCodeGateCall {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
}

/** A profiled session's ruleset: every tool asks, and the gate answers. */
export const PROFILED_PERMISSION_RULES: ReadonlyArray<{
  readonly permission: string;
  readonly pattern: string;
  readonly action: "ask";
}> = [{ permission: "*", pattern: "*", action: "ask" }];

/** OpenCode's model option a profile's effort sets. */
export const OPENCODE_EFFORT_OPTION = "variant";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A path as the gate reads it: absolute, against the session for a relative one, `..` resolved. */
const absoluteIn = (cwd: string, path: string): string => resolvePosixPath(cwd, path);

const within = (cwd: string, path: string): boolean => {
  const root = cwd.replace(/\/+$/u, "");
  const normalized = path.replace(/\/+$/u, "");
  return normalized === root || normalized.startsWith(`${root}/`);
};

/** A glob's directory: `/a/b/*` is `/a/b`. */
const globDirectory = (pattern: string): string => pattern.replace(/\/\*+$/u, "");

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

/**
 * The MCP server the profile's tools are served as for one thread: its own
 * name, since a session's OpenCode may serve another thread in the same
 * directory, and an MCP tool's key is that name, `_`, the tool.
 */
export const threadToolsServerName = (threadId: string): string =>
  `crew-${Hex.encode(sha256(new TextEncoder().encode(threadId))).slice(0, 10)}`;

/**
 * The calls one ask makes, shaped as Claude's tools so the crew's gate
 * applies unchanged; `undefined` declines it.
 */
export const openCodeGateCalls = (
  ask: OpenCodePermissionAsk,
  call: OpenCodeToolInput | undefined,
  cwd: string,
  toolsServer: string | undefined,
): ReadonlyArray<OpenCodeGateCall> | undefined => {
  const input = call?.input ?? {};
  const paths = (values: ReadonlyArray<string>) => values.map((value) => absoluteIn(cwd, value));
  switch (ask.permission) {
    case "bash": {
      const workdir = stringOf(input.workdir);
      if (workdir !== undefined && !within(cwd, absoluteIn(cwd, workdir))) return undefined;
      const command = stringOf(input.command) ?? stringOf(ask.metadata.command);
      return command === undefined
        ? undefined
        : [{ toolName: "Bash", input: { command: shellCommand(command) } }];
    }
    case "edit": {
      const files = stringOf(ask.metadata.filepath)?.startsWith("/")
        ? [stringOf(ask.metadata.filepath)!]
        : paths(ask.patterns.filter((pattern) => pattern !== "*"));
      return files.length === 0
        ? undefined
        : files.map((file) => ({ toolName: "Edit", input: { file_path: file } }));
    }
    case "read": {
      const files = ask.patterns.filter(
        (pattern) => pattern !== "*" && !pattern.startsWith("mcp:"),
      );
      return files.length === 0 || files.length !== ask.patterns.length
        ? undefined
        : paths(files).map((file) => ({ toolName: "Read", input: { file_path: file } }));
    }
    case "glob":
    case "grep":
    case "list":
      return [
        {
          toolName: ask.permission === "grep" ? "Grep" : "Glob",
          input: { path: absoluteIn(cwd, stringOf(input.path) ?? cwd) },
        },
      ];
    case "external_directory": {
      // Reaching outside the session's directory: allowed where the gate lets it read.
      const directories = ask.patterns.map(globDirectory).filter((dir) => dir.length > 0);
      return directories.length === 0
        ? undefined
        : paths(directories).map((dir) => ({ toolName: "Read", input: { file_path: dir } }));
    }
    case "webfetch":
      return [{ toolName: "WebFetch", input: { url: stringOf(input.url) ?? "" } }];
    case "question":
      return [{ toolName: "AskUserQuestion", input: {} }];
    case "todowrite":
      return [{ toolName: "TodoWrite", input: {} }];
    case "doom_loop":
      return undefined;
    default: {
      const key = ask.permission;
      if (toolsServer !== undefined && key.startsWith(`${toolsServer}_`)) {
        return [
          { toolName: `mcp__crew__${key.slice(toolsServer.length + 1)}`, input: { ...input } },
        ];
      }
      if (key.startsWith("zerops_zerops_")) {
        return [{ toolName: `mcp__zerops__${key.slice("zerops_".length)}`, input: { ...input } }];
      }
      return [{ toolName: key, input: { ...input } }];
    }
  }
};

const deny = (reason: string): ToolDecision => ({ kind: "deny", reason });

const sameInput = (input: Record<string, unknown>, updated: Record<string, unknown>): boolean => {
  const keys = Object.keys(updated);
  return (
    keys.length === Object.keys(input).length && keys.every((key) => updated[key] === input[key])
  );
};

/**
 * One call through the gate: `undefined` when it passes, else why not. A
 * failing or silent gate denies, and so does an allow that rewrites the
 * call: OpenCode's reply is once or reject, so it would run what it asked,
 * not what the gate allowed.
 */
const refusalOf = (profile: ThreadToolProfile, call: OpenCodeGateCall, toolUseId: string) =>
  profile.decideTool({ ...call, toolUseId }).pipe(
    Effect.catchCause(() => Effect.succeed(deny("The tool gate failed."))),
    Effect.timeoutOrElse({
      duration: DECIDE_TOOL_TIMEOUT,
      orElse: () => Effect.succeed(deny("The tool gate gave no decision in time.")),
    }),
    Effect.map((decision): string | undefined =>
      decision.kind === "deny"
        ? decision.reason
        : decision.updatedInput === undefined || sameInput(call.input, decision.updatedInput)
          ? undefined
          : "Run the call exactly as the crew's instructions give it.",
    ),
  );

/** The reply to one ask, with the gate's reason for a rejection, which the model reads. */
export interface OpenCodePermissionReply {
  readonly reply: "once" | "reject";
  readonly message?: string;
}

/** `once` when every call passes the gate, else `reject` with why. Never `always`. */
export const decideOpenCodePermission = (
  profile: ThreadToolProfile,
  ask: OpenCodePermissionAsk,
  call: OpenCodeToolInput | undefined,
  cwd: string,
  toolsServer: string | undefined,
): Effect.Effect<OpenCodePermissionReply> =>
  Effect.gen(function* () {
    const calls = openCodeGateCalls(ask, call, cwd, toolsServer);
    if (calls === undefined || calls.length === 0) {
      return { reply: "reject", message: `${ask.permission} is not available to a crewmate.` };
    }
    for (const gateCall of calls) {
      const refusal = yield* refusalOf(profile, gateCall, ask.tool?.callID ?? ask.id);
      if (refusal !== undefined) return { reply: "reject", message: refusal };
    }
    return { reply: "once" };
  });

/** What a profiled thread's session starts with on OpenCode. */
export interface OpenCodeThreadSetup {
  readonly permission: typeof PROFILED_PERMISSION_RULES;
  /** The MCP server to add to the session's OpenCode, when the profile has tools. */
  readonly mcp:
    | {
        readonly name: string;
        readonly config: {
          readonly type: "local";
          readonly command: Array<string>;
          readonly environment: Record<string, string>;
        };
      }
    | undefined;
  readonly decidePermission: (
    ask: OpenCodePermissionAsk,
    call: OpenCodeToolInput | undefined,
  ) => Effect.Effect<OpenCodePermissionReply>;
}

/**
 * Read once, when the adapter is built. Optional on purpose, so neither the
 * driver's requirements nor its tests' change.
 */
export const readOpenCodeThreadPolicies: Effect.Effect<
  Option.Option<InstallSlot<ThreadToolPolicy>>
> = Effect.serviceOption(ThreadToolPolicyRegistry);

type ThreadRef = Parameters<ThreadToolPolicy["profileFor"]>[0];

/**
 * A session's setup, in the session's scope; `undefined` for a thread with no
 * profile, which runs as it would without this file.
 */
export const openCodeThreadSetup = (
  policies: Option.Option<InstallSlot<ThreadToolPolicy>>,
  thread: ThreadRef & { readonly cwd: string },
): Effect.Effect<OpenCodeThreadSetup | undefined, never, Scope.Scope> =>
  Effect.gen(function* () {
    const profile = yield* threadProfileFor(policies, thread);
    if (profile === undefined) return undefined;
    const name = threadToolsServerName(thread.threadId);
    const served =
      profile.tools.length === 0 ? undefined : yield* serveThreadTools(name, profile.tools);
    return {
      permission: PROFILED_PERMISSION_RULES,
      mcp:
        served === undefined
          ? undefined
          : {
              name,
              config: {
                type: "local",
                command: [served.command, ...served.args],
                environment: Object.fromEntries(
                  served.env.map((variable) => [variable.name, variable.value]),
                ),
              },
            },
      decidePermission: (ask, call) =>
        decideOpenCodePermission(profile, ask, call, thread.cwd, served ? name : undefined),
    };
  });

/**
 * A prompt's profile, asked again at every turn: the text to add to the
 * prompt's `system`, and the model selection to run it with.
 */
export const openCodeTurnProfile = (
  policies: Option.Option<InstallSlot<ThreadToolPolicy>>,
  thread: ThreadRef,
  selection: ModelSelection | undefined,
): Effect.Effect<{
  readonly instructions: string | undefined;
  readonly modelSelection: ModelSelection | undefined;
}> =>
  Effect.map(threadProfileFor(policies, thread), (profile) => ({
    instructions:
      profile === undefined
        ? undefined
        : [profile.sessionContext, profile.exactCallsContext].filter(Boolean).join("\n\n"),
    modelSelection: profileModelSelection(
      profile,
      thread.instanceId,
      selection,
      OPENCODE_EFFORT_OPTION,
    ),
  }));
