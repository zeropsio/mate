/**
 * codexAdapterHarness — owned test-only harness for the ported Codex
 * adapter. Builds `makeCodexAdapter` over the real session runtime and
 * hands it a spawner whose `codex app-server` is a scripted peer in memory,
 * so what the harness records is exactly what the adapter writes to Codex:
 * every request and notification, and every answer to a server request.
 * Nothing is spawned.
 *
 * The peer answers `thread/start` and `thread/resume` with a captured
 * response (`provider/testFixtures/codexMultiAgentWire.json`) and, after
 * answering each `turn/start`, sends that turn's scripted messages — the
 * notifications and approval requests a turn of a real Codex would send. Once
 * an approval request is answered it sends `serverRequest/resolved`, naming
 * the request by its approval or item id as Codex does, or by its own id.
 *
 * @module codexAdapterHarness
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CodexSettings, type ProviderRuntimeEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { ServerConfig } from "../config.ts";
import { makeCodexAdapter } from "../provider/Layers/CodexAdapter.ts";
import wireFixture from "../provider/testFixtures/codexMultiAgentWire.json" with { type: "json" };
import { ServerSettingsService } from "../serverSettings.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);

/** A line the adapter writes: a request, a notification, or an answer to the peer. */
const decodeAdapterLine = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.optionalKey(Schema.Number),
      method: Schema.optionalKey(Schema.String),
      params: Schema.optionalKey(Schema.Unknown),
      result: Schema.optionalKey(Schema.Unknown),
      error: Schema.optionalKey(Schema.Unknown),
    }),
  ),
);

export const HARNESS_ENVIRONMENT: NodeJS.ProcessEnv = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/harness",
};

/** The provider thread and turn the peer's captured responses name. */
export const PEER_THREAD_ID = wireFixture.responses.threadStart.thread.id;
export const PEER_TURN_ID = wireFixture.responses.turnStart.turn.id;

/** One message the peer sends during a turn. */
export type PeerMessage =
  | { readonly notification: string; readonly params: Record<string, unknown> }
  | { readonly request: string; readonly params: Record<string, unknown> };

/** What the adapter wrote: a request or notification, or its answer to a peer request. */
export type WireRecord =
  | { readonly method: string; readonly params?: unknown }
  | { readonly answered: string; readonly result?: unknown; readonly error?: unknown };

export interface RecordedSpawn {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string | undefined;
}

/** Ids the peer gives its own requests; far from the adapter's. */
const FIRST_PEER_REQUEST_ID = 9000;

/**
 * Builds one adapter and returns it with everything it recorded so far —
 * the arrays fill as the caller drives sessions and turns. `turns[n]` is
 * what the peer sends after answering the n-th `turn/start`. Scoped: the
 * event collector fiber lives as long as the caller's scope.
 */
