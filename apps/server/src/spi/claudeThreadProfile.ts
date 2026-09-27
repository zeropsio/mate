/**
 * claudeThreadProfile — the Claude extension of the thread tool policy SPI.
 *
 * The second of the two files the ported zone may import from `spi/`; like
 * `threadToolPolicy.ts` it imports nothing from `provider/**`. It holds what
 * only Claude has — settings, the SessionStart and PostCompact hooks — and,
 * from a thread's profile and extension, the options the Claude adapter
 * adds to its session. Codex gets its own extension file.
 *
 * @module claudeThreadProfile
 */
import type {
  Options as ClaudeQueryOptions,
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  McpSdkServerConfigWithInstance,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import type { ModelSelection, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  type InstallSlot,
  makeInstallSlot,
  type ThreadTool,
  threadProfileFor,
  type ThreadToolPolicy,
  ThreadToolPolicyRegistry,
  type ThreadToolProfile,
  type ToolDecision,
} from "./threadToolPolicy.ts";

export interface ClaudeThreadExtension {
  readonly settings: { readonly autoMemoryEnabled: false; readonly disableAllHooks: false };
  /** The returned text becomes the session's `additionalContext`. */
  readonly onSessionStart: (event: {
    readonly source: "startup" | "resume" | "compact" | "clear";
    readonly sessionId: string;
    readonly transcriptPath: string;
  }) => Effect.Effect<string | undefined>;
  readonly onPostCompact: (event: { readonly summary: string }) => Effect.Effect<void>;
}

export interface ClaudeThreadExtensions {
  readonly extensionFor: (threadId: ThreadId) => Effect.Effect<ClaudeThreadExtension | undefined>;
}

export class ClaudeThreadExtensionRegistry extends Context.Service<
  ClaudeThreadExtensionRegistry,
  InstallSlot<ClaudeThreadExtensions>
>()("t3/spi/claudeThreadProfile/ClaudeThreadExtensionRegistry") {
  static readonly layer = Layer.effect(
    ClaudeThreadExtensionRegistry,
    makeInstallSlot<ClaudeThreadExtensions>(),
  );
}

/** Both registries as the adapter's context has them — either may be absent. */
export interface ClaudeThreadRegistries {
  readonly policies: Option.Option<InstallSlot<ThreadToolPolicy>>;
  readonly extensions: Option.Option<InstallSlot<ClaudeThreadExtensions>>;
}

/**
 * Read once, when the adapter is built. Optional on purpose, so neither the
 * Claude driver's nor the replay's requirements change: without the
 * registries every thread simply has no profile.
 */
export const readClaudeThreadRegistries: Effect.Effect<ClaudeThreadRegistries> = Effect.all({
  policies: Effect.serviceOption(ThreadToolPolicyRegistry),
  extensions: Effect.serviceOption(ClaudeThreadExtensionRegistry),
});

export interface ClaudeThreadSetup {
  readonly profile: ThreadToolProfile;
  readonly extension: ClaudeThreadExtension | undefined;
}

/** What a session starts with: nothing unless the thread has a profile. */
export const resolveClaudeThreadSetup = (
  registries: ClaudeThreadRegistries,
  thread: Parameters<ThreadToolPolicy["profileFor"]>[0],
): Effect.Effect<ClaudeThreadSetup | undefined> =>
  Effect.gen(function* () {
    const profile = yield* threadProfileFor(registries.policies, thread);
    if (profile === undefined) return undefined;
    const extensions = Option.isSome(registries.extensions)
      ? yield* registries.extensions.value.current
      : Option.none<ClaudeThreadExtensions>();
    const extension = Option.isSome(extensions)
      ? yield* extensions.value.extensionFor(thread.threadId)
      : undefined;
    return { profile, extension };
  });

/**
 * The model selection a profiled thread runs with: the profile's model and
 * effort over the thread's own choice, the thread's other options kept.
 * Effort needs a model, so an effort-only profile on a thread with no
 * selection changes nothing.
 */
export function claudeProfileModelSelection(
  profile: ThreadToolProfile | undefined,
  instanceId: ProviderInstanceId,
  selection: ModelSelection | undefined,
): ModelSelection | undefined {
  const model = profile?.model ?? selection?.model;
  if (!profile || !model || (profile.model === undefined && profile.effort === undefined)) {
    return selection;
  }
  const kept = (selection?.options ?? []).filter(
    (option) => profile.effort === undefined || option.id !== "effort",
  );
  const options =
    profile.effort === undefined ? kept : [...kept, { id: "effort", value: profile.effort }];
  return { instanceId, model, ...(options.length > 0 ? { options } : {}) };
}

/**
 * A turn's model selection: the profile is asked again at every turn, so a
 * changed model or effort applies from the thread's next turn on, in the
 * same conversation.
 */
export const claudeTurnModelSelection = (
  registries: ClaudeThreadRegistries,
  thread: Parameters<ThreadToolPolicy["profileFor"]>[0],
  selection: ModelSelection | undefined,
): Effect.Effect<ModelSelection | undefined> =>
  Effect.map(threadProfileFor(registries.policies, thread), (profile) =>
    claudeProfileModelSelection(profile, thread.instanceId, selection),
  );

/** The adapter's bridge from an SDK callback into Effect (`Effect.runPromiseWith` of its context). */
export type RunPromise = <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;

/** How long a tool call waits for the profile's decision before it is denied. */
export const DECIDE_TOOL_TIMEOUT = Duration.seconds(15);

const preToolUseOutput = (decision: ToolDecision): SyncHookJSONOutput => ({
  hookSpecificOutput:
    decision.kind === "allow"
      ? {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          ...(decision.updatedInput ? { updatedInput: decision.updatedInput } : {}),
        }
      : {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: decision.reason,
        },
});

const deny = (reason: string): ToolDecision => ({ kind: "deny", reason });

const matchers = (hook: HookCallback): Array<HookCallbackMatcher> => [{ hooks: [hook] }];

interface JsonRpcRequest {
  readonly id?: string | number;
  readonly method: string;
  readonly params?: {
    readonly protocolVersion?: string;
    readonly name?: string;
    readonly arguments?: unknown;
  };
}

interface SdkServerTransport {
  onmessage?: (message: JsonRpcRequest) => void;
  start(): Promise<void>;
  send(message: unknown): Promise<void>;
}

const toolResult = (text: string, isError: boolean) => ({
  content: [{ type: "text", text }],
  isError,
});

/**
 * The profile's tools as an in-process MCP server. The SDK only calls
 * `connect(transport)` and exchanges JSON-RPC over that transport, so this
 * answers the four methods a tool server needs directly, with each tool's
 * JSON Schema as it is: the SDK's own `tool()` wants Zod shapes. A tool that
 * fails is an error result the model reads, never a protocol error.
 */
const crewToolServer = (
  tools: ReadonlyArray<ThreadTool>,
  runPromise: RunPromise,
): McpSdkServerConfigWithInstance => {
  const answer = async (request: JsonRpcRequest): Promise<Record<string, unknown>> => {
    switch (request.method) {
      case "initialize":
        return {
          result: {
            protocolVersion: request.params?.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "crew", version: "1.0.0" },
          },
        };
      case "ping":
        return { result: {} };
      case "tools/list":
        return {
          result: {
            tools: tools.map(({ name, description, inputSchema }) => ({
              name,
              description,
              inputSchema,
            })),
          },
        };
      case "tools/call": {
        const name = request.params?.name;
        const tool = tools.find((candidate) => candidate.name === name);
        if (!tool) return { result: toolResult(`No tool named ${String(name)}.`, true) };
        const outcome = await runPromise(
          tool
            .run(request.params?.arguments ?? {})
            .pipe(
              Effect.catchCause(() =>
                Effect.succeed({ text: `${tool.name} failed.`, isError: true }),
              ),
            ),
        );
        return { result: toolResult(outcome.text, outcome.isError) };
      }
      default:
        return { error: { code: -32601, message: `Method not found: ${request.method}` } };
    }
  };
  const instance = {
    connect: async (transport: SdkServerTransport) => {
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- an MCP transport takes its one handler as this property; it has no addEventListener.
      transport.onmessage = (request) => {
        if (request.id === undefined) return;
        // A reply to a session that has since closed has nowhere to go.
        answer(request)
          .then((reply) => transport.send({ jsonrpc: "2.0", id: request.id, ...reply }))
          .catch(() => undefined);
      };
      await transport.start();
    },
  };
  return {
    type: "sdk",
    name: "crew",
    instance: instance as unknown as McpSdkServerConfigWithInstance["instance"],
  };
};

