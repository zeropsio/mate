// @effect-diagnostics nodeBuiltinImport:off
/**
 * Recordings for the bridge's tests, made through real, unchanged adapters:
 *
 * - Claude and Codex through the SPI replay seams (`spi/replay/claudeReplay.ts`,
 *   `codexReplay.ts`) with an authored wire, the command log placed around the
 *   events where each driver's calls return;
 * - Cursor, Grok and Antigravity against the ACP mock agent
 *   (`apps/server/scripts/acp-mock-agent.ts`), its `T3_ACP_*` knobs choosing
 *   the behaviour, the commands recorded as the host would issue them — the
 *   send forked, because an ACP send holds its turn.
 *
 * Nothing here is imported by production code.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AntigravitySettings,
  CursorSettings,
  GrokSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type SpiEvent,
  ThreadId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { ServerConfig } from "../../../config.ts";
import type { ProviderAdapterError } from "../../../provider/Errors.ts";
import {
  makeAntigravityAdapter,
  type AntigravityAdapterOptions,
} from "../../../provider/Layers/AntigravityAdapter.ts";
import { makeCursorAdapter } from "../../../provider/Layers/CursorAdapter.ts";
import { makeGrokAdapter } from "../../../provider/Layers/GrokAdapter.ts";
import { makeAntigravityAcpRuntime } from "../../../provider/acp/AntigravityAcpSupport.ts";
import { replayClaude } from "../../../spi/replay/claudeReplay.ts";
import { replayCodex } from "../../../spi/replay/codexReplay.ts";
import type { Fixture } from "../../../spi/replay/types.ts";
import type { BridgeDriver, RequestKey, SessionId, TurnHandle } from "../../bridge/spi3.ts";
import type { BridgeInput } from "../../bridge/translate.ts";

export const S1 = "s1" as SessionId;
export const H1 = "h1" as TurnHandle;

const holdsTurn = (driver: BridgeDriver) =>
  driver === "cursor" || driver === "grok" || driver === "antigravity";

/**
 * The commands the engine would have sent around a stream that came out of a
 * replay with no command log: the session opens before the first turn-bound
 * event, one message is sent, its send returns where the driver's returns —
 * once the turn opens, or at its end (ACP) — and each resolved request is
 * answered just before the driver says so.
 */
export function commandLogAround(
  driver: BridgeDriver,
  events: ReadonlyArray<SpiEvent>,
): Array<BridgeInput> {
  const parent = String(events[0]!.threadId);
  const startsTurn = events.some((event) => event.type === "turn.started");
  const log: Array<BridgeInput> = [{ kind: "start", session: S1, from: "fresh" }];
  let opened = false;
  let firstTurn: string | undefined;
  let requests = 0;
  for (const event of events) {
    const turnBound =
      event.type === "turn.started" ||
      event.type === "content.delta" ||
      event.type.startsWith("item.");
    if (!opened && turnBound) {
      log.push({ kind: "started" }, { kind: "send", turn: H1, mode: "new" });
      opened = true;
      // A capture cut after its turn started (an extract) still names the turn: the send returns
      // with it, as a driver's send does.
      if (!startsTurn && event.turnId !== undefined) {
        firstTurn = String(event.turnId);
        if (!holdsTurn(driver)) log.push({ kind: "sent", turn: H1, nativeTurn: firstTurn });
      }
    }
    if (event.type === "request.opened" || event.type === "user-input.requested") requests += 1;
    if (event.type === "request.resolved" || event.type === "user-input.resolved") {
      log.push({ kind: "respond", request: `${S1}.r${requests}` as RequestKey });
    }
    log.push({ kind: "event", event });
    if (
      event.type === "turn.started" &&
      firstTurn === undefined &&
      String(event.threadId) === parent
    ) {
      firstTurn = String(event.turnId);
      if (!holdsTurn(driver)) log.push({ kind: "sent", turn: H1, nativeTurn: firstTurn });
    }
  }
  if (holdsTurn(driver) && firstTurn !== undefined) {
    log.push({ kind: "sent", turn: H1, nativeTurn: firstTurn });
  }
  return log;
}

const fixtureOf = (driver: string, messages: ReadonlyArray<unknown>): Fixture => ({
  name: "authored",
  dir: "",
  meta: { driver, synthetic: true },
  lines: messages.map((message) => ({ kind: "message", message })),
});

