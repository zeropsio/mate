// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import type {
  Options as ClaudeQueryOptions,
  PermissionMode,
  PermissionResult,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  ApprovalRequestId,
  ClaudeSettings,
  ProviderDriverKind,
  ProviderItemId,
  ProviderRuntimeEvent,
  type RuntimeMode,
  ThreadId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { attachmentRelativePath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { CONTENT_CONTRACT } from "../../contentContract.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  SYNTHETIC_CLAUDE_CAPABLE_MODEL,
  SYNTHETIC_CLAUDE_COLLIDING_ALIAS,
  SYNTHETIC_CLAUDE_MODEL_CATALOG,
  SYNTHETIC_CLAUDE_STANDARD_MODEL,
  SYNTHETIC_CLAUDE_THINKING_MODEL,
} from "../ClaudeModelCatalog.testFixtures.ts";
import {
  type ProviderAdapterError,
  ProviderAdapterProcessError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import type { ClaudeScopedLimitNames } from "./claudeUsageLimits.ts";
import { makeClaudeAdapter, type ClaudeAdapterLiveOptions } from "./ClaudeAdapter.ts";
const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);
const encodeUnknownJsonString = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

// Test-local service tag so the rest of the file can keep using `yield* ClaudeAdapter`.
class ClaudeAdapter extends Context.Service<ClaudeAdapter, ClaudeAdapterShape>()(
  "t3/provider/Layers/ClaudeAdapter.test/ClaudeAdapter",
) {}

class FakeClaudeQuery implements AsyncIterable<SDKMessage> {
  private readonly queue: Array<SDKMessage> = [];
  private readonly waiters: Array<{
    readonly resolve: (value: IteratorResult<SDKMessage>) => void;
    readonly reject: (reason: unknown) => void;
  }> = [];
  private done = false;
  private failure: unknown | undefined;

  public readonly setModelCalls: Array<string | undefined> = [];
  public readonly setPermissionModeCalls: Array<string> = [];
  public readonly setMaxThinkingTokensCalls: Array<number | null> = [];
  public closeCalls = 0;
  public closeError: unknown | undefined;
  /** Set by tests that exercise Claude's graceful interrupt. */
  public interrupt?: () => Promise<unknown>;

  emit(message: SDKMessage): void {
    if (this.done) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value: message });
      return;
    }
    this.queue.push(message);
  }

  fail(cause: unknown): void {
    if (this.done) {
      return;
    }
    this.done = true;
    this.failure = cause;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(cause);
    }
  }

  finish(): void {
    if (this.done) {
      return;
    }
    this.done = true;
    this.failure = undefined;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }

  public setModelError: unknown | undefined;
  readonly setModel = async (model?: string): Promise<void> => {
    this.setModelCalls.push(model);
    if (this.setModelError !== undefined) throw this.setModelError;
  };

  readonly setPermissionMode = async (mode: PermissionMode): Promise<void> => {
    this.setPermissionModeCalls.push(mode);
  };

  readonly setMaxThinkingTokens = async (maxThinkingTokens: number | null): Promise<void> => {
    this.setMaxThinkingTokensCalls.push(maxThinkingTokens);
  };

  public readonly applyFlagSettingsCalls: Array<Record<string, unknown>> = [];
  public applyFlagSettingsError: unknown | undefined;
  readonly applyFlagSettings = async (settings: Record<string, unknown>): Promise<void> => {
    this.applyFlagSettingsCalls.push(settings);
    if (this.applyFlagSettingsError !== undefined) throw this.applyFlagSettingsError;
  };

  readonly close = (): void => {
    this.closeCalls += 1;
    if (this.closeError !== undefined) {
      throw this.closeError;
    }
    this.finish();
  };

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: () => {
        if (this.queue.length > 0) {
          const value = this.queue.shift();
          if (value) {
            return Promise.resolve({
              done: false,
              value,
            });
          }
        }
        if (this.failure !== undefined) {
          const failure = this.failure;
          this.failure = undefined;
          return Promise.reject(failure);
        }
        if (this.done) {
          return Promise.resolve({
            done: true,
            value: undefined,
          });
        }
        return new Promise((resolve, reject) => {
          this.waiters.push({
            resolve,
            reject,
          });
        });
      },
    };
  }
}

function makeHarness(config?: {
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: ClaudeAdapterLiveOptions["nativeEventLogger"];
  readonly cwd?: string;
  readonly baseDir?: string;
  readonly claudeConfig?: Partial<ClaudeSettings>;
  readonly instanceId?: ProviderInstanceId;
  readonly scopedLimitNames?: ClaudeAdapterLiveOptions["scopedLimitNames"];
  readonly environment?: ClaudeAdapterLiveOptions["environment"];
  readonly getSessionMessages?: ClaudeAdapterLiveOptions["getSessionMessages"];
  readonly forkSession?: ClaudeAdapterLiveOptions["forkSession"];
}) {
  const query = new FakeClaudeQuery();
  const queries = [query];
  let createInput:
    | {
        readonly prompt: AsyncIterable<SDKUserMessage>;
        readonly options: ClaudeQueryOptions;
      }
    | undefined;

  const adapterOptions: ClaudeAdapterLiveOptions = {
    ...(config?.environment ? { environment: config.environment } : {}),
    ...(config?.instanceId ? { instanceId: config.instanceId } : {}),
    ...(config?.scopedLimitNames ? { scopedLimitNames: config.scopedLimitNames } : {}),
    modelCatalog: Effect.succeed(SYNTHETIC_CLAUDE_MODEL_CATALOG),
    ...(config?.getSessionMessages ? { getSessionMessages: config.getSessionMessages } : {}),
    ...(config?.forkSession ? { forkSession: config.forkSession } : {}),
    createQuery: (input) => {
      if (createInput && config?.getSessionMessages) queries.push(new FakeClaudeQuery());
      createInput = input;
      return queries.at(-1)!;
    },
    ...(config?.nativeEventLogger
      ? {
          nativeEventLogger: config.nativeEventLogger,
        }
      : {}),
    ...(config?.nativeEventLogPath
      ? {
          nativeEventLogPath: config.nativeEventLogPath,
        }
      : {}),
  };

  return {
    layer: Layer.effect(
      ClaudeAdapter,
      Effect.gen(function* () {
        const claudeConfig = decodeClaudeSettings(config?.claudeConfig ?? {});
        return yield* makeClaudeAdapter(claudeConfig, adapterOptions);
      }),
    ).pipe(
      Layer.provideMerge(
        ServerConfig.layerTest(
          config?.cwd ?? "/tmp/claude-adapter-test",
          config?.baseDir ?? "/tmp",
        ),
      ),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(NodeServices.layer),
    ),
    query,
    queries,
    getLastCreateQueryInput: () => createInput,
  };
}

function makeDeterministicRandomService(seed = 0x1234_5678): {
  nextIntUnsafe: () => number;
  nextDoubleUnsafe: () => number;
} {
  let state = seed >>> 0;
  const nextIntUnsafe = (): number => {
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
    return state;
  };

  return {
    nextIntUnsafe,
    nextDoubleUnsafe: () => nextIntUnsafe() / 0x1_0000_0000,
  };
}

async function readFirstPromptText(
  input:
    | {
        readonly prompt: AsyncIterable<SDKUserMessage>;
      }
    | undefined,
): Promise<string | undefined> {
  const iterator = input?.prompt[Symbol.asyncIterator]();
  if (!iterator) {
    return undefined;
  }
  const next = await iterator.next();
  if (next.done) {
    return undefined;
  }
  if (typeof next.value.message.content === "string") {
    return next.value.message.content;
  }
  const content = next.value.message.content[0];
  if (!content || content.type !== "text") {
    return undefined;
  }
  return content.text;
}

async function readFirstPromptMessage(
  input:
    | {
        readonly prompt: AsyncIterable<SDKUserMessage>;
      }
    | undefined,
): Promise<SDKUserMessage | undefined> {
  const iterator = input?.prompt[Symbol.asyncIterator]();
  if (!iterator) {
    return undefined;
  }
  const next = await iterator.next();
  if (next.done) {
    return undefined;
  }
  return next.value;
}

/** Drains the first `count` queued prompts so consecutive turns can be compared. */
async function readPromptMessages(
  input:
    | {
        readonly prompt: AsyncIterable<SDKUserMessage>;
      }
    | undefined,
  count: number,
): Promise<Array<SDKUserMessage>> {
  const iterator = input?.prompt[Symbol.asyncIterator]();
  if (!iterator) {
    return [];
  }
  const messages: Array<SDKUserMessage> = [];
  while (messages.length < count) {
    const next = await iterator.next();
    if (next.done) {
      break;
    }
    messages.push(next.value);
  }
  return messages;
}

const THREAD_ID = ThreadId.make("thread-claude-1");
const RESUME_THREAD_ID = ThreadId.make("thread-claude-resume");
const SYNTHETIC_SUBAGENT_MODEL = "claude-synthetic-subagent[expanded]";
const CLAUDE_ORIGINAL_SESSION_ID = "550e8400-e29b-41d4-a716-446655440010";
const CLAUDE_FORK_SESSION_ID = "550e8400-e29b-41d4-a716-446655440020";

function claudeHistoryMessage(input: {
  readonly type: "user" | "assistant" | "system";
  readonly uuid: string;
  readonly sessionId?: string;
  readonly content?: unknown;
  readonly parentToolUseId?: string | null;
}) {
  const content =
    input.content ??
    (input.type === "user" ? "prompt" : input.type === "assistant" ? [] : { subtype: "init" });
  return {
    type: input.type,
    uuid: input.uuid,
    session_id: input.sessionId ?? CLAUDE_ORIGINAL_SESSION_ID,
    parent_tool_use_id: input.parentToolUseId ?? null,
    parent_agent_id: null,
    message: input.type === "system" ? content : { content },
  };
}

const sendCompletedClaudeTurn = (
  adapter: ClaudeAdapterShape,
  harness: ReturnType<typeof makeHarness>,
  threadId: ThreadId,
  input: string,
) =>
  Effect.gen(function* () {
    const turn = yield* adapter.sendTurn({
      threadId,
      input,
      attachments: [],
    });
    const completedFiber = yield* Stream.filter(
      adapter.streamEvents,
      (event) => event.type === "turn.completed",
    ).pipe(Stream.runHead, Effect.forkChild);
    harness.queries.at(-1)!.emit({
      type: "result",
      subtype: "success",
      is_error: false,
      errors: [],
      session_id: CLAUDE_ORIGINAL_SESSION_ID,
      uuid: `result-${turn.turnId}`,
    } as unknown as SDKMessage);
    const completed = yield* Fiber.join(completedFiber);
    assert.equal(completed._tag, "Some");
    return turn;
  });

