/**
 * The thread tool policy SPI against the real Claude adapter: what a thread
 * with a profile runs with, compared with the same session without one
 * (ARCHITECTURE seam 8, §7 "SPI contract test").
 */
import { assert, describe, it } from "@effect/vitest";
import {
  type ModelSelection,
  type ProviderSendTurnInput,
  type ProviderSessionStartInput,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import { buildRuntimeInstructions } from "../provider/RuntimeInstructions.ts";
import {
  claudeAdapterHarnessLayer,
  makeClaudeAdapterHarness,
  toComparable,
} from "./claudeAdapterHarness.ts";
import {
  SYNTHETIC_CLAUDE_CAPABLE_MODEL,
  SYNTHETIC_CLAUDE_STANDARD_MODEL,
} from "./claudeProviderTest.ts";
import {
  type ClaudeThreadExtension,
  ClaudeThreadExtensionRegistry,
} from "./claudeThreadProfile.ts";
import { type ThreadToolProfile, ThreadToolPolicyRegistry } from "./threadToolPolicy.ts";

const THREAD_ID = ThreadId.make("crew-thread");

const PROFILE: ThreadToolProfile = {
  sessionContext: "You are @backend on the crew.",
  contextWindow: 400_000,
  maxBudgetUsd: 5,
  decideTool: () => Effect.succeed({ kind: "allow" }),
  tools: [],
};

const EXTENSION: ClaudeThreadExtension = {
  settings: { autoMemoryEnabled: false, disableAllHooks: false },
  onSessionStart: () => Effect.succeed(undefined),
  onPostCompact: () => Effect.void,
};

/** Top-level option keys whose value differs, sessionId aside (it is fresh per session). */
const changedKeys = (before: object, after: object): ReadonlyArray<string> => {
  const comparable = (options: object) => toComparable(options) as Record<string, unknown>;
  const [a, b] = [comparable(before), comparable(after)];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => key !== "sessionId" && JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .sort();
};

const startInput = (
  overrides: Partial<ProviderSessionStartInput> = {},
): ProviderSessionStartInput => ({
  threadId: THREAD_ID,
  provider: ProviderDriverKind.make("claudeAgent"),
  runtimeMode: "full-access",
  cwd: "/var/www/.crew/backend",
  ...overrides,
});

const turnInput = (overrides: Partial<ProviderSendTurnInput> = {}): ProviderSendTurnInput => ({
  threadId: THREAD_ID,
  input: "work",
  attachments: [],
  ...overrides,
});

/**
 * One adapter with the profile (and extension) installed for THREAD_ID only.
 * Returns the harness so a case can drive sessions and turns on it.
 */
const withProfile = (
  profile: ThreadToolProfile,
  options: {
    readonly extension?: ClaudeThreadExtension;
    readonly settings?: Parameters<typeof makeClaudeAdapterHarness>[0];
  } = {},
) =>
  Effect.gen(function* () {
    yield* (yield* ThreadToolPolicyRegistry).install({
      profileFor: ({ threadId }) => Effect.succeed(threadId === THREAD_ID ? profile : undefined),
    });
    yield* (yield* ClaudeThreadExtensionRegistry).install({
      extensionFor: (threadId) =>
        Effect.succeed(threadId === THREAD_ID ? options.extension : undefined),
    });
    return yield* makeClaudeAdapterHarness(options.settings);
  });

const contractLayer = Layer.mergeAll(
  claudeAdapterHarnessLayer,
  ThreadToolPolicyRegistry.layer,
  ClaudeThreadExtensionRegistry.layer,
);

describe("a thread with a tool profile, on the Claude adapter", () => {
  it.effect("runs in dontAsk even under full-access and a bypass launch arg", () =>
    Effect.gen(function* () {
      const { adapter, sessions, firstEvent } = yield* withProfile(PROFILE, {
        settings: { launchArgs: "--dangerously-skip-permissions" },
      });
      yield* adapter.startSession(startInput());
      const options = sessions[0]!.options;
      assert.strictEqual(options.permissionMode, "dontAsk");
      assert.notProperty(options, "allowDangerouslySkipPermissions");
      const configured = yield* firstEvent("session.configured");
      assert.strictEqual(configured.payload.config.permissionMode, "dontAsk");
    }).pipe(Effect.scoped, Effect.provide(contractLayer)),
  );

  it.effect("returns to dontAsk on every default-mode turn", () =>
    Effect.gen(function* () {
      const { adapter, sessions } = yield* withProfile(PROFILE);
      yield* adapter.startSession(startInput());
      yield* adapter.sendTurn(turnInput({ interactionMode: "plan" }));
      yield* adapter.sendTurn(turnInput({ interactionMode: "default" }));
      assert.deepStrictEqual(sessions[0]!.query.setPermissionModeCalls, ["plan", "dontAsk"]);
    }).pipe(Effect.scoped, Effect.provide(contractLayer)),
  );

  it.effect("changes exactly the profile's options, and drops the person's dialogs", () =>
    Effect.gen(function* () {
      const { adapter, sessions } = yield* withProfile(PROFILE, { extension: EXTENSION });
      yield* adapter.startSession(startInput());
      yield* adapter.startSession(startInput({ threadId: ThreadId.make("person-thread") }));
      const [crew, person] = sessions.map((session) => session.options);
      assert.deepStrictEqual(changedKeys(person!, crew!), [
        "allowDangerouslySkipPermissions",
        "hooks",
        "maxBudgetUsd",
        "permissionMode",
        "settings",
        "supportedDialogKinds",
        "systemPrompt",
      ]);
      assert.notProperty(crew, "supportedDialogKinds");
      assert.strictEqual(
        crew!.systemPrompt &&
          typeof crew!.systemPrompt === "object" &&
          "append" in crew!.systemPrompt
          ? crew!.systemPrompt.append
          : undefined,
        `${buildRuntimeInstructions({ harness: "Claude Code" })}\n\n${PROFILE.sessionContext}`,
      );
      assert.deepStrictEqual(crew!.settings, {
        ...(person!.settings as object),
        autoMemoryEnabled: false,
        disableAllHooks: false,
        autoCompactWindow: PROFILE.contextWindow,
      });
      assert.strictEqual(crew!.maxBudgetUsd, PROFILE.maxBudgetUsd);
    }).pipe(Effect.scoped, Effect.provide(contractLayer)),
  );

  // The PreToolUse hook is the gate: every row is one decideTool behavior
  // and the output the CLI must receive for it.
  const GATE_CASES: ReadonlyArray<{
    readonly name: string;
    readonly decideTool: ThreadToolProfile["decideTool"];
    readonly expected: unknown;
  }> = [
    {
      name: "an allow passes the rewritten input",
      decideTool: () => Effect.succeed({ kind: "allow", updatedInput: { command: "ls" } }),
      expected: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { command: "ls" },
      },
    },
    {
      name: "a deny carries its reason",
      decideTool: () => Effect.succeed({ kind: "deny", reason: "outside your copy" }),
      expected: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "outside your copy",
      },
    },
    {
      name: "a throwing decideTool denies",
      decideTool: () => Effect.die(new Error("gate crashed")),
      expected: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "The tool gate failed.",
      },
    },
    {
      name: "a decideTool silent for 15 s denies",
      decideTool: () => Effect.never,
      expected: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "The tool gate gave no decision in time.",
      },
    },
  ];

  it.effect.each(
    Array.from(GATE_CASES, ({ name, decideTool, expected }) => ({
      title: `gates tool calls: ${name}`,
      decideTool,
      expected,
    })),
  )("$title", ({ decideTool, expected }) =>
    Effect.gen(function* () {
      const { adapter, sessions } = yield* withProfile({ ...PROFILE, decideTool });
      yield* adapter.startSession(startInput());
      const [preToolUse] = sessions[0]!.options.hooks?.PreToolUse?.[0]?.hooks ?? [];
      const output = preToolUse!(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "ls -la" },
          tool_use_id: "toolu_1",
          session_id: "session",
          transcript_path: "/tmp/transcript.jsonl",
          cwd: "/var/www/.crew/backend",
        },
        "toolu_1",
        { signal: new AbortController().signal },
      );
      yield* TestClock.adjust("15 seconds");
      const result = yield* Effect.promise(() => output);
      assert.deepStrictEqual(
        "hookSpecificOutput" in result ? result.hookSpecificOutput : undefined,
        expected,
      );
    }).pipe(Effect.scoped, Effect.provide(contractLayer)),
  );

  // SessionStart hands the extension each (re)start of the CLI session and
  // returns its text as additional context; a fork resumes a transcript too.
  const SESSION_START_CASES: ReadonlyArray<{
    readonly source: "startup" | "resume" | "compact" | "clear" | "fork";
    readonly context: string | undefined;
    readonly seen: string;
    readonly expected: unknown;
  }> = [
    {
      source: "startup",
      context: "the state packet",
      seen: "startup",
      expected: {
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: "the state packet",
        },
      },
    },
    {
      source: "compact",
      context: "the state packet",
      seen: "compact",
      expected: {
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: "the state packet",
        },
      },
    },
    {
      source: "fork",
      context: "the delta",
      seen: "resume",
      expected: {
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "the delta" },
      },
    },
    { source: "clear", context: undefined, seen: "clear", expected: {} },
  ];

  it.effect.each(
    Array.from(SESSION_START_CASES, ({ source, context, seen, expected }) => ({
      title: `hands a ${source} session start to the extension`,
      source,
      context,
      seen,
      expected,
    })),
  )("$title", ({ source, context, seen, expected }) =>
    Effect.gen(function* () {
      const events: Array<unknown> = [];
      const { adapter, sessions } = yield* withProfile(PROFILE, {
        extension: {
          ...EXTENSION,
          onSessionStart: (event) => Effect.sync(() => events.push(event)).pipe(Effect.as(context)),
        },
      });
      yield* adapter.startSession(startInput());
      const [sessionStart] = sessions[0]!.options.hooks?.SessionStart?.[0]?.hooks ?? [];
      const result = yield* Effect.promise(() =>
        sessionStart!(
          {
            hook_event_name: "SessionStart",
            source,
            session_id: "session-1",
            transcript_path: "/home/zerops/.claude/projects/x/session-1.jsonl",
            cwd: "/var/www/.crew/backend",
          },
          undefined,
          { signal: new AbortController().signal },
        ),
      );
      assert.deepStrictEqual(result, expected);
      assert.deepStrictEqual(events, [
        {
          source: seen,
          sessionId: "session-1",
          transcriptPath: "/home/zerops/.claude/projects/x/session-1.jsonl",
        },
      ]);
    }).pipe(Effect.scoped, Effect.provide(contractLayer)),
  );

  // The CLI runs its startup and resume SessionStart before the SDK has
  // registered any callback (CLI 2.1.283), so a process's start reaches the
  // extension with its first prompt instead — once, whichever arrives first.
  const TRANSCRIPT = "/home/zerops/.claude/projects/x/session-1.jsonl";
  type SessionHook = "UserPromptSubmit" | "SessionStart" | "PreCompact";
  const hookInput = (event: SessionHook, source?: string) => ({
    hook_event_name: event,
    session_id: "session-1",
    transcript_path: TRANSCRIPT,
    cwd: "/var/www/.crew/backend",
    ...(event === "UserPromptSubmit" ? { prompt: "work" } : {}),
    ...(event === "SessionStart" ? { source } : {}),
    ...(event === "PreCompact" ? { trigger: "auto", custom_instructions: null } : {}),
  });
  const promptContext = (source: string) => ({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `context for ${source}`,
    },
  });
  const sessionStartContext = (source: string) => ({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `context for ${source}`,
    },
  });
  const FIRST_PROMPT_CASES: ReadonlyArray<{
    readonly name: string;
    readonly resumed: boolean;
    readonly calls: ReadonlyArray<readonly [SessionHook, string?]>;
    readonly seen: ReadonlyArray<string>;
    readonly outputs: ReadonlyArray<unknown>;
  }> = [
    {
      name: "a new session's start arrives with its first prompt, once",
      resumed: false,
      calls: [["UserPromptSubmit"], ["UserPromptSubmit"]],
      seen: ["startup"],
      outputs: [
        {
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: "context for startup",
          },
        },
        {},
      ],
    },
    {
      name: "a resumed session's start arrives with its first prompt as a resume",
      resumed: true,
      calls: [["UserPromptSubmit"]],
      seen: ["resume"],
      outputs: [
        {
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: "context for resume",
          },
        },
      ],
    },
    {
      name: "a start the CLI does deliver is not handed over again with the first prompt",
      resumed: false,
      calls: [["SessionStart", "startup"], ["UserPromptSubmit"]],
      seen: ["startup"],
      outputs: [
        {
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: "context for startup",
          },
        },
        {},
      ],
    },
    {
      name: "a compaction after the first prompt still arrives through SessionStart",
      resumed: false,
      calls: [["UserPromptSubmit"], ["SessionStart", "compact"]],
      seen: ["startup", "compact"],
      outputs: [
        {
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: "context for startup",
          },
        },
        {
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: "context for compact",
          },
        },
      ],
    },
    // A compaction whose SessionStart never arrives: PreCompact marks it,
    // and the next prompt hands it over instead — once, whichever comes first.
    {
      name: "a compaction without its SessionStart arrives with the next prompt, once",
      resumed: false,
      calls: [["UserPromptSubmit"], ["PreCompact"], ["UserPromptSubmit"], ["UserPromptSubmit"]],
      seen: ["startup", "compact"],
      outputs: [promptContext("startup"), {}, promptContext("compact"), {}],
    },
    {
      name: "a compaction whose SessionStart arrives is not handed over again with the next prompt",
      resumed: false,
      calls: [
        ["UserPromptSubmit"],
        ["PreCompact"],
        ["SessionStart", "compact"],
        ["UserPromptSubmit"],
      ],
      seen: ["startup", "compact"],
      outputs: [promptContext("startup"), {}, sessionStartContext("compact"), {}],
    },
    {
      name: "a compaction's SessionStart after the prompt handed it over adds nothing",
      resumed: false,
      calls: [
        ["UserPromptSubmit"],
        ["PreCompact"],
        ["UserPromptSubmit"],
        ["SessionStart", "compact"],
      ],
      seen: ["startup", "compact"],
      outputs: [promptContext("startup"), {}, promptContext("compact"), {}],
    },
  ];

  it.effect.each(
    Array.from(FIRST_PROMPT_CASES, ({ name, resumed, calls, seen, outputs }) => ({
      title: name,
      resumed,
      calls,
      seen,
      outputs,
    })),
  )("$title", ({ resumed, calls, seen, outputs }) =>
    Effect.gen(function* () {
      const sources: Array<string> = [];
      const { adapter, sessions } = yield* withProfile(PROFILE, {
        extension: {
          ...EXTENSION,
          onSessionStart: (event) =>
            Effect.sync(() => {
              assert.deepStrictEqual(
                [event.sessionId, event.transcriptPath],
                ["session-1", TRANSCRIPT],
              );
              sources.push(event.source);
              return `context for ${event.source}`;
            }),
        },
      });
      yield* adapter.startSession(
        startInput(
          resumed
            ? {
                resumeCursor: {
                  threadId: THREAD_ID,
                  resume: "5d9f1c3a-7b2e-4c8d-9a1f-3e6b8c0d2f47",
                  turnCount: 1,
                },
              }
            : {},
        ),
      );
      const hooks = sessions[0]!.options.hooks ?? {};
      const results: Array<unknown> = [];
      for (const [event, source] of calls) {
        const [callback] = hooks[event]?.[0]?.hooks ?? [];
        results.push(
          yield* Effect.promise(() =>
            callback!(hookInput(event, source) as never, undefined, {
              signal: new AbortController().signal,
            }),
          ),
        );
      }
      assert.deepStrictEqual(sources, seen);
      assert.deepStrictEqual(results, outputs);
    }).pipe(Effect.scoped, Effect.provide(contractLayer)),
  );

  it.effect("runs the profile's model and effort over the thread's, on start and every turn", () =>
    Effect.gen(function* () {
      const threadSelection: ModelSelection = {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: SYNTHETIC_CLAUDE_CAPABLE_MODEL,
        options: [{ id: "effort", value: "max" }],
      };
      const { adapter, sessions, firstEvent } = yield* withProfile({
        ...PROFILE,
        model: SYNTHETIC_CLAUDE_STANDARD_MODEL,
        effort: "low",
      });
      yield* adapter.startSession(startInput({ modelSelection: threadSelection }));
      yield* adapter.sendTurn(turnInput({ modelSelection: threadSelection }));
      // The same session, chosen by hand: what the profile's override must equal.
      yield* adapter.startSession(
        startInput({
          threadId: ThreadId.make("person-thread"),
          modelSelection: {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            model: SYNTHETIC_CLAUDE_STANDARD_MODEL,
            options: [{ id: "effort", value: "low" }],
          },
        }),
      );
      const [crew, person] = sessions;
      assert.strictEqual(crew!.options.model, person!.options.model);
      assert.strictEqual(crew!.options.effort, "low");
      const configured = yield* firstEvent("session.configured");
      assert.strictEqual(configured.threadId, THREAD_ID);
      assert.strictEqual(configured.payload.config.model, person!.options.model);
      assert.deepStrictEqual(crew!.query.setModelCalls, [], "the turn switched the model back");
    }).pipe(Effect.scoped, Effect.provide(contractLayer)),
  );

  it.effect("hands the compaction summary to the extension", () =>
    Effect.gen(function* () {
      const summaries: Array<string> = [];
      const { adapter, sessions } = yield* withProfile(PROFILE, {
        extension: {
          ...EXTENSION,
          onPostCompact: ({ summary }) => Effect.sync(() => summaries.push(summary)),
        },
      });
      yield* adapter.startSession(startInput());
      const [postCompact] = sessions[0]!.options.hooks?.PostCompact?.[0]?.hooks ?? [];
      const result = yield* Effect.promise(() =>
        postCompact!(
          {
            hook_event_name: "PostCompact",
            trigger: "auto",
            compact_summary: "worked on the login form",
            session_id: "session-1",
            transcript_path: "/home/zerops/.claude/projects/x/session-1.jsonl",
            cwd: "/var/www/.crew/backend",
          },
          undefined,
          { signal: new AbortController().signal },
        ),
      );
      assert.deepStrictEqual(result, {});
      assert.deepStrictEqual(summaries, ["worked on the login form"]);
    }).pipe(Effect.scoped, Effect.provide(contractLayer)),
  );
});