/** Claude's adapter fed an authored SDK message stream through its createQuery seam. */
export async function recordClaude(messages: ReadonlyArray<unknown>) {
  const events = await replayClaude(fixtureOf("claude", messages));
  return { threadId: String(events[0]!.threadId), log: commandLogAround("claudeAgent", events) };
}

/** Codex's adapter fed authored app-server notifications through its runtime seam. */
export async function recordCodex(notifications: ReadonlyArray<unknown>) {
  const events = await replayCodex(fixtureOf("codex", notifications));
  return { threadId: String(events[0]!.threadId), log: commandLogAround("codex", events) };
}

// ── ACP drivers against the mock agent ──────────────────────────────

const decodeCursorSettings = Schema.decodeSync(CursorSettings);
const decodeGrokSettings = Schema.decodeSync(GrokSettings);
const decodeAntigravitySettings = Schema.decodeSync(AntigravitySettings);

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../../scripts/acp-mock-agent.ts");

async function mockAgentWrapper(env: Readonly<Record<string, string>>): Promise<string> {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "bridge-acp-mock-"));
  const wrapperPath = NodePath.join(dir, "fake-agent.sh");
  const exports = Object.entries(env)
    .map(([name, value]) => `export ${name}=${JSON.stringify(value)}\n`)
    .join("");
  await NodeFSP.writeFile(
    wrapperPath,
    `#!/bin/sh\n${exports}exec ${JSON.stringify(process.execPath)} ${JSON.stringify(mockAgentPath)} "$@"\n`,
    "utf8",
  );
  await NodeFSP.chmod(wrapperPath, 0o755);
  return wrapperPath;
}

/** A temp path for the mock's crash-once marker: its first prompt kills it. */
export async function crashOncePath(): Promise<string> {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "bridge-acp-crash-"));
  return NodePath.join(dir, "crashed");
}

interface AcpAdapter {
  readonly streamEvents: Stream.Stream<SpiEvent, never>;
  readonly startSession: (input: {
    readonly threadId: ThreadId;
    readonly provider: ProviderDriverKind;
    readonly cwd: string;
    readonly runtimeMode: "full-access";
    readonly modelSelection: { readonly instanceId: ProviderInstanceId; readonly model: string };
  }) => Effect.Effect<unknown, ProviderAdapterError>;
  readonly sendTurn: (input: {
    readonly threadId: ThreadId;
    readonly input: string;
    readonly attachments: ReadonlyArray<never>;
  }) => Effect.Effect<{ readonly turnId: string }, ProviderAdapterError>;
  readonly interruptTurn: (threadId: ThreadId) => Effect.Effect<unknown, ProviderAdapterError>;
  readonly stopSession: (threadId: ThreadId) => Effect.Effect<unknown, ProviderAdapterError>;
}

/** What a scenario does once the session is open and its message is sent. */
export type AcpScenario =
  /** Wait for the turn's end. */
  | { readonly kind: "until-end" }
  /** Wait for the first sign of a call, then Stop. */
  | { readonly kind: "stop-mid-tool" }
  /** Wait for an event of this type. */
  | { readonly kind: "until"; readonly type: string };

const MODELS = {
  cursor: "default",
  grok: "grok-mock-alt",
  antigravity: "gemini-test-low",
} as const;

/**
 * Runs one message through a real ACP adapter against the mock agent and
 * returns the host's log: commands as they were issued, results as they came
 * back, events as the stream delivered them.
 */
