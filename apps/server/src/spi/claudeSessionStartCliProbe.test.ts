/**
 * Optional check against a real Claude Code CLI: a profiled thread's session
 * start reaches the Claude extension with the CLI's own session id and
 * transcript path, and the context the extension returns reaches the model.
 * Runs one short Haiku turn on the local Claude login.
 *
 * Enable with: T3_CLAUDE_CLI_PROBE=1 vp test run src/spi/claudeSessionStartCliProbe.test.ts
 * (`T3_CLAUDE_CLI_PROBE_BINARY` overrides the `claude` on PATH).
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ClaudeSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { makeClaudeAdapter } from "../provider/Layers/ClaudeAdapter.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  type ClaudeThreadExtension,
  ClaudeThreadExtensionRegistry,
} from "./claudeThreadProfile.ts";
import { ThreadToolPolicyRegistry } from "./threadToolPolicy.ts";

const THREAD_ID = ThreadId.make("claude-cli-probe-crew-thread");
const SECRET = "PAPAYA";
const PROBE_SETTINGS = Schema.decodeSync(ClaudeSettings)({
  binaryPath: process.env.T3_CLAUDE_CLI_PROBE_BINARY ?? "claude",
});

const probeLayer = Layer.mergeAll(
  ServerConfig.layerTest(process.cwd(), { prefix: "claude-cli-probe-" }),
  ServerSettingsService.layerTest(),
  ThreadToolPolicyRegistry.layer,
  ClaudeThreadExtensionRegistry.layer,
).pipe(Layer.provideMerge(NodeServices.layer));

describe.runIf(process.env.T3_CLAUDE_CLI_PROBE === "1")("Claude CLI probe: session start", () => {
  it.live(
    "hands a new session's start to the extension, and its context to the model",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "claude-cli-probe-cwd-" });
        const starts: Array<Parameters<ClaudeThreadExtension["onSessionStart"]>[0]> = [];
        yield* (yield* ThreadToolPolicyRegistry).install({
          profileFor: ({ threadId }) =>
            Effect.succeed(
              threadId === THREAD_ID
                ? {
                    sessionContext: "You are a crewmate in a probe.",
                    contextWindow: 400_000,
                    decideTool: () => Effect.succeed({ kind: "deny", reason: "No tools here." }),
                    tools: [],
                  }
                : undefined,
            ),
        });
        yield* (yield* ClaudeThreadExtensionRegistry).install({
          extensionFor: () =>
            Effect.succeed({
              settings: { autoMemoryEnabled: false, disableAllHooks: false },
              onSessionStart: (event) =>
                Effect.sync(() => starts.push(event)).pipe(
                  Effect.as(`The crew's secret word is ${SECRET}.`),
                ),
              onPostCompact: () => Effect.void,
            }),
        });

        const adapter = yield* makeClaudeAdapter(PROBE_SETTINGS);
        const events: Array<ProviderRuntimeEvent> = [];
        const completed = yield* Deferred.make<void>();
        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.andThen(
            Effect.sync(() => events.push(event)),
            event.type === "turn.completed" ? Deferred.succeed(completed, undefined) : Effect.void,
          ),
        ).pipe(Effect.forkScoped);

        yield* adapter.startSession({
          threadId: THREAD_ID,
          provider: ProviderDriverKind.make("claudeAgent"),
          runtimeMode: "full-access",
          cwd,
          modelSelection: {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            model: "claude-haiku-4-5",
          },
        });
        yield* adapter.sendTurn({
          threadId: THREAD_ID,
          input: "What is the crew's secret word? Reply with the word only.",
          attachments: [],
        });
        yield* Deferred.await(completed).pipe(Effect.timeout("90 seconds"));
        yield* adapter.stopSession(THREAD_ID);

        assert.strictEqual(starts.length, 1, "the extension saw no session start");
        const [start] = starts;
        assert.strictEqual(start!.source, "startup");
        assert.match(start!.sessionId, /^[0-9a-f-]{36}$/);
        assert.isTrue(start!.transcriptPath.endsWith(`${start!.sessionId}.jsonl`));
        const answer = events
          .flatMap((event) =>
            event.type === "item.completed" && event.payload.itemType === "assistant_message"
              ? [event.payload.detail ?? ""]
              : [],
          )
          .join(" ");
        assert.include(answer, SECRET, "the extension's context did not reach the model");
      }).pipe(Effect.scoped, Effect.provide(probeLayer)),
    120_000,
  );
});