export const makeCodexAdapterHarness = Effect.fn("makeCodexAdapterHarness")(function* (
  options: {
    readonly settings?: Partial<CodexSettings>;
    readonly turns?: ReadonlyArray<ReadonlyArray<PeerMessage>>;
  } = {},
) {
  const spawns: Array<RecordedSpawn> = [];
  const wire: Array<WireRecord> = [];
  const events: Array<ProviderRuntimeEvent> = [];
  let turnStarts = 0;
  let nextPeerRequestId = FIRST_PEER_REQUEST_ID;

  const spawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      if (!ChildProcess.isStandardCommand(command)) {
        return yield* Effect.die(new Error("the harness spawns only codex app-server"));
      }
      spawns.push({ command: command.command, args: command.args, cwd: command.options.cwd });
      const stdout = yield* Queue.unbounded<Uint8Array>();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      /** Each open peer request: its method, and the id `serverRequest/resolved` names it by. */
      const peerRequests = new Map<
        number,
        { readonly method: string; readonly resolves: unknown }
      >();
      const send = (message: Record<string, unknown>) =>
        Queue.offer(stdout, encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`));

      const receive = (message: ReturnType<typeof decodeAdapterLine>) =>
        Effect.gen(function* () {
          if (message.method === undefined) {
            const request = message.id === undefined ? undefined : peerRequests.get(message.id);
            if (request === undefined) return;
            wire.push({
              answered: request.method,
              ...("result" in message ? { result: message.result } : {}),
              ...("error" in message ? { error: message.error } : {}),
            });
            return yield* send({
              method: "serverRequest/resolved",
              params: { threadId: PEER_THREAD_ID, requestId: request.resolves },
            });
          }
          wire.push({
            method: message.method,
            ...(message.params === undefined ? {} : { params: message.params }),
          });
          if (message.id === undefined) return;
          switch (message.method) {
            case "initialize":
              return yield* send({
                id: message.id,
                result: {
                  userAgent: "t3-codex-harness/0.0.0",
                  codexHome: "/home/harness/.codex",
                  platformFamily: "unix",
                  platformOs: "linux",
                },
              });
            case "thread/start":
            case "thread/resume":
              return yield* send({ id: message.id, result: wireFixture.responses.threadStart });
            case "turn/start": {
              const turn = wireFixture.responses.turnStart.turn;
              const scripted = options.turns?.[turnStarts] ?? [];
              turnStarts += 1;
              yield* send({ id: message.id, result: wireFixture.responses.turnStart });
              yield* send({
                method: "turn/started",
                params: { threadId: PEER_THREAD_ID, turn },
              });
              for (const entry of scripted) {
                if ("notification" in entry) {
                  yield* send({ method: entry.notification, params: entry.params });
                } else {
                  const id = nextPeerRequestId;
                  nextPeerRequestId += 1;
                  peerRequests.set(id, {
                    method: entry.request,
                    resolves: entry.params.approvalId ?? entry.params.itemId ?? id,
                  });
                  yield* send({ id, method: entry.request, params: entry.params });
                }
              }
              return;
            }
            default:
              return yield* send({ id: message.id, result: {} });
          }
        });

      let buffered = "";
      const stdin = Sink.forEach((chunk: Uint8Array) =>
        Effect.gen(function* () {
          buffered += decoder.decode(chunk, { stream: true });
          let newline = buffered.indexOf("\n");
          while (newline >= 0) {
            const line = buffered.slice(0, newline).trim();
            buffered = buffered.slice(newline + 1);
            if (line.length > 0) yield* receive(decodeAdapterLine(line));
            newline = buffered.indexOf("\n");
          }
        }),
      );

      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.never,
        isRunning: Effect.succeed(true),
        kill: () => Queue.shutdown(stdout),
        unref: Effect.succeed(Effect.void),
        stdin,
        stdout: Stream.fromQueue(stdout),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );

  const adapter = yield* makeCodexAdapter(decodeCodexSettings(options.settings ?? {}), {
    environment: HARNESS_ENVIRONMENT,
  }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
  yield* Stream.runForEach(adapter.streamEvents, (event) =>
    Effect.sync(() => events.push(event)),
  ).pipe(Effect.forkScoped);

  /** Waits, yielding to the adapter's fibers, until `ready` holds. */
  const settle = (what: string, ready: () => boolean) =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < 1000; attempt += 1) {
        if (ready()) return;
        yield* Effect.yieldNow;
      }
      return yield* Effect.die(new Error(`the harness never saw ${what}`));
    });

  /** The first `count` events of a type, once the collector fiber has taken them in. */
  const eventsOfType = <T extends ProviderRuntimeEvent["type"]>(type: T, count = 1) =>
    Effect.gen(function* () {
      const matching = () => events.filter((event) => event.type === type);
      yield* settle(`${count} ${type} event(s)`, () => matching().length >= count);
      return matching().slice(0, count) as Array<
        Extract<ProviderRuntimeEvent, { readonly type: T }>
      >;
    });

  /** Every answer to a peer request, once `count` of them have arrived. */
  const answers = (count: number) =>
    Effect.gen(function* () {
      const answered = () => wire.filter((record) => "answered" in record);
      yield* settle(`${count} answer(s) to the peer`, () => answered().length >= count);
      return answered();
    });

  return { adapter, spawns, wire, events, eventsOfType, answers };
});

export const codexAdapterHarnessLayer = Layer.mergeAll(
  ServerConfig.layerTest("/tmp/codex-adapter-harness", "/tmp"),
  ServerSettingsService.layerTest(),
).pipe(Layer.provideMerge(NodeServices.layer));