/** How the adapter started the CLI session: a new conversation, or a resumed transcript. */
export type ClaudeSessionStart = "startup" | "resume";

/**
 * The extension's session events. The CLI runs a process's own startup or
 * resume SessionStart before the SDK has registered any callback (measured
 * on CLI 2.1.283 with SDK 0.3.276: the callback never runs, while a
 * settings hook does), so that start reaches the extension with the
 * process's first prompt instead, and its context rides on that prompt.
 * Whichever arrives first wins; the other adds nothing. Compaction and
 * `/clear` happen mid-session and arrive through SessionStart itself; a
 * fork resumes a transcript, so it reaches the extension as a resume. A
 * failing extension adds no context and the session goes on.
 */
const extensionHooks = (
  extension: ClaudeThreadExtension,
  runPromise: RunPromise,
  start: ClaudeSessionStart,
): Partial<Record<HookEvent, Array<HookCallbackMatcher>>> => {
  let started = false;
  const sessionStarted = (
    event: Parameters<ClaudeThreadExtension["onSessionStart"]>[0],
    hookEventName: "SessionStart" | "UserPromptSubmit",
  ) =>
    runPromise(
      extension.onSessionStart(event).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("claude.thread-extension.session-start-failed", { cause }).pipe(
            Effect.as(undefined),
          ),
        ),
        Effect.map((additionalContext): SyncHookJSONOutput =>
          additionalContext === undefined
            ? {}
            : { hookSpecificOutput: { hookEventName, additionalContext } },
        ),
      ),
    );
  const sessionStart: HookCallback = (input) => {
    if (input.hook_event_name !== "SessionStart") return Promise.resolve({});
    const source = input.source === "fork" ? "resume" : input.source;
    if (source === "startup" || source === "resume") {
      if (started) return Promise.resolve({});
      started = true;
    }
    return sessionStarted(
      { source, sessionId: input.session_id, transcriptPath: input.transcript_path },
      "SessionStart",
    );
  };
  const firstPrompt: HookCallback = (input) => {
    if (input.hook_event_name !== "UserPromptSubmit" || started) return Promise.resolve({});
    started = true;
    return sessionStarted(
      { source: start, sessionId: input.session_id, transcriptPath: input.transcript_path },
      "UserPromptSubmit",
    );
  };
  const postCompact: HookCallback = (input) =>
    input.hook_event_name !== "PostCompact"
      ? Promise.resolve({})
      : runPromise(
          extension.onPostCompact({ summary: input.compact_summary }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("claude.thread-extension.post-compact-failed", { cause }),
            ),
            Effect.as({}),
          ),
        );
  return {
    SessionStart: matchers(sessionStart),
    UserPromptSubmit: matchers(firstPrompt),
    PostCompact: matchers(postCompact),
  };
};

