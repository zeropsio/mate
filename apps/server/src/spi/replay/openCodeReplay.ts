/**
 * OpenCode baseline replay: like Cursor/Grok, there is no static wire
 * capture — OpenCode is driven through `OpencodeClient`, an SDK object
 * `makeOpenCodeAdapter` gets from the injectable `OpenCodeRuntime` service.
 * This module supplies a from-scratch minimal test double for that service
 * (a trimmed equivalent of OpenCodeAdapter.test.ts's own
 * `OpenCodeRuntimeTestDouble`, not exported from that .test.ts so it can't
 * be imported here) whose `event.subscribe` replays a small, fixed, canned
 * SSE body sequence — the same technique OpenCodeAdapter.test.ts itself
 * uses for its deterministic tests (e.g. "does not strip coincidental
 * prefix overlap from OpenCode part deltas").
 */
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { OpenCodeSettings, ProviderDriverKind, type SpiEvent, ThreadId } from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderSessionDirectory } from "../../provider/Services/ProviderSessionDirectory.ts";
import { OpenCodeRuntime, type OpenCodeRuntimeShape } from "../../provider/opencodeRuntime.ts";
import { makeOpenCodeAdapter } from "../../provider/Layers/OpenCodeAdapter.ts";

const decodeOpenCodeSettings = Schema.decodeSync(OpenCodeSettings);

const REPLAY_THREAD_ID = ThreadId.make("spi-replay-opencode-thread");
const SESSION_URL = "http://127.0.0.1:9999/session";

const providerSessionDirectoryTestLayer = Layer.succeed(ProviderSessionDirectory, {
  upsert: () => Effect.void,
  getProvider: () =>
    Effect.die(new Error("ProviderSessionDirectory.getProvider is not used by openCodeReplay")),
  getBinding: () => Effect.succeed(Option.none()),
  listThreadIds: () => Effect.succeed([]),
  listBindings: () => Effect.succeed([]),
});

/** The fixed canned SSE body sequence this baseline replays through OpenCodeAdapter. */
const CANNED_EVENTS: ReadonlyArray<unknown> = [
  // The adapter's `startSession` waits on this to mark the event stream ready
  // (`context.firstConnection`) before returning — without it, startup times
  // out after 10 seconds even though the events below are still processed.
  { type: "server.connected", properties: {} },
  {
    type: "message.updated",
    properties: {
      sessionID: SESSION_URL,
      info: { id: "msg-spi-replay", role: "assistant" },
    },
  },
  {
    type: "message.part.updated",
    properties: {
      sessionID: SESSION_URL,
      part: {
        id: "part-spi-replay",
        sessionID: SESSION_URL,
        messageID: "msg-spi-replay",
        type: "text",
        text: "Hello from",
        time: { start: 1 },
      },
      time: 1,
    },
  },
  {
    type: "message.part.delta",
    properties: {
      sessionID: SESSION_URL,
      messageID: "msg-spi-replay",
      partID: "part-spi-replay",
      field: "text",
      delta: " OpenCode",
    },
  },
  {
    type: "message.part.updated",
    properties: {
      sessionID: SESSION_URL,
      part: {
        id: "part-spi-replay",
        sessionID: SESSION_URL,
        messageID: "msg-spi-replay",
        type: "text",
        text: "Hello from OpenCode",
        time: { start: 1, end: 2 },
      },
      time: 2,
    },
  },
];

/** Minimal from-scratch equivalent of OpenCodeAdapter.test.ts's OpenCodeRuntimeTestDouble. */
const replayOpenCodeRuntime: OpenCodeRuntimeShape = {
  startOpenCodeServerProcess: () =>
    Effect.die(new Error("replayOpenCodeRuntime.startOpenCodeServerProcess is not used")),
  connectToOpenCodeServer: ({ serverUrl }) =>
    Effect.succeed({
      url: serverUrl ?? "http://127.0.0.1:9999",
      version: "1.14.19",
      exitCode: null,
      external: Boolean(serverUrl),
    }),
  runOpenCodeCommand: () => Effect.succeed({ stdout: "", stderr: "", code: 0 }),
  createOpenCodeSdkClient: ({ baseUrl }) =>
    ({
      session: {
        create: async () => ({ data: { id: `${baseUrl}/session` } }),
        get: async ({ sessionID }: { readonly sessionID: string }) => ({ data: { id: sessionID } }),
        update: async ({ sessionID }: { readonly sessionID: string }) => ({
          data: { id: sessionID },
        }),
        fork: async ({ sessionID }: { readonly sessionID: string }) => ({
          data: { id: `${sessionID}_fork` },
        }),
        abort: async () => {},
        promptAsync: async () => {},
        messages: async () => ({ data: [] }),
        revert: async () => {},
      },
      // Startup runs pending-request recovery (permission.list/question.list)
      // once the event stream connects; an empty backlog matches this
      // baseline's clean session with nothing to recover.
      permission: {
        list: async () => ({ data: [] }),
      },
      question: {
        list: async () => ({ data: [] }),
      },
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            for (const event of CANNED_EVENTS) {
              yield event;
            }
          })(),
        }),
      },
      // biome-ignore lint: matches the shape the OpenCode SDK client provides at runtime.
    }) as unknown as ReturnType<OpenCodeRuntimeShape["createOpenCodeSdkClient"]>,
  loadOpenCodeInventory: () =>
    Effect.die(new Error("replayOpenCodeRuntime.loadOpenCodeInventory is not used")),
  loadInventoryFromCli: () =>
    Effect.die(new Error("replayOpenCodeRuntime.loadInventoryFromCli is not used")),
};

/**
 * Starts a session against the replay double and returns every emitted
 * event up to (and slightly past) `item.completed`, once the canned SSE
 * sequence above has fully played out.
 */
export async function recordOpenCodeBaseline(): Promise<ReadonlyArray<SpiEvent>> {
  const openCodeConfig = decodeOpenCodeSettings({
    binaryPath: "spi-replay-opencode",
    serverUrl: "http://127.0.0.1:9999",
  });

  const program = Effect.gen(function* () {
    const adapter = yield* makeOpenCodeAdapter(openCodeConfig);

    const events: Array<SpiEvent> = [];
    const itemCompleted = yield* Deferred.make<void>();

    const collectorFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
      Effect.sync(() => {
        events.push(event);
      }).pipe(
        Effect.andThen(
          event.type === "item.completed"
            ? Deferred.succeed(itemCompleted, undefined)
            : Effect.void,
        ),
      ),
    ).pipe(Effect.forkChild);

    yield* adapter.startSession({
      threadId: REPLAY_THREAD_ID,
      provider: ProviderDriverKind.make("opencode"),
      runtimeMode: "full-access",
    });

    yield* Deferred.await(itemCompleted);
    yield* Effect.sleep("100 millis");
    yield* Fiber.interrupt(collectorFiber);

    return events;
  });

  const testLayer = Layer.mergeAll(
    ServerConfig.layerTest(process.cwd(), process.cwd()),
    ServerSettingsService.layerTest(),
    providerSessionDirectoryTestLayer,
    Layer.succeed(OpenCodeRuntime, replayOpenCodeRuntime),
  ).pipe(Layer.provideMerge(NodeServices.layer));

  return Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(testLayer)));
}
