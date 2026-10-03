// @effect-diagnostics nodeBuiltinImport:off
/**
 * What a thread profile changes on an ACP agent, through the real Cursor
 * adapter against the ACP mock agent: the crew tools reach `session/new` as
 * an MCP server, the gate answers the agent's permission requests in the
 * person's place, the profile's context rides on the prompt, and its model
 * overrides the thread's. A thread with no profile runs as before.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CursorSettings,
  GrokSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { makeCursorAdapter } from "../provider/Layers/CursorAdapter.ts";
import { makeGrokAdapter } from "../provider/Layers/GrokAdapter.ts";
import type { ProviderAdapterError } from "../provider/Errors.ts";
import type { ProviderAdapterShape } from "../provider/Services/ProviderAdapter.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { execScriptSource, writeFakeCli } from "../testUtils/fakeCli.ts";
import {
  ThreadToolPolicyRegistry,
  type ThreadToolProfile,
  type ToolDecision,
} from "./threadToolPolicy.ts";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(here, "../../scripts/acp-mock-agent.ts");
const CREW_THREAD = ThreadId.make("crew-thread");
const PERSON_THREAD = ThreadId.make("person-thread");

const readJsonLines = async (filePath: string) =>
  (await NodeFSP.readFile(filePath, "utf8"))
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

const profile = (decided: Array<unknown>, model: string): ThreadToolProfile => ({
  sessionContext: "You are @backend on the crew.",
  exactCallsContext: "Write commands exactly as given.",
  contextWindow: 100_000,
  model,
  decideTool: (call) =>
    Effect.sync((): ToolDecision => {
      decided.push({ toolName: call.toolName, input: call.input });
      return { kind: "deny", reason: "Not in your lane." };
    }),
  tools: [
    {
      name: "crew_report",
      description: "Report.",
      inputSchema: { type: "object" },
      run: () => Effect.succeed({ text: "ok", isError: false }),
    },
  ],
});

type AdapterServices =
  | Effect.Services<ReturnType<typeof makeCursorAdapter>>
  | Effect.Services<ReturnType<typeof makeGrokAdapter>>;

/** An ACP driver's real adapter over the mock agent at `binaryPath`. */
interface AcpDriver {
  readonly name: string;
  readonly kind: ProviderDriverKind;
  /** The thread's own model, and the one its profile sets instead. */
  readonly ownModel: string;
  readonly profileModel: string;
  readonly make: (
    binaryPath: string,
  ) => Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, never, AdapterServices>;
}

const DRIVERS: ReadonlyArray<AcpDriver> = [
  {
    name: "Cursor",
    kind: ProviderDriverKind.make("cursor"),
    ownModel: "default",
    profileModel: "gpt-5.4",
    make: (binaryPath) =>
      Effect.flatMap(Schema.decodeEffect(CursorSettings)({ binaryPath }), (settings) =>
        makeCursorAdapter(settings, {}),
      ).pipe(Effect.orDie),
  },
  {
    name: "Grok",
    kind: ProviderDriverKind.make("grok"),
    ownModel: "grok-4.6",
    profileModel: "grok-mock-alt",
    make: (binaryPath) =>
      Effect.flatMap(Schema.decodeEffect(GrokSettings)({ binaryPath }), (settings) =>
        makeGrokAdapter(settings, {}),
      ).pipe(Effect.orDie),
  },
];