const TOOL_PROFILE: ThreadToolProfile = {
  ...PROFILE,
  tools: [
    {
      name: "crew_report",
      description: "Report the task's outcome.",
      inputSchema: {
        type: "object",
        properties: { outcome: { type: "string" } },
        required: ["outcome"],
      },
      run: (input) => Effect.succeed({ text: `reported ${JSON.stringify(input)}`, isError: false }),
    },
    {
      name: "crew_broken",
      description: "Always fails.",
      inputSchema: { type: "object" },
      run: () => Effect.die(new Error("boom")),
    },
  ],
};

/**
 * Starts a profiled session and connects to its `crew` server the way the
 * SDK does: it sends JSON-RPC through a transport, the server answers
 * through `send`.
 */
const connectCrewServer = Effect.gen(function* () {
  const { adapter, sessions } = yield* withProfile(TOOL_PROFILE);
  yield* adapter.startSession(startInput());
  const servers = sessions[0]!.options.mcpServers ?? {};
  assert.deepStrictEqual(Object.keys(servers), ["crew"]);
  const server = servers.crew as {
    readonly type: string;
    readonly name: string;
    readonly instance: { connect: (transport: object) => Promise<void> };
  };
  assert.deepInclude(server, { type: "sdk", name: "crew" });
  const replies = new Map<unknown, (message: unknown) => void>();
  const transport = {
    onmessage: undefined as ((message: unknown) => void) | undefined,
    start: async () => {},
    send: async (message: { readonly id?: unknown }) => {
      replies.get(message.id)?.(message);
    },
  };
  yield* Effect.promise(() => server.instance.connect(transport));
  const request = (id: number, method: string, params?: unknown) =>
    Effect.promise(
      () =>
        new Promise<unknown>((resolve) => {
          replies.set(id, resolve);
          transport.onmessage?.({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
        }),
    );
  const notify = (method: string) => transport.onmessage?.({ jsonrpc: "2.0", method });
  return { request, notify };
});

describe("a profile's tools, served in-process as the crew MCP server", () => {
  const CASES: ReadonlyArray<{
    readonly name: string;
    readonly method: string;
    readonly params?: unknown;
    readonly reply: Record<string, unknown>;
  }> = [
    {
      name: "initialize answers the client's protocol version with the tools capability",
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude" } },
      reply: {
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "crew", version: "1.0.0" },
        },
      },
    },
    {
      name: "tools/list lists every tool with its JSON Schema",
      method: "tools/list",
      reply: {
        result: {
          tools: TOOL_PROFILE.tools.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        },
      },
    },
    {
      name: "tools/call runs the tool",
      method: "tools/call",
      params: { name: "crew_report", arguments: { outcome: "done" } },
      reply: {
        result: {
          content: [{ type: "text", text: 'reported {"outcome":"done"}' }],
          isError: false,
        },
      },
    },
    {
      name: "a failing tool is an error result, never a protocol error",
      method: "tools/call",
      params: { name: "crew_broken", arguments: {} },
      reply: {
        result: { content: [{ type: "text", text: "crew_broken failed." }], isError: true },
      },
    },
    {
      name: "an unknown tool is an error result",
      method: "tools/call",
      params: { name: "crew_missing", arguments: {} },
      reply: {
        result: { content: [{ type: "text", text: "No tool named crew_missing." }], isError: true },
      },
    },
    { name: "ping answers empty", method: "ping", reply: { result: {} } },
    {
      name: "any other method is not found",
      method: "resources/list",
      reply: { error: { code: -32601, message: "Method not found: resources/list" } },
    },
  ];

  it.effect.each(
    Array.from(CASES, ({ name, method, params, reply }) => ({
      title: name,
      method,
      params,
      reply,
    })),
  )("$title", ({ method, params, reply }) =>
    Effect.gen(function* () {
      const { request, notify } = yield* connectCrewServer;
      notify("notifications/initialized");
      assert.deepStrictEqual(yield* request(7, method, params), {
        jsonrpc: "2.0",
        id: 7,
        ...reply,
      });
    }).pipe(Effect.scoped, Effect.provide(contractLayer)),
  );
});
