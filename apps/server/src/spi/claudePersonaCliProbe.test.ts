/**
 * Optional check against a real Claude Code CLI: a Mate's persona reaches the
 * model at session start, a change and a removal reach it on the next message,
 * and a resumed chat hears the current persona again, also after it compacts.
 * Runs a few short Haiku turns on the local Claude login.
 *
 * Enable with: T3_CLAUDE_CLI_PROBE=1 vp test run src/spi/claudePersonaCliProbe.test.ts
 * (`T3_CLAUDE_CLI_PROBE_BINARY` overrides the `claude` on PATH).
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import {
  ClaudeSettings,
  type MatePersona,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { makeClaudeAdapter } from "../provider/Layers/ClaudeAdapter.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ClaudeThreadExtensionRegistry } from "./claudeThreadProfile.ts";
import { ThreadToolPolicyRegistry } from "./threadToolPolicy.ts";

const THREAD_ID = ThreadId.make("claude-cli-probe-persona-thread");
const PROBE_SETTINGS = Schema.decodeSync(ClaudeSettings)({
  binaryPath: process.env.T3_CLAUDE_CLI_PROBE_BINARY ?? "claude",
});
const ASK =
  "What is the persona's secret word according to your current instructions? If no persona applies now, reply NONE. Reply with the word only.";
const persona = (word: string): MatePersona => ({
  name: "Probe",
  instructions: `The persona's secret word is ${word}. When asked for the persona's secret word, reply with the word only.`,
});

const probeLayer = Layer.mergeAll(
  ServerConfig.layerTest(process.cwd(), { prefix: "claude-persona-probe-" }),
  ServerSettingsService.layerTest({ persona: persona("KIWI") }),
  ThreadToolPolicyRegistry.layer,
  ClaudeThreadExtensionRegistry.layer,
).pipe(Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

describe.runIf(process.env.T3_CLAUDE_CLI_PROBE === "1")("Claude CLI probe: persona", () => {
  it.live(
    "a Mate's persona reaches Claude at start, after a change, a removal, a resume and a compaction",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const settings = yield* ServerSettingsService;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "claude-persona-probe-cwd-" });
        const adapter = yield* makeClaudeAdapter(PROBE_SETTINGS);
        const answer = yield* Ref.make("");
        const compactions = yield* Ref.make(0);
        const completed = yield* Ref.make(yield* Deferred.make<void>());
        yield* Stream.runForEach(adapter.streamEvents, (event: ProviderRuntimeEvent) =>
          event.type === "item.completed" && event.payload.itemType === "assistant_message"
            ? Ref.update(answer, (text) => `${text} ${event.payload.detail ?? ""}`)
            : event.type === "thread.state.changed" && event.payload.state === "compacted"
              ? Ref.update(compactions, (count) => count + 1)
              : event.type === "turn.completed"
                ? Effect.flatMap(Ref.get(completed), (done) => Deferred.succeed(done, undefined))
                : Effect.void,
        ).pipe(Effect.forkScoped);

        const turn = (input: string) =>
          Effect.gen(function* () {
            yield* Ref.set(answer, "");
            yield* Ref.set(completed, yield* Deferred.make<void>());
            yield* adapter.sendTurn({ threadId: THREAD_ID, input, attachments: [] });
            yield* Deferred.await(yield* Ref.get(completed));
            return (yield* Ref.get(answer)).trim();
          });
        const start = (resumeCursor?: unknown) =>
          adapter.startSession({
            threadId: THREAD_ID,
            provider: ProviderDriverKind.make("claudeAgent"),
            runtimeMode: "full-access",
            cwd,
            modelSelection: {
              instanceId: ProviderInstanceId.make("claudeAgent"),
              model: "claude-haiku-4-5",
            },
            ...(resumeCursor === undefined ? {} : { resumeCursor }),
          });

        yield* start();
        assert.include(yield* turn(ASK), "KIWI", "the persona at start did not reach Claude");

        yield* settings.updateSettings({ persona: persona("MANGO") });
        assert.include(
          yield* turn(ASK),
          "MANGO",
          "a persona changed mid-chat did not reach Claude",
        );

        yield* settings.updateSettings({ persona: null });
        const removed = yield* turn(ASK);
        assert.include(removed, "NONE", "a removed persona still applied");
        assert.notInclude(removed, "MANGO");

        const [session] = yield* adapter.listSessions();
        yield* adapter.stopSession(THREAD_ID);
        yield* settings.updateSettings({ persona: persona("LIME") });
        yield* start(session?.resumeCursor);
        assert.include(yield* turn(ASK), "LIME", "a resumed chat did not hear the current persona");

        yield* turn("/compact");
        assert.strictEqual(yield* Ref.get(compactions), 1, "the chat did not compact");
        const compacted = yield* turn(ASK);
        assert.include(compacted, "LIME", "a compacted chat lost the current persona");
        assert.notInclude(
          compacted,
          "KIWI",
          "a compacted chat went back to its start-time persona",
        );
        yield* adapter.stopSession(THREAD_ID);
      }).pipe(Effect.scoped, Effect.provide(probeLayer)),
    300_000,
  );
});