/** One turn on `threadId` through the real adapter; what the agent was sent, and the events. */
const oneTurn = (driver: AcpDriver, threadId: ThreadId) =>
  Effect.gen(function* () {
    const decided: Array<unknown> = [];
    const registry = yield* ThreadToolPolicyRegistry;
    yield* registry.install({
      profileFor: (thread) =>
        Effect.succeed(
          thread.threadId === CREW_THREAD ? profile(decided, driver.profileModel) : undefined,
        ),
    });
    const dir = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "acp-profile-")),
    );
    const requestLogPath = NodePath.join(dir, "requests.ndjson");
    yield* Effect.promise(() => NodeFSP.writeFile(requestLogPath, "", "utf8"));
    const binaryPath = writeFakeCli({
      directory: dir,
      name: "fake-agent",
      env: { T3_ACP_REQUEST_LOG_PATH: requestLogPath, T3_ACP_EMIT_TOOL_CALLS: "1" },
      source: execScriptSource({ scriptPath: mockAgentPath }),
    });
    const adapter = yield* driver.make(binaryPath);
    const events: Array<ProviderRuntimeEvent> = [];
    const settled = yield* Deferred.make<void>();
    const collecting = yield* Stream.runForEach(adapter.streamEvents, (event) =>
      Effect.gen(function* () {
        events.push(event);
        if (event.type === "turn.completed" || event.type === "request.opened") {
          yield* Deferred.succeed(settled, undefined);
        }
      }),
    ).pipe(Effect.forkChild);
    yield* adapter.startSession({
      threadId,
      provider: driver.kind,
      cwd: process.cwd(),
      runtimeMode: "approval-required",
      modelSelection: { instanceId: ProviderInstanceId.make(driver.kind), model: driver.ownModel },
    });
    // A parked permission holds the prompt open, so the turn runs beside the wait.
    yield* adapter
      .sendTurn({ threadId, input: "run a tool call", attachments: [] })
      .pipe(Effect.ignore, Effect.forkChild);
    yield* Deferred.await(settled);
    yield* Fiber.interrupt(collecting);
    yield* adapter.stopSession(threadId);
    return {
      requests: yield* Effect.promise(() => readJsonLines(requestLogPath)),
      events,
      decided,
    };
  });

const layer = it.layer(
  Layer.mergeAll(ThreadToolPolicyRegistry.layer).pipe(
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "acp-profile-contract-" })),
    Layer.provideMerge(NodeServices.layer),
  ),
);

const method = (requests: ReadonlyArray<Record<string, unknown>>, name: string) =>
  requests.filter((entry) => entry.method === name);

/** Every text the first prompt carried. */
const promptTexts = (requests: ReadonlyArray<Record<string, unknown>>): ReadonlyArray<string> =>
  (
    (method(requests, "session/prompt")[0]?.params as { prompt?: Array<{ text?: string }> })
      ?.prompt ?? []
  ).flatMap((part) => (part.text === undefined ? [] : [part.text]));

/** The model values the adapter set on the session, as a config option or with `set_model`. */
const modelsSet = (requests: ReadonlyArray<Record<string, unknown>>): ReadonlyArray<unknown> => [
  ...method(requests, "session/set_config_option").flatMap((entry) => {
    const params = entry.params as { configId?: string; value?: unknown };
    return params.configId === "model" ? [params.value] : [];
  }),
  ...method(requests, "session/set_model").map(
    (entry) => (entry.params as { modelId?: unknown }).modelId,
  ),
];

const permissionAnswers = (requests: ReadonlyArray<Record<string, unknown>>) =>
  requests.flatMap((entry) => {
    const result = entry.result as { outcome?: { optionId?: string } } | undefined;
    return !("method" in entry) && result?.outcome?.optionId !== undefined
      ? [result.outcome.optionId]
      : [];
  });

for (const driver of DRIVERS)
  layer(`a thread profile on ${driver.name}`, (it) => {
    it.effect("a crewmate's session carries its tools, its gate, its context and its model", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { requests, events, decided } = yield* oneTurn(driver, CREW_THREAD);
          const [sessionNew] = method(requests, "session/new");
          const servers = (sessionNew?.params as { mcpServers?: Array<{ name: string }> })
            ?.mcpServers;
          assert.deepStrictEqual(
            {
              servers: servers?.map((server) => server.name),
              decided,
              answers: permissionAnswers(requests),
              parked: events.some((event) => event.type === "request.opened"),
              context: promptTexts(requests).some((text) =>
                text.includes("You are @backend on the crew.\n\nWrite commands exactly as given."),
              ),
              model: modelsSet(requests).includes(driver.profileModel),
            },
            {
              servers: ["crew"],
              decided: [{ toolName: "Bash", input: { command: "cat server/package.json" } }],
              answers: ["reject-once"],
              parked: false,
              context: true,
              model: true,
            },
          );
        }),
      ),
    );

    it.effect("a person's thread runs as it would without a profile", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { requests, events, decided } = yield* oneTurn(driver, PERSON_THREAD);
          const [sessionNew] = method(requests, "session/new");
          assert.deepStrictEqual(
            {
              servers: (sessionNew?.params as { mcpServers?: unknown[] })?.mcpServers,
              decided,
              parked: events.some((event) => event.type === "request.opened"),
            },
            { servers: [], decided: [], parked: true },
          );
        }),
      ),
    );
  });
