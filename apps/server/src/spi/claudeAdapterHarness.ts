/**
 * claudeAdapterHarness — owned test-only harness for the ported Claude
 * adapter. Builds `makeClaudeAdapter` through its `options.createQuery` seam,
 * exactly as `replay/claudeReplay.ts` does, and records what the adapter
 * hands the SDK: every session's query options, and the model and
 * permission-mode calls made on each live query. Nothing is sent to a CLI.
 *
 * The environment and the model catalog are fixed so what the harness
 * records is the same on every machine: `env` would otherwise be the whole
 * process environment, and the bundled catalog moves with every manifest.
 *
 * @module claudeAdapterHarness
 */
import type {
  Options as ClaudeQueryOptions,
  PermissionMode,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ClaudeSettings, type ProviderRuntimeEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { makeClaudeAdapter } from "../provider/Layers/ClaudeAdapter.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { SYNTHETIC_CLAUDE_MODEL_CATALOG } from "./claudeProviderTest.ts";

const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

export const HARNESS_ENVIRONMENT: NodeJS.ProcessEnv = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/harness",
};

/** A fake SDK query: pulls nothing on its own, records every runtime call. */
export class RecordingClaudeQuery implements AsyncIterable<SDKMessage> {
  readonly setModelCalls: Array<string | undefined> = [];
  readonly setPermissionModeCalls: Array<PermissionMode> = [];
  private readonly queue: Array<SDKMessage> = [];
  private readonly waiters: Array<(result: IteratorResult<SDKMessage>) => void> = [];
  private done = false;

  emit(message: SDKMessage): void {
    if (this.done) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ done: false, value: message });
      return;
    }
    this.queue.push(message);
  }

  readonly usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = async (_opts?: {
    skipBehaviors?: boolean;
  }) => ({
    session: {
      total_cost_usd: 0,
      total_api_duration_ms: 0,
      total_duration_ms: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
      model_usage: {},
    },
    subscription_type: null,
    rate_limits_available: false,
    rate_limits: null,
    behaviors: null,
  });

  readonly setModel = async (model?: string): Promise<void> => {
    this.setModelCalls.push(model);
  };
  readonly setPermissionMode = async (mode: PermissionMode): Promise<void> => {
    this.setPermissionModeCalls.push(mode);
  };
  readonly setMaxThinkingTokens = async (_maxThinkingTokens: number | null): Promise<void> => {};
  readonly applyFlagSettings = async (_settings: unknown): Promise<void> => {};

  readonly close = (): void => {
    this.done = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  };

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: () => {
        const queued = this.queue.shift();
        if (queued) return Promise.resolve({ done: false, value: queued });
        if (this.done) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

export interface RecordedClaudeSession {
  readonly options: ClaudeQueryOptions;
  readonly query: RecordingClaudeQuery;
}

/**
 * Builds one adapter and returns it with everything it recorded so far —
 * the arrays fill as the caller drives sessions and turns. Scoped: the event
 * collector fiber lives as long as the caller's scope.
 */
export const makeClaudeAdapterHarness = Effect.fn("makeClaudeAdapterHarness")(function* (
  settings: Partial<ClaudeSettings> = {},
) {
  const sessions: Array<RecordedClaudeSession> = [];
  const events: Array<ProviderRuntimeEvent> = [];
  const adapter = yield* makeClaudeAdapter(decodeClaudeSettings(settings), {
    environment: HARNESS_ENVIRONMENT,
    modelCatalog: Effect.succeed(SYNTHETIC_CLAUDE_MODEL_CATALOG),
    createQuery: (input) => {
      const query = new RecordingClaudeQuery();
      sessions.push({ options: input.options, query });
      return query;
    },
  });
  yield* Stream.runForEach(adapter.streamEvents, (event) =>
    Effect.sync(() => events.push(event)),
  ).pipe(Effect.forkScoped);
  /** The first event of a type, once the collector fiber has taken it in. */
  const firstEvent = <T extends ProviderRuntimeEvent["type"]>(type: T) =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const found = events.find((event) => event.type === type);
        if (found) return found as Extract<ProviderRuntimeEvent, { readonly type: T }>;
        yield* Effect.yieldNow;
      }
      return yield* Effect.die(new Error(`the adapter emitted no ${type} event`));
    });
  return { adapter, sessions, events, firstEvent };
});

export const claudeAdapterHarnessLayer = Layer.mergeAll(
  ServerConfig.layerTest("/tmp/claude-adapter-harness", "/tmp"),
  ServerSettingsService.layerTest(),
).pipe(Layer.provideMerge(NodeServices.layer));

/**
 * A JSON-comparable copy of recorded options: `JSON.stringify` would drop a
 * function-valued key silently, so every function becomes a marker and a
 * callback that appears or disappears still shows in a diff.
 */
export function toComparable(value: unknown): unknown {
  if (typeof value === "function") return "[function]";
  if (Array.isArray(value)) return value.map(toComparable);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toComparable(entry)]),
    );
  }
  return value;
}