export async function recordAcp(
  driver: "cursor" | "grok" | "antigravity",
  env: Readonly<Record<string, string>>,
  scenario: AcpScenario,
): Promise<{ readonly threadId: string; readonly log: ReadonlyArray<BridgeInput> }> {
  const wrapperPath = await mockAgentWrapper(env);
  const threadId = ThreadId.make(`bridge-${driver}-thread`);
  const cursorSettings = decodeCursorSettings({ binaryPath: wrapperPath });
  const grokSettings = decodeGrokSettings({ binaryPath: wrapperPath });
  const antigravitySettings = decodeAntigravitySettings({ enabled: true });

  const makeAdapter = Effect.gen(function* () {
    switch (driver) {
      case "cursor":
        return (yield* makeCursorAdapter(cursorSettings)) as unknown as AcpAdapter;
      case "grok":
        return (yield* makeGrokAdapter(grokSettings)) as unknown as AcpAdapter;
      case "antigravity": {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const crypto = yield* Crypto.Crypto;
        // As acpReplay.ts: production's install/profile/sign-in machinery is
        // irrelevant to a mock peer, so the mock is spawned through the same
        // runtime seam AntigravityDriver.ts uses.
        const makeRuntime: AntigravityAdapterOptions["makeRuntime"] = (input) =>
          makeAntigravityAcpRuntime({
            ...input,
            childProcessSpawner: spawner,
            spawn: {
              command: wrapperPath,
              args: [],
              cwd: input.cwd,
              env: { ...process.env, T3_ACP_ANTIGRAVITY: "1" },
            },
          }).pipe(Effect.provideService(Crypto.Crypto, crypto));
        return (yield* makeAntigravityAdapter(antigravitySettings, {
          instanceId: ProviderInstanceId.make("antigravity"),
          makeRuntime,
          withProcess: (_stop, task) => task,
        })) as unknown as AcpAdapter;
      }
    }
  });

  const program = Effect.gen(function* () {
    const adapter = yield* makeAdapter;
    const log: Array<BridgeInput> = [];
    const seen = (predicate: (event: SpiEvent) => boolean) =>
      log.some((input) => input.kind === "event" && predicate(input.event));
    const waitFor = (predicate: (event: SpiEvent) => boolean) =>
      Effect.gen(function* () {
        for (let tries = 0; tries < 300 && !seen(predicate); tries += 1) {
          yield* Effect.sleep("20 millis");
        }
      });
    yield* Stream.runForEach(adapter.streamEvents, (event) =>
      Effect.sync(() => {
        log.push({ kind: "event", event });
      }),
    ).pipe(Effect.forkScoped);

    log.push({ kind: "start", session: S1, from: "fresh" });
    yield* adapter.startSession({
      threadId,
      provider: ProviderDriverKind.make(driver),
      cwd: process.cwd(),
      runtimeMode: "full-access",
      modelSelection: { instanceId: ProviderInstanceId.make(driver), model: MODELS[driver] },
    });
    log.push({ kind: "started" });

    // The host forks an ACP send: it returns only at the turn's end.
    log.push({ kind: "send", turn: H1, mode: "new" });
    const sendReturned = yield* Deferred.make<void>();
    yield* adapter.sendTurn({ threadId, input: "go", attachments: [] }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          log.push({ kind: "sent", turn: H1, nativeTurn: String(result.turnId) });
        }),
      ),
      Effect.tapError((error) =>
        Effect.sync(() => {
          log.push({
            kind: "send-failed",
            turn: H1,
            words: String((error as { readonly message?: unknown }).message ?? error),
            sessionGone:
              (error as { readonly _tag?: unknown })._tag === "ProviderAdapterSessionClosedError",
          });
        }),
      ),
      Effect.ignore,
      Effect.ensuring(Deferred.succeed(sendReturned, undefined)),
      Effect.forkScoped,
    );
    const untilReturned = Deferred.await(sendReturned).pipe(
      Effect.timeout("6 seconds"),
      Effect.ignore,
    );

    switch (scenario.kind) {
      case "until-end":
        yield* untilReturned;
        break;
      case "stop-mid-tool":
        yield* waitFor((event) => event.type.startsWith("item.") && event.payload !== undefined);
        log.push({ kind: "interrupt", turn: H1 });
        yield* adapter.interruptTurn(threadId).pipe(Effect.ignore);
        yield* untilReturned;
        break;
      case "until":
        yield* waitFor((event) => event.type === scenario.type);
        break;
    }
    // Late events land after the end: give the stream a moment, as acpReplay does.
    yield* Effect.sleep("300 millis");
    // A copy: what the scope's finalizers emit on close is not part of the scenario.
    return [...log];
  });

  const layer = ServerConfig.layerTest(process.cwd(), {
    prefix: "bridge-acp-record-",
  }).pipe(Layer.provideMerge(NodeServices.layer));
  const log = await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(layer)));
  return { threadId, log };
}