describe("ClaudeAdapterLive", () => {
  it.effect("returns validation error for non-claude provider on startSession", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const result = yield* adapter
        .startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("codex"),
          runtimeMode: "full-access",
        })
        .pipe(Effect.result);

      assert.equal(result._tag, "Failure");
      if (result._tag !== "Failure") {
        return;
      }
      assert.deepEqual(
        result.failure,
        new ProviderAdapterValidationError({
          provider: ProviderDriverKind.make("claudeAgent"),
          operation: "startSession",
          issue: "Expected provider 'claudeAgent' but received 'codex'.",
        }),
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("Claude adapter query options carry no mcpServers entry", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.equal(createInput?.options.mcpServers, undefined);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("retains Claude session startup causes without exposing their messages", () => {
    const cause = new Error("credential material that must remain in the cause chain");
    const layer = Layer.effect(
      ClaudeAdapter,
      Effect.gen(function* () {
        const claudeConfig = decodeClaudeSettings({});
        return yield* makeClaudeAdapter(claudeConfig, {
          createQuery: () => {
            throw cause;
          },
        });
      }),
    ).pipe(
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const error = yield* adapter
        .startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("claudeAgent"),
          runtimeMode: "full-access",
        })
        .pipe(Effect.flip);

      assert.instanceOf(error, ProviderAdapterProcessError);
      assert.equal(error.detail, "Failed to start Claude runtime session.");
      assert.strictEqual(error.cause, cause);
      assert.notMatch(error.message, /credential material/u);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("derives bypass permission mode from full-access runtime policy", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.deepEqual(createInput?.options.settingSources, ["user", "project", "local"]);
      assert.deepEqual(createInput?.options.systemPrompt, {
        type: "preset",
        preset: "claude_code",
        append: `<runtime_info>In case you're asked: you are running in Zerops Mate through the Claude Code harness. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>\n${CONTENT_CONTRACT}`,
      });
      assert.equal(createInput?.options.permissionMode, "bypassPermissions");
      assert.equal(createInput?.options.allowDangerouslySkipPermissions, true);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("derives auto permission mode from auto runtime policy without skip flag", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "auto",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.equal(createInput?.options.permissionMode, "auto");
      assert.equal(createInput?.options.allowDangerouslySkipPermissions, undefined);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("lets a launch-arg permission flag win over the thread runtime mode", () => {
    const harness = makeHarness({
      claudeConfig: { launchArgs: "--dangerously-skip-permissions --verbose" },
    });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "auto-accept-edits",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.equal(createInput?.options.permissionMode, "bypassPermissions");
      assert.equal(createInput?.options.allowDangerouslySkipPermissions, true);
      // The honored flag is dropped from extraArgs so the CLI sees it once.
      assert.deepEqual(createInput?.options.extraArgs, {
        verbose: null,
        "thinking-display": "summarized",
      });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("loads Claude filesystem settings sources for SDK sessions", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "approval-required",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.deepEqual(createInput?.options.settingSources, ["user", "project", "local"]);
      assert.equal(createInput?.options.permissionMode, undefined);
      assert.equal(createInput?.options.allowDangerouslySkipPermissions, undefined);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("uses bypass permissions for full-access claude sessions", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.equal(createInput?.options.permissionMode, "bypassPermissions");
      assert.equal(createInput?.options.allowDangerouslySkipPermissions, true);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("passes the configured auto-compaction window to Claude", () => {
    const harness = makeHarness({ claudeConfig: { autoCompactWindow: "300000" } });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const options = harness.getLastCreateQueryInput()?.options;
      assert.deepEqual(options?.settings, {
        showThinkingSummaries: true,
        autoCompactWindow: 300000,
      });
      assert.deepEqual(options?.supportedDialogKinds, ["resume_return"]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("forwards claude effort levels into query options", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          SYNTHETIC_CLAUDE_CAPABLE_MODEL,
          [{ id: "effort", value: "max" }],
        ),
        runtimeMode: "full-access",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.equal(createInput?.options.effort, "max");
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("delivers a message whose effort the live session refuses, and tries again", () => {
    const harness = makeHarness();
    const withEffort = (effort: string) =>
      createModelSelection(ProviderInstanceId.make("claudeAgent"), SYNTHETIC_CLAUDE_CAPABLE_MODEL, [
        { id: "effort", value: effort },
      ]);
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        modelSelection: withEffort("xhigh"),
        runtimeMode: "full-access",
      });
      harness.query.applyFlagSettingsError = new Error("Unknown control request");
      const sent = yield* adapter
        .sendTurn({
          threadId: session.threadId,
          input: "hello",
          modelSelection: withEffort("max"),
          attachments: [],
        })
        .pipe(Effect.result);
      assert.equal(sent._tag, "Success");

      harness.query.applyFlagSettingsError = undefined;
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "again",
        modelSelection: withEffort("max"),
        attachments: [],
      });
      assert.deepEqual(harness.query.applyFlagSettingsCalls, [
        { effortLevel: "max" },
        { effortLevel: "max" },
      ]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("applies an effort change to the live session, once", () => {
    const harness = makeHarness();
    const withEffort = (effort: string) =>
      createModelSelection(ProviderInstanceId.make("claudeAgent"), SYNTHETIC_CLAUDE_CAPABLE_MODEL, [
        { id: "effort", value: effort },
      ]);
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        modelSelection: withEffort("xhigh"),
        runtimeMode: "full-access",
      });
      for (const effort of ["xhigh", "max", "max"]) {
        yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "hello",
          modelSelection: withEffort(effort),
          attachments: [],
        });
      }

      assert.equal(harness.queries.length, 1);
      assert.deepEqual(harness.query.applyFlagSettingsCalls, [{ effortLevel: "max" }]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("runs Claude SDK sessions with the configured CLAUDE_CONFIG_DIR", () => {
    const harness = makeHarness({ claudeConfig: { homePath: "~/.claude-work" } });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          SYNTHETIC_CLAUDE_CAPABLE_MODEL,
        ),
        runtimeMode: "full-access",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.equal(
        createInput?.options.env?.CLAUDE_CONFIG_DIR,
        NodePath.join(NodeOS.homedir(), ".claude-work"),
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("forwards Claude thinking toggle for models that support it", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          SYNTHETIC_CLAUDE_THINKING_MODEL,
          [{ id: "thinking", value: false }],
        ),
        runtimeMode: "full-access",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.deepEqual(createInput?.options.settings, {
        alwaysThinkingEnabled: false,
      });
      assert.equal(createInput?.options.thinking, undefined);
      assert.equal(createInput?.options.extraArgs?.["thinking-display"], undefined);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("requests Claude thinking summaries unless thinking is off", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          SYNTHETIC_CLAUDE_THINKING_MODEL,
          [{ id: "thinking", value: true }],
        ),
        runtimeMode: "full-access",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.deepEqual(createInput?.options.settings, {
        alwaysThinkingEnabled: true,
        showThinkingSummaries: true,
      });
      assert.deepEqual(createInput?.options.thinking, {
        type: "adaptive",
        display: "summarized",
      });
      assert.equal(createInput?.options.extraArgs?.["thinking-display"], "summarized");
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("honors a launch-arg that omits Claude thinking display", () => {
    const harness = makeHarness({
      claudeConfig: { launchArgs: "--thinking-display omitted" },
    });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.equal(createInput?.options.settings, undefined);
      assert.equal(createInput?.options.thinking, undefined);
      assert.equal(createInput?.options.extraArgs?.["thinking-display"], "omitted");
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("ignores Claude thinking toggle for models without it", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          SYNTHETIC_CLAUDE_STANDARD_MODEL,
          [{ id: "thinking", value: false }],
        ),
        runtimeMode: "full-access",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.deepEqual(createInput?.options.settings, {
        showThinkingSummaries: true,
      });
      assert.deepEqual(createInput?.options.thinking, {
        type: "adaptive",
        display: "summarized",
      });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("forwards claude fast mode into SDK settings", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          SYNTHETIC_CLAUDE_CAPABLE_MODEL,
          [{ id: "fastMode", value: true }],
        ),
        runtimeMode: "full-access",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.deepEqual(createInput?.options.settings, {
        showThinkingSummaries: true,
        fastMode: true,
      });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("ignores claude fast mode for models without it", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          SYNTHETIC_CLAUDE_STANDARD_MODEL,
          [{ id: "fastMode", value: true }],
        ),
        runtimeMode: "full-access",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.deepEqual(createInput?.options.settings, {
        showThinkingSummaries: true,
      });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect(
    "keeps a configured custom alias opaque without disabling the canonical built-in",
    () => {
      const claudeConfig = { customModels: [SYNTHETIC_CLAUDE_COLLIDING_ALIAS] };
      const customHarness = makeHarness({ claudeConfig });
      const builtInHarness = makeHarness({ claudeConfig });
      const start = (harness: ReturnType<typeof makeHarness>, model: string) =>
        Effect.gen(function* () {
          const adapter = yield* ClaudeAdapter;
          yield* adapter.startSession({
            threadId: THREAD_ID,
            provider: ProviderDriverKind.make("claudeAgent"),
            modelSelection: createModelSelection(ProviderInstanceId.make("claudeAgent"), model, [
              { id: "effort", value: "max" },
              { id: "fastMode", value: true },
              { id: "contextWindow", value: "expanded" },
            ]),
            runtimeMode: "full-access",
          });
          return harness.getLastCreateQueryInput()!.options;
        }).pipe(
          Effect.provideService(Random.Random, makeDeterministicRandomService()),
          Effect.provide(harness.layer),
        );
      const runCustomFlow = Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("claudeAgent"),
          modelSelection: createModelSelection(
            ProviderInstanceId.make("claudeAgent"),
            SYNTHETIC_CLAUDE_COLLIDING_ALIAS,
            [
              { id: "effort", value: "max" },
              { id: "fastMode", value: true },
              { id: "contextWindow", value: "expanded" },
            ],
          ),
          runtimeMode: "full-access",
        });
        const options = customHarness.getLastCreateQueryInput()!.options;

        yield* adapter.sendTurn({
          threadId: THREAD_ID,
          input: "use the built-in model",
          modelSelection: createModelSelection(
            ProviderInstanceId.make("claudeAgent"),
            SYNTHETIC_CLAUDE_CAPABLE_MODEL,
            [{ id: "contextWindow", value: "expanded" }],
          ),
          attachments: [],
        });
        yield* Effect.promise(() => readFirstPromptText(customHarness.getLastCreateQueryInput()));
        yield* adapter.sendTurn({
          threadId: THREAD_ID,
          input: "keep this prompt literal",
          modelSelection: createModelSelection(
            ProviderInstanceId.make("claudeAgent"),
            SYNTHETIC_CLAUDE_COLLIDING_ALIAS,
            [{ id: "effort", value: "ultrathink" }],
          ),
          attachments: [],
        });
        const prompt = yield* Effect.promise(() =>
          readFirstPromptText(customHarness.getLastCreateQueryInput()),
        );
        return { options, prompt };
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(customHarness.layer),
      );

      return Effect.gen(function* () {
        const { options: customOptions, prompt: customPrompt } = yield* runCustomFlow;
        assert.equal(customOptions.model, SYNTHETIC_CLAUDE_COLLIDING_ALIAS);
        assert.equal(customOptions.effort, undefined);
        assert.deepEqual(customOptions.settings, { showThinkingSummaries: true });
        assert.deepEqual(customHarness.query.setModelCalls, [
          `${SYNTHETIC_CLAUDE_CAPABLE_MODEL}[expanded]`,
          SYNTHETIC_CLAUDE_COLLIDING_ALIAS,
        ]);
        assert.equal(customPrompt, "keep this prompt literal");

        const builtInOptions = yield* start(builtInHarness, SYNTHETIC_CLAUDE_CAPABLE_MODEL);
        assert.equal(builtInOptions.model, `${SYNTHETIC_CLAUDE_CAPABLE_MODEL}[expanded]`);
        assert.equal(builtInOptions.effort, "max");
        assert.deepEqual(builtInOptions.settings, {
          showThinkingSummaries: true,
          fastMode: true,
        });
      });
    },
  );

  it.effect("treats ultrathink as a prompt keyword instead of a session effort", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          SYNTHETIC_CLAUDE_STANDARD_MODEL,
          [{ id: "effort", value: "ultrathink" }],
        ),
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "Investigate the edge cases",
        attachments: [],
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          SYNTHETIC_CLAUDE_STANDARD_MODEL,
          [{ id: "effort", value: "ultrathink" }],
        ),
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.equal(createInput?.options.effort, "high");
      const promptText = yield* Effect.promise(() => readFirstPromptText(createInput));
      assert.equal(promptText, "Ultrathink:\nInvestigate the edge cases");
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("keeps compact commands intact when ultrathink is selected", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const modelSelection = createModelSelection(
        ProviderInstanceId.make("claudeAgent"),
        SYNTHETIC_CLAUDE_STANDARD_MODEL,
        [{ id: "effort", value: "ultrathink" }],
      );
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        modelSelection,
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "/compact",
        attachments: [],
        modelSelection,
      });

      const promptText = yield* Effect.promise(() =>
        readFirstPromptText(harness.getLastCreateQueryInput()),
      );
      assert.equal(promptText, "/compact");
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  // A picture that cannot be read fails the send before any turn opens: no
  // turn is left working, and the person reads it plainly.
  it.effect("fails a send whose picture cannot be read before opening its turn", () => {
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "claude-attachments-"));
    const harness = makeHarness({ cwd: "/tmp/project-claude-attachments", baseDir });
    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true })),
      );
      const adapter = yield* ClaudeAdapter;
      const started: Array<string> = [];
      const observer = yield* adapter.streamEvents.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.type === "turn.started") started.push(event.turnId ?? "");
          }),
        ),
        Effect.forkChild,
      );
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      const error = yield* adapter
        .sendTurn({
          threadId: session.threadId,
          input: "What's in this image?",
          attachments: [
            {
              type: "image" as const,
              id: "thread-claude-attachment-12345678-1234-1234-1234-123456789abd",
              name: "gone.png",
              mimeType: "image/png",
              sizeBytes: 4,
            },
          ],
        })
        .pipe(Effect.flip);
      for (let tick = 0; tick < 20; tick += 1) yield* Effect.yieldNow;
      assert.equal(error._tag, "ProviderAdapterRequestError");
      assert.equal(
        "detail" in error ? error.detail : undefined,
        "A picture you attached could not be read. Attach it again and send.",
      );
      assert.deepEqual(started, []);
      assert.isUndefined((yield* adapter.listSessions())[0]?.activeTurnId);
      yield* Fiber.interrupt(observer);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("embeds image attachments in Claude user messages", () => {
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "claude-attachments-"));
    const harness = makeHarness({
      cwd: "/tmp/project-claude-attachments",
      baseDir,
    });
    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() =>
          NodeFS.rmSync(baseDir, {
            recursive: true,
            force: true,
          }),
        ),
      );

      const adapter = yield* ClaudeAdapter;
      const { attachmentsDir } = yield* ServerConfig;

      const attachment = {
        type: "image" as const,
        id: "thread-claude-attachment-12345678-1234-1234-1234-123456789abc",
        name: "diagram.png",
        mimeType: "image/png",
        sizeBytes: 4,
      };
      const attachmentPath = NodePath.join(attachmentsDir, attachmentRelativePath(attachment)!);
      NodeFS.mkdirSync(NodePath.dirname(attachmentPath), { recursive: true });
      NodeFS.writeFileSync(attachmentPath, Uint8Array.from([1, 2, 3, 4]));

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "What's in this image?",
        attachments: [attachment],
      });

      const createInput = harness.getLastCreateQueryInput();
      const promptMessage = yield* Effect.promise(() => readFirstPromptMessage(createInput));
      assert.isDefined(promptMessage);
      assert.deepEqual(promptMessage?.message.content, [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "AQIDBA==",
          },
        },
        {
          type: "text",
          text: "What's in this image?",
        },
      ]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  // Pictures the composer placed in the text go right after their labels; a
  // command, or a message with nothing after its last picture, keeps the
  // images-first layout so its final text block stays last.
  it.effect.each([
    {
      name: "each picture right after its label, the words between as text",
      input:
        "The header feels off:\n[Picture 1]\nNotes on picture 1:\n1. Bigger logo\nAnd the phone:\n[Picture 2]\nFix both",
      content: [
        { type: "text", text: "The header feels off:\n[Picture 1]" },
        "first",
        { type: "text", text: "Notes on picture 1:\n1. Bigger logo\nAnd the phone:\n[Picture 2]" },
        "second",
        { type: "text", text: "Fix both" },
      ],
    },
    {
      name: "a slash command keeps its text last",
      input: "/review\n[Picture 1]\n[Picture 2]\nthis",
      content: [
        "first",
        "second",
        { type: "text", text: "/review\n[Picture 1]\n[Picture 2]\nthis" },
      ],
    },
    {
      name: "a message ending on a picture keeps its text last",
      input: "See:\n[Picture 1]\n[Picture 2]",
      content: ["first", "second", { type: "text", text: "See:\n[Picture 1]\n[Picture 2]" }],
    },
    {
      name: "words after the last picture that start with a slash stay last, not a command",
      input: "[Picture 1]\n[Picture 2]\n/etc/hosts is wrong",
      content: [
        "first",
        "second",
        { type: "text", text: "[Picture 1]\n[Picture 2]\n/etc/hosts is wrong" },
      ],
    },
  ])("interleaves pictures: $name", ({ input, content }) => {
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "claude-pictures-"));
    const harness = makeHarness({ cwd: "/tmp/project-claude-pictures", baseDir });
    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true })),
      );
      const adapter = yield* ClaudeAdapter;
      const { attachmentsDir } = yield* ServerConfig;
      const pictures = [
        { key: "first", id: "thread-claude-picture-42345678-1234-1234-1234-123456789abc", byte: 1 },
        {
          key: "second",
          id: "thread-claude-picture-52345678-1234-1234-1234-123456789abc",
          byte: 2,
        },
      ].map(({ key, id, byte }) => {
        const attachment = {
          type: "image" as const,
          id,
          name: `${key}.png`,
          mimeType: "image/png",
          sizeBytes: 1,
        };
        const attachmentPath = NodePath.join(attachmentsDir, attachmentRelativePath(attachment)!);
        NodeFS.mkdirSync(NodePath.dirname(attachmentPath), { recursive: true });
        NodeFS.writeFileSync(attachmentPath, Uint8Array.from([byte]));
        return { key, attachment, data: Buffer.from([byte]).toString("base64") };
      });
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input,
        attachments: pictures.map((picture) => picture.attachment),
      });
      const promptMessage = yield* Effect.promise(() =>
        readFirstPromptMessage(harness.getLastCreateQueryInput()),
      );
      assert.deepEqual(
        promptMessage?.message.content,
        content.map((part) => {
          if (typeof part !== "string") return { type: "text" as const, text: part.text };
          const picture = pictures.find((entry) => entry.key === part)!;
          return {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: "image/png" as const,
              data: picture.data,
            },
          };
        }),
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  // The Claude CLI reads a streamed user message as a slash-command invocation
  // only when the final content block is text. Leading with the text block sent
  // every image-carrying turn down the plain-prompt path, so `/skill args`
  // reached the agent unexpanded with no error anywhere.
  it.effect("puts the command text last so attachments do not suppress expansion", () => {
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "claude-attachments-"));
    const harness = makeHarness({
      cwd: "/tmp/project-claude-command-attachments",
      baseDir,
    });
    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() =>
          NodeFS.rmSync(baseDir, {
            recursive: true,
            force: true,
          }),
        ),
      );

      const adapter = yield* ClaudeAdapter;
      const { attachmentsDir } = yield* ServerConfig;

      const imageAttachment = {
        type: "image" as const,
        id: "thread-claude-attachment-22345678-1234-1234-1234-123456789abc",
        name: "screenshot.png",
        mimeType: "image/png",
        sizeBytes: 4,
      };
      const fileAttachment = {
        type: "file" as const,
        id: "thread-claude-attachment-32345678-1234-1234-1234-123456789abc",
        name: "notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4,
      };
      for (const attachment of [imageAttachment, fileAttachment]) {
        const attachmentPath = NodePath.join(attachmentsDir, attachmentRelativePath(attachment)!);
        NodeFS.mkdirSync(NodePath.dirname(attachmentPath), { recursive: true });
        NodeFS.writeFileSync(attachmentPath, Uint8Array.from([1, 2, 3, 4]));
      }

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "/flow-patterns hello",
        attachments: [],
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "/flow-patterns hello",
        attachments: [imageAttachment],
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "/flow-patterns hello",
        attachments: [fileAttachment],
      });

      const prompts = yield* Effect.promise(() =>
        readPromptMessages(harness.getLastCreateQueryInput(), 3),
      );
      const commandBlock = {
        type: "text" as const,
        text: "/flow-patterns hello",
      };

      assert.deepEqual(prompts[0]?.message.content, [commandBlock]);
      assert.deepEqual(prompts[1]?.message.content, [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "AQIDBA==",
          },
        },
        commandBlock,
      ]);
      // Non-image attachments never become content blocks. Claude reaches them
      // through the path line ProviderService writes into the prompt, so the
      // text block stays last on its own.
      assert.deepEqual(prompts[2]?.message.content, [commandBlock]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("dispatches a $skill mention as a trailing slash command block", () => {
    // Claude Code only runs `/name` from the message's last text block, so a
    // chip picked mid-prompt is moved there and the surrounding prose kept.
    const homeDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "claude-skills-home-"));
    NodeFS.mkdirSync(NodePath.join(homeDir, "skills", "implement"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(homeDir, "skills", "implement", "SKILL.md"),
      "---\ndescription: Implement the tickets.\n---\n# Body\n",
    );
    const harness = makeHarness({ claudeConfig: { homePath: homeDir } });
    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(homeDir, { recursive: true, force: true })),
      );
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "ok, now $implement all the tickets\nstart with auth",
        attachments: [],
      });

      const promptMessage = yield* Effect.promise(() =>
        readFirstPromptMessage(harness.getLastCreateQueryInput()),
      );
      assert.deepEqual(promptMessage?.message.content, [
        { type: "text", text: "ok, now" },
        { type: "text", text: "/implement all the tickets\nstart with auth" },
      ]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("keeps the skill command block after image attachments", () => {
    // A command block followed by an image is not expanded by the CLI; the
    // image must come first.
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "claude-skill-image-"));
    const homeDir = NodePath.join(baseDir, "claude-home");
    NodeFS.mkdirSync(NodePath.join(homeDir, "skills", "review"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(homeDir, "skills", "review", "SKILL.md"),
      "---\ndescription: Review.\n---\n# Body\n",
    );
    const harness = makeHarness({ baseDir, claudeConfig: { homePath: homeDir } });
    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true })),
      );
      const adapter = yield* ClaudeAdapter;
      const { attachmentsDir } = yield* ServerConfig;
      const attachment = {
        type: "image" as const,
        id: "thread-claude-attachment-12345678-1234-1234-1234-123456789abc",
        name: "diagram.png",
        mimeType: "image/png",
        sizeBytes: 4,
      };
      const attachmentPath = NodePath.join(attachmentsDir, attachmentRelativePath(attachment)!);
      NodeFS.mkdirSync(NodePath.dirname(attachmentPath), { recursive: true });
      NodeFS.writeFileSync(attachmentPath, Uint8Array.from([1, 2, 3, 4]));

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "$review this screenshot",
        attachments: [attachment],
      });

      const promptMessage = yield* Effect.promise(() =>
        readFirstPromptMessage(harness.getLastCreateQueryInput()),
      );
      assert.isDefined(promptMessage);
      const blocks = promptMessage.message.content as Array<{ type: string; text?: string }>;
      assert.deepEqual(
        blocks.map((block) => (block.type === "text" ? block.text : block.type)),
        ["image", "/review this screenshot"],
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("leaves a $ mention of an unknown or disabled skill as prose", () => {
    const homeDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "claude-skills-off-"));
    NodeFS.mkdirSync(NodePath.join(homeDir, "skills", "deploy"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(homeDir, "skills", "deploy", "SKILL.md"),
      "---\ndescription: Deploy.\n---\n# Body\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(homeDir, "settings.json"),
      JSON.stringify({ skillOverrides: { deploy: "off" } }),
    );
    const harness = makeHarness({ claudeConfig: { homePath: homeDir } });
    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(homeDir, { recursive: true, force: true })),
      );
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "run $deploy and echo $HOME",
        attachments: [],
      });

      const promptText = yield* Effect.promise(() =>
        readFirstPromptText(harness.getLastCreateQueryInput()),
      );
      assert.equal(promptText, "run $deploy and echo $HOME");
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("maps Claude stream/runtime messages to canonical provider runtime events", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 10).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: SYNTHETIC_CLAUDE_STANDARD_MODEL,
        },
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-1",
        uuid: "stream-0",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "text",
            text: "",
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-1",
        uuid: "stream-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "text_delta",
            text: "Hi",
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-1",
        uuid: "stream-2",
        parent_tool_use_id: null,
        event: {
          type: "content_block_stop",
          index: 0,
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-1",
        uuid: "stream-3",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: {
              command: "ls",
            },
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-1",
        uuid: "stream-4",
        parent_tool_use_id: null,
        event: {
          type: "content_block_stop",
          index: 1,
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-1",
        uuid: "assistant-1",
        parent_tool_use_id: null,
        message: {
          id: "assistant-message-1",
          content: [{ type: "text", text: "Hi" }],
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-1",
        uuid: "result-1",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "thread.started",
          "content.delta",
          "item.completed",
          "item.started",
          "item.completed",
          "turn.completed",
        ],
      );

      const turnStarted = runtimeEvents[3];
      assert.equal(turnStarted?.type, "turn.started");
      if (turnStarted?.type === "turn.started") {
        assert.equal(String(turnStarted.turnId), String(turn.turnId));
      }

      const deltaEvent = runtimeEvents.find((event) => event.type === "content.delta");
      assert.equal(deltaEvent?.type, "content.delta");
      if (deltaEvent?.type === "content.delta") {
        assert.equal(deltaEvent.payload.delta, "Hi");
        assert.equal(String(deltaEvent.turnId), String(turn.turnId));
      }

      const toolStarted = runtimeEvents.find((event) => event.type === "item.started");
      assert.equal(toolStarted?.type, "item.started");
      if (toolStarted?.type === "item.started") {
        assert.equal(toolStarted.payload.itemType, "command_execution");
      }

      const assistantCompletedIndex = runtimeEvents.findIndex(
        (event) =>
          event.type === "item.completed" && event.payload.itemType === "assistant_message",
      );
      const toolStartedIndex = runtimeEvents.findIndex((event) => event.type === "item.started");
      assert.equal(
        assistantCompletedIndex >= 0 &&
          toolStartedIndex >= 0 &&
          assistantCompletedIndex < toolStartedIndex,
        true,
      );

      const turnCompleted = runtimeEvents[runtimeEvents.length - 1];
      assert.equal(turnCompleted?.type, "turn.completed");
      if (turnCompleted?.type === "turn.completed") {
        assert.equal(String(turnCompleted.turnId), String(turn.turnId));
        assert.equal(turnCompleted.payload.state, "completed");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("places overage-included rate-limit events on the bucket the probe named", () => {
    const scopedLimitNames = Ref.makeUnsafe<ClaudeScopedLimitNames>({ overageIncluded: undefined });
    const harness = makeHarness({ scopedLimitNames });
    const rateLimitEvent = (utilization: number): SDKMessage =>
      ({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed",
          rateLimitType: "seven_day_overage_included",
          utilization,
        },
        uuid: `rate-limit-${utilization}`,
        session_id: "sdk-session-1",
      }) as unknown as SDKMessage;
    const resultMessage = (uuid: string): SDKMessage =>
      ({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        num_turns: 1,
        session_id: "sdk-session-1",
        uuid,
      }) as unknown as SDKMessage;
    const limitsUpdates = (events: Iterable<ProviderRuntimeEvent>) =>
      Array.from(events).flatMap((event) =>
        event.type === "account.rate-limits.updated" ? [event.payload.limits] : [],
      );
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      // Before any probe names the bucket the event has nowhere to land.
      // Collecting through the turn's completion proves the SDK message was
      // handled, not merely still queued.
      const firstTurnFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.sendTurn({ threadId: session.threadId, input: "hello", attachments: [] });
      harness.query.emit(rateLimitEvent(0.2));
      harness.query.emit(resultMessage("result-1"));
      assert.deepStrictEqual(limitsUpdates(yield* Fiber.join(firstTurnFiber)), []);

      // The status probe reads `get_usage` and records the model it saw.
      yield* Ref.set(scopedLimitNames, { overageIncluded: "Fable" });
      const secondTurnFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.sendTurn({ threadId: session.threadId, input: "again", attachments: [] });
      harness.query.emit(rateLimitEvent(0.4));
      harness.query.emit(resultMessage("result-2"));
      assert.deepStrictEqual(limitsUpdates(yield* Fiber.join(secondTurnFiber)), [
        {
          windows: [
            {
              id: "seven_day_fable",
              kind: "weekly",
              label: "Weekly · Fable",
              usedPercent: 40,
              windowDurationMins: 10_080,
            },
          ],
        },
      ]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("does not emit turn.completed for a result with no active turn", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      // Collect through session.exited so the window after the second result
      // is deterministically inside the collection: both results are queued
      // after sendTurn returns and drain in order on the one stream consumer.
      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "session.exited"),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        num_turns: 1,
        session_id: "sdk-session-1",
        uuid: "result-real",
      } as unknown as SDKMessage);

      // Second result with no turn in flight — the shape the resume
      // handshake (system/init + result(num_turns: 0)) delivers, and the
      // same completeTurn branch every no-turnState result lands in. This
      // used to emit an untargeted turn.completed; it must emit nothing.
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        num_turns: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
        session_id: "sdk-session-1",
        uuid: "result-handshake",
      } as unknown as SDKMessage);

      harness.query.finish();

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const completions = runtimeEvents.filter((event) => event.type === "turn.completed");
      // Exactly one completion — the real turn's, targeted at its turn id.
      // The buggy branch produced a second, untargeted one here.
      assert.equal(completions.length, 1);
      const completed = completions[0];
      if (completed?.type === "turn.completed") {
        assert.equal(String(completed.turnId), String(turn.turnId));
        assert.equal(completed.payload.state, "completed");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("steers a running turn instead of opening a new one on mid-turn sendTurn", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.takeUntil(
        adapter.streamEvents,
        (event) => event.type === "turn.completed",
      ).pipe(Stream.runCollect, Effect.forkChild);

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "run 5 commands",
        attachments: [],
      });

      // Steer: a second sendTurn while the turn is still running continues
      // the same turn — the message is queued into the live agent loop.
      const steeredTurn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "actually run 15",
        attachments: [],
      });
      assert.equal(String(steeredTurn.turnId), String(turn.turnId));

      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-steer",
        uuid: "assistant-steer-1",
        parent_tool_use_id: null,
        message: {
          id: "assistant-message-steer-1",
          content: [{ type: "text", text: "Adjusting to 15." }],
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-steer",
        uuid: "result-steer-1",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const turnStartedEvents = runtimeEvents.filter((event) => event.type === "turn.started");
      const turnCompletedEvents = runtimeEvents.filter((event) => event.type === "turn.completed");

      // One turn boundary for the whole run: the steer produced no
      // turn.completed/turn.started pair.
      assert.equal(turnStartedEvents.length, 1);
      assert.equal(String(turnStartedEvents[0]?.turnId), String(turn.turnId));
      assert.equal(turnCompletedEvents.length, 1);
      assert.equal(String(turnCompletedEvents[0]?.turnId), String(turn.turnId));
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("maps Claude reasoning deltas, streamed tool inputs, and tool results", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 11).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-tool-streams",
        uuid: "stream-thinking",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "thinking_delta",
            thinking: "Let",
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-tool-streams",
        uuid: "stream-tool-start",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "tool-grep-1",
            name: "Grep",
            input: {},
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-tool-streams",
        uuid: "stream-tool-input-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 1,
          delta: {
            type: "input_json_delta",
            partial_json: '{"pattern":"foo","path":"src"}',
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-tool-streams",
        uuid: "stream-tool-stop",
        parent_tool_use_id: null,
        event: {
          type: "content_block_stop",
          index: 1,
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "user",
        session_id: "sdk-session-tool-streams",
        uuid: "user-tool-result",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-grep-1",
              content: "src/example.ts:1:foo",
            },
          ],
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-tool-streams",
        uuid: "result-tool-streams",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "thread.started",
          "content.delta",
          "item.started",
          "item.updated",
          "item.updated",
          "item.completed",
          "turn.completed",
        ],
      );

      const reasoningDelta = runtimeEvents.find(
        (event) =>
          event.type === "content.delta" && event.payload.streamKind === "reasoning_summary_text",
      );
      assert.equal(reasoningDelta?.type, "content.delta");
      if (reasoningDelta?.type === "content.delta") {
        assert.equal(reasoningDelta.payload.delta, "Let");
        assert.equal(String(reasoningDelta.turnId), String(turn.turnId));
      }

      const toolStarted = runtimeEvents.find((event) => event.type === "item.started");
      assert.equal(toolStarted?.type, "item.started");
      if (toolStarted?.type === "item.started") {
        assert.equal(toolStarted.payload.itemType, "dynamic_tool_call");
      }

      const toolInputUpdated = runtimeEvents.find(
        (event) =>
          event.type === "item.updated" &&
          (event.payload.data as { input?: { pattern?: string; path?: string } } | undefined)?.input
            ?.pattern === "foo",
      );
      assert.equal(toolInputUpdated?.type, "item.updated");
      if (toolInputUpdated?.type === "item.updated") {
        assert.deepEqual(toolInputUpdated.payload.data, {
          toolName: "Grep",
          input: {
            pattern: "foo",
            path: "src",
          },
        });
      }

      const toolResultUpdated = runtimeEvents.find(
        (event) =>
          event.type === "item.updated" &&
          (event.payload.data as { result?: { tool_use_id?: string } } | undefined)?.result
            ?.tool_use_id === "tool-grep-1",
      );
      assert.equal(toolResultUpdated?.type, "item.updated");
      if (toolResultUpdated?.type === "item.updated") {
        assert.equal(
          (
            toolResultUpdated.payload.data as {
              result?: { content?: string };
            }
          ).result?.content,
          "src/example.ts:1:foo",
        );
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("backfills Claude thinking summaries from assistant snapshots", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.takeUntil(
        adapter.streamEvents,
        (event) => event.type === "turn.completed",
      ).pipe(Stream.runCollect, Effect.forkChild);

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      const thinkingSnapshot = {
        type: "assistant",
        session_id: "sdk-session-thinking-snapshot",
        uuid: "assistant-thinking-snapshot",
        parent_tool_use_id: null,
        message: {
          id: "assistant-message-thinking",
          content: [
            { type: "thinking", thinking: "Use Euclidean algorithm." },
            { type: "text", text: "The gcd is 21." },
          ],
        },
      } as unknown as SDKMessage;
      harness.query.emit(thinkingSnapshot);
      harness.query.emit(thinkingSnapshot);
      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-thinking-snapshot",
        uuid: "assistant-thinking-snapshot-2",
        parent_tool_use_id: null,
        message: {
          id: "assistant-message-thinking-2",
          content: [{ type: "thinking", thinking: "Verify the result." }],
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-thinking-snapshot",
        uuid: "result-thinking-snapshot",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const reasoningDeltas = runtimeEvents.filter(
        (event) =>
          event.type === "content.delta" && event.payload.streamKind === "reasoning_summary_text",
      );
      assert.equal(reasoningDeltas.length, 2);
      const reasoningDelta = reasoningDeltas[0];
      assert.equal(reasoningDelta?.type, "content.delta");
      if (reasoningDelta?.type === "content.delta") {
        assert.equal(reasoningDelta.payload.delta, "Use Euclidean algorithm.");
        assert.equal(String(reasoningDelta.turnId), String(turn.turnId));
      }
      assert.deepEqual(
        runtimeEvents.flatMap((event) =>
          event.type === "content.delta" ? [event.payload.delta] : [],
        ),
        ["Use Euclidean algorithm.", "The gcd is 21.", "Verify the result."],
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("classifies only streamed Read image inputs as image views", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEventsFiber = yield* Stream.takeUntil(
        adapter.streamEvents,
        (event) => event.type === "turn.completed",
      ).pipe(Stream.runCollect, Effect.forkChild);

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "inspect both files",
        attachments: [],
      });

      const imagePath = `/workspace/${"nested folder/".repeat(16)}reference image.webp`;
      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-read-image",
        uuid: "read-image-start",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool-read-image",
            name: "Read",
            input: {},
          },
        },
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-read-image",
        uuid: "read-image-input",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: encodeUnknownJsonString({ file_path: imagePath }),
          },
        },
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "user",
        session_id: "sdk-session-read-image",
        uuid: "read-image-result",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-read-image",
              content: "Image Size: 1280x720.",
            },
          ],
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-read-image",
        uuid: "read-text-start",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "tool-read-text",
            name: "Read",
            input: { file_path: "/workspace/src/index.ts" },
          },
        },
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "user",
        session_id: "sdk-session-read-image",
        uuid: "read-text-result",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-read-text",
              content: "export {};",
            },
          ],
        },
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-read-image",
        uuid: "read-image-turn-result",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const imageEvents = runtimeEvents.filter(
        (
          event,
        ): event is Extract<
          ProviderRuntimeEvent,
          { type: "item.started" | "item.updated" | "item.completed" }
        > =>
          (event.type === "item.started" ||
            event.type === "item.updated" ||
            event.type === "item.completed") &&
          String(event.itemId) === "tool-read-image",
      );
      assert.deepEqual(
        imageEvents.map((event) => [event.type, event.payload.itemType]),
        [
          ["item.started", "dynamic_tool_call"],
          ["item.updated", "image_view"],
          ["item.updated", "image_view"],
          ["item.completed", "image_view"],
        ],
      );
      for (const event of imageEvents.slice(1)) {
        assert.equal(event.payload.detail, imagePath);
        assert.equal(
          (event.payload.data as { input?: { file_path?: string } } | undefined)?.input?.file_path,
          imagePath,
        );
      }

      const textEvents = runtimeEvents.filter(
        (
          event,
        ): event is Extract<
          ProviderRuntimeEvent,
          { type: "item.started" | "item.updated" | "item.completed" }
        > =>
          (event.type === "item.started" ||
            event.type === "item.updated" ||
            event.type === "item.completed") &&
          String(event.itemId) === "tool-read-text",
      );
      assert.deepEqual(
        textEvents.map((event) => event.payload.itemType),
        ["dynamic_tool_call", "dynamic_tool_call", "dynamic_tool_call"],
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("falls back to a default plan step label for blank TodoWrite content", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 10).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-todo-plan",
        uuid: "stream-todo-start",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "tool-todo-1",
            name: "TodoWrite",
            input: {},
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-todo-plan",
        uuid: "stream-todo-input",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 1,
          delta: {
            type: "input_json_delta",
            partial_json:
              '{"todos":[{"content":"   ","status":"in_progress"},{"content":"Ship it","status":"completed"}]}',
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-todo-plan",
        uuid: "stream-todo-stop",
        parent_tool_use_id: null,
        event: {
          type: "content_block_stop",
          index: 1,
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-todo-plan",
        uuid: "result-todo-plan",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const planUpdated = runtimeEvents.find((event) => event.type === "turn.plan.updated");
      assert.equal(planUpdated?.type, "turn.plan.updated");
      if (planUpdated?.type === "turn.plan.updated") {
        assert.equal(String(planUpdated.turnId), String(turn.turnId));
        assert.deepEqual(planUpdated.payload.plan, [
          { step: "Task", status: "inProgress" },
          { step: "Ship it", status: "completed" },
        ]);
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("classifies Claude Task tool invocations as collaboration agent work", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 8).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "delegate this",
        attachments: [],
      });

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-task",
        uuid: "stream-task-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool-task-1",
            name: "Task",
            input: {
              description: "Review the database layer",
              prompt: "Audit the SQL changes",
              subagent_type: "code-reviewer",
            },
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-task",
        uuid: "assistant-task-1",
        parent_tool_use_id: null,
        message: {
          id: "assistant-message-task-1",
          content: [{ type: "text", text: "Delegated" }],
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-task",
        uuid: "result-task-1",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const toolStarted = runtimeEvents.find((event) => event.type === "item.started");
      assert.equal(toolStarted?.type, "item.started");
      if (toolStarted?.type === "item.started") {
        assert.equal(toolStarted.payload.itemType, "collab_agent_tool_call");
        assert.equal(toolStarted.payload.title, "Subagent task");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  // Block indexes count per response, and a helper's response streams
  // beside its parent's: a helper's call at the same index as the parent's
  // Task call must not take its place, or one result never closes its call.
  it.effect("keeps a parent's call and a helper's call at the same block index apart", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: session.threadId, input: "delegate", attachments: [] });
      const toolStart = (
        uuid: string,
        parent: string | null,
        id: string,
        name: string,
        input: Record<string, unknown>,
      ) =>
        ({
          type: "stream_event",
          session_id: "sdk-session-index",
          uuid,
          parent_tool_use_id: parent,
          event: {
            type: "content_block_start",
            index: 1,
            content_block: { type: "tool_use", id, name, input },
          },
        }) as unknown as SDKMessage;
      const toolResult = (uuid: string, parent: string | null, id: string, content: string) =>
        ({
          type: "user",
          session_id: "sdk-session-index",
          uuid,
          parent_tool_use_id: parent,
          message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] },
        }) as unknown as SDKMessage;
      harness.query.emit(
        toolStart("stream-parent", null, "tool-task-p", "Task", {
          description: "Check the schema",
          prompt: "Check the schema",
          subagent_type: "general-purpose",
        }),
      );
      harness.query.emit(
        toolStart("stream-helper", "tool-task-p", "tool-read-h", "Read", {
          file_path: "/srv/app/schema.sql",
        }),
      );
      harness.query.emit(toolResult("user-helper", "tool-task-p", "tool-read-h", "create table"));
      harness.query.emit(toolResult("user-parent", null, "tool-task-p", "The schema is fine"));
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-index",
        uuid: "result-index",
      } as unknown as SDKMessage);

      const events = Array.from(yield* Fiber.join(eventsFiber));
      const completed = events.flatMap((event) =>
        event.type === "item.completed" && event.itemId !== undefined ? [String(event.itemId)] : [],
      );
      assert.deepStrictEqual(
        completed.filter((id) => id === "tool-task-p" || id === "tool-read-h"),
        ["tool-read-h", "tool-task-p"],
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  // A helper's own work reaches the thread as its steps: the SDK forwards a
  // helper's calls only in its snapshots (no stream events), each tagged with
  // the launching Agent call as its parent.
  describe("a helper's steps", () => {
    const SESSION = "sdk-session-helper-steps";
    const launch = (id: string, input: Record<string, unknown>) =>
      ({
        type: "stream_event",
        session_id: SESSION,
        uuid: `launch-${id}`,
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id, name: "Agent", input },
        },
      }) as unknown as SDKMessage;
    const started = (
      taskId: string,
      toolUseId: string,
      taskType: string,
      extra: Record<string, unknown> = {},
    ) =>
      ({
        type: "system",
        subtype: "task_started",
        task_id: taskId,
        tool_use_id: toolUseId,
        description: `Task ${taskId}`,
        task_type: taskType,
        uuid: `started-${taskId}`,
        session_id: SESSION,
        ...extra,
      }) as unknown as SDKMessage;
    const helperCalls = (
      parent: string,
      calls: ReadonlyArray<{ id: string; name: string; input: Record<string, unknown> }>,
    ) =>
      ({
        type: "assistant",
        parent_tool_use_id: parent,
        message: {
          model: SYNTHETIC_SUBAGENT_MODEL,
          content: calls.map((call) => ({ type: "tool_use", ...call })),
        },
        uuid: `snapshot-${calls.map((call) => call.id).join("-")}`,
        session_id: SESSION,
      }) as unknown as SDKMessage;
    const returned = (parent: string | null, id: string, content: string) =>
      ({
        type: "user",
        session_id: SESSION,
        uuid: `result-${id}`,
        parent_tool_use_id: parent,
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] },
      }) as unknown as SDKMessage;
    const notified = (taskId: string, toolUseId: string, summary: string) =>
      ({
        type: "system",
        subtype: "task_notification",
        task_id: taskId,
        tool_use_id: toolUseId,
        status: "completed",
        output_file: `/tmp/${taskId}.output`,
        summary,
        uuid: `notified-${taskId}`,
        session_id: SESSION,
      }) as unknown as SDKMessage;
    const turnEnd = {
      type: "result",
      subtype: "success",
      is_error: false,
      errors: [],
      session_id: SESSION,
      uuid: "result-helper-steps",
    } as unknown as SDKMessage;
    const PROMPT = "Read the schema and report every table without a primary key.";

    type Seen = ReadonlyArray<ProviderRuntimeEvent>;
    const callsOf = (events: Seen, type: "item.started" | "item.updated" | "item.completed") =>
      events.flatMap((event) =>
        event.type === type && event.itemId !== undefined
          ? [
              {
                id: String(event.itemId),
                agentId: event.payload.agentId ?? null,
                parent: event.payload.parentToolUseId ?? null,
              },
            ]
          : [],
      );
    const tasksOf = (events: Seen) =>
      events.flatMap((event) => (event.type === "task.started" ? [event.payload] : []));

    const cases: ReadonlyArray<{
      readonly name: string;
      readonly messages: ReadonlyArray<SDKMessage>;
      readonly check: (events: Seen) => void;
    }> = [
      {
        name: "a helper's call starts and returns as its own step",
        messages: [
          launch("toolu_agent_a", { description: "Check the schema", prompt: PROMPT }),
          started("task-a", "toolu_agent_a", "local_agent", { prompt: PROMPT }),
          helperCalls("toolu_agent_a", [
            { id: "tool-h1", name: "Bash", input: { command: "npm test" } },
          ]),
          returned("toolu_agent_a", "tool-h1", "4 passing"),
          turnEnd,
        ],
        check: (events) => {
          assert.deepStrictEqual(callsOf(events, "item.started").at(-1), {
            id: "tool-h1",
            agentId: "task-a",
            parent: "toolu_agent_a",
          });
          assert.deepStrictEqual(
            callsOf(events, "item.completed").filter((call) => call.id === "tool-h1"),
            [{ id: "tool-h1", agentId: "task-a", parent: "toolu_agent_a" }],
          );
          // Its result is in its completion: no streamed update row for a helper's call.
          assert.deepStrictEqual(
            callsOf(events, "item.updated").filter((call) => call.id === "tool-h1"),
            [],
          );
        },
      },
      // A resume starts the same task under a new launch, while the helper's
      // calls keep naming its first launch as their parent.
      {
        name: "a resumed helper's calls stay its own",
        messages: [
          launch("toolu_agent_a", { description: "Review the change", prompt: PROMPT }),
          started("task-a", "toolu_agent_a", "local_agent", { prompt: PROMPT }),
          returned(null, "toolu_agent_a", "Reviewed"),
          launch("toolu_agent_a2", { description: "Review again", prompt: PROMPT }),
          started("task-a", "toolu_agent_a2", "local_agent", { prompt: PROMPT }),
          helperCalls("toolu_agent_a", [
            { id: "tool-h2", name: "Bash", input: { command: "npm test" } },
          ]),
          returned("toolu_agent_a", "tool-h2", "4 passing"),
          turnEnd,
        ],
        check: (events) => {
          assert.deepStrictEqual(
            callsOf(events, "item.completed").filter((call) => call.id === "tool-h2"),
            [{ id: "tool-h2", agentId: "task-a", parent: "toolu_agent_a" }],
          );
        },
      },
      {
        name: "a helper starts with the prompt it was given",
        messages: [
          launch("toolu_agent_a", { description: "Check the schema", prompt: PROMPT }),
          started("task-a", "toolu_agent_a", "local_agent", { prompt: PROMPT }),
          turnEnd,
        ],
        check: (events) => {
          assert.equal(tasksOf(events)[0]?.prompt, PROMPT);
        },
      },
      {
        name: "a call a helper's stream already started is not started twice",
        messages: [
          launch("toolu_agent_a", { description: "Check the schema", prompt: PROMPT }),
          started("task-a", "toolu_agent_a", "local_agent"),
          {
            type: "stream_event",
            session_id: SESSION,
            uuid: "helper-stream-h1",
            parent_tool_use_id: "toolu_agent_a",
            event: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "tool-h1", name: "Read", input: {} },
            },
          } as unknown as SDKMessage,
          helperCalls("toolu_agent_a", [
            { id: "tool-h1", name: "Read", input: { file_path: "/srv/schema.sql" } },
          ]),
          returned("toolu_agent_a", "tool-h1", "create table"),
          turnEnd,
        ],
        check: (events) => {
          assert.equal(
            callsOf(events, "item.started").filter((call) => call.id === "tool-h1").length,
            1,
          );
        },
      },
      {
        name: "a helper's own background command is its work, not the Mate's",
        messages: [
          launch("toolu_agent_a", { description: "Check the schema", prompt: PROMPT }),
          started("task-a", "toolu_agent_a", "local_agent"),
          helperCalls("toolu_agent_a", [
            { id: "tool-h2", name: "Bash", input: { command: "npm run dev" } },
          ]),
          started("task-shell", "tool-h2", "local_bash"),
          turnEnd,
        ],
        check: (events) => {
          const shell = tasksOf(events).find((task) => task.taskId === "task-shell");
          assert.equal(shell?.agentId, "task-a");
        },
      },
      {
        name: "a helper's helper names the helper that started it",
        messages: [
          launch("toolu_agent_a", { description: "Check the schema", prompt: PROMPT }),
          started("task-a", "toolu_agent_a", "local_agent"),
          helperCalls("toolu_agent_a", [
            { id: "toolu_agent_b", name: "Agent", input: { description: "Read the logs" } },
          ]),
          started("task-b", "toolu_agent_b", "local_agent"),
          helperCalls("toolu_agent_b", [
            { id: "tool-b1", name: "Read", input: { file_path: "/var/log/app.log" } },
          ]),
          turnEnd,
        ],
        check: (events) => {
          assert.equal(tasksOf(events).find((task) => task.taskId === "task-b")?.agentId, "task-a");
          assert.deepStrictEqual(
            callsOf(events, "item.started").find((call) => call.id === "tool-b1"),
            { id: "tool-b1", agentId: "task-b", parent: "toolu_agent_b" },
          );
        },
      },
      {
        name: "the Mate's turn ending leaves a working helper's call open; the helper's end closes it",
        messages: [
          launch("toolu_agent_a", { description: "Check the schema", prompt: PROMPT }),
          started("task-a", "toolu_agent_a", "local_agent"),
          returned(null, "toolu_agent_a", "Async agent launched successfully."),
          helperCalls("toolu_agent_a", [
            { id: "tool-h3", name: "Bash", input: { command: "sleep 600" } },
          ]),
          turnEnd,
          notified("task-a", "toolu_agent_a", "Every table has a primary key."),
        ],
        check: (events) => {
          const closes = events.flatMap((event) =>
            event.type === "item.completed" && String(event.itemId) === "tool-h3" ? [event] : [],
          );
          assert.equal(closes.length, 1);
          const close = closes[0]!;
          assert.equal(close.payload.agentId, "task-a");
          const turnEndAt = events.findIndex((event) => event.type === "turn.completed");
          assert.ok(events.indexOf(close) > turnEndAt);
        },
      },
      {
        name: "a helper's call before its helper is known is still a helper's, never the Mate's",
        messages: [
          launch("toolu_agent_a", { description: "Check the schema", prompt: PROMPT }),
          helperCalls("toolu_agent_a", [
            { id: "tool-early", name: "Bash", input: { command: "npm test" } },
          ]),
          started("task-a", "toolu_agent_a", "local_agent"),
          returned(null, "toolu_agent_a", "Async agent launched successfully."),
          turnEnd,
          returned("toolu_agent_a", "tool-early", "4 passing"),
        ],
        check: (events) => {
          // Tagged with its launch until the helper is known by its task.
          assert.deepStrictEqual(
            callsOf(events, "item.started").find((call) => call.id === "tool-early"),
            { id: "tool-early", agentId: "toolu_agent_a", parent: "toolu_agent_a" },
          );
          assert.deepStrictEqual(
            callsOf(events, "item.updated").filter((call) => call.id === "tool-early"),
            [],
          );
          // Its result completes it, after the Mate's turn ended: never closed as unreturned.
          const closes = events.flatMap((event) =>
            event.type === "item.completed" && String(event.itemId) === "tool-early" ? [event] : [],
          );
          assert.equal(closes.length, 1);
          assert.equal(closes[0]?.payload.unreturned, undefined);
        },
      },
      {
        name: "a helper's helper launched before its parent is known names the parent's task",
        messages: [
          launch("toolu_agent_a", { description: "Check the schema", prompt: PROMPT }),
          helperCalls("toolu_agent_a", [
            { id: "toolu_agent_b", name: "Agent", input: { description: "Read the logs" } },
          ]),
          started("task-a", "toolu_agent_a", "local_agent"),
          started("task-b", "toolu_agent_b", "local_agent"),
          turnEnd,
        ],
        check: (events) => {
          assert.equal(tasksOf(events).find((task) => task.taskId === "task-b")?.agentId, "task-a");
        },
      },
      {
        name: "a helper's own task list is never the Mate's plan",
        messages: [
          launch("toolu_agent_a", { description: "Check the schema", prompt: PROMPT }),
          started("task-a", "toolu_agent_a", "local_agent"),
          helperCalls("toolu_agent_a", [
            { id: "tool-task", name: "TaskCreate", input: { subject: "Read the schema" } },
          ]),
          {
            ...(returned("toolu_agent_a", "tool-task", "Task #1 created") as object),
            tool_use_result: { task: { id: "1", subject: "Read the schema" } },
          } as unknown as SDKMessage,
          turnEnd,
        ],
        check: (events) => {
          assert.equal(events.filter((event) => event.type === "turn.plan.updated").length, 0);
        },
      },
      {
        name: "a helper's end by a status patch closes its calls",
        messages: [
          launch("toolu_agent_a", { description: "Check the schema", prompt: PROMPT }),
          started("task-a", "toolu_agent_a", "local_agent"),
          helperCalls("toolu_agent_a", [
            { id: "tool-h4", name: "Bash", input: { command: "sleep 600" } },
          ]),
          {
            type: "system",
            subtype: "task_updated",
            task_id: "task-a",
            patch: { status: "killed", end_time: 1_791_098_296_585 },
            uuid: "patched-task-a",
            session_id: SESSION,
          } as unknown as SDKMessage,
        ],
        check: (events) => {
          const close = events.find(
            (event) => event.type === "item.completed" && String(event.itemId) === "tool-h4",
          );
          assert.equal(close?.type === "item.completed" ? close.payload.agentId : null, "task-a");
        },
      },
    ];

    it.effect("a stop while a helper works closes the calls it left open", () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        const beforeFiber = yield* adapter.streamEvents.pipe(
          Stream.takeUntil(
            (event) => event.type === "task.completed" && event.payload.taskId === "task-sync",
          ),
          Stream.runCollect,
          Effect.forkChild,
        );
        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("claudeAgent"),
          runtimeMode: "full-access",
        });
        yield* adapter.sendTurn({ threadId: session.threadId, input: "delegate", attachments: [] });
        for (const message of [
          launch("toolu_agent_a", { description: "Check the schema", prompt: PROMPT }),
          started("task-a", "toolu_agent_a", "local_agent"),
          returned(null, "toolu_agent_a", "Async agent launched successfully."),
          helperCalls("toolu_agent_a", [
            { id: "tool-h5", name: "Bash", input: { command: "sleep 600" } },
          ]),
          turnEnd,
          notified("task-sync", "toolu_sync", "sync"),
        ]) {
          harness.query.emit(message);
        }
        const before = Array.from(yield* Fiber.join(beforeFiber));
        // The Mate idle, its helper at work: then the session stops.
        const afterFiber = yield* adapter.streamEvents.pipe(
          Stream.takeUntil((event) => event.type === "task.completed"),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* adapter.stopSession(session.threadId);
        const events = [...before, ...Array.from(yield* Fiber.join(afterFiber))];
        const closes = events.filter(
          (event) => event.type === "item.completed" && String(event.itemId) === "tool-h5",
        );
        assert.equal(closes.length, 1);
        const close = closes[0]!;
        assert.equal(close.type === "item.completed" ? close.payload.agentId : null, "task-a");
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    });

    for (const { name, messages, check } of cases) {
      it.effect(name, () => {
        const harness = makeHarness();
        return Effect.gen(function* () {
          const adapter = yield* ClaudeAdapter;
          const eventsFiber = yield* adapter.streamEvents.pipe(
            Stream.takeUntil(
              (event) => event.type === "task.completed" && event.payload.taskId === "task-end",
            ),
            Stream.runCollect,
            Effect.forkChild,
          );
          const session = yield* adapter.startSession({
            threadId: THREAD_ID,
            provider: ProviderDriverKind.make("claudeAgent"),
            runtimeMode: "full-access",
          });
          yield* adapter.sendTurn({
            threadId: session.threadId,
            input: "delegate",
            attachments: [],
          });
          for (const message of messages) harness.query.emit(message);
          harness.query.emit(notified("task-end", "toolu_end", "end"));
          check(Array.from(yield* Fiber.join(eventsFiber)));
        }).pipe(
          Effect.provideService(Random.Random, makeDeterministicRandomService()),
          Effect.provide(harness.layer),
        );
      });
    }
  });

  // The calls of one model response are one batch: the live slot tells a
  // newer batch by the response a call was written in.
  it.effect("stamps each call with the model response it was written in", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: session.threadId, input: "look", attachments: [] });
      const stream = (uuid: string, parent: string | null, event: Record<string, unknown>) =>
        ({
          type: "stream_event",
          session_id: "sdk-session-response",
          uuid,
          parent_tool_use_id: parent,
          event,
        }) as unknown as SDKMessage;
      const toolUse = (index: number, id: string) => ({
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id, name: "Read", input: { file_path: `/srv/${id}` } },
      });
      harness.query.emit(stream("s1", null, { type: "message_start", message: { id: "msg-a" } }));
      harness.query.emit(stream("s2", null, toolUse(0, "tool-a1")));
      harness.query.emit(stream("s3", null, toolUse(1, "tool-a2")));
      // A helper's response streams between: it is no response of the Mate's.
      harness.query.emit(
        stream("s4", "tool-a2", { type: "message_start", message: { id: "msg-h" } }),
      );
      harness.query.emit(stream("s5", "tool-a2", toolUse(0, "tool-h1")));
      // The Mate's own call streamed after the helper's response began is
      // still its response's: a helper's start never names the Mate's.
      harness.query.emit(stream("s5b", null, toolUse(2, "tool-a3")));
      harness.query.emit(stream("s6", null, { type: "message_start", message: { id: "msg-b" } }));
      harness.query.emit(stream("s7", null, toolUse(0, "tool-b1")));
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-response",
        uuid: "result-response",
      } as unknown as SDKMessage);

      const events = Array.from(yield* Fiber.join(eventsFiber));
      const started = events.flatMap((event) =>
        event.type === "item.started" && event.itemId !== undefined
          ? [[String(event.itemId), event.payload.responseId ?? null] as const]
          : [],
      );
      assert.deepStrictEqual(started, [
        ["tool-a1", "msg-a"],
        ["tool-a2", "msg-a"],
        ["tool-h1", null],
        ["tool-a3", "msg-a"],
        ["tool-b1", "msg-b"],
      ]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("an MCP call presents the title and server Claude Code gives it", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: session.threadId, input: "scrape", attachments: [] });
      const toolName = "mcp__claude_ai_Firecrawl__firecrawl_scrape";
      const input = { url: "https://example.com" };
      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-mcp",
        uuid: "s1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_fc", name: toolName, input },
        },
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-mcp",
        uuid: "assistant-mcp",
        parent_tool_use_id: null,
        message: {
          id: "msg-mcp",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "tool_use", id: "toolu_fc", name: toolName, input }],
        },
        tool_use_meta: [
          {
            id: "toolu_fc",
            display_name: "Firecrawl scrape",
            server_display_name: "Firecrawl",
            icon_url: "https://firecrawl.dev/icon.png",
          },
        ],
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "user",
        session_id: "sdk-session-mcp",
        uuid: "user-mcp",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_fc", content: "# Example" }],
        },
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-mcp",
        uuid: "result-mcp",
      } as unknown as SDKMessage);

      const events = Array.from(yield* Fiber.join(eventsFiber));
      const presented = {
        title: "Firecrawl scrape",
        source: {
          key: "mcp:claude_ai_firecrawl",
          name: "Firecrawl",
          iconUrl: "https://firecrawl.dev/icon.png",
        },
      };
      const lifecycle = events.flatMap((event) =>
        (event.type === "item.started" ||
          event.type === "item.updated" ||
          event.type === "item.completed") &&
        event.itemId === "toolu_fc"
          ? [[event.type, event.payload.presentation ?? null] as const]
          : [],
      );
      // Started before Claude Code named it; every step after says it.
      assert.deepStrictEqual(lifecycle[0], ["item.started", null]);
      assert.deepStrictEqual(lifecycle.slice(1), [
        ["item.updated", presented],
        ["item.updated", presented],
        ["item.completed", presented],
      ]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  // Block indexes count per response, and a helper's response streams beside
  // the Mate's: a helper's block stop at the index of the Mate's open text
  // block must not close that block early (D9).
  it.effect("keeps the Mate's text block open through a helper's block stop at its index", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: session.threadId, input: "say", attachments: [] });
      const stream = (uuid: string, parent: string | null, event: Record<string, unknown>) =>
        ({
          type: "stream_event",
          session_id: "sdk-session-stop",
          uuid,
          parent_tool_use_id: parent,
          event,
        }) as unknown as SDKMessage;
      const text = (uuid: string, words: string) =>
        stream(uuid, null, {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: words },
        });
      harness.query.emit(
        stream("s1", null, {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        }),
      );
      harness.query.emit(text("s2", "The schema "));
      harness.query.emit(stream("s3", "tool-task-p", { type: "content_block_stop", index: 0 }));
      harness.query.emit(text("s4", "is fine."));
      harness.query.emit(stream("s5", null, { type: "content_block_stop", index: 0 }));
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-stop",
        uuid: "result-stop",
      } as unknown as SDKMessage);

      const events = Array.from(yield* Fiber.join(eventsFiber));
      const lastDelta = events.findLastIndex((event) => event.type === "content.delta");
      const firstEnd = events.findIndex(
        (event) =>
          event.type === "item.completed" && event.payload.itemType === "assistant_message",
      );
      assert.ok(lastDelta >= 0 && firstEnd > lastDelta, "the text block ends after its words");
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  // A call still open when its turn's result comes never returned: the turn's
  // end closes it as unreturned, never as a call that came back (D4).
  it.effect("closes a call left open at the turn's end as unreturned", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: session.threadId, input: "test", attachments: [] });
      const stream = (uuid: string, event: Record<string, unknown>) =>
        ({
          type: "stream_event",
          session_id: "sdk-session-sweep",
          uuid,
          parent_tool_use_id: null,
          event,
        }) as unknown as SDKMessage;
      const toolUse = (index: number, id: string) => ({
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id, name: "Bash", input: { command: "pnpm test" } },
      });
      harness.query.emit(stream("s1", { type: "message_start", message: { id: "msg-a" } }));
      harness.query.emit(stream("s2", toolUse(0, "tool-lost")));
      harness.query.emit(stream("s3", toolUse(1, "tool-back")));
      harness.query.emit({
        type: "user",
        session_id: "sdk-session-sweep",
        uuid: "user-back",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tool-back", content: "ok" }],
        },
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-sweep",
        uuid: "result-sweep",
      } as unknown as SDKMessage);

      const events = Array.from(yield* Fiber.join(eventsFiber));
      const completed = events.flatMap((event) =>
        event.type === "item.completed" && event.itemId !== undefined
          ? [[String(event.itemId), event.payload.unreturned === true] as const]
          : [],
      );
      assert.deepStrictEqual(
        completed.filter(([id]) => id === "tool-lost" || id === "tool-back"),
        [
          ["tool-back", false],
          ["tool-lost", true],
        ],
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("treats user-aborted Claude results as interrupted without a runtime error", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 6).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      harness.query.emit({
        type: "result",
        subtype: "error_during_execution",
        is_error: false,
        errors: ["Error: Request was aborted."],
        stop_reason: "tool_use",
        session_id: "sdk-session-abort",
        uuid: "result-abort",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "thread.started",
          "turn.completed",
        ],
      );

      const turnCompleted = runtimeEvents[runtimeEvents.length - 1];
      assert.equal(turnCompleted?.type, "turn.completed");
      if (turnCompleted?.type === "turn.completed") {
        assert.equal(String(turnCompleted.turnId), String(turn.turnId));
        assert.equal(turnCompleted.payload.state, "interrupted");
        assert.equal(turnCompleted.payload.errorMessage, "Error: Request was aborted.");
        assert.equal(turnCompleted.payload.stopReason, "tool_use");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("treats aborted_tools results as interrupted and hides ede_diagnostic errors", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 6).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      // Exact shape the CLI emits when Stop lands mid-tool-call: is_error
      // is true and the only error is internal diagnostic telemetry.
      harness.query.emit({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use"],
        stop_reason: "tool_use",
        terminal_reason: "aborted_tools",
        session_id: "sdk-session-abort-tools",
        uuid: "result-abort-tools",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "thread.started",
          "turn.completed",
        ],
      );

      const turnCompleted = runtimeEvents[runtimeEvents.length - 1];
      assert.equal(turnCompleted?.type, "turn.completed");
      if (turnCompleted?.type === "turn.completed") {
        assert.equal(String(turnCompleted.turnId), String(turn.turnId));
        assert.equal(turnCompleted.payload.state, "interrupted");
        assert.equal(turnCompleted.payload.errorMessage, undefined);
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("fails a turn when the result carries a give-up terminal_reason", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 7).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      // The CLI stamps subtype success with an empty error list when it
      // gives up after exhausting API retries; the terminal_reason is the
      // only structured failure signal.
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
        errors: [],
        stop_reason: null,
        terminal_reason: "api_error",
        session_id: "sdk-session-api-error",
        uuid: "result-api-error",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "thread.started",
          "runtime.error",
          "turn.completed",
        ],
      );

      const turnCompleted = runtimeEvents[runtimeEvents.length - 1];
      assert.equal(turnCompleted?.type, "turn.completed");
      if (turnCompleted?.type === "turn.completed") {
        assert.equal(String(turnCompleted.turnId), String(turn.turnId));
        assert.equal(turnCompleted.payload.state, "failed");
        assert.equal(
          turnCompleted.payload.errorMessage,
          "Claude gave up after repeated API errors.",
        );
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  const AUTH_FAILURE_ASSISTANT = {
    type: "assistant",
    session_id: "sdk-session-auth",
    uuid: "assistant-auth",
    parent_tool_use_id: null,
    error: "authentication_failed",
    is_api_error_message: true,
    message: {
      id: "assistant-message-auth",
      model: "<synthetic>",
      content: [{ type: "text", text: "Not logged in \u00b7 Please run /login" }],
    },
  } as unknown as SDKMessage;

  const completedTurn = (runtimeEvents: ReadonlyArray<ProviderRuntimeEvent>) => {
    const event = runtimeEvents[runtimeEvents.length - 1];
    assert.equal(event?.type, "turn.completed");
    assert(event?.type === "turn.completed");
    return event.payload;
  };

  it.effect.each([
    {
      name: "an api_error terminal reason",
      result: { subtype: "success", is_error: false, terminal_reason: "api_error", errors: [] },
      state: "failed",
      errorMessage: /claude auth login/,
    },
    {
      name: "an is_error success with no terminal reason",
      result: { subtype: "success", is_error: true, errors: [] },
      state: "failed",
      errorMessage: /claude auth login/,
    },
    // Every other outcome names its own cause, and the latch must not speak over it.
    {
      name: "a terminal reason of its own",
      result: {
        subtype: "success",
        is_error: false,
        terminal_reason: "prompt_too_long",
        errors: [],
      },
      state: "failed",
      errorMessage: /prompt exceeds the model's context window/,
    },
    {
      name: "a listed tool failure",
      result: {
        subtype: "error_during_execution",
        is_error: true,
        errors: ["Tool execution failed: EACCES"],
      },
      state: "failed",
      errorMessage: /EACCES/,
    },
    {
      name: "a user interrupt",
      result: {
        subtype: "error_during_execution",
        is_error: true,
        terminal_reason: "aborted_tools",
        errors: [],
      },
      state: "interrupted",
      errorMessage: undefined,
    },
    {
      name: "a cancellation",
      result: { subtype: "error_during_execution", is_error: true, errors: ["cancelled"] },
      state: "cancelled",
      errorMessage: /cancelled/,
    },
  ])(
    "reports the real cause when an expired login is followed by $name",
    ({ result, state, errorMessage }) => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;

        const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
          Stream.takeUntil((event) => event.type === "turn.completed"),
          Stream.runCollect,
          Effect.forkChild,
        );

        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("claudeAgent"),
          runtimeMode: "full-access",
        });
        yield* adapter.sendTurn({ threadId: session.threadId, input: "hello", attachments: [] });

        harness.query.emit(AUTH_FAILURE_ASSISTANT);
        harness.query.emit({
          type: "result",
          ...result,
          session_id: "sdk-session-auth",
          uuid: "result-auth",
        } as unknown as SDKMessage);

        const payload = completedTurn(Array.from(yield* Fiber.join(runtimeEventsFiber)));
        assert.equal(payload.state, state);
        if (errorMessage === undefined) {
          assert.equal(payload.errorMessage, undefined);
        } else {
          assert.match(payload.errorMessage ?? "", errorMessage);
        }
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );

  it.effect("fails a usage-limited turn with the limit it parked on", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: session.threadId, input: "hello", attachments: [] });

      const nowMs = yield* Clock.currentTimeMillis;
      harness.query.emit({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          rateLimitType: "five_hour",
          resetsAt: Math.floor(nowMs / 1000) + 2 * 60 * 60,
        },
        session_id: "sdk-session-limit",
        uuid: "rate-limit-rejected",
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        terminal_reason: "api_error",
        errors: [],
        session_id: "sdk-session-limit",
        uuid: "result-limit",
      } as unknown as SDKMessage);

      const payload = completedTurn(Array.from(yield* Fiber.join(runtimeEventsFiber)));
      assert.equal(payload.state, "failed");
      assert.equal(
        payload.errorMessage,
        "Claude usage limit reached. Send the message again once the limit resets.",
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  const usageLimitMessage =
    "Claude usage limit reached. Send the message again once the limit resets.";
  const genericApiErrorMessage = "Claude gave up after repeated API errors.";
  const rateLimitAssistant = {
    type: "assistant",
    session_id: "sdk-session-limit",
    uuid: "assistant-limit",
    parent_tool_use_id: null,
    error: "rate_limit",
    message: {
      id: "assistant-message-limit",
      model: "<synthetic>",
      content: [{ type: "text", text: "You've hit your session limit" }],
    },
  };
  const rateLimitResult = {
    type: "result",
    subtype: "success",
    is_error: true,
    terminal_reason: "api_error",
    session_id: "sdk-session-limit",
    uuid: "result-limit",
  };

  it.effect.each([
    {
      name: "an assistant-only rate limit",
      messages: [rateLimitAssistant],
      expected: usageLimitMessage,
    },
    {
      name: "a normal parent response after a rate limit",
      messages: [rateLimitAssistant, { ...rateLimitAssistant, error: undefined }],
      expected: genericApiErrorMessage,
    },
    {
      name: "a server error after a rate limit",
      messages: [rateLimitAssistant, { ...rateLimitAssistant, error: "server_error" }],
      expected: genericApiErrorMessage,
    },
    {
      name: "a subagent rate limit",
      messages: [{ ...rateLimitAssistant, parent_tool_use_id: "nested-tool" }],
      expected: genericApiErrorMessage,
    },
    {
      name: "a subagent response after a parent rate limit",
      messages: [
        rateLimitAssistant,
        { ...rateLimitAssistant, error: undefined, parent_tool_use_id: "nested-tool" },
      ],
      expected: usageLimitMessage,
    },
  ])("classifies the terminal API failure after $name", ({ messages, expected }) => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: session.threadId, input: "hello", attachments: [] });
      for (const [index, message] of messages.entries()) {
        harness.query.emit({ ...message, uuid: `assistant-${index}` } as unknown as SDKMessage);
      }
      harness.query.emit(rateLimitResult as unknown as SDKMessage);

      const events = Array.from(yield* Fiber.join(eventsFiber));
      const errors = events.filter((event) => event.type === "runtime.error");
      assert.equal(errors.length, 1);
      assert.equal(errors[0]?.payload.message, expected);
      // A usage limit is typed a pause, for the conversation to read without its words.
      assert.equal(
        errors[0]?.type === "runtime.error" ? errors[0].payload.class : undefined,
        expected === usageLimitMessage ? "usage_limit" : "provider_error",
      );
      assert.equal(completedTurn(events).state, "failed");
      assert.equal(completedTurn(events).errorMessage, expected);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("names repeated usage limits without carrying them into a later turn", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      for (const [index, expected] of [
        usageLimitMessage,
        usageLimitMessage,
        genericApiErrorMessage,
      ].entries()) {
        const eventsFiber = yield* adapter.streamEvents.pipe(
          Stream.takeUntil((event) => event.type === "turn.completed"),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* adapter.sendTurn({ threadId: session.threadId, input: "again", attachments: [] });
        if (index === 0) {
          harness.query.emit({
            type: "rate_limit_event",
            rate_limit_info: { status: "rejected", rateLimitType: "five_hour" },
            session_id: "sdk-session-limit",
            uuid: "limit-rejected",
          } as unknown as SDKMessage);
        }
        if (index < 2) {
          harness.query.emit({
            ...rateLimitAssistant,
            uuid: `assistant-limit-${index}`,
          } as unknown as SDKMessage);
        }
        harness.query.emit({
          ...rateLimitResult,
          uuid: `result-limit-${index}`,
        } as unknown as SDKMessage);
        const payload = completedTurn(Array.from(yield* Fiber.join(eventsFiber)));
        assert.equal(payload.state, "failed");
        assert.equal(payload.errorMessage, expected);
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect.each([
    {
      name: "listed error with api_error",
      evidence: "auth",
      result: {
        subtype: "error_during_execution",
        is_error: true,
        terminal_reason: "api_error",
        errors: ["Tool execution failed: EACCES"],
      },
      expected: /EACCES/,
      expectedState: "failed",
    },
    {
      name: "overload with api_error",
      evidence: "auth",
      result: {
        subtype: "success",
        is_error: true,
        terminal_reason: "api_error",
        api_error_status: 529,
        errors: [],
      },
      expected: /overloaded \(529\)/,
      expectedState: "failed",
    },
    {
      name: "listed error on an is_error success",
      evidence: "auth",
      result: {
        subtype: "success",
        is_error: true,
        errors: ["Tool execution failed: EACCES"],
      },
      expected: /EACCES/,
      expectedState: "failed",
    },
    {
      name: "recovered same window",
      evidence: "recovered",
      result: { subtype: "success", is_error: false, terminal_reason: "api_error", errors: [] },
      expected: /repeated API errors/,
      expectedState: "failed",
    },
    {
      name: "nested assistant does not poison parent",
      evidence: "nested-auth",
      result: { subtype: "success", is_error: false, terminal_reason: "api_error", errors: [] },
      expected: /repeated API errors/,
      expectedState: "failed",
    },
    {
      name: "assistant rate limit followed by overload",
      evidence: "assistant-rate-limit",
      result: {
        subtype: "success",
        is_error: true,
        terminal_reason: "api_error",
        api_error_status: 529,
        errors: [],
      },
      expected: /overloaded \(529\)/,
      expectedState: "failed",
    },
    {
      name: "assistant rate limit followed by a listed error",
      evidence: "assistant-rate-limit",
      result: {
        subtype: "success",
        is_error: true,
        terminal_reason: "api_error",
        errors: ["Tool execution failed: EACCES"],
      },
      expected: /EACCES/,
      expectedState: "failed",
    },
    {
      name: "assistant rate limit followed by an interrupt",
      evidence: "assistant-rate-limit",
      result: {
        subtype: "error_during_execution",
        is_error: true,
        terminal_reason: "aborted_tools",
        errors: [],
      },
      expected: undefined,
      expectedState: "interrupted",
    },
    ...[
      "recovered-missing-reset",
      "recovered-next-reset",
      "recovered-warning",
      "two-windows-recovered",
    ].map((evidence) => ({
      name: evidence,
      evidence,
      result: { subtype: "success", is_error: false, terminal_reason: "api_error", errors: [] },
      expected: /repeated API errors/,
      expectedState: "failed",
    })),
    ...["two-windows-one-recovered", "rejected-again"].map((evidence) => ({
      name: evidence,
      evidence,
      result: { subtype: "success", is_error: false, terminal_reason: "api_error", errors: [] },
      expected: /usage limit reached/,
      expectedState: "failed",
    })),
    {
      name: "successful turn stays successful",
      evidence: "recovered",
      result: { subtype: "success", is_error: false, errors: [] },
      expected: undefined,
      expectedState: "completed",
    },
  ])(
    "preserves terminal failure evidence after $name",
    ({ evidence, result, expected, expectedState }) => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        const eventsFiber = yield* adapter.streamEvents.pipe(
          Stream.takeUntil((event) => event.type === "turn.completed"),
          Stream.runCollect,
          Effect.forkChild,
        );
        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("claudeAgent"),
          runtimeMode: "full-access",
        });
        yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "synthetic hello",
          attachments: [],
        });
        if (evidence === "assistant-rate-limit") {
          harness.query.emit(rateLimitAssistant as unknown as SDKMessage);
        } else if (evidence === "auth" || evidence === "nested-auth") {
          harness.query.emit({
            type: "assistant",
            session_id: "sdk-audit",
            uuid: "audit-auth",
            parent_tool_use_id: evidence === "nested-auth" ? "synthetic-parent-tool" : null,
            error: "authentication_failed",
            is_api_error_message: true,
            message: {
              id: "audit-message",
              model: "synthetic-audit-model",
              content: [{ type: "text", text: "Not logged in. Please run /login" }],
            },
          } as unknown as SDKMessage);
        } else {
          const nowMs = yield* Clock.currentTimeMillis;
          const resetsAt = Math.floor(nowMs / 1000) + 7200;
          harness.query.emit({
            type: "rate_limit_event",
            rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt },
            session_id: "sdk-audit",
            uuid: "audit-limit-rejected",
          } as unknown as SDKMessage);
          if (evidence.startsWith("two-windows")) {
            harness.query.emit({
              type: "rate_limit_event",
              rate_limit_info: { status: "rejected", rateLimitType: "seven_day", resetsAt },
              session_id: "sdk-audit",
              uuid: "audit-weekly-rejected",
            } as unknown as SDKMessage);
          }
          harness.query.emit({
            type: "rate_limit_event",
            rate_limit_info: {
              status: evidence === "recovered-warning" ? "allowed_warning" : "allowed",
              rateLimitType: "five_hour",
              ...(evidence === "recovered-missing-reset"
                ? {}
                : {
                    resetsAt: evidence === "recovered-next-reset" ? resetsAt + 18000 : resetsAt,
                  }),
            },
            session_id: "sdk-audit",
            uuid: "audit-limit-allowed",
          } as unknown as SDKMessage);
          if (evidence === "two-windows-recovered" || evidence === "rejected-again") {
            harness.query.emit({
              type: "rate_limit_event",
              rate_limit_info: {
                status: evidence === "rejected-again" ? "rejected" : "allowed",
                rateLimitType: evidence === "rejected-again" ? "five_hour" : "seven_day",
                resetsAt,
              },
              session_id: "sdk-audit",
              uuid: "audit-final-quota-update",
            } as unknown as SDKMessage);
          }
        }
        harness.query.emit({
          type: "result",
          ...result,
          session_id: "sdk-audit",
          uuid: "audit-result",
        } as unknown as SDKMessage);
        const events = Array.from(yield* Fiber.join(eventsFiber));
        const complete = events.at(-1);
        assert(complete?.type === "turn.completed");
        assert.equal(complete.payload.state, expectedState);
        if (expected) assert.match(complete.payload.errorMessage ?? "", expected);
        else assert.equal(complete.payload.errorMessage, undefined);
        if (evidence === "rejected-again")
          assert.equal(events.filter((event) => event.type === "runtime.warning").length, 1);
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );

  it.effect.each([
    { homePath: "./synthetic config's $literal", inherited: undefined },
    { homePath: "", inherited: ".synthetic config's $literal" },
    { homePath: "", inherited: " /synthetic/path with edge spaces " },
  ])(
    "reports the same Claude config and cwd used by the spawned query ($homePath, $inherited)",
    ({ homePath, inherited }) => {
      const harness = makeHarness({
        claudeConfig: { homePath },
        environment: { ...process.env, CLAUDE_CONFIG_DIR: inherited },
      });
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        const eventsFiber = yield* adapter.streamEvents.pipe(
          Stream.takeUntil((event) => event.type === "turn.completed"),
          Stream.runCollect,
          Effect.forkChild,
        );
        const cwd = NodePath.resolve("/tmp/synthetic-audit-project");
        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("claudeAgent"),
          runtimeMode: "full-access",
          cwd,
        });
        yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "synthetic",
          attachments: [],
        });
        harness.query.emit(AUTH_FAILURE_ASSISTANT);
        harness.query.emit({
          type: "result",
          subtype: "success",
          is_error: false,
          terminal_reason: "api_error",
          errors: [],
          session_id: "sdk-session-auth",
          uuid: "result-auth",
        } as unknown as SDKMessage);
        const events = Array.from(yield* Fiber.join(eventsFiber));
        const completed = events.at(-1);
        assert(completed?.type === "turn.completed");
        const actualQuery = harness.getLastCreateQueryInput();
        assert(actualQuery !== undefined);
        const expectedConfigDir = homePath ? NodePath.resolve(homePath) : inherited;
        assert.equal(actualQuery.options.env?.CLAUDE_CONFIG_DIR, expectedConfigDir);
        assert.equal(actualQuery.options.cwd, cwd);
        assert(
          completed.payload.errorMessage?.includes(
            `CLAUDE_CONFIG_DIR set to ${encodeUnknownJsonString(expectedConfigDir)}`,
          ),
        );
        assert(completed.payload.errorMessage?.includes(`from ${encodeUnknownJsonString(cwd)}`));
        assert(!completed.payload.errorMessage?.includes("CLAUDE_CONFIG_DIR="));
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );

  // The API's words for a picture it cannot read ("image exceeds 5 MB
  // maximum") never said which picture was the person's, nor what to do.
  it.effect.each([
    {
      name: "a placed picture over the limits is named by its label",
      input: "The header:\n[Picture 1]\nFix it",
      errors: [
        "API Error: 400 messages.3.content.1.image.source.base64: image exceeds 5 MB maximum",
      ],
      expected: /^Claude couldn't read Picture 1 \(3210 × 2118, 4\.3 MB\)/,
    },
    {
      name: "an image no label places is named by its file",
      input: "The header",
      errors: [],
      expected: /^Claude couldn't read "shot\.png" \(3210 × 2118, 4\.3 MB\)/,
    },
  ])("names the picture an image_error is about: $name", ({ input, errors, expected }) => {
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "claude-image-error-"));
    const harness = makeHarness({ cwd: "/tmp/project-claude-image-error", baseDir });
    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true })),
      );
      const adapter = yield* ClaudeAdapter;
      const { attachmentsDir } = yield* ServerConfig;
      // A PNG header saying 3210 × 2118, weighing what the failed paste did.
      const bytes = new Uint8Array(4_500_000);
      bytes.set([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
      ]);
      new DataView(bytes.buffer).setUint32(16, 3210);
      new DataView(bytes.buffer).setUint32(20, 2118);
      const attachment = {
        type: "image" as const,
        id: "thread-claude-image-error-62345678-1234-1234-1234-123456789abc",
        name: "shot.png",
        mimeType: "image/png",
        sizeBytes: bytes.byteLength,
        width: 3210,
        height: 2118,
      };
      const attachmentPath = NodePath.join(attachmentsDir, attachmentRelativePath(attachment)!);
      NodeFS.mkdirSync(NodePath.dirname(attachmentPath), { recursive: true });
      NodeFS.writeFileSync(attachmentPath, bytes);
      const completionFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "turn.completed"),
        Stream.runHead,
        Effect.forkChild,
      );
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: session.threadId, input, attachments: [attachment] });
      harness.query.emit({
        type: "result",
        subtype: errors.length > 0 ? "error_during_execution" : "success",
        is_error: errors.length > 0,
        result: "",
        errors,
        stop_reason: null,
        terminal_reason: "image_error",
        session_id: "sdk-session-image-error",
        uuid: "result-image-error",
      } as unknown as SDKMessage);
      const completed = yield* Fiber.join(completionFiber);
      assert.equal(completed._tag, "Some");
      if (completed._tag === "Some" && completed.value.type === "turn.completed") {
        assert.equal(completed.value.payload.state, "failed");
        assert.match(completed.value.payload.errorMessage ?? "", expected);
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("fails a turn for every dead-turn terminal_reason", () => {
    const reasons = [
      "blocking_limit",
      "rapid_refill_breaker",
      "prompt_too_long",
      "image_error",
      "model_error",
      "malformed_tool_use_exhausted",
      "budget_exhausted",
      "structured_output_retry_exhausted",
      "tool_deferred_unavailable",
      "turn_setup_failed",
    ];
    // One harness per reason: the fake query settles a single turn.
    const runDeadTurn = (reason: string) => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        const completionFiber = yield* adapter.streamEvents.pipe(
          Stream.filter((event) => event.type === "turn.completed"),
          Stream.runHead,
          Effect.forkChild,
        );
        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("claudeAgent"),
          runtimeMode: "full-access",
        });
        yield* adapter.sendTurn({ threadId: session.threadId, input: "hello", attachments: [] });
        harness.query.emit({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "",
          errors: [],
          stop_reason: null,
          terminal_reason: reason,
          session_id: "sdk-session-dead-turn",
          uuid: `result-${reason}`,
        } as unknown as SDKMessage);
        const completed = yield* Fiber.join(completionFiber);
        assert.equal(completed._tag, "Some");
        if (completed._tag === "Some" && completed.value.type === "turn.completed") {
          assert.equal(completed.value.payload.state, "failed", reason);
          assert.ok(completed.value.payload.errorMessage, `${reason} carries an error message`);
        }
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    };
    return Effect.forEach(reasons, runDeadTurn, { discard: true });
  });

  it.effect.each(["success", "error_during_execution"] as const)(
    "preserves %s behavior for an unknown runtime terminal reason",
    (subtype) => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        const completionFiber = yield* adapter.streamEvents.pipe(
          Stream.filter((event) => event.type === "turn.completed"),
          Stream.runHead,
          Effect.forkChild,
        );
        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("claudeAgent"),
          runtimeMode: "full-access",
        });
        yield* adapter.sendTurn({ threadId: session.threadId, input: "hello", attachments: [] });
        // An installed CLI can send a terminal reason newer than the bundled SDK.
        harness.query.emit({
          type: "result",
          subtype,
          is_error: subtype !== "success",
          result: "",
          errors: subtype === "success" ? [] : ["Provider error detail"],
          stop_reason: null,
          terminal_reason: "future_terminal_reason",
          session_id: "sdk-session-future-reason",
          uuid: "result-future-reason",
        } as unknown as SDKMessage);
        const completed = yield* Fiber.join(completionFiber);
        assert.equal(completed._tag, "Some");
        if (completed._tag === "Some" && completed.value.type === "turn.completed") {
          assert.equal(
            completed.value.payload.state,
            subtype === "success" ? "completed" : "failed",
          );
          assert.equal(
            completed.value.payload.errorMessage,
            subtype === "success" ? undefined : "Provider error detail",
          );
        }
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );

  it.effect("fails a turn when a success result reports a 529 overload", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 7).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: true,
        api_error_status: 529,
        result: "",
        errors: [],
        stop_reason: null,
        session_id: "sdk-session-overload",
        uuid: "result-overload",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const turnCompleted = runtimeEvents[runtimeEvents.length - 1];
      assert.equal(turnCompleted?.type, "turn.completed");
      if (turnCompleted?.type === "turn.completed") {
        assert.equal(turnCompleted.payload.state, "failed");
        assert.equal(
          turnCompleted.payload.errorMessage,
          "Claude API is overloaded (529). Try again shortly.",
        );
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("interruptTurn settles live tasks and closes the provider session", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      // Wait for the three task.* runtime events to prove the lifecycle
      // handlers processed the emissions (no wall-clock sleeps under the
      // test clock).
      const taskEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type.startsWith("task.")),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "spawn agents",
        attachments: [],
      });

      harness.query.emit({
        type: "system",
        subtype: "task_started",
        task_id: "task-live",
        description: "Agent A",
        task_type: "local_agent",
        uuid: "task-live-uuid",
        session_id: "sdk-session",
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "system",
        subtype: "task_started",
        task_id: "task-settled",
        description: "Agent B",
        task_type: "local_agent",
        uuid: "task-settled-uuid",
        session_id: "sdk-session",
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "system",
        subtype: "task_notification",
        task_id: "task-settled",
        status: "completed",
        output_file: "/tmp/task-settled.jsonl",
        summary: "done",
        uuid: "task-settled-done-uuid",
        session_id: "sdk-session",
      } as unknown as SDKMessage);

      yield* Fiber.join(taskEventsFiber);

      const stoppedTaskEventFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "task.completed"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.interruptTurn(session.threadId);

      // Closing the session is the hard stop because SDK interrupt can leave
      // resumed background work alive.
      assert.equal(harness.query.closeCalls, 1);

      const sessions = yield* adapter.listSessions();
      assert.equal(sessions.length, 0);

      const stoppedTaskEvents = Array.from(yield* Fiber.join(stoppedTaskEventFiber));
      assert.equal(stoppedTaskEvents.length, 1);
      const stoppedTaskEvent = stoppedTaskEvents[0];
      assert.equal(stoppedTaskEvent?.type, "task.completed");
      if (stoppedTaskEvent?.type === "task.completed") {
        assert.equal(String(stoppedTaskEvent.payload.taskId), "task-live");
        assert.equal(stoppedTaskEvent.payload.status, "stopped");
        assert.equal(stoppedTaskEvent.payload.taskType, "local_agent");
        assert.equal(stoppedTaskEvent.payload.title, "Agent A");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("interruptTurn lets Claude abort the turn before closing the session", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      const turnCompletedFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "turn.completed"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );
      let closeCallsAtInterrupt: number | undefined;
      harness.query.interrupt = async () => {
        closeCallsAtInterrupt = harness.query.closeCalls;
        harness.query.emit({
          type: "result",
          subtype: "error_during_execution",
          is_error: false,
          errors: ["Error: Request was aborted."],
          session_id: "sdk-session",
          uuid: "result-interrupted",
        } as unknown as SDKMessage);
      };

      yield* adapter.interruptTurn(session.threadId);

      assert.equal(closeCallsAtInterrupt, 0);
      assert.equal(harness.query.closeCalls, 1);
      const [turnCompleted] = Array.from(yield* Fiber.join(turnCompletedFiber));
      assert.equal(turnCompleted?.type, "turn.completed");
      if (turnCompleted?.type === "turn.completed") {
        assert.equal(turnCompleted.payload.state, "interrupted");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("interruptTurn closes the session when Claude never aborts the turn", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });
      harness.query.interrupt = () => new Promise(() => {});

      const interruptFiber = yield* adapter.interruptTurn(session.threadId).pipe(Effect.forkChild);
      yield* TestClock.adjust("3 seconds");
      yield* Fiber.join(interruptFiber);

      assert.equal(harness.query.closeCalls, 1);
      assert.equal(yield* adapter.hasSession(session.threadId), false);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("keeps the session available when process close fails", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      harness.query.closeError = new Error("close failed");

      const result = yield* adapter.interruptTurn(session.threadId).pipe(Effect.result);

      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.equal(result.failure._tag, "ProviderAdapterProcessError");
      }
      assert.equal(harness.query.closeCalls, 1);
      assert.equal(yield* adapter.hasSession(session.threadId), true);
      assert.equal((yield* adapter.listSessions())[0]?.status, "ready");
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("stopAll attempts every session when one process close fails", () => {
    const queries: FakeClaudeQuery[] = [];
    const layer = Layer.effect(
      ClaudeAdapter,
      Effect.gen(function* () {
        const claudeConfig = decodeClaudeSettings({});
        return yield* makeClaudeAdapter(claudeConfig, {
          createQuery: () => {
            const query = new FakeClaudeQuery();
            queries.push(query);
            return query;
          },
        });
      }),
    ).pipe(
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.startSession({
        threadId: RESUME_THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      const firstQuery = queries[0];
      if (!firstQuery) {
        return;
      }
      firstQuery.closeError = new Error("close failed");

      const result = yield* adapter.stopAll().pipe(Effect.result);

      assert.equal(result._tag, "Failure");
      assert.equal(queries[0]?.closeCalls, 1);
      assert.equal(queries[1]?.closeCalls, 1);
      assert.equal(yield* adapter.hasSession(THREAD_ID), true);
      assert.equal(yield* adapter.hasSession(RESUME_THREAD_ID), false);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("keeps the conversation's own context window, not a subagent's larger one", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 7).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          SYNTHETIC_CLAUDE_CAPABLE_MODEL,
          [{ id: "contextWindow", value: "standard" }],
        ),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "hello", attachments: [] });

      for (const index of [1, 2, 3]) {
        harness.query.emit({
          type: "assistant",
          session_id: "sdk-session-subagent-window",
          uuid: `assistant-subagent-window-${index}`,
          parent_tool_use_id: null,
          message: {
            id: `assistant-message-subagent-window-${index}`,
            role: "assistant",
            content: [],
            usage: { input_tokens: 80 * index, output_tokens: 20 },
          },
        } as unknown as SDKMessage);
      }
      // A Task ran on a model with a million-token window. The conversation
      // itself is still on the two hundred thousand it was started with.
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1234,
        duration_api_ms: 1200,
        num_turns: 1,
        result: "done",
        stop_reason: "end_turn",
        session_id: "sdk-session-subagent-window",
        usage: { input_tokens: 400, output_tokens: 50 },
        modelUsage: {
          [SYNTHETIC_CLAUDE_CAPABLE_MODEL]: {
            contextWindow: 200000,
            maxOutputTokens: 64000,
            inputTokens: 400,
            cacheReadInputTokens: 21_000,
          },
          "claude-synthetic-subagent": {
            contextWindow: 1000000,
            maxOutputTokens: 64000,
            inputTokens: 120,
          },
        },
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const usageEvent = runtimeEvents.find((event) => event.type === "thread.token-usage.updated");
      assert.equal(usageEvent?.type, "thread.token-usage.updated");
      if (usageEvent?.type === "thread.token-usage.updated") {
        assert.equal(usageEvent.payload.usage.maxTokens, 200000);
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect(
    "a conversation with no model selection is not measured by the largest model that ran",
    () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 7).pipe(
          Stream.runCollect,
          Effect.forkChild,
        );
        // No selection reaches this session, so nothing here knows an api model
        // id: the runtime picked the model. `modelUsage` covers the main loop,
        // subagents and internal calls alike, so the largest window in it is
        // never the conversation's own.
        yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("claudeAgent"),
          runtimeMode: "full-access",
        });
        yield* adapter.sendTurn({ threadId: THREAD_ID, input: "hello", attachments: [] });

        for (const index of [1, 2, 3]) {
          harness.query.emit({
            type: "assistant",
            session_id: "sdk-session-unselected-window",
            uuid: `assistant-unselected-window-${index}`,
            parent_tool_use_id: null,
            message: {
              id: `assistant-message-unselected-window-${index}`,
              role: "assistant",
              content: [],
              usage: { input_tokens: 80 * index, output_tokens: 20 },
            },
          } as unknown as SDKMessage);
        }
        harness.query.emit({
          type: "result",
          subtype: "success",
          is_error: false,
          duration_ms: 1234,
          duration_api_ms: 1200,
          num_turns: 1,
          result: "done",
          stop_reason: "end_turn",
          session_id: "sdk-session-unselected-window",
          usage: { input_tokens: 400, output_tokens: 50 },
          modelUsage: {
            [SYNTHETIC_CLAUDE_CAPABLE_MODEL]: {
              contextWindow: 200000,
              maxOutputTokens: 64000,
              inputTokens: 400,
              cacheReadInputTokens: 21_000,
            },
            "claude-synthetic-subagent": {
              contextWindow: 1000000,
              maxOutputTokens: 64000,
              inputTokens: 120,
            },
          },
        } as unknown as SDKMessage);

        const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
        const usageEvent = runtimeEvents.find(
          (event) => event.type === "thread.token-usage.updated",
        );
        assert.equal(usageEvent?.type, "thread.token-usage.updated");
        if (usageEvent?.type === "thread.token-usage.updated") {
          assert.equal(usageEvent.payload.usage.maxTokens, 200000);
        }
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );

  it.effect("keeps a wide window where the conversation is the one that is on it", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 7).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "hello", attachments: [] });

      for (const index of [1, 2, 3]) {
        harness.query.emit({
          type: "assistant",
          session_id: "sdk-session-wide-window",
          uuid: `assistant-wide-window-${index}`,
          parent_tool_use_id: null,
          message: {
            id: `assistant-message-wide-window-${index}`,
            role: "assistant",
            content: [],
            usage: { input_tokens: 80 * index, output_tokens: 20 },
          },
        } as unknown as SDKMessage);
      }
      // The shape a real turn has (`plain-text-turn.jsonl`): the conversation
      // runs the expanded window and carries the turn's tokens, while a small
      // internal call — a title, a classifier — runs a narrow one. Taking the
      // narrowest here would have measured this conversation against a model
      // it never ran.
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1234,
        duration_api_ms: 1200,
        num_turns: 1,
        result: "done",
        stop_reason: "end_turn",
        session_id: "sdk-session-wide-window",
        usage: { input_tokens: 400, output_tokens: 50 },
        modelUsage: {
          "claude-synthetic-helper": {
            contextWindow: 200000,
            maxOutputTokens: 32000,
            inputTokens: 899,
            outputTokens: 10,
          },
          "claude-synthetic-wide[1m]": {
            contextWindow: 1000000,
            maxOutputTokens: 64000,
            inputTokens: 2,
            cacheReadInputTokens: 11_474,
            cacheCreationInputTokens: 9980,
          },
        },
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const usageEvent = runtimeEvents.find((event) => event.type === "thread.token-usage.updated");
      assert.equal(usageEvent?.type, "thread.token-usage.updated");
      if (usageEvent?.type === "thread.token-usage.updated") {
        assert.equal(usageEvent.payload.usage.maxTokens, 1000000);
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("follows the window of the model the person switched to", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 7).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          SYNTHETIC_CLAUDE_CAPABLE_MODEL,
          [{ id: "contextWindow", value: "standard" }],
        ),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "hello",
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          SYNTHETIC_CLAUDE_CAPABLE_MODEL,
          [{ id: "contextWindow", value: "expanded" }],
        ),
        attachments: [],
      });

      for (const index of [1, 2, 3]) {
        harness.query.emit({
          type: "assistant",
          session_id: "sdk-session-switched-window",
          uuid: `assistant-switched-window-${index}`,
          parent_tool_use_id: null,
          message: {
            id: `assistant-message-switched-window-${index}`,
            role: "assistant",
            content: [],
            usage: { input_tokens: 80 * index, output_tokens: 20 },
          },
        } as unknown as SDKMessage);
      }
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1234,
        duration_api_ms: 1200,
        num_turns: 1,
        result: "done",
        stop_reason: "end_turn",
        session_id: "sdk-session-switched-window",
        usage: { input_tokens: 400, output_tokens: 50 },
        modelUsage: {
          [SYNTHETIC_CLAUDE_CAPABLE_MODEL]: { contextWindow: 200000, maxOutputTokens: 64000 },
        },
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const usageEvent = runtimeEvents.find((event) => event.type === "thread.token-usage.updated");
      assert.equal(usageEvent?.type, "thread.token-usage.updated");
      if (usageEvent?.type === "thread.token-usage.updated") {
        assert.equal(usageEvent.payload.usage.maxTokens, 1000000);
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("completes with result usage without querying current context usage", () => {
    const harness = makeHarness();
    let getContextUsageCalls = 0;
    Object.assign(harness.query, {
      getContextUsage: async () => {
        getContextUsageCalls += 1;
        return {
          totalTokens: 999,
          maxTokens: 200000,
          isAutoCompactEnabled: true,
        };
      },
    });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 7).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "hello",
        attachments: [],
      });

      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-result-usage",
        uuid: "assistant-result-usage-1",
        parent_tool_use_id: null,
        message: {
          id: "assistant-message-result-usage-1",
          role: "assistant",
          content: [],
          usage: {
            input_tokens: 80,
            output_tokens: 20,
          },
        },
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-result-usage",
        uuid: "assistant-result-usage-2",
        parent_tool_use_id: null,
        message: {
          id: "assistant-message-result-usage-2",
          role: "assistant",
          content: [],
          usage: {
            input_tokens: 180,
            output_tokens: 20,
          },
        },
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-result-usage",
        uuid: "assistant-result-usage-3",
        parent_tool_use_id: null,
        message: {
          id: "assistant-message-result-usage-3",
          role: "assistant",
          content: [],
        },
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1234,
        duration_api_ms: 1200,
        num_turns: 1,
        result: "done",
        stop_reason: "end_turn",
        session_id: "sdk-session-result-usage",
        usage: {
          input_tokens: 400,
          output_tokens: 50,
        },
        modelUsage: {
          [SYNTHETIC_CLAUDE_CAPABLE_MODEL]: {
            contextWindow: 200000,
            maxOutputTokens: 64000,
          },
        },
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.equal(getContextUsageCalls, 0);
      const usageEvent = runtimeEvents.find((event) => event.type === "thread.token-usage.updated");
      assert.equal(usageEvent?.type, "thread.token-usage.updated");
      if (usageEvent?.type === "thread.token-usage.updated") {
        assert.deepEqual(usageEvent.payload.usage, {
          usedTokens: 200,
          lastUsedTokens: 200,
          totalProcessedTokens: 450,
          inputTokens: 180,
          outputTokens: 20,
          maxTokens: 200000,
        });
      }
      assert.equal(
        runtimeEvents.find((event) => event.type === "turn.completed")?.type,
        "turn.completed",
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("preserves compacted usage when completion follows an older assistant frame", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 11).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "hello",
        attachments: [],
      });
      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-compacted-usage",
        uuid: "assistant-compacted-usage",
        parent_tool_use_id: null,
        message: {
          id: "assistant-message-compacted-usage",
          role: "assistant",
          content: [],
          usage: {
            input_tokens: 180,
            output_tokens: 20,
          },
        },
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: {
          pre_tokens: 200,
          post_tokens: 40,
        },
        session_id: "sdk-session-compacted-usage",
        uuid: "compact-boundary-usage",
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { post_tokens: 40 },
        session_id: "sdk-session-compacted-usage",
        uuid: "compact-boundary-post-usage",
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1234,
        duration_api_ms: 1200,
        num_turns: 2,
        result: "done",
        stop_reason: "end_turn",
        session_id: "sdk-session-compacted-usage",
        usage: {
          input_tokens: 400,
          output_tokens: 50,
        },
        modelUsage: {
          [SYNTHETIC_CLAUDE_CAPABLE_MODEL]: {
            contextWindow: 200000,
            maxOutputTokens: 64000,
          },
        },
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const compactionEvents = runtimeEvents.filter(
        (event): event is Extract<ProviderRuntimeEvent, { type: "thread.state.changed" }> =>
          event.type === "thread.state.changed" && event.payload.state === "compacted",
      );
      assert.equal(compactionEvents[0]?.payload.beforeTokens, 200);
      assert.equal(compactionEvents[0]?.payload.afterTokens, 40);
      assert.equal(compactionEvents[1]?.payload.beforeTokens, undefined);
      assert.equal(compactionEvents[1]?.payload.afterTokens, 40);
      const finalUsageEvent = runtimeEvents.findLast(
        (event) => event.type === "thread.token-usage.updated",
      );
      assert.equal(finalUsageEvent?.type, "thread.token-usage.updated");
      if (finalUsageEvent?.type === "thread.token-usage.updated") {
        assert.deepEqual(finalUsageEvent.payload.usage, {
          usedTokens: 40,
          totalProcessedTokens: 450,
          maxTokens: 200000,
        });
      }
      assert.equal(
        runtimeEvents.find((event) => event.type === "turn.completed")?.type,
        "turn.completed",
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("workflow member coalescing: identical snapshots suppress, changes emit", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      // Collect task.progress until member-0's tick-3 emission lands, then
      // evaluate member emissions.
      const progressFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "task.progress"),
        Stream.takeUntil(
          // Sentinel: member-0's tick-3 emission (tokens 20) — members are
          // emitted after the coordinator row within a tick.
          (event) =>
            (event.payload as { taskId?: string }).taskId === "wf-coalesce:wf:0" &&
            (event.payload as { typedUsage?: { totalTokens?: number } }).typedUsage?.totalTokens ===
              20,
        ),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "run workflow",
        attachments: [],
      });

      const memberSnapshot = (tokens: number) => [
        { type: "workflow_phase", index: 0, title: "Work" },
        {
          type: "workflow_agent",
          index: 0,
          state: "running",
          label: "member-0",
          phaseIndex: 0,
          tokens,
        },
        {
          type: "workflow_agent",
          index: 1,
          state: "running",
          label: "member-1",
          phaseIndex: 0,
          tokens: 50,
        },
      ];
      const tick = (usageTotal: number, snapshot: ReturnType<typeof memberSnapshot>) =>
        harness.query.emit({
          type: "system",
          subtype: "task_progress",
          task_id: "wf-coalesce",
          description: "Coalescing workflow",
          usage: { total_tokens: usageTotal, tool_uses: 1, duration_ms: 10 },
          workflow_progress: snapshot,
          uuid: `wf-tick-${usageTotal}`,
          session_id: "sdk-session",
        } as unknown as SDKMessage);

      // Tick 1: both members are new -> 2 member events.
      tick(100, memberSnapshot(10));
      // Tick 2: IDENTICAL member snapshot -> 0 member events (coordinator
      // usage changed, but members did not).
      tick(200, memberSnapshot(10));
      // Tick 3: member-0's tokens advanced -> exactly 1 member event.
      tick(300, memberSnapshot(20));

      const progressEvents = Array.from(yield* Fiber.join(progressFiber));
      const byMember = new Map<string, number>();
      for (const event of progressEvents) {
        const taskId = (event.payload as { taskId: string }).taskId;
        if (!taskId.includes(":wf:")) continue;
        byMember.set(taskId, (byMember.get(taskId) ?? 0) + 1);
      }
      // member-0: tick 1 + tick 3. member-1: tick 1 only (tick 2 identical,
      // tick 3 unchanged).
      assert.equal(byMember.get("wf-coalesce:wf:0"), 2);
      assert.equal(byMember.get("wf-coalesce:wf:1"), 1);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("task.started carries model/effort; subagent snapshots refine the model", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const taskEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type.startsWith("task.")),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          SYNTHETIC_CLAUDE_CAPABLE_MODEL,
          [{ id: "effort", value: "max" }],
        ),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "spawn an agent",
        attachments: [],
      });

      // No explicit model/effort on the launch input: the task inherits the
      // session's selection.
      harness.query.emit({
        type: "system",
        subtype: "task_started",
        task_id: "task-model",
        description: "Agent M",
        task_type: "local_agent",
        tool_use_id: "toolu_agent_m",
        uuid: "task-model-uuid",
        session_id: "sdk-session",
      } as unknown as SDKMessage);
      // The subagent's assistant snapshot carries the authoritative API
      // model id, which refines the linkage on later rows.
      harness.query.emit({
        type: "assistant",
        parent_tool_use_id: "toolu_agent_m",
        message: {
          model: SYNTHETIC_SUBAGENT_MODEL,
          content: [],
        },
        uuid: "subagent-snapshot-uuid",
        session_id: "sdk-session",
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "system",
        subtype: "task_progress",
        task_id: "task-model",
        description: "Agent M",
        usage: { total_tokens: 100, tool_uses: 1, duration_ms: 10 },
        uuid: "task-model-progress-uuid",
        session_id: "sdk-session",
      } as unknown as SDKMessage);

      const taskEvents = Array.from(yield* Fiber.join(taskEventsFiber));
      const started = taskEvents[0];
      assert.equal(started?.type, "task.started");
      if (started?.type === "task.started") {
        assert.equal(started.payload.model, SYNTHETIC_CLAUDE_CAPABLE_MODEL);
        assert.equal(started.payload.effort, "max");
      }
      const progress = taskEvents[1];
      assert.equal(progress?.type, "task.progress");
      if (progress?.type === "task.progress") {
        assert.equal(progress.payload.model, SYNTHETIC_SUBAGENT_MODEL);
        assert.equal(progress.payload.effort, "max");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("a subagent snapshot that beats task_started still wins over the seed", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const taskEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type.startsWith("task.")),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          SYNTHETIC_CLAUDE_CAPABLE_MODEL,
          [{ id: "effort", value: "max" }],
        ),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "spawn an agent",
        attachments: [],
      });

      // The subagent streams its first assistant snapshot before the task is
      // registered, so there is no agent to refine yet.
      harness.query.emit({
        type: "assistant",
        parent_tool_use_id: "toolu_agent_early",
        message: {
          model: SYNTHETIC_SUBAGENT_MODEL,
          content: [],
        },
        uuid: "early-snapshot-uuid",
        session_id: "sdk-session",
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "system",
        subtype: "task_started",
        task_id: "task-early",
        description: "Agent E",
        task_type: "local_agent",
        tool_use_id: "toolu_agent_early",
        uuid: "task-early-uuid",
        session_id: "sdk-session",
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "system",
        subtype: "task_progress",
        task_id: "task-early",
        description: "Agent E",
        usage: { total_tokens: 100, tool_uses: 1, duration_ms: 10 },
        uuid: "task-early-progress-uuid",
        session_id: "sdk-session",
      } as unknown as SDKMessage);

      const taskEvents = Array.from(yield* Fiber.join(taskEventsFiber));
      const started = taskEvents[0];
      assert.equal(started?.type, "task.started");
      if (started?.type === "task.started") {
        assert.equal(started.payload.model, SYNTHETIC_SUBAGENT_MODEL);
        assert.equal(started.payload.effort, "max");
      }
      const progress = taskEvents[1];
      assert.equal(progress?.type, "task.progress");
      if (progress?.type === "task.progress") {
        assert.equal(progress.payload.model, SYNTHETIC_SUBAGENT_MODEL);
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("closes the session when the Claude stream aborts after a turn starts", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEvents: Array<ProviderRuntimeEvent> = [];

      const runtimeEventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          runtimeEvents.push(event);
        }),
      ).pipe(Effect.forkChild);

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "hello",
        attachments: [],
      });

      harness.query.fail(new Error("All fibers interrupted without error"));

      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      runtimeEventsFiber.interruptUnsafe();
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "turn.completed",
          "session.exited",
        ],
      );

      const turnCompleted = runtimeEvents[4];
      assert.equal(turnCompleted?.type, "turn.completed");
      if (turnCompleted?.type === "turn.completed") {
        assert.equal(String(turnCompleted.turnId), String(turn.turnId));
        assert.equal(turnCompleted.payload.state, "interrupted");
        assert.equal(turnCompleted.payload.errorMessage, "Claude runtime interrupted.");
      }

      const sessionExited = runtimeEvents[5];
      assert.equal(sessionExited?.type, "session.exited");

      assert.equal(yield* adapter.hasSession(THREAD_ID), false);
      const sessions = yield* adapter.listSessions();
      assert.equal(sessions.length, 0);
      assert.equal(harness.query.closeCalls, 1);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("keeps Claude stream failure events structural", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEvents: Array<ProviderRuntimeEvent> = [];
      const runtimeEventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          runtimeEvents.push(event);
        }),
      ).pipe(Effect.forkChild);

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "hello",
        attachments: [],
      });

      harness.query.fail(new Error("credential material that must stay in the cause chain"));

      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      runtimeEventsFiber.interruptUnsafe();

      const runtimeError = runtimeEvents.find((event) => event.type === "runtime.error");
      assert.equal(runtimeError?.type, "runtime.error");
      if (runtimeError?.type === "runtime.error") {
        assert.equal(
          runtimeError.payload.message,
          "Claude Code stopped unexpectedly. Send a message to pick up where it left off.",
        );
        assert.deepEqual(runtimeError.payload.detail, {
          failureCount: 1,
          failureTags: ["ProviderAdapterProcessError"],
        });
      }

      const completed = runtimeEvents.find((event) => event.type === "turn.completed");
      assert.equal(completed?.type, "turn.completed");
      if (completed?.type === "turn.completed") {
        assert.equal(completed.payload.state, "failed");
        assert.equal(
          completed.payload.errorMessage,
          "Claude Code stopped unexpectedly. Send a message to pick up where it left off.",
        );
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  // A stream that dies says why, in plain words, and what happens next; the
  // CLI's own stderr goes to the log, never the conversation.
  it.effect("says why a stream died, from the CLI's stderr", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEvents: Array<ProviderRuntimeEvent> = [];
      const runtimeEventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          runtimeEvents.push(event);
        }),
      ).pipe(Effect.forkChild);
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "hello", attachments: [] });
      const stderr = harness.getLastCreateQueryInput()?.options.stderr;
      assert.equal(typeof stderr, "function");
      stderr?.(
        "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n",
      );
      harness.query.fail(
        Object.assign(new Error("Claude Code process exited with code 134"), { exitCode: 134 }),
      );
      for (let tick = 0; tick < 5; tick += 1) yield* Effect.yieldNow;
      runtimeEventsFiber.interruptUnsafe();

      const words = "Claude Code ran out of memory. Send a message to pick up where it left off.";
      const runtimeError = runtimeEvents.find((event) => event.type === "runtime.error");
      assert.equal(
        runtimeError?.type === "runtime.error" ? runtimeError.payload.message : null,
        words,
      );
      // Its stderr is the log's, never the conversation's.
      assert.deepEqual(
        runtimeError?.type === "runtime.error" ? runtimeError.payload.detail : null,
        { failureCount: 1, failureTags: ["ProviderAdapterProcessError"] },
      );
      const completed = runtimeEvents.find((event) => event.type === "turn.completed");
      assert.equal(
        completed?.type === "turn.completed" ? completed.payload.errorMessage : null,
        words,
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  // How a stream ended, and what the person is told: a crash says why and
  // fails the turn (its reason the thread's last error); our own failure to
  // read the stream is ours, never Claude Code's; a crash whose stderr says
  // "aborted" is no Stop; and only this stream's stderr is read.
  describe("a stream's end", () => {
    const SESSION = "sdk-session-stream-end";
    const resultOf = (uuid: string) =>
      ({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: SESSION,
        uuid,
      }) as unknown as SDKMessage;
    const cases: ReadonlyArray<{
      readonly name: string;
      readonly run: (
        harness: ReturnType<typeof makeHarness>,
        adapter: ClaudeAdapterShape,
      ) => Effect.Effect<void, ProviderAdapterError>;
      readonly words: string;
    }> = [
      {
        name: "a crash mid-turn fails the turn with its reason",
        run: (harness) =>
          Effect.sync(() => {
            harness.getLastCreateQueryInput()?.options.stderr?.("Error: socket hang up\n");
            harness.query.finish();
          }),
        words: "The Claude API stopped answering. Send a message to pick up where it left off.",
      },
      {
        name: "our own failure to read its output is ours",
        run: (harness) =>
          Effect.sync(() => {
            harness.query.emit({
              type: "assistant",
              parent_tool_use_id: "toolu_x",
              message: null,
              uuid: "broken-snapshot",
              session_id: SESSION,
            } as unknown as SDKMessage);
          }),
        words: "Mate failed to read Claude's output. Send a message to pick up where it left off.",
      },
      {
        name: "a crash whose stderr says aborted is no Stop",
        run: (harness) =>
          Effect.sync(() => {
            harness.query.fail(
              Object.assign(
                new Error("Claude Code process exited with code 1. stderr: Request was aborted."),
                { exitCode: 1 },
              ),
            );
          }),
        words: "Claude Code stopped unexpectedly. Send a message to pick up where it left off.",
      },
      {
        name: "an earlier turn's stderr is not this one's",
        run: (harness, adapter) =>
          Effect.gen(function* () {
            harness.getLastCreateQueryInput()?.options.stderr?.("API Error: 529 overloaded\n");
            harness.query.emit(resultOf("result-first"));
            for (let tick = 0; tick < 5; tick += 1) yield* Effect.yieldNow;
            yield* adapter.sendTurn({ threadId: THREAD_ID, input: "again", attachments: [] });
            harness.query.fail(new Error("stream closed"));
          }),
        words: "Claude Code stopped unexpectedly. Send a message to pick up where it left off.",
      },
    ];
    for (const { name, run, words } of cases) {
      it.effect(name, () => {
        const harness = makeHarness();
        return Effect.gen(function* () {
          const adapter = yield* ClaudeAdapter;
          const runtimeEvents: Array<ProviderRuntimeEvent> = [];
          const runtimeEventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
            Effect.sync(() => {
              runtimeEvents.push(event);
            }),
          ).pipe(Effect.forkChild);
          yield* adapter.startSession({
            threadId: THREAD_ID,
            provider: ProviderDriverKind.make("claudeAgent"),
            runtimeMode: "full-access",
          });
          yield* adapter.sendTurn({ threadId: THREAD_ID, input: "hello", attachments: [] });
          yield* run(harness, adapter);
          for (let tick = 0; tick < 10; tick += 1) yield* Effect.yieldNow;
          runtimeEventsFiber.interruptUnsafe();
          const errors = runtimeEvents.flatMap((event) =>
            event.type === "runtime.error" ? [event.payload.message] : [],
          );
          assert.deepEqual(errors, [words]);
          // A stream that died is typed a crash.
          assert.deepEqual(
            runtimeEvents.flatMap((event) =>
              event.type === "runtime.error" ? [event.payload.class] : [],
            ),
            ["process_exit"],
          );
          const ends = runtimeEvents.flatMap((event) =>
            event.type === "turn.completed"
              ? [[event.payload.state, event.payload.errorMessage ?? null]]
              : [],
          );
          assert.deepEqual(ends.at(-1), ["failed", words]);
        }).pipe(
          Effect.provideService(Random.Random, makeDeterministicRandomService()),
          Effect.provide(harness.layer),
        );
      });
    }
  });

  // The Mate idle, its helpers at work, and the stream dies: the person is
  // told, and each helper and its open call read as stopped, never working on.
  it.effect("stops the helpers a dead stream left working, and says so", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEvents: Array<ProviderRuntimeEvent> = [];
      const runtimeEventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          runtimeEvents.push(event);
        }),
      ).pipe(Effect.forkChild);
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "delegate", attachments: [] });
      const session = "sdk-session-dead-stream";
      for (const message of [
        {
          type: "system",
          subtype: "task_started",
          task_id: "task-a",
          tool_use_id: "toolu_agent_a",
          description: "Check the schema",
          task_type: "local_agent",
          uuid: "started-task-a",
          session_id: session,
        },
        {
          type: "assistant",
          parent_tool_use_id: "toolu_agent_a",
          message: {
            model: SYNTHETIC_SUBAGENT_MODEL,
            content: [{ type: "tool_use", id: "tool-h1", name: "Bash", input: { command: "ls" } }],
          },
          uuid: "snapshot-h1",
          session_id: session,
        },
        {
          type: "result",
          subtype: "success",
          is_error: false,
          errors: [],
          session_id: session,
          uuid: "result-dead-stream",
        },
      ]) {
        harness.query.emit(message as unknown as SDKMessage);
      }
      for (let tick = 0; tick < 5; tick += 1) yield* Effect.yieldNow;
      harness.query.fail(new Error("socket hang up"));
      for (let tick = 0; tick < 8; tick += 1) yield* Effect.yieldNow;
      runtimeEventsFiber.interruptUnsafe();

      const runtimeError = runtimeEvents.find((event) => event.type === "runtime.error");
      assert.equal(
        runtimeError?.type === "runtime.error" ? runtimeError.payload.message : null,
        "The Claude API stopped answering. Send a message to pick up where it left off.",
      );
      const stopped = runtimeEvents.find(
        (event) => event.type === "task.completed" && event.payload.taskId === "task-a",
      );
      assert.equal(stopped?.type === "task.completed" ? stopped.payload.status : null, "stopped");
      const closed = runtimeEvents.find(
        (event) => event.type === "item.completed" && String(event.itemId) === "tool-h1",
      );
      assert.equal(closed?.type === "item.completed" ? closed.payload.agentId : null, "task-a");
      assert.ok(runtimeEvents.some((event) => event.type === "session.exited"));
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("closes the previous session before replacing an existing thread session", () => {
    const queries: FakeClaudeQuery[] = [];
    const layer = Layer.effect(
      ClaudeAdapter,
      Effect.gen(function* () {
        const claudeConfig = decodeClaudeSettings({});
        return yield* makeClaudeAdapter(claudeConfig, {
          createQuery: () => {
            const query = new FakeClaudeQuery();
            queries.push(query);
            return query;
          },
        });
      }),
    ).pipe(
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 6).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const firstSession = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const secondSession = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
        resumeCursor: firstSession.resumeCursor,
      });

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const activeSessions = yield* adapter.listSessions();

      assert.equal(queries.length, 2);
      assert.equal(queries[0]?.closeCalls, 1);
      assert.equal(queries[1]?.closeCalls, 0);
      assert.equal(yield* adapter.hasSession(THREAD_ID), true);
      assert.equal(activeSessions.length, 1);
      assert.deepEqual(activeSessions[0]?.resumeCursor, secondSession.resumeCursor);
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "session.started",
          "session.configured",
          "session.state.changed",
        ],
      );
      assert.equal(
        runtimeEvents.some((event) => event.type === "session.exited"),
        false,
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("stopSession does not throw into the SDK prompt consumer", () => {
    // The SDK consumes user messages via `for await (... of prompt)`.
    // Stopping a session must end that loop cleanly — not throw an error.
    //
    // FakeClaudeQuery.close() masks this by resolving pending iterators
    // before the shutdown propagates. Override it to match real SDK behavior
    // where close() does not resolve the prompt consumer.
    const query = new FakeClaudeQuery();
    (query as { close: () => void }).close = () => {
      query.closeCalls += 1;
    };

    let promptConsumerError: unknown = undefined;

    const layer = Layer.effect(
      ClaudeAdapter,
      Effect.gen(function* () {
        const claudeConfig = decodeClaudeSettings({});
        return yield* makeClaudeAdapter(claudeConfig, {
          createQuery: (input) => {
            // Simulate the SDK consuming the prompt iterable
            (async () => {
              try {
                for await (const _message of input.prompt) {
                  /* SDK processes user messages */
                }
              } catch (error) {
                promptConsumerError = error;
              }
            })();
            return query;
          },
        });
      }),
    ).pipe(
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.runForEach(
        adapter.streamEvents,
        () => Effect.void,
      ).pipe(Effect.forkChild);

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      yield* adapter.stopSession(THREAD_ID);

      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* TestClock.adjust("50 millis");
      yield* Effect.yieldNow;

      runtimeEventsFiber.interruptUnsafe();

      assert.equal(
        promptConsumerError,
        undefined,
        `Prompt consumer should not receive a thrown error on session stop, ` +
          `but got: "${promptConsumerError instanceof Error ? promptConsumerError.message : String(promptConsumerError)}"`,
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("forwards Claude task progress summaries for subagent updates", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 6).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      harness.query.emit({
        type: "system",
        subtype: "task_progress",
        task_id: "task-subagent-1",
        description: "Running background teammate",
        summary: "Code reviewer checked the migration edge cases.",
        usage: {
          total_tokens: 123,
          tool_uses: 4,
          duration_ms: 987,
        },
        session_id: "sdk-session-task-summary",
        uuid: "task-progress-1",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const progressEvent = runtimeEvents.find((event) => event.type === "task.progress");
      assert.equal(progressEvent?.type, "task.progress");
      if (progressEvent?.type === "task.progress") {
        assert.equal(
          progressEvent.payload.summary,
          "Code reviewer checked the migration edge cases.",
        );
        assert.equal(progressEvent.payload.description, "Running background teammate");
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("consumes undeclared and UX-internal system subtypes without warning rows", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) =>
            event.type === "session.state.changed" && event.payload.reason === "api_retry:3/10",
        ),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      // Undeclared wire-only roster snapshot + every typed UX-internal
      // subtype and top-level type consumed silently: none may surface as
      // unknown-subtype warnings.
      for (const message of [
        {
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [{ task_id: "t1", task_type: "local_agent", description: "Say hi" }],
          session_id: "session",
          uuid: "roster",
        },
        {
          type: "system",
          subtype: "vcs_state_changed",
          kind: "push",
          cwd: "/tmp/worktree",
          session_id: "session",
          uuid: "vcs",
        },
        {
          type: "system",
          subtype: "code_change_published",
          provider: "github",
          url: "https://github.com/pingdotgg/t3code/pull/1",
          repo: "pingdotgg/t3code",
          identifier: "1",
          session_id: "session",
          uuid: "ccp",
        },
        {
          type: "system",
          subtype: "task_updated",
          task_id: "t1",
          patch: { status: "running" },
          session_id: "session",
          uuid: "tu",
        },
        { type: "system", subtype: "commands_changed", session_id: "session", uuid: "cc" },
        { type: "system", subtype: "plugin_install", session_id: "session", uuid: "pi" },
        { type: "system", subtype: "memory_recall", session_id: "session", uuid: "mr" },
        { type: "system", subtype: "elicitation_complete", session_id: "session", uuid: "ec" },
        {
          type: "system",
          subtype: "control_request_progress",
          request_id: "ctrl-1",
          status: "started",
          session_id: "session",
          uuid: "crp",
        },
        {
          type: "system",
          subtype: "worker_shutting_down",
          reason: "host_exit",
          session_id: "session",
          uuid: "wsd",
        },
        {
          type: "system",
          subtype: "informational",
          content: "Loaded 3 skills",
          level: "notice",
          session_id: "session",
          uuid: "info",
        },
        { type: "prompt_suggestion", suggestion: "try this", session_id: "session", uuid: "ps" },
        {
          type: "conversation_reset",
          new_conversation_id: "conv-2",
          session_id: "session",
          uuid: "cr",
        },
        {
          type: "system",
          subtype: "notification",
          key: "context",
          text: "low priority note",
          priority: "low",
          session_id: "session",
          uuid: "notif",
        },
      ]) {
        harness.query.emit(message as unknown as SDKMessage);
      }
      // Safety model-fallback notices DO surface as a warning row.
      harness.query.emit({
        type: "system",
        subtype: "model_refusal_fallback",
        trigger: "refusal",
        direction: "retry",
        original_model: "claude-fable-5",
        fallback_model: "claude-opus-4-8",
        request_id: "req_test",
        api_refusal_category: "cyber",
        api_refusal_explanation: null,
        content: "Safeguards flagged this message. Switched to Opus 4.8.",
        session_id: "session",
        uuid: "mrf",
      } as unknown as SDKMessage);
      // High-priority notifications DO surface as a warning row.
      harness.query.emit({
        type: "system",
        subtype: "notification",
        key: "limit",
        text: "context window nearly full",
        priority: "high",
        session_id: "session",
        uuid: "notif-high",
      } as unknown as SDKMessage);
      // Warning-level informational notes and refusals without a fallback
      // model surface as warning rows too.
      harness.query.emit({
        type: "system",
        subtype: "informational",
        content: "Stop hook prevented continuation",
        level: "warning",
        prevent_continuation: true,
        session_id: "session",
        uuid: "info-warn",
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "system",
        subtype: "model_refusal_no_fallback",
        original_model: "claude-opus-5",
        request_id: null,
        api_refusal_explanation: "The request was declined by the API.",
        content: "Model refused",
        session_id: "session",
        uuid: "mrnf",
      } as unknown as SDKMessage);
      // session_state_changed maps to the matching session states.
      for (const [state, uuid] of [
        ["running", "ssc-run"],
        ["requires_action", "ssc-req"],
        ["idle", "ssc-idle"],
      ]) {
        harness.query.emit({
          type: "system",
          subtype: "session_state_changed",
          state,
          session_id: "session",
          uuid,
        } as unknown as SDKMessage);
      }
      // api_retry maps to a session heartbeat, not a warning row.
      harness.query.emit({
        type: "system",
        subtype: "api_retry",
        attempt: 3,
        max_retries: 10,
        retry_delay_ms: 1000,
        error_status: 502,
        error: { type: "api_error" },
        session_id: "session",
        uuid: "retry",
      } as unknown as SDKMessage);
      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));

      const warnings = runtimeEvents.filter((event) => event.type === "runtime.warning");
      // Exactly four warnings: the fallback notice, high-priority notification,
      // warning-level informational note, and the refusal. Nothing else.
      assert.deepEqual(
        warnings.map((event) => event.payload.message),
        [
          "Safeguards flagged this message. Switched to Opus 4.8.",
          "context window nearly full",
          "Stop hook prevented continuation",
          "The request was declined by the API.",
        ],
      );
      const sessionStates = runtimeEvents
        .filter((event) => event.type === "session.state.changed")
        .map((event) =>
          event.type === "session.state.changed"
            ? `${event.payload.state}:${event.payload.reason ?? ""}`
            : "",
        )
        .filter(
          (entry) => entry.startsWith("running:session_state") || entry.includes("session_state"),
        );
      assert.deepEqual(sessionStates, [
        "running:session_state:running",
        "waiting:session_state:requires_action",
        "ready:session_state:idle",
      ]);
      const heartbeat = runtimeEvents.find(
        (event) =>
          event.type === "session.state.changed" &&
          typeof event.payload.reason === "string" &&
          event.payload.reason.startsWith("api_retry:"),
      );
      assert.equal(heartbeat?.type, "session.state.changed");
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  const observeUsageLimitEvents = (adapter: ClaudeAdapterShape, query: FakeClaudeQuery) =>
    Effect.gen(function* () {
      const runtimeEvents: Array<ProviderRuntimeEvent> = [];
      let receipt: Deferred.Deferred<void> | undefined;
      const runtimeEventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.gen(function* () {
          runtimeEvents.push(event);
          if (
            receipt &&
            event.type === "session.state.changed" &&
            event.payload.reason === "api_retry:1/1"
          ) {
            yield* Deferred.succeed(receipt, undefined);
          }
        }),
      ).pipe(Effect.forkChild);
      const drainSdkMessages = Effect.gen(function* () {
        receipt = yield* Deferred.make<void>();
        // The heartbeat follows queued SDK messages without adding a warning.
        query.emit({
          type: "system",
          subtype: "api_retry",
          attempt: 1,
          max_retries: 1,
          retry_delay_ms: 0,
          error_status: 429,
          error: { type: "rate_limit_error" },
          session_id: "sdk-session-limit",
          uuid: "usage-limit-drain",
        } as unknown as SDKMessage);
        yield* Deferred.await(receipt);
      });
      return { runtimeEvents, runtimeEventsFiber, drainSdkMessages };
    });

  it.effect("surfaces a rejected Claude usage limit once per turn", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const { runtimeEvents, runtimeEventsFiber, drainSdkMessages } =
        yield* observeUsageLimitEvents(adapter, harness.query);

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "hello", attachments: [] });

      // resetsAt is epoch seconds, so the window reopens 4h 1m30s out.
      const nowMs = yield* Clock.currentTimeMillis;
      const rateLimitInfo = {
        status: "rejected",
        rateLimitType: "five_hour",
        utilization: 1,
        resetsAt: Math.floor(nowMs / 1000) + 4 * 60 * 60 + 90,
      };
      const rejected = {
        type: "rate_limit_event",
        rate_limit_info: rateLimitInfo,
        session_id: "sdk-session-limit",
        uuid: "rate-limit-rejected",
      };
      // Sibling fields drift while the window is parked, so the same rendered
      // line can arrive more than once inside one turn.
      harness.query.emit(rejected as unknown as SDKMessage);
      yield* drainSdkMessages;
      // The repeat lands minutes later, so the remaining wait has visibly
      // shrunk. Deduping on the rendered row would let that drift through.
      yield* TestClock.adjust("5 minutes");
      harness.query.emit(rejected as unknown as SDKMessage);
      yield* drainSdkMessages;

      const usageLimitRows = () =>
        runtimeEvents
          .filter((event) => event.type === "runtime.warning")
          .map((event) => (event.type === "runtime.warning" ? event.payload.message : ""));
      assert.equal(usageLimitRows().length, 1);
      // A wait, not a wall clock: the server renders this row but clients read
      // it from other timezones. Reading resetsAt as milliseconds would put the
      // window minutes out instead of hours, so the hour also pins the scale.
      assert.match(
        usageLimitRows()[0] ?? "",
        /^Claude usage limit reached\. This turn is paused until the 5-hour limit resets in 4h( \d{1,2}m)?\.$/,
      );
      // The exact instant still rides along for clients that want to render it.
      assert.deepEqual(
        runtimeEvents.find((event) => event.type === "runtime.warning")?.payload.detail,
        rateLimitInfo,
      );
      // The raw telemetry event still flows for every copy.
      assert.equal(
        runtimeEvents.filter((event) => event.type === "account.rate-limits.updated").length,
        2,
      );

      // Same window, drifting siblings: still the one pause.
      harness.query.emit({
        ...rejected,
        rate_limit_info: { ...rateLimitInfo, utilization: 0.99 },
        uuid: "rate-limit-rejected-drift",
      } as unknown as SDKMessage);
      yield* drainSdkMessages;
      assert.equal(usageLimitRows().length, 1);

      // Retrying inside the same window renders the identical line. Staying
      // quiet there would put the new turn right back to a silent spin.
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-limit",
        uuid: "result-limit",
      } as unknown as SDKMessage);
      yield* drainSdkMessages;
      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "retry", attachments: [] });
      harness.query.emit(rejected as unknown as SDKMessage);
      yield* drainSdkMessages;

      assert.equal(usageLimitRows().length, 2);

      runtimeEventsFiber.interruptUnsafe();
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("keeps allowed and malformed Claude rate-limit events out of the work log", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const { runtimeEvents, runtimeEventsFiber, drainSdkMessages } =
        yield* observeUsageLimitEvents(adapter, harness.query);

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      // A turn is in flight, so silence here is the status filter doing its job
      // rather than the between-turns guard.
      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "hello", attachments: [] });

      for (const rateLimitInfo of [
        { status: "allowed", rateLimitType: "five_hour", utilization: 0.4 },
        { status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.9 },
        // Undeclared shape from an older/newer CLI must not take the session down.
        undefined,
      ]) {
        harness.query.emit({
          type: "rate_limit_event",
          ...(rateLimitInfo ? { rate_limit_info: rateLimitInfo } : {}),
          session_id: "sdk-session-limit-ok",
          uuid: `rate-limit-${rateLimitInfo?.status ?? "malformed"}`,
        } as unknown as SDKMessage);
      }
      yield* drainSdkMessages;

      assert.deepEqual(
        runtimeEvents.filter((event) => event.type === "runtime.warning"),
        [],
      );
      assert.equal(
        runtimeEvents.filter((event) => event.type === "account.rate-limits.updated").length,
        2,
      );

      runtimeEventsFiber.interruptUnsafe();
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("stays quiet when no turn is parked by the Claude limit", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const { runtimeEvents, runtimeEventsFiber, drainSdkMessages } =
        yield* observeUsageLimitEvents(adapter, harness.query);

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const nowMs = yield* Clock.currentTimeMillis;
      const resetsAt = Math.floor(nowMs / 1000) + 60 * 60;
      // The stream stays live between turns, so a reject can land with nothing
      // to pause; claiming "this turn is paused" there would be a lie.
      harness.query.emit({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          rateLimitType: "five_hour",
          utilization: 1,
          resetsAt,
        },
        session_id: "sdk-session-idle",
        uuid: "rate-limit-idle",
      } as unknown as SDKMessage);
      yield* drainSdkMessages;

      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "hello", attachments: [] });
      // Provisioned overage carries the request even though the base window
      // rejected it, so the turn keeps running and needs no row.
      for (const overage of [
        { overageStatus: "allowed" },
        { overageStatus: "allowed_warning" },
        { isUsingOverage: true },
        { overageInUse: true },
      ]) {
        harness.query.emit({
          type: "rate_limit_event",
          rate_limit_info: {
            status: "rejected",
            rateLimitType: "five_hour",
            resetsAt,
            utilization: 1,
            ...overage,
          },
          session_id: "sdk-session-idle",
          uuid: "rate-limit-overage",
        } as unknown as SDKMessage);
      }
      yield* drainSdkMessages;

      assert.deepEqual(
        runtimeEvents.filter((event) => event.type === "runtime.warning"),
        [],
      );
      // Idle and overage-covered events still reach the account telemetry stream.
      assert.equal(
        runtimeEvents.filter((event) => event.type === "account.rate-limits.updated").length,
        5,
      );

      runtimeEventsFiber.interruptUnsafe();
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("still surfaces the pause when overage is exhausted too", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const { runtimeEvents, runtimeEventsFiber, drainSdkMessages } =
        yield* observeUsageLimitEvents(adapter, harness.query);

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "hello", attachments: [] });

      const nowMs = yield* Clock.currentTimeMillis;
      const resetsAt = Math.floor(nowMs / 1000) + 60 * 60;
      // The overage-exhausted / out-of-credits shape: the base window and the
      // overage it would have spent both reject, with neither isUsingOverage
      // nor overageInUse set to say anything is still covered. Nothing is
      // carrying the turn here, so staying quiet would be the silent spin
      // this row exists to prevent.
      harness.query.emit({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          rateLimitType: "five_hour",
          resetsAt,
          overageStatus: "rejected",
        },
        session_id: "sdk-session-dual-reject",
        uuid: "rate-limit-dual-reject",
      } as unknown as SDKMessage);
      yield* drainSdkMessages;

      assert.equal(runtimeEvents.filter((event) => event.type === "runtime.warning").length, 1);

      runtimeEventsFiber.interruptUnsafe();
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("keeps one row per window when two Claude limits interleave", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const { runtimeEvents, runtimeEventsFiber, drainSdkMessages } =
        yield* observeUsageLimitEvents(adapter, harness.query);

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "hello", attachments: [] });

      const nowMs = yield* Clock.currentTimeMillis;
      const nowSeconds = Math.floor(nowMs / 1000);
      const rejection = (rateLimitType: string, resetsAt: number, uuid: string) => ({
        type: "rate_limit_event",
        rate_limit_info: { status: "rejected", rateLimitType, resetsAt },
        session_id: "sdk-session-interleaved",
        uuid,
      });

      // One turn can park on more than one window; each deserves its own row,
      // and a later repeat of an earlier window deserves none.
      for (const message of [
        rejection("five_hour", nowSeconds + 2 * 60 * 60, "limit-five-hour"),
        rejection("seven_day", nowSeconds + 48 * 60 * 60, "limit-seven-day"),
        rejection("five_hour", nowSeconds + 2 * 60 * 60, "limit-five-hour-repeat"),
      ]) {
        harness.query.emit(message as unknown as SDKMessage);
        yield* drainSdkMessages;
      }

      assert.deepEqual(
        runtimeEvents
          .filter((event) => event.type === "runtime.warning")
          .map((event) => (event.type === "runtime.warning" ? event.payload.message : ""))
          .map((message) => message.replace(/ in \d+h( \d{1,2}m)?/, "")),
        [
          "Claude usage limit reached. This turn is paused until the 5-hour limit resets.",
          "Claude usage limit reached. This turn is paused until the 7-day limit resets.",
        ],
      );

      runtimeEventsFiber.interruptUnsafe();
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  const hour = 60 * 60;
  it.effect.each([
    {
      name: "between turns",
      inTurn: false,
      info: { status: "rejected", rateLimitType: "five_hour", offsetSeconds: 2 * hour },
      expected: { window: "5-hour", offsetSeconds: 2 * hour },
    },
    {
      name: "in a turn, beside its utilization",
      inTurn: true,
      info: {
        status: "rejected",
        rateLimitType: "seven_day",
        utilization: 1,
        offsetSeconds: 48 * hour,
      },
      expected: { window: "7-day", offsetSeconds: 48 * hour },
    },
    {
      name: "not at all without a credible reset",
      inTurn: false,
      info: { status: "rejected", rateLimitType: "five_hour", offsetSeconds: 1e12 },
      expected: undefined,
    },
    {
      name: "not at all while overage carries the requests",
      inTurn: true,
      info: {
        status: "rejected",
        rateLimitType: "five_hour",
        utilization: 1,
        overageStatus: "allowed",
        offsetSeconds: 2 * hour,
      },
      expected: undefined,
    },
    {
      name: "not at all while the window allows requests",
      inTurn: false,
      info: {
        status: "allowed",
        rateLimitType: "five_hour",
        utilization: 0.5,
        offsetSeconds: hour,
      },
      expected: undefined,
    },
  ])("reports a closed Claude usage window $name", ({ inTurn, info, expected }) => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const { runtimeEvents, runtimeEventsFiber, drainSdkMessages } =
        yield* observeUsageLimitEvents(adapter, harness.query);
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      if (inTurn) {
        yield* adapter.sendTurn({ threadId: THREAD_ID, input: "hello", attachments: [] });
      }

      const nowSeconds = Math.floor((yield* Clock.currentTimeMillis) / 1000);
      const { offsetSeconds, ...rateLimitInfo } = info;
      harness.query.emit({
        type: "rate_limit_event",
        rate_limit_info: { ...rateLimitInfo, resetsAt: nowSeconds + offsetSeconds },
        session_id: "sdk-session-blocked",
        uuid: "rate-limit-blocked",
      } as unknown as SDKMessage);
      yield* drainSdkMessages;

      const blocked = runtimeEvents.flatMap((event) =>
        event.type === "account.rate-limits.updated" && event.payload.blocked
          ? [event.payload.blocked]
          : [],
      );
      assert.deepEqual(
        blocked,
        expected === undefined
          ? []
          : [
              {
                window: expected.window,
                resetsAt: DateTime.formatIso(
                  DateTime.makeUnsafe((nowSeconds + expected.offsetSeconds) * 1000),
                ),
              },
            ],
      );

      runtimeEventsFiber.interruptUnsafe();
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  // Claude Code starts a turn by itself whenever a background task finishes,
  // to hand the model its result. Against a closed window that turn fails at
  // the first request with a synthetic "You've hit your session limit" message
  // and a result; one real thread collected eleven such empty turns. The
  // result stays in Claude's conversation for the resume, so no turn opens.
  const limitedWake = [
    {
      type: "assistant",
      session_id: "sdk-session-wake",
      uuid: "assistant-limit-wake",
      parent_tool_use_id: null,
      error: "rate_limit",
      message: {
        id: "assistant-message-limit-wake",
        model: "<synthetic>",
        content: [{ type: "text", text: "You've hit your session limit · resets 3pm" }],
      },
    },
    {
      type: "result",
      subtype: "success",
      is_error: true,
      terminal_reason: "api_error",
      session_id: "sdk-session-wake",
      uuid: "result-limit-wake",
    },
  ];

  it.effect.each([
    { name: "no turn while the window is closed", before: ["rejected"], opensTurn: false },
    { name: "a turn when no closed window was reported", before: [], opensTurn: true },
    {
      name: "a turn once the window reopened",
      before: ["rejected", "allowed"],
      opensTurn: true,
    },
  ])("a background wake that hits the Claude limit opens $name", ({ before, opensTurn }) => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const { runtimeEvents, runtimeEventsFiber, drainSdkMessages } =
        yield* observeUsageLimitEvents(adapter, harness.query);
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const nowSeconds = Math.floor((yield* Clock.currentTimeMillis) / 1000);
      for (const status of before) {
        harness.query.emit({
          type: "rate_limit_event",
          rate_limit_info: { status, rateLimitType: "five_hour", resetsAt: nowSeconds + hour },
          session_id: "sdk-session-wake",
          uuid: `rate-limit-${status}`,
        } as unknown as SDKMessage);
      }
      for (const message of limitedWake) {
        harness.query.emit(message as unknown as SDKMessage);
      }
      yield* drainSdkMessages;

      const lifecycle = runtimeEvents
        .map((event) => event.type)
        .filter((type) => type === "turn.started" || type === "turn.completed");
      assert.deepEqual(lifecycle, opensTurn ? ["turn.started", "turn.completed"] : []);
      if (!opensTurn) {
        assert.deepEqual(
          runtimeEvents.filter(
            (event) => event.type === "runtime.error" || event.type === "content.delta",
          ),
          [],
        );
        // The wake's result sits before this message in Claude's conversation;
        // a resumed session must keep it.
        const [session] = yield* adapter.listSessions();
        assert.equal(
          (session?.resumeCursor as { resumeSessionAt?: string } | undefined)?.resumeSessionAt,
          "assistant-limit-wake",
        );
      }

      runtimeEventsFiber.interruptUnsafe();
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  // The SDK hands some local slash commands' output over as its own message
  // and asks for it to be shown as assistant text; dropped, the command
  // answered with nothing. It belongs to the command's turn: arriving after the
  // turn's result, it must not open one that nothing closes.
  it.effect.each([
    { name: "shows as the agent's reply inside the command's turn", turnOpen: true },
    { name: "opens no turn when none is open", turnOpen: false },
  ])("a local slash command's output $name", ({ turnOpen }) => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const { runtimeEvents, runtimeEventsFiber, drainSdkMessages } =
        yield* observeUsageLimitEvents(adapter, harness.query);
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      if (turnOpen) {
        yield* adapter.sendTurn({ threadId: THREAD_ID, input: "/mcp", attachments: [] });
        // The turn's start reaches the observer a few ticks after the send.
        for (
          let tick = 0;
          tick < 20 && !runtimeEvents.some((event) => event.type === "turn.started");
          tick += 1
        ) {
          yield* Effect.yieldNow;
        }
      }
      const turnsBefore = runtimeEvents.filter((event) => event.type === "turn.started").length;

      harness.query.emit({
        type: "system",
        subtype: "local_command_output",
        content: "2 MCP server(s): 2 connected",
        session_id: "sdk-session-local",
        uuid: "local-command-output",
      } as unknown as SDKMessage);
      yield* drainSdkMessages;

      const text = runtimeEvents
        .flatMap((event) => (event.type === "content.delta" ? [event.payload.delta] : []))
        .join("");
      assert.equal(text, turnOpen ? "2 MCP server(s): 2 connected" : "");
      assert.equal(
        runtimeEvents.filter((event) => event.type === "turn.started").length,
        turnsBefore,
      );

      runtimeEventsFiber.interruptUnsafe();
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  // What Claude Code writes when a background task's notification is still in
  // its queue as a /compact arrives (Claude Code 2.1.271 and 2.1.278 in
  // stream-json mode, against a local stand-in for the API): the CLI runs the
  // notification's wake as a turn of its own first, then the /compact's turn.
  // Each result carries whatever the producer echoes about the send it ends.
  const WAKE_SESSION = "sdk-session-wake-compact";
  const wakeAheadOfCompact = (results: {
    readonly wake: Record<string, unknown>;
    readonly compact: Record<string, unknown>;
  }) => [
    { type: "system", subtype: "init", session_id: WAKE_SESSION, uuid: "init-wake" },
    {
      type: "system",
      subtype: "status",
      status: "requesting",
      session_id: WAKE_SESSION,
      uuid: "status-wake",
    },
    {
      type: "assistant",
      session_id: WAKE_SESSION,
      uuid: "assistant-wake",
      parent_tool_use_id: null,
      message: {
        id: "assistant-message-wake",
        role: "assistant",
        content: [{ type: "text", text: "The job log shows the 21:50 run finished." }],
      },
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 1,
      result: "The job log shows the 21:50 run finished.",
      stop_reason: "end_turn",
      session_id: WAKE_SESSION,
      uuid: "result-wake",
      ...results.wake,
    },
    {
      type: "system",
      subtype: "status",
      status: "compacting",
      session_id: WAKE_SESSION,
      uuid: "status-compacting",
    },
    {
      type: "system",
      subtype: "status",
      status: null,
      compact_result: "success",
      session_id: WAKE_SESSION,
      uuid: "status-compacted",
    },
    { type: "system", subtype: "init", session_id: WAKE_SESSION, uuid: "init-compact" },
    {
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: { trigger: "manual", pre_tokens: 386_000, post_tokens: 9_890 },
      session_id: WAKE_SESSION,
      uuid: "compact-boundary",
    },
    {
      type: "user",
      message: { role: "user", content: "This session is being continued from a summary." },
      parent_tool_use_id: null,
      session_id: WAKE_SESSION,
      uuid: "compact-summary",
    },
    {
      type: "user",
      message: { role: "user", content: "<local-command-stdout>Compacted </local-command-stdout>" },
      parent_tool_use_id: null,
      isReplay: true,
      session_id: WAKE_SESSION,
      uuid: "compact-stdout",
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 0,
      result: "",
      stop_reason: null,
      session_id: WAKE_SESSION,
      uuid: "result-compact",
      ...results.compact,
    },
  ];
  // A notice the adapter drains the stream up to, so every case reads the
  // same, complete set of events.
  const DRAINED = "claude-sdk-messages-drained";
  const drainedNotice = {
    type: "system",
    subtype: "notification",
    key: "drained",
    text: DRAINED,
    priority: "high",
    session_id: WAKE_SESSION,
    uuid: "notification-drained",
  };
  // The session lifecycle a thread projects from the adapter's events. A
  // working state no turn carries has nothing that will ever settle it.
  const lifecycleOf = (events: ReadonlyArray<ProviderRuntimeEvent>) =>
    events.flatMap((event) =>
      event.type === "turn.started" || event.type === "turn.completed"
        ? [event.type]
        : event.type === "session.state.changed"
          ? [event.turnId === undefined ? `${event.payload.state}, no turn` : event.payload.state]
          : [],
    );

  it.effect.each([
    {
      name: "the /compact whose turn a background wake's result closed",
      sendsCompact: true,
      messages: wakeAheadOfCompact({ wake: {}, compact: {} }),
      lifecycle: ["ready, no turn", "turn.started", "running", "turn.completed"],
    },
    {
      name: "a permission mode change between turns",
      sendsCompact: false,
      messages: [
        {
          type: "system",
          subtype: "status",
          status: null,
          permissionMode: "plan",
          session_id: WAKE_SESSION,
          uuid: "status-permission-mode",
        },
      ],
      lifecycle: ["ready, no turn"],
    },
  ])("leaves the session settled after $name", ({ sendsCompact, messages, lifecycle }) => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) => event.type === "runtime.warning" && event.payload.message === DRAINED,
        ),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      if (sendsCompact) {
        // ProviderService.compactThread's slash-command fallback for Claude.
        yield* adapter.sendTurn({ threadId: THREAD_ID, input: "/compact", attachments: [] });
      }
      for (const message of [...messages, drainedNotice]) {
        harness.query.emit(message as unknown as SDKMessage);
      }

      assert.deepEqual(lifecycleOf(Array.from(yield* Fiber.join(runtimeEventsFiber))), lifecycle);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("keeps a /compact turn open through a background wake the CLI ran ahead of it", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) => event.type === "runtime.warning" && event.payload.message === DRAINED,
        ),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      const turn = yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "/compact",
        attachments: [],
      });
      // As the CLI writes them: the wake's result is marked as a turn it
      // started itself, the /compact's names the send it answers.
      const messages = wakeAheadOfCompact({
        wake: { origin: { kind: "task-notification" } },
        compact: {
          user_message_uuid: turn.turnId,
          user_message_uuids: [turn.turnId],
          local_command: "compact",
        },
      });
      for (const message of [...messages, drainedNotice]) {
        harness.query.emit(message as unknown as SDKMessage);
      }
      const events = Array.from(yield* Fiber.join(runtimeEventsFiber));

      assert.deepEqual(lifecycleOf(events), [
        "ready, no turn",
        "turn.started",
        "running",
        "waiting",
        "running",
        "turn.completed",
      ]);
      // ProviderService.compactThread settles on this turn's completion, and
      // the compaction it reports belongs to the turn that ran it.
      const compactedAt = events.findIndex(
        (event) => event.type === "thread.state.changed" && event.payload.state === "compacted",
      );
      const completedAt = events.findIndex((event) => event.type === "turn.completed");
      assert.equal(events[compactedAt]?.turnId, turn.turnId);
      assert.equal(events[completedAt]?.turnId, turn.turnId);
      assert.ok(compactedAt < completedAt, "the turn ends after its compaction");
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect.each([
    {
      name: "a background wake's result",
      result: () => ({ origin: { kind: "task-notification" } }),
      closes: false,
    },
    {
      name: "the result of another send",
      result: () => ({ user_message_uuid: "another-send", user_message_uuids: ["another-send"] }),
      closes: false,
    },
    {
      name: "a wake's result that took this turn's message in",
      result: (turnId: string) => ({
        origin: { kind: "task-notification" },
        user_message_uuid: turnId,
        user_message_uuids: [turnId],
      }),
      closes: true,
    },
    {
      name: "this turn's own result",
      result: (turnId: string) => ({ user_message_uuid: turnId, user_message_uuids: [turnId] }),
      closes: true,
    },
    {
      name: "a result that names no send",
      result: () => ({}),
      closes: true,
    },
  ])("a sent turn is ended by $name: $closes", ({ result, closes }) => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) => event.type === "runtime.warning" && event.payload.message === DRAINED,
        ),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      const turn = yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "hello",
        attachments: [],
      });
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        num_turns: 1,
        result: "done",
        stop_reason: "end_turn",
        session_id: WAKE_SESSION,
        uuid: "result-attribution",
        ...result(turn.turnId),
      } as unknown as SDKMessage);
      harness.query.emit(drainedNotice as unknown as SDKMessage);

      assert.deepEqual(
        lifecycleOf(Array.from(yield* Fiber.join(runtimeEventsFiber))),
        closes
          ? ["ready, no turn", "turn.started", "turn.completed"]
          : ["ready, no turn", "turn.started"],
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("ends a background wake's own turn on its result", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil(
          (event) => event.type === "runtime.warning" && event.payload.message === DRAINED,
        ),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      // The wake's turn alone, with nothing sent: its reply opens the turn.
      const wakeTurn = wakeAheadOfCompact({
        wake: { origin: { kind: "task-notification" } },
        compact: {},
      }).slice(0, 4);
      for (const message of [...wakeTurn, drainedNotice]) {
        harness.query.emit(message as unknown as SDKMessage);
      }

      assert.deepEqual(lifecycleOf(Array.from(yield* Fiber.join(runtimeEventsFiber))), [
        "ready, no turn",
        "turn.started",
        "turn.completed",
      ]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("re-announces a Claude limit for a synthetic turn", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const { runtimeEvents, runtimeEventsFiber, drainSdkMessages } =
        yield* observeUsageLimitEvents(adapter, harness.query);

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "hello", attachments: [] });

      const nowMs = yield* Clock.currentTimeMillis;
      const rejected = {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          rateLimitType: "five_hour",
          resetsAt: Math.floor(nowMs / 1000) + 2 * 60 * 60,
        },
        session_id: "sdk-session-synthetic",
        uuid: "rate-limit-synthetic",
      };
      harness.query.emit(rejected as unknown as SDKMessage);
      yield* drainSdkMessages;

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-synthetic",
        uuid: "result-synthetic",
      } as unknown as SDKMessage);
      yield* drainSdkMessages;

      // A background agent answering between prompts auto-starts a synthetic
      // turn, which parks on the same window and needs its own row.
      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-synthetic",
        uuid: "assistant-synthetic",
        parent_tool_use_id: null,
        message: {
          id: "assistant-message-synthetic",
          content: [{ type: "text", text: "Following up" }],
        },
      } as unknown as SDKMessage);
      yield* drainSdkMessages;
      harness.query.emit({ ...rejected, uuid: "rate-limit-synthetic-2" } as unknown as SDKMessage);
      yield* drainSdkMessages;

      assert.equal(runtimeEvents.filter((event) => event.type === "runtime.warning").length, 2);

      runtimeEventsFiber.interruptUnsafe();
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("drops an unusable Claude reset time, not the row or the session", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const { runtimeEvents, runtimeEventsFiber, drainSdkMessages } =
        yield* observeUsageLimitEvents(adapter, harness.query);

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "hello", attachments: [] });

      for (const [rateLimitType, resetsAt] of [
        ["five_hour", undefined],
        // Implausibly far out once scaled to milliseconds: no credible wait.
        ["seven_day", 1e20],
      ] as const) {
        harness.query.emit({
          type: "rate_limit_event",
          rate_limit_info: { status: "rejected", rateLimitType, resetsAt },
          session_id: "sdk-session-limit-unusable",
          uuid: `rate-limit-${rateLimitType}`,
        } as unknown as SDKMessage);
      }
      yield* drainSdkMessages;

      assert.deepEqual(
        runtimeEvents
          .filter((event) => event.type === "runtime.warning")
          .map((event) => (event.type === "runtime.warning" ? event.payload.message : "")),
        [
          "Claude usage limit reached. This turn is paused until the 5-hour limit resets.",
          "Claude usage limit reached. This turn is paused until the 7-day limit resets.",
        ],
      );
      // A throw inside the telemetry handler would tear the session down.
      assert.deepEqual(
        runtimeEvents
          .filter((event) => event.type === "session.exited" || event.type === "runtime.error")
          .map((event) => event.type),
        [],
      );
      // Still live enough to take the next turn.
      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "still here", attachments: [] });

      runtimeEventsFiber.interruptUnsafe();
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("warns for unmapped Claude limits and names the probed model bucket", () => {
    const scopedLimitNames = Ref.makeUnsafe<ClaudeScopedLimitNames>({ overageIncluded: undefined });
    const harness = makeHarness({ scopedLimitNames });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const { runtimeEvents, runtimeEventsFiber, drainSdkMessages } =
        yield* observeUsageLimitEvents(adapter, harness.query);
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId: THREAD_ID, input: "hello", attachments: [] });

      for (const rateLimitType of ["seven_day_overage_included", "future_window"]) {
        harness.query.emit({
          type: "rate_limit_event",
          rate_limit_info: { status: "rejected", rateLimitType },
          session_id: "sdk-session-unmapped-limit",
          uuid: `rejected-${rateLimitType}`,
        } as unknown as SDKMessage);
      }
      yield* drainSdkMessages;
      assert.deepEqual(
        runtimeEvents.filter((event) => event.type === "account.rate-limits.updated"),
        [],
      );

      yield* Ref.set(scopedLimitNames, { overageIncluded: "Model A" });
      const nowMs = yield* Clock.currentTimeMillis;
      harness.query.emit({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          rateLimitType: "seven_day_overage_included",
          utilization: 1,
          resetsAt: Math.floor(nowMs / 1000) + 3600,
        },
        session_id: "sdk-session-unmapped-limit",
        uuid: "rejected-probed-bucket",
      } as unknown as SDKMessage);
      yield* drainSdkMessages;
      assert.deepEqual(
        runtimeEvents
          .filter((event) => event.type === "runtime.warning")
          .map((event) => event.payload.message),
        [
          "Claude usage limit reached. This turn is paused until the 7-day model limit resets.",
          "Claude usage limit reached. This turn is paused until the limit resets.",
          "Claude usage limit reached. This turn is paused until the 7-day Model A limit resets in 1h.",
        ],
      );
      assert.equal(
        runtimeEvents.filter((event) => event.type === "account.rate-limits.updated").length,
        1,
      );
      runtimeEventsFiber.interruptUnsafe();
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("consumes Claude command lifecycle notifications silently", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const sessionId = "6e81554e-5cff-4b37-8a39-f3a9051ac234";

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const readyMessage = "command lifecycle test ready";
      const readyFiber = yield* Stream.takeUntil(
        adapter.streamEvents,
        (event) => event.type === "runtime.warning" && event.payload.message === readyMessage,
      ).pipe(Stream.runDrain, Effect.forkChild);
      harness.query.emit({
        type: "system",
        subtype: "notification",
        key: "command-lifecycle-ready",
        text: readyMessage,
        priority: "high",
        session_id: sessionId,
        uuid: "command-lifecycle-ready",
      } as unknown as SDKMessage);
      yield* Fiber.join(readyFiber);

      const processedMessage = "command lifecycle messages processed";
      const runtimeEventsFiber = yield* Stream.takeUntil(
        adapter.streamEvents,
        (event) => event.type === "runtime.warning" && event.payload.message === processedMessage,
      ).pipe(Stream.runCollect, Effect.forkChild);
      for (const [state, uuid] of [
        ["started", "command-started"],
        ["completed", "command-completed"],
      ]) {
        harness.query.emit({
          type: "command_lifecycle",
          command_uuid: "4cd8e8a3-df7a-425d-b6c9-4053abc0b8fd",
          state,
          session_id: sessionId,
          uuid,
        } as unknown as SDKMessage);
      }
      harness.query.emit({
        type: "system",
        subtype: "notification",
        key: "command-lifecycle-processed",
        text: processedMessage,
        priority: "high",
        session_id: sessionId,
        uuid: "command-lifecycle-processed",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        ["runtime.warning"],
      );
      const warning = runtimeEvents[0];
      assert.equal(warning?.type, "runtime.warning");
      if (warning?.type === "runtime.warning") {
        assert.equal(warning.payload.message, processedMessage);
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("emits thread token usage updates from Claude task progress", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 6).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      harness.query.emit({
        type: "system",
        subtype: "task_progress",
        task_id: "task-usage-1",
        description: "Thinking through the patch",
        usage: {
          total_tokens: 321,
          tool_uses: 2,
          duration_ms: 654,
        },
        session_id: "sdk-session-task-usage",
        uuid: "task-usage-progress-1",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const usageEvent = runtimeEvents.find((event) => event.type === "thread.token-usage.updated");
      const progressEvent = runtimeEvents.find((event) => event.type === "task.progress");
      assert.equal(usageEvent?.type, "thread.token-usage.updated");
      if (usageEvent?.type === "thread.token-usage.updated") {
        assert.deepEqual(usageEvent.payload, {
          usage: {
            usedTokens: 321,
            lastUsedTokens: 321,
            toolUses: 2,
            durationMs: 654,
          },
        });
      }
      assert.equal(progressEvent?.type, "task.progress");
      if (usageEvent && progressEvent) {
        assert.notStrictEqual(usageEvent.eventId, progressEvent.eventId);
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("emits Claude context window on result completion usage snapshots", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 7).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "hello",
        attachments: [],
      });

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1234,
        duration_api_ms: 1200,
        num_turns: 1,
        result: "done",
        stop_reason: "end_turn",
        session_id: "sdk-session-result-usage",
        usage: {
          input_tokens: 4,
          cache_creation_input_tokens: 2715,
          cache_read_input_tokens: 21144,
          output_tokens: 679,
        },
        modelUsage: {
          [SYNTHETIC_CLAUDE_CAPABLE_MODEL]: {
            contextWindow: 200000,
            maxOutputTokens: 64000,
          },
        },
      } as unknown as SDKMessage);
      harness.query.finish();

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const usageEvent = runtimeEvents.find((event) => event.type === "thread.token-usage.updated");
      assert.equal(usageEvent?.type, "thread.token-usage.updated");
      if (usageEvent?.type === "thread.token-usage.updated") {
        assert.deepEqual(usageEvent.payload, {
          usage: {
            usedTokens: 24542,
            lastUsedTokens: 24542,
            inputTokens: 23863,
            outputTokens: 679,
            maxTokens: 200000,
          },
        });
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("clamps oversized Claude usage to the reported context window", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 7).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "hello",
        attachments: [],
      });

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1234,
        duration_api_ms: 1200,
        num_turns: 1,
        result: "done",
        stop_reason: "end_turn",
        session_id: "sdk-session-result-usage-clamped",
        usage: {
          total_tokens: 535000,
        },
        modelUsage: {
          [SYNTHETIC_CLAUDE_CAPABLE_MODEL]: {
            contextWindow: 200000,
            maxOutputTokens: 64000,
          },
        },
      } as unknown as SDKMessage);
      harness.query.finish();

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const usageEvent = runtimeEvents.find((event) => event.type === "thread.token-usage.updated");
      assert.equal(usageEvent?.type, "thread.token-usage.updated");
      if (usageEvent?.type === "thread.token-usage.updated") {
        assert.deepEqual(usageEvent.payload, {
          usage: {
            usedTokens: 200000,
            lastUsedTokens: 200000,
            totalProcessedTokens: 535000,
            maxTokens: 200000,
          },
        });
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect(
    "preserves oversized Claude result totals after task progress snapshots are recorded",
    () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;

        const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 9).pipe(
          Stream.runCollect,
          Effect.forkChild,
        );

        yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("claudeAgent"),
          runtimeMode: "full-access",
        });

        yield* adapter.sendTurn({
          threadId: THREAD_ID,
          input: "hello",
          attachments: [],
        });

        harness.query.emit({
          type: "system",
          subtype: "task_progress",
          task_id: "task-usage-clamped",
          description: "Thinking through the patch",
          usage: {
            total_tokens: 190000,
          },
          session_id: "sdk-session-task-usage-clamped",
          uuid: "task-usage-progress-clamped",
        } as unknown as SDKMessage);

        harness.query.emit({
          type: "result",
          subtype: "success",
          is_error: false,
          duration_ms: 1234,
          duration_api_ms: 1200,
          num_turns: 1,
          result: "done",
          stop_reason: "end_turn",
          session_id: "sdk-session-result-usage-clamped-after-progress",
          usage: {
            total_tokens: 535000,
          },
          modelUsage: {
            [SYNTHETIC_CLAUDE_CAPABLE_MODEL]: {
              contextWindow: 200000,
              maxOutputTokens: 64000,
            },
          },
        } as unknown as SDKMessage);
        harness.query.finish();

        const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
        const usageEvents = runtimeEvents.filter(
          (event) => event.type === "thread.token-usage.updated",
        );
        const finalUsageEvent = usageEvents.at(-1);
        assert.equal(finalUsageEvent?.type, "thread.token-usage.updated");
        if (finalUsageEvent?.type === "thread.token-usage.updated") {
          assert.deepEqual(finalUsageEvent.payload, {
            usage: {
              usedTokens: 190000,
              lastUsedTokens: 190000,
              totalProcessedTokens: 535000,
              maxTokens: 200000,
            },
          });
        }
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );

  it.effect(
    "emits completion only after turn result when assistant frames arrive before deltas",
    () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;

        const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 8).pipe(
          Stream.runCollect,
          Effect.forkChild,
        );

        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("claudeAgent"),
          runtimeMode: "full-access",
        });

        const turn = yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "hello",
          attachments: [],
        });

        harness.query.emit({
          type: "assistant",
          session_id: "sdk-session-early-assistant",
          uuid: "assistant-early",
          parent_tool_use_id: null,
          message: {
            id: "assistant-message-early",
            content: [
              { type: "tool_use", id: "tool-early", name: "Read", input: { path: "a.ts" } },
            ],
          },
        } as unknown as SDKMessage);

        harness.query.emit({
          type: "stream_event",
          session_id: "sdk-session-early-assistant",
          uuid: "stream-early",
          parent_tool_use_id: null,
          event: {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "text_delta",
              text: "Late text",
            },
          },
        } as unknown as SDKMessage);

        harness.query.emit({
          type: "result",
          subtype: "success",
          is_error: false,
          errors: [],
          session_id: "sdk-session-early-assistant",
          uuid: "result-early",
        } as unknown as SDKMessage);

        const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
        assert.deepEqual(
          runtimeEvents.map((event) => event.type),
          [
            "session.started",
            "session.configured",
            "session.state.changed",
            "turn.started",
            "thread.started",
            "content.delta",
            "item.completed",
            "turn.completed",
          ],
        );

        const deltaIndex = runtimeEvents.findIndex((event) => event.type === "content.delta");
        const completedIndex = runtimeEvents.findIndex((event) => event.type === "item.completed");
        assert.equal(deltaIndex >= 0 && completedIndex >= 0 && deltaIndex < completedIndex, true);

        const deltaEvent = runtimeEvents[deltaIndex];
        assert.equal(deltaEvent?.type, "content.delta");
        if (deltaEvent?.type === "content.delta") {
          assert.equal(deltaEvent.payload.delta, "Late text");
          assert.equal(String(deltaEvent.turnId), String(turn.turnId));
        }
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );

  it.effect("creates a fresh assistant message when Claude reuses a text block index", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 9).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-reused-text-index",
        uuid: "stream-reused-start-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "text",
            text: "",
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-reused-text-index",
        uuid: "stream-reused-delta-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "text_delta",
            text: "First",
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-reused-text-index",
        uuid: "stream-reused-stop-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_stop",
          index: 0,
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-reused-text-index",
        uuid: "stream-reused-start-2",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "text",
            text: "",
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-reused-text-index",
        uuid: "stream-reused-delta-2",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "text_delta",
            text: "Second",
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-reused-text-index",
        uuid: "stream-reused-stop-2",
        parent_tool_use_id: null,
        event: {
          type: "content_block_stop",
          index: 0,
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-reused-text-index",
        uuid: "result-reused-text-index",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "thread.started",
          "content.delta",
          "item.completed",
          "content.delta",
          "item.completed",
        ],
      );

      const assistantDeltas = runtimeEvents.filter(
        (event) => event.type === "content.delta" && event.payload.streamKind === "assistant_text",
      );
      assert.equal(assistantDeltas.length, 2);
      if (assistantDeltas.length !== 2) {
        return;
      }
      const [firstAssistantDelta, secondAssistantDelta] = assistantDeltas;
      assert.equal(firstAssistantDelta?.type, "content.delta");
      assert.equal(secondAssistantDelta?.type, "content.delta");
      if (
        firstAssistantDelta?.type !== "content.delta" ||
        secondAssistantDelta?.type !== "content.delta"
      ) {
        return;
      }
      assert.equal(firstAssistantDelta.payload.delta, "First");
      assert.equal(secondAssistantDelta.payload.delta, "Second");
      assert.notEqual(firstAssistantDelta.itemId, secondAssistantDelta.itemId);

      const assistantCompletions = runtimeEvents.filter(
        (event) =>
          event.type === "item.completed" && event.payload.itemType === "assistant_message",
      );
      assert.equal(assistantCompletions.length, 2);
      assert.equal(String(assistantCompletions[0]?.itemId), String(firstAssistantDelta.itemId));
      assert.equal(String(assistantCompletions[1]?.itemId), String(secondAssistantDelta.itemId));
      assert.notEqual(
        String(assistantCompletions[0]?.itemId),
        String(assistantCompletions[1]?.itemId),
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("falls back to assistant payload text when stream deltas are absent", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 8).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-fallback-text",
        uuid: "assistant-fallback",
        parent_tool_use_id: null,
        message: {
          id: "assistant-message-fallback",
          content: [{ type: "text", text: "Fallback hello" }],
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-fallback-text",
        uuid: "result-fallback",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "thread.started",
          "content.delta",
          "item.completed",
          "turn.completed",
        ],
      );

      const deltaEvent = runtimeEvents.find((event) => event.type === "content.delta");
      assert.equal(deltaEvent?.type, "content.delta");
      if (deltaEvent?.type === "content.delta") {
        assert.equal(deltaEvent.payload.delta, "Fallback hello");
        assert.equal(String(deltaEvent.turnId), String(turn.turnId));
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("segments Claude assistant text blocks around tool calls", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 13).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-interleaved",
        uuid: "stream-text-1-start",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "text",
            text: "",
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-interleaved",
        uuid: "stream-text-1-delta",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "text_delta",
            text: "First message.",
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-interleaved",
        uuid: "stream-text-1-stop",
        parent_tool_use_id: null,
        event: {
          type: "content_block_stop",
          index: 0,
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-interleaved",
        uuid: "stream-tool-start",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "tool-interleaved-1",
            name: "Grep",
            input: {
              pattern: "assistant",
              path: "src",
            },
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-interleaved",
        uuid: "stream-tool-stop",
        parent_tool_use_id: null,
        event: {
          type: "content_block_stop",
          index: 1,
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "user",
        session_id: "sdk-session-interleaved",
        uuid: "user-tool-result-interleaved",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-interleaved-1",
              content: "src/example.ts:1:assistant",
            },
          ],
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-interleaved",
        uuid: "stream-text-2-start",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 2,
          content_block: {
            type: "text",
            text: "",
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-interleaved",
        uuid: "stream-text-2-delta",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 2,
          delta: {
            type: "text_delta",
            text: "Second message.",
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-interleaved",
        uuid: "stream-text-2-stop",
        parent_tool_use_id: null,
        event: {
          type: "content_block_stop",
          index: 2,
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-interleaved",
        uuid: "result-interleaved",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "thread.started",
          "content.delta",
          "item.completed",
          "item.started",
          "item.updated",
          "item.completed",
          "content.delta",
          "item.completed",
          "turn.completed",
        ],
      );

      const assistantTextDeltas = runtimeEvents.filter(
        (event) => event.type === "content.delta" && event.payload.streamKind === "assistant_text",
      );
      assert.equal(assistantTextDeltas.length, 2);
      if (assistantTextDeltas.length !== 2) {
        return;
      }
      const [firstAssistantDelta, secondAssistantDelta] = assistantTextDeltas;
      if (!firstAssistantDelta || !secondAssistantDelta) {
        return;
      }
      assert.notEqual(String(firstAssistantDelta.itemId), String(secondAssistantDelta.itemId));

      const firstAssistantCompletedIndex = runtimeEvents.findIndex(
        (event) =>
          event.type === "item.completed" &&
          event.payload.itemType === "assistant_message" &&
          String(event.itemId) === String(firstAssistantDelta.itemId),
      );
      const toolStartedIndex = runtimeEvents.findIndex((event) => event.type === "item.started");
      const secondAssistantDeltaIndex = runtimeEvents.findIndex(
        (event) =>
          event.type === "content.delta" &&
          event.payload.streamKind === "assistant_text" &&
          String(event.itemId) === String(secondAssistantDelta.itemId),
      );

      assert.equal(
        firstAssistantCompletedIndex >= 0 &&
          toolStartedIndex >= 0 &&
          secondAssistantDeltaIndex >= 0 &&
          firstAssistantCompletedIndex < toolStartedIndex &&
          toolStartedIndex < secondAssistantDeltaIndex,
        true,
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("does not fabricate provider thread ids before first SDK session_id", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 5).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      assert.equal(session.threadId, THREAD_ID);

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });
      assert.equal(turn.threadId, THREAD_ID);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-thread-real",
        uuid: "stream-thread-real",
        parent_tool_use_id: null,
        event: {
          type: "message_start",
          message: {
            id: "msg-thread-real",
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-thread-real",
        uuid: "result-thread-real",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        [
          "session.started",
          "session.configured",
          "session.state.changed",
          "turn.started",
          "thread.started",
        ],
      );

      const sessionStarted = runtimeEvents[0];
      assert.equal(sessionStarted?.type, "session.started");
      if (sessionStarted?.type === "session.started") {
        assert.equal(sessionStarted.threadId, THREAD_ID);
      }

      const threadStarted = runtimeEvents[4];
      assert.equal(threadStarted?.type, "thread.started");
      if (threadStarted?.type === "thread.started") {
        assert.equal(threadStarted.threadId, THREAD_ID);
        assert.deepEqual(threadStarted.payload, {
          providerThreadId: "sdk-thread-real",
        });
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("bridges approval request/response lifecycle through canUseTool", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "approval-required",
      });

      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "approve this",
        attachments: [],
      });
      yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runDrain);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-approval-1",
        uuid: "stream-approval-thread",
        parent_tool_use_id: null,
        event: {
          type: "message_start",
          message: {
            id: "msg-approval-thread",
          },
        },
      } as unknown as SDKMessage);

      const threadStarted = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(threadStarted._tag, "Some");
      if (threadStarted._tag !== "Some" || threadStarted.value.type !== "thread.started") {
        return;
      }

      const createInput = harness.getLastCreateQueryInput();
      const canUseTool = createInput?.options.canUseTool;
      assert.equal(typeof canUseTool, "function");
      if (!canUseTool) {
        return;
      }

      const permissionPromise = canUseTool(
        "Bash",
        { command: "pwd" },
        {
          signal: new AbortController().signal,
          requestId: "request-1",
          suggestions: [
            {
              type: "setMode",
              mode: "default",
              destination: "session",
            },
          ],
          toolUseID: "tool-use-1",
        },
      );

      const requested = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(requested._tag, "Some");
      if (requested._tag !== "Some") {
        return;
      }
      assert.equal(requested.value.type, "request.opened");
      if (requested.value.type !== "request.opened") {
        return;
      }
      assert.deepEqual(requested.value.providerRefs, {
        providerItemId: ProviderItemId.make("tool-use-1"),
      });
      const runtimeRequestId = requested.value.requestId;
      assert.equal(typeof runtimeRequestId, "string");
      if (runtimeRequestId === undefined) {
        return;
      }

      yield* adapter.respondToRequest(
        session.threadId,
        ApprovalRequestId.make(runtimeRequestId),
        "accept",
      );

      const resolved = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(resolved._tag, "Some");
      if (resolved._tag !== "Some") {
        return;
      }
      assert.equal(resolved.value.type, "request.resolved");
      if (resolved.value.type !== "request.resolved") {
        return;
      }
      assert.equal(resolved.value.requestId, requested.value.requestId);
      assert.equal(resolved.value.payload.decision, "accept");
      assert.deepEqual(resolved.value.providerRefs, {
        providerItemId: ProviderItemId.make("tool-use-1"),
      });

      const permissionResult = yield* Effect.promise(() => permissionPromise);
      assert.equal((permissionResult as PermissionResult).behavior, "allow");
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("acceptForSession returns session-scoped permission updates", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "approval-required",
      });

      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "approve this for the session",
        attachments: [],
      });
      yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runDrain);

      const createInput = harness.getLastCreateQueryInput();
      const canUseTool = createInput?.options.canUseTool;
      assert.equal(typeof canUseTool, "function");
      if (!canUseTool) {
        return;
      }

      const respondToNextRequest = Effect.gen(function* () {
        const requested = yield* Stream.runHead(adapter.streamEvents);
        assert.equal(requested._tag, "Some");
        if (requested._tag !== "Some" || requested.value.type !== "request.opened") {
          return;
        }
        const runtimeRequestId = requested.value.requestId;
        assert.equal(typeof runtimeRequestId, "string");
        if (runtimeRequestId === undefined) {
          return;
        }
        yield* adapter.respondToRequest(
          session.threadId,
          ApprovalRequestId.make(runtimeRequestId),
          "acceptForSession",
        );
        yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runDrain);
      });

      // MCP tools frequently arrive with no usable suggestion (Claude Code
      // sends an empty array); the decision must still stick for the session.
      const mcpPermissionPromise = canUseTool(
        "mcp__linear__create_issue",
        { title: "hello" },
        {
          signal: new AbortController().signal,
          requestId: "request-2",
          suggestions: [],
          toolUseID: "tool-use-mcp-1",
        },
      );
      yield* respondToNextRequest;
      const mcpPermission = (yield* Effect.promise(() => mcpPermissionPromise)) as PermissionResult;
      assert.equal(mcpPermission.behavior, "allow");
      if (mcpPermission.behavior !== "allow") {
        return;
      }
      assert.deepEqual(mcpPermission.updatedPermissions, [
        {
          type: "addRules",
          rules: [{ toolName: "mcp__linear__create_issue" }],
          behavior: "allow",
          destination: "session",
        },
      ]);

      // Received suggestions are reused but rescoped to the session —
      // echoing "localSettings" would persist a session-only choice to disk.
      const bashPermissionPromise = canUseTool(
        "Bash",
        { command: "git status" },
        {
          signal: new AbortController().signal,
          requestId: "request-3",
          suggestions: [
            {
              type: "addRules",
              rules: [{ toolName: "Bash", ruleContent: "git status" }],
              behavior: "allow",
              destination: "localSettings",
            },
          ],
          toolUseID: "tool-use-bash-1",
        },
      );
      yield* respondToNextRequest;
      const bashPermission = (yield* Effect.promise(
        () => bashPermissionPromise,
      )) as PermissionResult;
      assert.equal(bashPermission.behavior, "allow");
      if (bashPermission.behavior !== "allow") {
        return;
      }
      assert.deepEqual(bashPermission.updatedPermissions, [
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "git status" }],
          behavior: "allow",
          destination: "session",
        },
      ]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("classifies Agent tools and read-only Claude tools correctly for approvals", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "approval-required",
      });

      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);

      const createInput = harness.getLastCreateQueryInput();
      const canUseTool = createInput?.options.canUseTool;
      assert.equal(typeof canUseTool, "function");
      if (!canUseTool) {
        return;
      }

      const agentPermissionPromise = canUseTool(
        "Agent",
        {},
        {
          signal: new AbortController().signal,
          requestId: "request-4",
          toolUseID: "tool-agent-1",
        },
      );

      const agentRequested = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(agentRequested._tag, "Some");
      if (agentRequested._tag !== "Some" || agentRequested.value.type !== "request.opened") {
        return;
      }
      assert.equal(agentRequested.value.payload.requestType, "dynamic_tool_call");

      yield* adapter.respondToRequest(
        session.threadId,
        ApprovalRequestId.make(String(agentRequested.value.requestId)),
        "accept",
      );
      yield* Stream.runHead(adapter.streamEvents);
      yield* Effect.promise(() => agentPermissionPromise);

      const grepPermissionPromise = canUseTool(
        "Grep",
        { pattern: "foo", path: "src" },
        {
          signal: new AbortController().signal,
          requestId: "request-5",
          toolUseID: "tool-grep-approval-1",
        },
      );

      const grepRequested = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(grepRequested._tag, "Some");
      if (grepRequested._tag !== "Some" || grepRequested.value.type !== "request.opened") {
        return;
      }
      assert.equal(grepRequested.value.payload.requestType, "file_read_approval");

      yield* adapter.respondToRequest(
        session.threadId,
        ApprovalRequestId.make(String(grepRequested.value.requestId)),
        "accept",
      );
      yield* Stream.runHead(adapter.streamEvents);
      yield* Effect.promise(() => grepPermissionPromise);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("passes Claude resume ids without pinning a stale assistant checkpoint", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: RESUME_THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        resumeCursor: {
          threadId: "resume-thread-1",
          resume: "550e8400-e29b-41d4-a716-446655440000",
          resumeSessionAt: "assistant-99",
          turnCount: 3,
        },
        runtimeMode: "full-access",
      });

      assert.equal(session.threadId, RESUME_THREAD_ID);
      assert.deepEqual(session.resumeCursor, {
        threadId: RESUME_THREAD_ID,
        resume: "550e8400-e29b-41d4-a716-446655440000",
        resumeSessionAt: "assistant-99",
        turnCount: 3,
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.equal(createInput?.options.resume, "550e8400-e29b-41d4-a716-446655440000");
      assert.equal(createInput?.options.sessionId, undefined);
      assert.equal(createInput?.options.resumeSessionAt, undefined);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("preserves durable resume ids across Claude resume hooks", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const durableSessionId = "550e8400-e29b-41d4-a716-446655440000";
      const transientHookSessionId = "7368d0c7-40a3-4d8a-bcc1-ac80c49f2719";

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 7).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        threadId: RESUME_THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        resumeCursor: {
          threadId: RESUME_THREAD_ID,
          resume: durableSessionId,
          resumeSessionAt: "assistant-99",
          turnCount: 3,
        },
        runtimeMode: "full-access",
      });

      harness.query.emit({
        type: "system",
        subtype: "hook_started",
        hook_id: "resume-hook-1",
        hook_name: "SessionStart:resume",
        hook_event: "SessionStart",
        session_id: transientHookSessionId,
        uuid: "resume-hook-started",
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "system",
        subtype: "hook_response",
        hook_id: "resume-hook-1",
        hook_name: "SessionStart:resume",
        hook_event: "SessionStart",
        output: "",
        stdout: "",
        stderr: "",
        outcome: "success",
        session_id: transientHookSessionId,
        uuid: "resume-hook-response",
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "system",
        subtype: "init",
        apiKeySource: "none",
        claude_code_version: "test",
        cwd: "/tmp/claude-adapter-test",
        tools: [],
        mcp_servers: [],
        model: SYNTHETIC_CLAUDE_STANDARD_MODEL,
        permissionMode: "bypassPermissions",
        slash_commands: [],
        output_style: "default",
        skills: [],
        plugins: [],
        session_id: durableSessionId,
        uuid: "resume-init",
      } as unknown as SDKMessage);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const threadStartedEvents = runtimeEvents.filter((event) => event.type === "thread.started");
      assert.equal(threadStartedEvents.length, 1);
      const threadStarted = threadStartedEvents[0];
      assert.equal(threadStarted?.type, "thread.started");
      if (threadStarted?.type === "thread.started") {
        assert.deepEqual(threadStarted.payload, {
          providerThreadId: durableSessionId,
        });
      }

      const activeSessions = yield* adapter.listSessions();
      const resumeCursor = activeSessions[0]?.resumeCursor as
        | {
            readonly resume?: string;
          }
        | undefined;
      assert.equal(resumeCursor?.resume, durableSessionId);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("uses an app-generated Claude session id for fresh sessions", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const createInput = harness.getLastCreateQueryInput();
      const sessionResumeCursor = session.resumeCursor as {
        threadId?: string;
        resume?: string;
        turnCount?: number;
      };
      assert.equal(sessionResumeCursor.threadId, THREAD_ID);
      assert.equal(typeof sessionResumeCursor.resume, "string");
      assert.equal(sessionResumeCursor.turnCount, 0);
      assert.match(
        sessionResumeCursor.resume ?? "",
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      assert.equal(createInput?.options.resume, undefined);
      assert.equal(createInput?.options.sessionId, sessionResumeCursor.resume);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("rewinds a steered Claude turn after recovery and preserves fork boundaries", () => {
    const forkCalls: Array<Parameters<NonNullable<ClaudeAdapterLiveOptions["forkSession"]>>> = [];
    let firstTurnId = "";
    let secondTurnId = "";
    let missingBoundary = false;
    let legacyHistory = false;
    const harness = makeHarness({
      forkSession: async (...args) => {
        forkCalls.push(args);
        return { sessionId: "550e8400-e29b-41d4-a716-446655440020" };
      },
      getSessionMessages: async (sessionId) => {
        const history: Awaited<
          ReturnType<NonNullable<ClaudeAdapterLiveOptions["getSessionMessages"]>>
        > = [
          {
            type: "user",
            uuid: firstTurnId,
            session_id: "550e8400-e29b-41d4-a716-446655440010",
            parent_tool_use_id: null,
            parent_agent_id: null,
            message: { content: "first" },
          },
          {
            type: "assistant",
            uuid: "assistant-1",
            session_id: "550e8400-e29b-41d4-a716-446655440010",
            parent_tool_use_id: null,
            parent_agent_id: null,
            message: { content: [] },
          },
          {
            type: "user",
            uuid: "tool-result-1",
            session_id: "550e8400-e29b-41d4-a716-446655440010",
            parent_tool_use_id: null,
            parent_agent_id: null,
            message: { content: [{ type: "tool_result" }] },
          },
          {
            type: "assistant",
            uuid: "assistant-1-final",
            session_id: "550e8400-e29b-41d4-a716-446655440010",
            parent_tool_use_id: null,
            parent_agent_id: null,
            message: { content: [] },
          },
          {
            type: "user",
            uuid: secondTurnId,
            session_id: "550e8400-e29b-41d4-a716-446655440010",
            parent_tool_use_id: null,
            parent_agent_id: null,
            message: { content: "second" },
          },
          {
            type: "assistant",
            uuid: "assistant-2",
            session_id: "550e8400-e29b-41d4-a716-446655440010",
            parent_tool_use_id: null,
            parent_agent_id: null,
            message: { content: [] },
          },
          {
            type: "user",
            uuid: "steer",
            session_id: sessionId,
            parent_tool_use_id: null,
            parent_agent_id: null,
            message: { content: "steer the second turn" },
          },
          {
            type: "assistant",
            uuid: "assistant-steer",
            session_id: sessionId,
            parent_tool_use_id: null,
            parent_agent_id: null,
            message: { content: [] },
          },
        ];
        return sessionId.endsWith("0020")
          ? history.slice(0, 4).map((message) => ({ ...message, uuid: `fork-${message.uuid}` }))
          : legacyHistory
            ? history.slice(0, 6)
            : missingBoundary
              ? history.filter((message) => message.uuid !== secondTurnId)
              : history;
      },
    });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      const firstTurn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "first",
        attachments: [],
      });
      firstTurnId = firstTurn.turnId;

      const firstCompletedFiber = yield* Stream.filter(
        adapter.streamEvents,
        (event) => event.type === "turn.completed",
      ).pipe(Stream.runHead, Effect.forkChild);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "550e8400-e29b-41d4-a716-446655440010",
        uuid: "result-first",
      } as unknown as SDKMessage);

      const firstCompleted = yield* Fiber.join(firstCompletedFiber);
      assert.equal(firstCompleted._tag, "Some");
      if (firstCompleted._tag === "Some" && firstCompleted.value.type === "turn.completed") {
        assert.equal(String(firstCompleted.value.turnId), String(firstTurn.turnId));
      }

      const secondTurn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "second",
        attachments: [],
      });
      secondTurnId = secondTurn.turnId;
      const steer = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "steer the second turn",
        attachments: [],
      });
      assert.equal(steer.turnId, secondTurn.turnId);

      const secondCompletedFiber = yield* Stream.filter(
        adapter.streamEvents,
        (event) => event.type === "turn.completed",
      ).pipe(Stream.runHead, Effect.forkChild);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "550e8400-e29b-41d4-a716-446655440010",
        uuid: "result-second",
      } as unknown as SDKMessage);

      const secondCompleted = yield* Fiber.join(secondCompletedFiber);
      assert.equal(secondCompleted._tag, "Some");
      if (secondCompleted._tag === "Some" && secondCompleted.value.type === "turn.completed") {
        assert.equal(String(secondCompleted.value.turnId), String(secondTurn.turnId));
      }

      const threadBeforeRollback = yield* adapter.readThread(session.threadId);
      assert.equal(threadBeforeRollback.turns.length, 2);
      const cursor = (yield* adapter.listSessions())[0]?.resumeCursor;
      yield* adapter.stopSession(session.threadId);
      legacyHistory = true;
      yield* adapter.startSession({
        threadId: session.threadId,
        runtimeMode: "full-access",
        resumeCursor: {
          threadId: session.threadId,
          resume: "550e8400-e29b-41d4-a716-446655440010",
          turnCount: 1,
        },
      });
      const legacyOptions = harness.getLastCreateQueryInput();
      const ambiguousLegacy = yield* adapter.rollbackThread(session.threadId, 1).pipe(Effect.flip);
      assert.match(ambiguousLegacy.message, /exact Claude turn boundary is unavailable/);
      assert.equal(forkCalls.length, 0);
      assert.equal(harness.getLastCreateQueryInput(), legacyOptions);
      assert.equal((yield* adapter.listSessions()).length, 1);
      yield* adapter.stopSession(session.threadId);
      legacyHistory = false;
      yield* adapter.startSession({
        threadId: session.threadId,
        runtimeMode: "full-access",
        resumeCursor: cursor,
      });
      missingBoundary = true;
      const unavailable = yield* adapter.rollbackThread(session.threadId, 1).pipe(Effect.flip);
      assert.match(unavailable.message, /exact Claude turn boundary is unavailable/);
      assert.equal(forkCalls.length, 0);
      missingBoundary = false;

      const recoveredQuery = harness.queries.at(-1)!;
      assert.equal(recoveredQuery.closeCalls, 0);
      yield* adapter.rollbackThread(session.threadId, 1);
      assert.equal(recoveredQuery.closeCalls, 1);
      const forkOptions = harness.getLastCreateQueryInput()?.options;
      assert.deepEqual(forkCalls, [
        ["550e8400-e29b-41d4-a716-446655440010", { upToMessageId: "assistant-1-final" }],
      ]);
      assert.equal(forkOptions?.resume, "550e8400-e29b-41d4-a716-446655440020");
      assert.equal(forkOptions?.resumeSessionAt, undefined);
      assert.equal(forkOptions?.forkSession, undefined);
      assert.deepEqual((yield* adapter.listSessions())[0]?.resumeCursor, {
        threadId: session.threadId,
        resume: "550e8400-e29b-41d4-a716-446655440020",
        turnCount: 1,
        turnStartMessageIds: [`fork-${firstTurnId}`],
      });

      yield* adapter.rollbackThread(session.threadId, 2);
      const resetOptions = harness.getLastCreateQueryInput()?.options;
      assert.equal(resetOptions?.resume, undefined);
      assert.equal(resetOptions?.resumeSessionAt, undefined);
      assert.equal(resetOptions?.forkSession, undefined);
      assert.ok(resetOptions?.sessionId);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("completed turns keep their ids but not the SDK messages", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });
      const completedFiber = yield* Stream.filter(
        adapter.streamEvents,
        (event) => event.type === "turn.completed",
      ).pipe(Stream.runHead, Effect.forkChild);

      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-1",
        uuid: "assistant-1",
        parent_tool_use_id: null,
        message: {
          id: "assistant-message-1",
          content: [{ type: "text", text: "Hi" }],
        },
      } as unknown as SDKMessage);
      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-1",
        uuid: "result-1",
      } as unknown as SDKMessage);
      yield* Fiber.join(completedFiber);

      const snapshot = yield* adapter.readThread(session.threadId);
      assert.deepEqual(
        snapshot.turns.map((entry) => ({ id: String(entry.id), items: entry.items })),
        [{ id: String(turn.turnId), items: [] }],
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("rewinds Claude history when the fork omits retained system messages", () => {
    const forkCalls: Array<Parameters<NonNullable<ClaudeAdapterLiveOptions["forkSession"]>>> = [];
    let firstTurnId = "";
    let secondTurnId = "";
    const harness = makeHarness({
      forkSession: async (...args) => {
        forkCalls.push(args);
        return { sessionId: CLAUDE_FORK_SESSION_ID };
      },
      getSessionMessages: async (sessionId) => {
        if (sessionId === CLAUDE_FORK_SESSION_ID) {
          return [
            claudeHistoryMessage({
              type: "user",
              uuid: `fork-${firstTurnId}`,
              sessionId,
              content: "first",
            }),
            claudeHistoryMessage({
              type: "assistant",
              uuid: "fork-assistant-1",
              sessionId,
            }),
          ];
        }
        return [
          claudeHistoryMessage({ type: "system", uuid: "system-init" }),
          claudeHistoryMessage({ type: "user", uuid: firstTurnId, content: "first" }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-1" }),
          claudeHistoryMessage({
            type: "system",
            uuid: "compact-boundary",
            content: { subtype: "compact_boundary" },
          }),
          claudeHistoryMessage({ type: "user", uuid: secondTurnId, content: "second" }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-2" }),
        ];
      },
    });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      firstTurnId = (yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "first"))
        .turnId;
      secondTurnId = (yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "second"))
        .turnId;

      const snapshot = yield* adapter.rollbackThread(session.threadId, 1);
      assert.equal(snapshot.turns.length, 1);
      assert.deepEqual(forkCalls, [
        [CLAUDE_ORIGINAL_SESSION_ID, { upToMessageId: "compact-boundary" }],
      ]);
      assert.deepEqual((yield* adapter.listSessions())[0]?.resumeCursor, {
        threadId: session.threadId,
        resume: CLAUDE_FORK_SESSION_ID,
        turnCount: 1,
        turnStartMessageIds: [`fork-${firstTurnId}`],
      });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("rewinds Claude history when the fork inserts extra system messages", () => {
    let firstTurnId = "";
    let secondTurnId = "";
    const harness = makeHarness({
      forkSession: async () => ({ sessionId: CLAUDE_FORK_SESSION_ID }),
      getSessionMessages: async (sessionId) => {
        if (sessionId === CLAUDE_FORK_SESSION_ID) {
          return [
            claudeHistoryMessage({
              type: "system",
              uuid: "fork-system-init",
              sessionId,
            }),
            claudeHistoryMessage({
              type: "user",
              uuid: `fork-${firstTurnId}`,
              sessionId,
              content: "first",
            }),
            claudeHistoryMessage({
              type: "assistant",
              uuid: "fork-assistant-1",
              sessionId,
            }),
          ];
        }
        return [
          claudeHistoryMessage({ type: "user", uuid: firstTurnId, content: "first" }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-1" }),
          claudeHistoryMessage({ type: "user", uuid: secondTurnId, content: "second" }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-2" }),
        ];
      },
    });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      firstTurnId = (yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "first"))
        .turnId;
      secondTurnId = (yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "second"))
        .turnId;

      yield* adapter.rollbackThread(session.threadId, 1);
      assert.deepEqual((yield* adapter.listSessions())[0]?.resumeCursor, {
        threadId: session.threadId,
        resume: CLAUDE_FORK_SESSION_ID,
        turnCount: 1,
        turnStartMessageIds: [`fork-${firstTurnId}`],
      });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("rewinds Claude history when the fork keeps a compact conversation prefix", () => {
    let firstTurnId = "";
    let secondTurnId = "";
    const harness = makeHarness({
      forkSession: async () => ({ sessionId: CLAUDE_FORK_SESSION_ID }),
      getSessionMessages: async (sessionId) => {
        if (sessionId === CLAUDE_FORK_SESSION_ID) {
          return [
            claudeHistoryMessage({
              type: "user",
              uuid: "fork-compacted-user",
              sessionId,
              content: "earlier compacted turn",
            }),
            claudeHistoryMessage({
              type: "assistant",
              uuid: "fork-compacted-assistant",
              sessionId,
            }),
            claudeHistoryMessage({
              type: "user",
              uuid: `fork-${firstTurnId}`,
              sessionId,
              content: "first",
            }),
            claudeHistoryMessage({
              type: "assistant",
              uuid: "fork-assistant-1",
              sessionId,
            }),
          ];
        }
        return [
          claudeHistoryMessage({ type: "user", uuid: firstTurnId, content: "first" }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-1" }),
          claudeHistoryMessage({ type: "user", uuid: secondTurnId, content: "second" }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-2" }),
        ];
      },
    });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      firstTurnId = (yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "first"))
        .turnId;
      secondTurnId = (yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "second"))
        .turnId;

      yield* adapter.rollbackThread(session.threadId, 1);
      assert.deepEqual((yield* adapter.listSessions())[0]?.resumeCursor, {
        threadId: session.threadId,
        resume: CLAUDE_FORK_SESSION_ID,
        turnCount: 1,
        turnStartMessageIds: [`fork-${firstTurnId}`],
      });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("rewinds a Claude turn that includes tool results and a later steer", () => {
    const forkCalls: Array<Parameters<NonNullable<ClaudeAdapterLiveOptions["forkSession"]>>> = [];
    let firstTurnId = "";
    let secondTurnId = "";
    const harness = makeHarness({
      forkSession: async (...args) => {
        forkCalls.push(args);
        return { sessionId: CLAUDE_FORK_SESSION_ID };
      },
      getSessionMessages: async (sessionId) => {
        const history = [
          claudeHistoryMessage({ type: "user", uuid: firstTurnId, content: "first" }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-1-tool" }),
          claudeHistoryMessage({
            type: "user",
            uuid: "tool-result-1",
            content: [{ type: "tool_result" }],
          }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-1-final" }),
          claudeHistoryMessage({ type: "user", uuid: secondTurnId, content: "second" }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-2" }),
          claudeHistoryMessage({
            type: "user",
            uuid: "steer",
            sessionId,
            content: "steer the second turn",
          }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-steer", sessionId }),
        ];
        return sessionId === CLAUDE_FORK_SESSION_ID
          ? history.slice(0, 4).map((message) => ({
              ...message,
              uuid: `fork-${message.uuid}`,
              session_id: sessionId,
            }))
          : history;
      },
    });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      firstTurnId = (yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "first"))
        .turnId;
      const secondTurn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "second",
        attachments: [],
      });
      secondTurnId = secondTurn.turnId;
      const steer = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "steer the second turn",
        attachments: [],
      });
      assert.equal(steer.turnId, secondTurn.turnId);
      const secondCompletedFiber = yield* Stream.filter(
        adapter.streamEvents,
        (event) => event.type === "turn.completed",
      ).pipe(Stream.runHead, Effect.forkChild);
      harness.queries.at(-1)!.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: CLAUDE_ORIGINAL_SESSION_ID,
        uuid: "result-second",
      } as unknown as SDKMessage);
      yield* Fiber.join(secondCompletedFiber);

      const snapshot = yield* adapter.rollbackThread(session.threadId, 1);
      assert.equal(snapshot.turns.length, 1);
      assert.deepEqual(forkCalls, [
        [CLAUDE_ORIGINAL_SESSION_ID, { upToMessageId: "assistant-1-final" }],
      ]);
      assert.deepEqual((yield* adapter.listSessions())[0]?.resumeCursor, {
        threadId: session.threadId,
        resume: CLAUDE_FORK_SESSION_ID,
        turnCount: 1,
        turnStartMessageIds: [`fork-${firstTurnId}`],
      });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("rewinds the last two turns of a three-turn Claude thread", () => {
    let firstTurnId = "";
    let secondTurnId = "";
    let thirdTurnId = "";
    const harness = makeHarness({
      forkSession: async () => ({ sessionId: CLAUDE_FORK_SESSION_ID }),
      getSessionMessages: async (sessionId) => {
        const history = [
          claudeHistoryMessage({ type: "system", uuid: "system-init" }),
          claudeHistoryMessage({ type: "user", uuid: firstTurnId, content: "first" }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-1" }),
          claudeHistoryMessage({ type: "user", uuid: secondTurnId, content: "second" }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-2" }),
          claudeHistoryMessage({ type: "user", uuid: thirdTurnId, content: "third" }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-3" }),
        ];
        return sessionId === CLAUDE_FORK_SESSION_ID
          ? [
              claudeHistoryMessage({
                type: "user",
                uuid: `fork-${firstTurnId}`,
                sessionId,
                content: "first",
              }),
              claudeHistoryMessage({
                type: "assistant",
                uuid: "fork-assistant-1",
                sessionId,
              }),
            ]
          : history;
      },
    });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      firstTurnId = (yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "first"))
        .turnId;
      secondTurnId = (yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "second"))
        .turnId;
      thirdTurnId = (yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "third"))
        .turnId;

      const snapshot = yield* adapter.rollbackThread(session.threadId, 2);
      assert.equal(snapshot.turns.length, 1);
      assert.deepEqual((yield* adapter.listSessions())[0]?.resumeCursor, {
        threadId: session.threadId,
        resume: CLAUDE_FORK_SESSION_ID,
        turnCount: 1,
        turnStartMessageIds: [`fork-${firstTurnId}`],
      });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("rewinds only the latest turn of a three-turn Claude thread", () => {
    let firstTurnId = "";
    let secondTurnId = "";
    let thirdTurnId = "";
    const harness = makeHarness({
      forkSession: async () => ({ sessionId: CLAUDE_FORK_SESSION_ID }),
      getSessionMessages: async (sessionId) => {
        const history = [
          claudeHistoryMessage({ type: "system", uuid: "system-init" }),
          claudeHistoryMessage({ type: "user", uuid: firstTurnId, content: "first" }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-1" }),
          claudeHistoryMessage({ type: "user", uuid: secondTurnId, content: "second" }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-2" }),
          claudeHistoryMessage({ type: "user", uuid: thirdTurnId, content: "third" }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-3" }),
        ];
        return sessionId === CLAUDE_FORK_SESSION_ID
          ? [
              claudeHistoryMessage({
                type: "user",
                uuid: `fork-${firstTurnId}`,
                sessionId,
                content: "first",
              }),
              claudeHistoryMessage({
                type: "assistant",
                uuid: "fork-assistant-1",
                sessionId,
              }),
              claudeHistoryMessage({
                type: "system",
                uuid: "fork-notice",
                sessionId,
              }),
              claudeHistoryMessage({
                type: "user",
                uuid: `fork-${secondTurnId}`,
                sessionId,
                content: "second",
              }),
              claudeHistoryMessage({
                type: "assistant",
                uuid: "fork-assistant-2",
                sessionId,
              }),
            ]
          : history;
      },
    });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      firstTurnId = (yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "first"))
        .turnId;
      secondTurnId = (yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "second"))
        .turnId;
      thirdTurnId = (yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "third"))
        .turnId;

      const snapshot = yield* adapter.rollbackThread(session.threadId, 1);
      assert.equal(snapshot.turns.length, 2);
      assert.deepEqual((yield* adapter.listSessions())[0]?.resumeCursor, {
        threadId: session.threadId,
        resume: CLAUDE_FORK_SESSION_ID,
        turnCount: 2,
        turnStartMessageIds: [`fork-${firstTurnId}`, `fork-${secondTurnId}`],
      });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("resets a Claude thread when rewind removes every recorded turn", () => {
    const forkCalls: Array<Parameters<NonNullable<ClaudeAdapterLiveOptions["forkSession"]>>> = [];
    const harness = makeHarness({
      forkSession: async (...args) => {
        forkCalls.push(args);
        return { sessionId: CLAUDE_FORK_SESSION_ID };
      },
      getSessionMessages: async () => [
        claudeHistoryMessage({ type: "user", uuid: "unused", content: "first" }),
      ],
    });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "first");
      yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "second");

      const snapshot = yield* adapter.rollbackThread(session.threadId, 2);
      assert.equal(snapshot.turns.length, 0);
      assert.equal(forkCalls.length, 0);
      const resetOptions = harness.getLastCreateQueryInput()?.options;
      assert.equal(resetOptions?.resume, undefined);
      assert.ok(resetOptions?.sessionId);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("rejects a Claude fork that drops a retained user turn", () => {
    let firstTurnId = "";
    let secondTurnId = "";
    const harness = makeHarness({
      forkSession: async () => ({ sessionId: CLAUDE_FORK_SESSION_ID }),
      getSessionMessages: async (sessionId) => {
        if (sessionId === CLAUDE_FORK_SESSION_ID) {
          return [
            claudeHistoryMessage({
              type: "assistant",
              uuid: "fork-assistant-1",
              sessionId,
            }),
          ];
        }
        return [
          claudeHistoryMessage({ type: "user", uuid: firstTurnId, content: "first" }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-1" }),
          claudeHistoryMessage({ type: "user", uuid: secondTurnId, content: "second" }),
          claudeHistoryMessage({ type: "assistant", uuid: "assistant-2" }),
        ];
      },
    });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      firstTurnId = (yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "first"))
        .turnId;
      secondTurnId = (yield* sendCompletedClaudeTurn(adapter, harness, session.threadId, "second"))
        .turnId;

      const error = yield* adapter.rollbackThread(session.threadId, 1).pipe(Effect.flip);
      assert.match(error.message, /did not preserve the retained turn boundaries/);
      assert.equal(harness.queries.at(-1)?.closeCalls, 0);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  for (const scenario of [
    "restores conversation messages between retained turns",
    "changes retained assistant content without changing its role",
  ] as const) {
    it.effect(`rejects a Claude fork that ${scenario}`, () => {
      const turnIds: Array<string> = [];
      const harness = makeHarness({
        forkSession: async () => ({ sessionId: CLAUDE_FORK_SESSION_ID }),
        getSessionMessages: async (sessionId) => {
          const history = turnIds.flatMap((turnId, index) => [
            claudeHistoryMessage({
              type: "user",
              uuid: turnId,
              content: `prompt ${index + 1}`,
            }),
            claudeHistoryMessage({
              type: "assistant",
              uuid: `assistant-${index + 1}`,
              content: [{ type: "text", text: `reply ${index + 1}` }],
            }),
          ]);
          if (sessionId !== CLAUDE_FORK_SESSION_ID) return history;
          const forkHistory = history.slice(0, 4).map((message) => ({
            ...message,
            uuid: `fork-${message.uuid}`,
            session_id: sessionId,
          }));
          if (scenario === "restores conversation messages between retained turns") {
            forkHistory.splice(
              2,
              0,
              claudeHistoryMessage({
                type: "user",
                uuid: "fork-restored-steer",
                sessionId,
                content: "earlier steer omitted by compaction",
              }),
              claudeHistoryMessage({
                type: "assistant",
                uuid: "fork-restored-reply",
                sessionId,
                content: [{ type: "text", text: "earlier steering reply" }],
              }),
            );
          } else {
            forkHistory[1] = claudeHistoryMessage({
              type: "assistant",
              uuid: "fork-assistant-1",
              sessionId,
              content: [{ type: "text", text: "different retained reply" }],
            });
          }
          return forkHistory;
        },
      });
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("claudeAgent"),
          runtimeMode: "full-access",
        });
        for (let index = 0; index < 3; index++) {
          const turn = yield* sendCompletedClaudeTurn(
            adapter,
            harness,
            session.threadId,
            `prompt ${index + 1}`,
          );
          turnIds.push(turn.turnId);
        }
        const cursorBeforeRollback = (yield* adapter.listSessions())[0]?.resumeCursor;
        const queryCountBeforeRollback = harness.queries.length;

        const error = yield* adapter.rollbackThread(session.threadId, 1).pipe(Effect.flip);
        assert.match(error.message, /did not preserve the retained turn boundaries/);
        assert.equal(harness.queries.length, queryCountBeforeRollback);
        assert.equal(harness.queries.at(-1)?.closeCalls, 0);
        assert.deepEqual((yield* adapter.listSessions())[0]?.resumeCursor, cursorBeforeRollback);
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    });
  }

  for (const { message, tag } of [
    { message: "Query closed before response received", tag: "ProviderAdapterSessionClosedError" },
    { message: "Unknown session: abc", tag: "ProviderAdapterSessionNotFoundError" },
    { message: "Model not found: claude-unknown", tag: "ProviderAdapterRequestError" },
    { message: "Connection closed by the proxy", tag: "ProviderAdapterRequestError" },
  ]) {
    it.effect(`reads a failed control request "${message}" as ${tag}`, () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("claudeAgent"),
          runtimeMode: "full-access",
        });
        harness.query.setModelError = new Error(message);
        const error = yield* adapter
          .sendTurn({
            threadId: session.threadId,
            input: "hello",
            modelSelection: {
              instanceId: ProviderInstanceId.make("claudeAgent"),
              model: SYNTHETIC_CLAUDE_CAPABLE_MODEL,
            },
            attachments: [],
          })
          .pipe(Effect.flip);
        assert.equal(error._tag, tag);
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    });
  }

  it.effect("updates model on sendTurn when model override is provided", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: SYNTHETIC_CLAUDE_CAPABLE_MODEL,
        },
        attachments: [],
      });

      assert.deepEqual(harness.query.setModelCalls, [
        `${SYNTHETIC_CLAUDE_CAPABLE_MODEL}[expanded]`,
      ]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("updates model on sendTurn for the adapter's bound custom instance id", () => {
    const customInstanceId = ProviderInstanceId.make("claude_openrouter");
    const harness = makeHarness({ instanceId: customInstanceId });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        modelSelection: {
          instanceId: customInstanceId,
          model: "openai/gpt-5.5",
        },
        attachments: [],
      });

      assert.deepEqual(harness.query.setModelCalls, ["openai/gpt-5.5"]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect(
    "does not re-set the Claude model when the session already uses the same effective API model",
    () => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;
        const modelSelection = {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: SYNTHETIC_CLAUDE_CAPABLE_MODEL,
        };

        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("claudeAgent"),
          modelSelection,
          runtimeMode: "full-access",
        });

        yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "hello",
          modelSelection,
          attachments: [],
        });
        yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "hello again",
          modelSelection,
          attachments: [],
        });

        assert.deepEqual(harness.query.setModelCalls, []);
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );

  it.effect("re-sets the Claude model when the effective API model changes", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          SYNTHETIC_CLAUDE_CAPABLE_MODEL,
          [{ id: "contextWindow", value: "expanded" }],
        ),
        attachments: [],
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello again",
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          SYNTHETIC_CLAUDE_CAPABLE_MODEL,
          [{ id: "contextWindow", value: "standard" }],
        ),
        attachments: [],
      });

      assert.deepEqual(harness.query.setModelCalls, [
        `${SYNTHETIC_CLAUDE_CAPABLE_MODEL}[expanded]`,
        SYNTHETIC_CLAUDE_CAPABLE_MODEL,
      ]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("sets plan permission mode on sendTurn when interactionMode is plan", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "plan this for me",
        interactionMode: "plan",
        attachments: [],
      });

      assert.deepEqual(harness.query.setPermissionModeCalls, ["plan"]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect.each<{ runtimeMode: RuntimeMode; expectedBase: PermissionMode }>([
    { runtimeMode: "full-access", expectedBase: "bypassPermissions" },
    { runtimeMode: "approval-required", expectedBase: "default" },
    { runtimeMode: "auto-accept-edits", expectedBase: "acceptEdits" },
  ])(
    "restores $expectedBase permission mode after plan turn ($runtimeMode)",
    ({ runtimeMode, expectedBase }) => {
      const harness = makeHarness();
      return Effect.gen(function* () {
        const adapter = yield* ClaudeAdapter;

        const session = yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("claudeAgent"),
          runtimeMode,
        });

        // First turn in plan mode
        yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "plan this",
          interactionMode: "plan",
          attachments: [],
        });

        // Complete the turn so we can send another
        const turnCompletedFiber = yield* Stream.filter(
          adapter.streamEvents,
          (event) => event.type === "turn.completed",
        ).pipe(Stream.runHead, Effect.forkChild);

        harness.query.emit({
          type: "result",
          subtype: "success",
          is_error: false,
          errors: [],
          session_id: `sdk-session-${runtimeMode}`,
          uuid: `result-${runtimeMode}`,
        } as unknown as SDKMessage);

        yield* Fiber.join(turnCompletedFiber);

        // Second turn back to default
        yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "now do it",
          interactionMode: "default",
          attachments: [],
        });

        assert.deepEqual(harness.query.setPermissionModeCalls, ["plan", expectedBase]);
      }).pipe(
        Effect.provideService(Random.Random, makeDeterministicRandomService()),
        Effect.provide(harness.layer),
      );
    },
  );

  it.effect("does not call setPermissionMode when interactionMode is absent", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      assert.deepEqual(harness.query.setPermissionModeCalls, []);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("captures ExitPlanMode as a proposed plan and denies auto-exit", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "plan this",
        interactionMode: "plan",
        attachments: [],
      });
      yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runDrain);

      const createInput = harness.getLastCreateQueryInput();
      const canUseTool = createInput?.options.canUseTool;
      assert.equal(typeof canUseTool, "function");
      if (!canUseTool) {
        return;
      }

      const permissionPromise = canUseTool(
        "ExitPlanMode",
        {
          plan: "# Ship it\n\n- one\n- two",
          allowedPrompts: [{ tool: "Bash", prompt: "run tests" }],
        },
        {
          signal: new AbortController().signal,
          requestId: "request-6",
          toolUseID: "tool-exit-1",
        },
      );

      const proposedEvent = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(proposedEvent._tag, "Some");
      if (proposedEvent._tag !== "Some") {
        return;
      }
      assert.equal(proposedEvent.value.type, "turn.proposed.completed");
      if (proposedEvent.value.type !== "turn.proposed.completed") {
        return;
      }
      assert.equal(proposedEvent.value.payload.planMarkdown, "# Ship it\n\n- one\n- two");
      assert.deepEqual(proposedEvent.value.providerRefs, {
        providerItemId: ProviderItemId.make("tool-exit-1"),
      });

      const permissionResult = yield* Effect.promise(() => permissionPromise);
      assert.equal((permissionResult as PermissionResult).behavior, "deny");
      const deniedResult = permissionResult as PermissionResult & {
        message?: string;
      };
      assert.equal(deniedResult.message?.includes("captured your proposed plan"), true);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("extracts proposed plans from assistant ExitPlanMode snapshots", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "plan this",
        interactionMode: "plan",
        attachments: [],
      });
      yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runDrain);

      const proposedEventFiber = yield* Stream.filter(
        adapter.streamEvents,
        (event) => event.type === "turn.proposed.completed",
      ).pipe(Stream.runHead, Effect.forkChild);

      harness.query.emit({
        type: "assistant",
        session_id: "sdk-session-exit-plan",
        uuid: "assistant-exit-plan",
        parent_tool_use_id: null,
        message: {
          model: SYNTHETIC_CLAUDE_CAPABLE_MODEL,
          id: "msg-exit-plan",
          type: "message",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-exit-2",
              name: "ExitPlanMode",
              input: {
                plan: "# Final plan\n\n- capture it",
              },
            },
          ],
          stop_reason: null,
          stop_sequence: null,
          usage: {},
        },
      } as unknown as SDKMessage);

      const proposedEvent = yield* Fiber.join(proposedEventFiber);
      assert.equal(proposedEvent._tag, "Some");
      if (proposedEvent._tag !== "Some") {
        return;
      }
      assert.equal(proposedEvent.value.type, "turn.proposed.completed");
      if (proposedEvent.value.type !== "turn.proposed.completed") {
        return;
      }
      assert.equal(proposedEvent.value.payload.planMarkdown, "# Final plan\n\n- capture it");
      assert.deepEqual(proposedEvent.value.providerRefs, {
        providerItemId: ProviderItemId.make("tool-exit-2"),
      });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("routes Claude resume compaction through the shared user-input UI", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: RESUME_THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        resumeCursor: { resume: "550e8400-e29b-41d4-a716-446655440000" },
        runtimeMode: "full-access",
      });
      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);

      const onUserDialog = harness.getLastCreateQueryInput()?.options.onUserDialog;
      assert.equal(typeof onUserDialog, "function");
      if (!onUserDialog) return;

      const dialogPromise = onUserDialog(
        {
          dialogKind: "resume_return",
          payload: { sessionAgeMinutes: 145, estimatedTokens: 275123 },
        },
        { signal: new AbortController().signal, requestId: "request-dialog" },
      );

      const requested = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(requested._tag, "Some");
      if (requested._tag !== "Some" || requested.value.type !== "user-input.requested") return;
      const question = requested.value.payload.questions[0];
      assert.equal(question?.header, "Resume session");
      assert.match(question?.question ?? "", /2h 25m/);
      assert.match(question?.question ?? "", /275,123 tokens/);
      assert.deepEqual(
        question?.options.map((option) => option.label),
        ["Compact and continue", "Keep full history", "Don't ask again"],
      );
      if (!question || !requested.value.requestId) return;

      yield* adapter.respondToUserInput(
        session.threadId,
        ApprovalRequestId.make(requested.value.requestId),
        { [question.id]: "Compact and continue" },
      );

      const resolved = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(resolved._tag, "Some");
      if (resolved._tag === "Some") assert.equal(resolved.value.type, "user-input.resolved");
      assert.deepEqual(yield* Effect.promise(() => dialogPromise), {
        behavior: "completed",
        result: "compact",
      });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("handles AskUserQuestion via user-input.requested/resolved lifecycle", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      // Start session in approval-required mode so canUseTool fires.
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "approval-required",
      });

      // Drain the session startup events (started, configured, state.changed).
      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "question turn",
        attachments: [],
      });
      yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runDrain);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-user-input-1",
        uuid: "stream-user-input-thread",
        parent_tool_use_id: null,
        event: {
          type: "message_start",
          message: {
            id: "msg-user-input-thread",
          },
        },
      } as unknown as SDKMessage);

      const threadStarted = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(threadStarted._tag, "Some");
      if (threadStarted._tag !== "Some" || threadStarted.value.type !== "thread.started") {
        return;
      }

      const createInput = harness.getLastCreateQueryInput();
      const canUseTool = createInput?.options.canUseTool;
      assert.equal(typeof canUseTool, "function");
      if (!canUseTool) {
        return;
      }

      // Simulate Claude calling AskUserQuestion with structured questions.
      const askInput = {
        questions: [
          {
            question: "Which framework?",
            header: "Framework",
            options: [
              { label: "React", description: "React.js" },
              { label: "Vue", description: "Vue.js" },
            ],
            multiSelect: false,
          },
        ],
      };

      const permissionPromise = canUseTool("AskUserQuestion", askInput, {
        signal: new AbortController().signal,
        requestId: "request-7",
        toolUseID: "tool-ask-1",
      });

      // The adapter should emit a user-input.requested event.
      const requestedEvent = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(requestedEvent._tag, "Some");
      if (requestedEvent._tag !== "Some") {
        return;
      }
      assert.equal(requestedEvent.value.type, "user-input.requested");
      if (requestedEvent.value.type !== "user-input.requested") {
        return;
      }
      const requestId = requestedEvent.value.requestId;
      assert.equal(typeof requestId, "string");
      assert.equal(requestedEvent.value.payload.questions.length, 1);
      assert.equal(requestedEvent.value.payload.questions[0]?.question, "Which framework?");
      // Regression for #2388: `id` must equal the full question text so the
      // UI's draft-answer key matches what the SDK looks up downstream.
      assert.equal(requestedEvent.value.payload.questions[0]?.id, "Which framework?");
      assert.deepEqual(requestedEvent.value.providerRefs, {
        providerItemId: ProviderItemId.make("tool-ask-1"),
      });

      // Respond with the user's answers.
      yield* adapter.respondToUserInput(session.threadId, ApprovalRequestId.make(requestId!), {
        "Which framework?": "React",
      });

      // The adapter should emit a user-input.resolved event.
      const resolvedEvent = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(resolvedEvent._tag, "Some");
      if (resolvedEvent._tag !== "Some") {
        return;
      }
      assert.equal(resolvedEvent.value.type, "user-input.resolved");
      if (resolvedEvent.value.type !== "user-input.resolved") {
        return;
      }
      assert.deepEqual(resolvedEvent.value.payload.answers, {
        "Which framework?": "React",
      });
      assert.deepEqual(resolvedEvent.value.providerRefs, {
        providerItemId: ProviderItemId.make("tool-ask-1"),
      });

      // The canUseTool promise should resolve with the answers in SDK format.
      const permissionResult = yield* Effect.promise(() => permissionPromise);
      assert.equal((permissionResult as PermissionResult).behavior, "allow");
      const updatedInput = (permissionResult as { updatedInput: Record<string, unknown> })
        .updatedInput;
      assert.deepEqual(updatedInput.answers, { "Which framework?": "React" });
      // Original questions should be passed through.
      assert.deepEqual(updatedInput.questions, askInput.questions);

      // Compatibility check for #2388: the answers shape we hand to the SDK
      // must produce a non-empty rendered tool_result on BOTH SDK iteration
      // patterns we have seen, so we don't regress the issue and we don't
      // break users still on the older Claude CLI.
      const sdkAnswers = updatedInput.answers as Record<string, unknown>;
      const sdkQuestions = updatedInput.questions as ReadonlyArray<{
        readonly question: string;
      }>;

      // Claude CLI 2.1.119 — key-agnostic Object.entries iteration. Any key
      // works here, but it must at least round-trip into a non-empty string.
      const v119Rendered = Object.entries(sdkAnswers)
        .map(([key, value]) => `"${key}"="${String(value)}"`)
        .join(", ");
      assert.equal(v119Rendered, '"Which framework?"="React"');

      // Claude CLI 2.1.121 — lookup by full question text. This is the path
      // that regressed in #2388 when the answers were keyed by `header`.
      const v121Rendered = sdkQuestions
        .map(({ question }) => {
          const answer = sdkAnswers[question];
          return answer === undefined ? null : `"${question}"="${String(answer)}"`;
        })
        .filter((entry): entry is string => entry !== null)
        .join(", ");
      assert.notEqual(v121Rendered, "", "Expected non-empty SDK 2.1.121 tool_result (#2388)");
      assert.equal(v121Rendered, '"Which framework?"="React"');
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("routes AskUserQuestion through user-input flow even in full-access mode", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      // In full-access mode, regular tools are auto-approved.
      // AskUserQuestion should still go through the user-input flow.
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });

      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);

      const createInput = harness.getLastCreateQueryInput();
      const canUseTool = createInput?.options.canUseTool;
      assert.equal(typeof canUseTool, "function");
      if (!canUseTool) {
        return;
      }

      const askInput = {
        questions: [
          {
            question: "Deploy to which env?",
            header: "Env",
            options: [
              { label: "Staging", description: "Staging environment" },
              { label: "Production", description: "Production environment" },
            ],
            multiSelect: false,
          },
        ],
      };

      const permissionPromise = canUseTool("AskUserQuestion", askInput, {
        signal: new AbortController().signal,
        requestId: "request-8",
        toolUseID: "tool-ask-2",
      });

      // Should still get user-input.requested even in full-access mode.
      const requestedEvent = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(requestedEvent._tag, "Some");
      if (requestedEvent._tag !== "Some" || requestedEvent.value.type !== "user-input.requested") {
        assert.fail("Expected user-input.requested event");
        return;
      }
      const requestId = requestedEvent.value.requestId;

      yield* adapter.respondToUserInput(session.threadId, ApprovalRequestId.make(requestId!), {
        "Deploy to which env?": "Staging",
      });

      // Drain the resolved event.
      yield* Stream.runHead(adapter.streamEvents);

      const permissionResult = yield* Effect.promise(() => permissionPromise);
      assert.equal((permissionResult as PermissionResult).behavior, "allow");
      const updatedInput = (permissionResult as { updatedInput: Record<string, unknown> })
        .updatedInput;
      assert.deepEqual(updatedInput.answers, { "Deploy to which env?": "Staging" });
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("denies AskUserQuestion when the waiting turn is aborted", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "approval-required",
      });

      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);

      const createInput = harness.getLastCreateQueryInput();
      const canUseTool = createInput?.options.canUseTool;
      assert.equal(typeof canUseTool, "function");
      if (!canUseTool) {
        return;
      }

      const controller = new AbortController();
      const permissionPromise = canUseTool(
        "AskUserQuestion",
        {
          questions: [
            {
              question: "Continue?",
              header: "Continue",
              options: [{ label: "Yes", description: "Proceed" }],
              multiSelect: false,
            },
          ],
        },
        {
          signal: controller.signal,
          requestId: "request-9",
          toolUseID: "tool-ask-abort",
        },
      );

      const requestedEvent = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(requestedEvent._tag, "Some");
      if (requestedEvent._tag !== "Some" || requestedEvent.value.type !== "user-input.requested") {
        assert.fail("Expected user-input.requested event");
        return;
      }
      assert.equal(requestedEvent.value.threadId, session.threadId);

      controller.abort();

      const resolvedEvent = yield* Stream.runHead(adapter.streamEvents);
      assert.equal(resolvedEvent._tag, "Some");
      if (resolvedEvent._tag !== "Some" || resolvedEvent.value.type !== "user-input.resolved") {
        assert.fail("Expected user-input.resolved event");
        return;
      }
      assert.deepEqual(resolvedEvent.value.payload.answers, {});

      const permissionResult = yield* Effect.promise(() => permissionPromise);
      assert.deepEqual(permissionResult, {
        behavior: "deny",
        message: "User cancelled tool execution.",
      } satisfies PermissionResult);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("denies AskUserQuestion when the signal aborted before the listener registered", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "approval-required",
      });

      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);

      const canUseTool = harness.getLastCreateQueryInput()?.options.canUseTool;
      assert.equal(typeof canUseTool, "function");
      if (!canUseTool) {
        return;
      }

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 2).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      // Abort before the call so the adapter's listener registration can
      // never observe the abort event, only the recheck can.
      const controller = new AbortController();
      controller.abort();
      const permissionPromise = canUseTool(
        "AskUserQuestion",
        {
          questions: [
            {
              question: "Continue?",
              header: "Continue",
              options: [{ label: "Yes", description: "Proceed" }],
              multiSelect: false,
            },
          ],
        },
        {
          signal: controller.signal,
          requestId: "request-10",
          toolUseID: "tool-ask-pre-aborted",
        },
      );

      const permissionResult = yield* Effect.promise(() => permissionPromise);
      assert.deepEqual(permissionResult, {
        behavior: "deny",
        message: "User cancelled tool execution.",
      } satisfies PermissionResult);

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      assert.deepEqual(
        runtimeEvents.map((event) => event.type),
        ["user-input.requested", "user-input.resolved"],
      );
      const resolvedEvent = runtimeEvents[1];
      if (resolvedEvent?.type === "user-input.resolved") {
        assert.deepEqual(resolvedEvent.payload.answers, {});
      }
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("stopping a session settles pending user-input waits", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "approval-required",
      });

      yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain);

      const canUseTool = harness.getLastCreateQueryInput()?.options.canUseTool;
      assert.equal(typeof canUseTool, "function");
      if (!canUseTool) {
        return;
      }

      const permissionPromise = canUseTool(
        "AskUserQuestion",
        {
          questions: [
            {
              question: "Continue?",
              header: "Continue",
              options: [{ label: "Yes", description: "Proceed" }],
              multiSelect: false,
            },
          ],
        },
        {
          signal: new AbortController().signal,
          requestId: "request-stop",
          toolUseID: "tool-ask-stop",
        },
      );

      const requestedEvent = yield* Stream.runHead(adapter.streamEvents);
      if (requestedEvent._tag !== "Some" || requestedEvent.value.type !== "user-input.requested") {
        assert.fail("Expected user-input.requested event");
        return;
      }

      // The session dies while the question is still on screen.
      yield* adapter.stopSession(THREAD_ID);

      const resolvedEvent = yield* Stream.runHead(adapter.streamEvents);
      if (resolvedEvent._tag !== "Some" || resolvedEvent.value.type !== "user-input.resolved") {
        assert.fail("Expected user-input.resolved event");
        return;
      }
      assert.deepEqual(resolvedEvent.value.payload.answers, {});

      const permissionResult = yield* Effect.promise(() => permissionPromise);
      assert.deepEqual(permissionResult, {
        behavior: "deny",
        message: "User cancelled tool execution.",
      } satisfies PermissionResult);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("writes provider-native observability records when enabled", () => {
    const nativeEvents: Array<{
      event?: {
        provider?: string;
        method?: string;
        threadId?: string;
        turnId?: string;
      };
    }> = [];
    const nativeThreadIds: Array<string | null> = [];
    const harness = makeHarness({
      nativeEventLogger: {
        filePath: "memory://claude-native-events",
        write: (event, threadId) => {
          nativeEvents.push(event as (typeof nativeEvents)[number]);
          nativeThreadIds.push(threadId ?? null);
          return Effect.void;
        },
        close: () => Effect.void,
      },
    });
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;

      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: ProviderDriverKind.make("claudeAgent"),
        runtimeMode: "full-access",
      });
      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "hello",
        attachments: [],
      });

      const turnCompletedFiber = yield* Stream.filter(
        adapter.streamEvents,
        (event) => event.type === "turn.completed",
      ).pipe(Stream.runHead, Effect.forkChild);

      harness.query.emit({
        type: "stream_event",
        session_id: "sdk-session-native-log",
        uuid: "stream-native-log",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "text_delta",
            text: "hi",
          },
        },
      } as unknown as SDKMessage);

      harness.query.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        errors: [],
        session_id: "sdk-session-native-log",
        uuid: "result-native-log",
      } as unknown as SDKMessage);

      const turnCompleted = yield* Fiber.join(turnCompletedFiber);
      assert.equal(turnCompleted._tag, "Some");

      assert.equal(nativeEvents.length > 0, true);
      assert.equal(
        nativeEvents.some((record) => record.event?.provider === "claudeAgent"),
        true,
      );
      assert.equal(
        nativeEvents.some(
          (record) =>
            String(
              (record.event as { readonly providerThreadId?: string } | undefined)
                ?.providerThreadId,
            ) === "sdk-session-native-log",
        ),
        true,
      );
      assert.equal(
        nativeEvents.some((record) => String(record.event?.turnId) === String(turn.turnId)),
        true,
      );
      assert.equal(
        nativeEvents.some(
          (record) => record.event?.method === "claude/stream_event/content_block_delta/text_delta",
        ),
        true,
      );
      assert.equal(
        nativeThreadIds.every((threadId) => threadId === String(THREAD_ID)),
        true,
      );
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });
});