/**
 * A profiled thread's contribution to the adapter's options: the session
 * context to append, its settings, the hooks that decide every tool call
 * and carry the extension's session events, its in-process tools and its
 * spend cap. `applyClaudeQueryOptionsPatch` folds it into the adapter's own
 * options. Every callback resolves — a failing or silent `decideTool`
 * becomes a deny, a failing extension adds nothing — so no hook ever
 * rejects into the CLI.
 */
export function claudeQueryOptionsPatch(
  profile: ThreadToolProfile,
  extension: ClaudeThreadExtension | undefined,
  runPromise: RunPromise,
  start: ClaudeSessionStart,
): Partial<ClaudeQueryOptions> {
  const preToolUse: HookCallback = (input) =>
    input.hook_event_name !== "PreToolUse"
      ? Promise.resolve({})
      : runPromise(
          profile
            .decideTool({
              toolName: input.tool_name,
              input: input.tool_input,
              toolUseId: input.tool_use_id,
            })
            .pipe(
              Effect.catchCause(() => Effect.succeed(deny("The tool gate failed."))),
              Effect.timeoutOrElse({
                duration: DECIDE_TOOL_TIMEOUT,
                orElse: () => Effect.succeed(deny("The tool gate gave no decision in time.")),
              }),
              Effect.map(preToolUseOutput),
            ),
        );
  const hooks: Partial<Record<HookEvent, Array<HookCallbackMatcher>>> = {
    PreToolUse: matchers(preToolUse),
    ...(extension ? extensionHooks(extension, runPromise, start) : {}),
  };
  return {
    systemPrompt: { type: "preset", preset: "claude_code", append: profile.sessionContext },
    settings: {
      ...extension?.settings,
      autoCompactWindow: profile.contextWindow,
    },
    hooks,
    ...(profile.tools.length > 0
      ? { mcpServers: { crew: crewToolServer(profile.tools, runPromise) } }
      : {}),
    ...(profile.maxBudgetUsd !== undefined ? { maxBudgetUsd: profile.maxBudgetUsd } : {}),
  };
}

type PresetSystemPrompt = Extract<ClaudeQueryOptions["systemPrompt"], { type: "preset" }>;

const presetOf = (prompt: ClaudeQueryOptions["systemPrompt"]): PresetSystemPrompt | undefined =>
  typeof prompt === "object" && !Array.isArray(prompt) && prompt.type === "preset"
    ? prompt
    : undefined;

const settingsOf = (settings: ClaudeQueryOptions["settings"]) =>
  typeof settings === "object" ? settings : {};

/**
 * The adapter's options with a profiled thread's patch folded in. Two keys
 * merge rather than replace: a preset prompt's `append` follows the
 * adapter's own (its runtime instructions stay first), and `settings` are
 * laid over the adapter's. Every other patch key replaces. The dialog kinds
 * are dropped: a gated thread has no person to answer a dialog.
 */
export function applyClaudeQueryOptionsPatch(
  base: ClaudeQueryOptions,
  patch: Partial<ClaudeQueryOptions>,
): ClaudeQueryOptions {
  const { supportedDialogKinds: _dialogKinds, ...rest } = base;
  const basePrompt = presetOf(base.systemPrompt);
  const patchPrompt = presetOf(patch.systemPrompt);
  return {
    ...rest,
    ...patch,
    ...(basePrompt && patchPrompt
      ? {
          systemPrompt: {
            ...basePrompt,
            append: [basePrompt.append, patchPrompt.append].filter(Boolean).join("\n\n"),
          },
        }
      : {}),
    ...(patch.settings
      ? { settings: { ...settingsOf(base.settings), ...settingsOf(patch.settings) } }
      : {}),
  };
}
