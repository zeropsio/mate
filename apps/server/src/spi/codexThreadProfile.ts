/**
 * codexThreadProfile — the Codex extension of the thread tool policy SPI.
 *
 * The third of the files the ported zone may import from `spi/`; like the
 * other two it imports nothing from `provider/**`. From a thread's profile
 * it builds what the Codex driver runs that thread with. Codex asks no
 * per-call approval for MCP tools and has no hook, so the gate is Codex's
 * own approval request: every command and file change is answered by the
 * profile's `decideTool`.
 *
 * @module codexThreadProfile
 */
import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type * as EffectCodexSchema from "effect-codex-app-server/schema";

import { DECIDE_TOOL_TIMEOUT } from "./claudeThreadProfile.ts";
import {
  type InstallSlot,
  threadProfileFor,
  type ThreadToolPolicy,
  ThreadToolPolicyRegistry,
  type ThreadToolProfile,
  type ToolDecision,
} from "./threadToolPolicy.ts";

/** Codex's answer to an approval request of a gated thread. */
export type CodexGateDecision = "accept" | "decline";

/** One file of a `fileChange` item, as `item/started` lists it. */
export type CodexFileChange = EffectCodexSchema.V2ItemStartedNotification__FileUpdateChange;

/** zcp's MCP server, as `zcp init` registers it in Codex's `config.toml`. */
const ZCP_MCP_SERVER = "zerops";

export interface CodexThreadSetup {
  /** Laid over `thread/start` and `thread/resume`. */
  readonly thread: Pick<
    EffectCodexSchema.V2ThreadStartParams,
    "approvalPolicy" | "approvalsReviewer" | "sandbox" | "developerInstructions" | "config"
  >;
  /** Laid over every `turn/start`, which would otherwise restore the runtime mode's. */
  readonly turn: Pick<
    EffectCodexSchema.V2TurnStartParams,
    "approvalPolicy" | "approvalsReviewer" | "sandboxPolicy"
  >;
  /** A command approval request: its item and the command Codex would run. */
  readonly decideCommand: (request: {
    readonly itemId: string;
    readonly command: string | null | undefined;
  }) => Effect.Effect<CodexGateDecision>;
  /**
   * A file change approval request. Its params name no file, so the driver
   * passes the changes its `fileChange` item listed when it started, and
   * the session's cwd for a relative path.
   */
  readonly decideFileChange: (request: {
    readonly itemId: string;
    readonly cwd: string;
    readonly changes: ReadonlyArray<CodexFileChange> | undefined;
  }) => Effect.Effect<CodexGateDecision>;
}

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
 * allow that rewrites the call: Codex's answer carries a decision only, so
 * it would run what it asked, not what the gate allowed.
 */
const gate = (
  profile: ThreadToolProfile,
  call: {
    readonly toolName: string;
    readonly input: Record<string, unknown>;
    readonly toolUseId: string;
  },
): Effect.Effect<CodexGateDecision> =>
  profile.decideTool(call).pipe(
    Effect.catchCause(() => Effect.succeed(deny("The tool gate failed."))),
    Effect.timeoutOrElse({
      duration: DECIDE_TOOL_TIMEOUT,
      orElse: () => Effect.succeed(deny("The tool gate gave no decision in time.")),
    }),
    Effect.map((decision) =>
      decision.kind === "allow" &&
      (decision.updatedInput === undefined || sameInput(call.input, decision.updatedInput))
        ? "accept"
        : "decline",
    ),
  );

/**
 * A command's words as a POSIX shell splits them, or undefined when it is
 * more than words and quotes. Codex names the argv it runs as one string,
 * each word quoted for sh, so this reads that argv back.
 */
const commandWords = (command: string): ReadonlyArray<string> | undefined => {
  const words: Array<string> = [];
  let current = "";
  let inWord = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (char === "'") {
      const end = command.indexOf("'", index + 1);
      if (end < 0) return undefined;
      current += command.slice(index + 1, end);
      index = end;
      inWord = true;
    } else if (char === '"') {
      index += 1;
      while (index < command.length && command[index] !== '"') {
        if (command[index] === "\\" && '$`"\\\n'.includes(command[index + 1] ?? "")) index += 1;
        current += command[index];
        index += 1;
      }
      if (index >= command.length) return undefined;
      inWord = true;
    } else if (char === "\\") {
      if (index + 1 >= command.length) return undefined;
      index += 1;
      current += command[index];
      inWord = true;
    } else if (/\s/u.test(char)) {
      if (inWord) words.push(current);
      current = "";
      inWord = false;
    } else if (";&|<>()`$*?[]{}~#!".includes(char)) {
      return undefined;
    } else {
      current += char;
      inWord = true;
    }
  }
  if (inWord) words.push(current);
  return words;
};

/** The shells Codex runs a command in. */
const COMMAND_SHELLS = new Set(["sh", "bash", "zsh"]);

/**
 * What a command runs: Codex runs the model's command as `<shell> -lc
 * <command>` (or `-c`), so the gate judges the command inside. Anything
 * else is judged as it is.
 */
const shellCommand = (command: string): string => {
  const words = commandWords(command);
  if (words?.length !== 3) return command;
  const [shell, flag, inner] = words as [string, string, string];
  return COMMAND_SHELLS.has(shell.slice(shell.lastIndexOf("/") + 1)) &&
    (flag === "-lc" || flag === "-c")
    ? inner
    : command;
};

const absoluteIn = (cwd: string, path: string): string =>
  path.startsWith("/") ? path : `${cwd.replace(/\/+$/u, "")}/${path}`;

/**
 * The calls one file change makes, shaped as Claude's file tools so the
 * gate applies unchanged: a new file is a `Write`, an update or a deletion
 * an `Edit`, and a move also a `Write` of its target.
 */
const fileChangeCalls = (
  change: CodexFileChange,
  cwd: string,
): ReadonlyArray<{ readonly toolName: string; readonly path: string }> => {
  const path = absoluteIn(cwd, change.path);
  if (change.kind.type === "add") return [{ toolName: "Write", path }];
  const target = change.kind.type === "update" ? change.kind.move_path : undefined;
  return [
    { toolName: "Edit", path },
    ...(target ? [{ toolName: "Write", path: absoluteIn(cwd, target) }] : []),
  ];
};

/** Every call must be accepted; the first decline ends the walk. */
const acceptAll = (
  checks: ReadonlyArray<Effect.Effect<CodexGateDecision>>,
): Effect.Effect<CodexGateDecision> =>
  Effect.gen(function* () {
    if (checks.length === 0) return "decline";
    for (const check of checks) {
      if ((yield* check) === "decline") return "decline";
    }
    return "accept";
  });

/** Codex's effort option (`ModelSelection.options`), the one a profile's effort sets. */
const EFFORT_OPTION = "reasoningEffort";

/**
 * The model selection a profiled thread runs with: the profile's model and
 * effort over the thread's own choice, the thread's other options (its
 * service tier) kept. Effort needs a model, so an effort-only profile on a
 * thread with no selection changes nothing.
 */
export function codexProfileModelSelection(
  profile: ThreadToolProfile | undefined,
  instanceId: ProviderInstanceId,
  selection: ModelSelection | undefined,
): ModelSelection | undefined {
  const model = profile?.model ?? selection?.model;
  if (!profile || !model || (profile.model === undefined && profile.effort === undefined)) {
    return selection;
  }
  const kept = (selection?.options ?? []).filter(
    (option) => profile.effort === undefined || option.id !== EFFORT_OPTION,
  );
  const options =
    profile.effort === undefined ? kept : [...kept, { id: EFFORT_OPTION, value: profile.effort }];
  return { instanceId, model, ...(options.length > 0 ? { options } : {}) };
}

/**
 * What a thread with this profile runs with on Codex: an approval policy
 * that sends commands and file changes to the gate (the reviewer stated,
 * since an omitted one stays as the thread last had it), zcp's MCP server
 * off and the context window as the compaction limit for this thread
 * alone, the session context as the thread's developer instructions, and a
 * read-only sandbox for a thread that only reads.
 * Codex has no spend cap, so `maxBudgetUsd` has nothing to become.
 */
export function codexThreadSetup(profile: ThreadToolProfile): CodexThreadSetup {
  return {
    thread: {
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandbox: profile.readOnly ? "read-only" : "workspace-write",
      developerInstructions: [profile.sessionContext, profile.exactCallsContext]
        .filter(Boolean)
        .join("\n\n"),
      config: {
        [`mcp_servers.${ZCP_MCP_SERVER}.enabled`]: false,
        model_auto_compact_token_limit: profile.contextWindow,
      },
    },
    turn: {
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandboxPolicy: { type: profile.readOnly ? "readOnly" : "workspaceWrite" },
    },
    decideCommand: ({ itemId, command }) =>
      command
        ? gate(profile, {
            toolName: "Bash",
            input: { command: shellCommand(command) },
            toolUseId: itemId,
          })
        : Effect.succeed("decline"),
    decideFileChange: ({ itemId, cwd, changes }) =>
      acceptAll(
        (changes ?? [])
          .flatMap((change) => fileChangeCalls(change, cwd))
          .map(({ toolName, path }) =>
            gate(profile, { toolName, input: { file_path: path }, toolUseId: itemId }),
          ),
      ),
  };
}

/**
 * Read once, when the adapter is built. Optional on purpose, so neither the
 * Codex driver's requirements nor its tests' change: without the registry
 * every thread simply has no profile.
 */
export const readCodexThreadPolicies: Effect.Effect<Option.Option<InstallSlot<ThreadToolPolicy>>> =
  Effect.serviceOption(ThreadToolPolicyRegistry);

type ThreadRef = Parameters<ThreadToolPolicy["profileFor"]>[0];

/** What a session starts with: no setup and the thread's own model unless it has a profile. */
export const codexThreadStart = (
  policies: Option.Option<InstallSlot<ThreadToolPolicy>>,
  thread: ThreadRef,
  selection: ModelSelection | undefined,
): Effect.Effect<{
  readonly setup: CodexThreadSetup | undefined;
  readonly modelSelection: ModelSelection | undefined;
}> =>
  Effect.map(threadProfileFor(policies, thread), (profile) => ({
    setup: profile ? codexThreadSetup(profile) : undefined,
    modelSelection: codexProfileModelSelection(profile, thread.instanceId, selection),
  }));

/**
 * A turn's model selection: the profile is asked again at every turn, so a
 * changed model or effort applies from the thread's next turn on, in the
 * same conversation.
 */
export const codexTurnModelSelection = (
  policies: Option.Option<InstallSlot<ThreadToolPolicy>>,
  thread: ThreadRef,
  selection: ModelSelection | undefined,
): Effect.Effect<ModelSelection | undefined> =>
  Effect.map(threadProfileFor(policies, thread), (profile) =>
    codexProfileModelSelection(profile, thread.instanceId, selection),
  );
