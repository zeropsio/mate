// @effect-diagnostics globalTimers:off preferSchemaOverJson:off - a real macrotask lets the client's own fibers run between steps; the socket's JSON is what a frame crosses.
/**
 * One conversation end to end: the running engine (`makeEngineWorld`: the live layer over a
 * scripted Claude provider, a SQLite file, the test clock) behind its wire (`makeEngineWire`), and
 * the client's own adapter and store over that wire — the frames and pages encoded and decoded by
 * the contract schemas, as the socket carries them. A person speaks through the wire's calls; the
 * agent is played on the provider's thread. A reload is a second client opened on the same record;
 * a restart crashes the server and boots it on the same file, and the open client resubscribes.
 */
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/reactivity";
import {
  CommandId,
  EngineConversationFrame,
  EngineDetail,
  EnginePage,
  EngineRowsFrame,
  MATE_ENGINE_PROTOCOLS,
  RunId,
} from "@t3tools/contracts";
import {
  ENGINE_LIVE_POLICY,
  makeAccountStore,
  makeEngineLiveText,
  makeMateEngineConversations,
  readsOfState,
  type EngineConversationKey,
  type EngineConversationWire,
} from "@t3tools/client-runtime/data";

import {
  makeEngineWorld,
  mate,
  type EngineWorld,
} from "../../../server/src/engine/testing/pump/engineWorld.ts";
import {
  makeEngineWire,
  type EngineWireShape,
  type WireCaller,
} from "../../../server/src/engine/wire/EngineWire.ts";

export const KEY: EngineConversationKey = { environmentId: "env-1", conversationId: mate };
const PROTOCOL = Math.max(...MATE_ENGINE_PROTOCOLS);
const CALLER: WireCaller = {
  subject: "zerops-user:ana",
  environmentId: KEY.environmentId,
  epoch: 4,
};

/** What the socket does to a value: encoded by its contract as JSON, decoded on the other side. */
const across = <S extends Schema.Top>(schema: S) => {
  const encode = Schema.encodeSync(schema as never) as unknown as (value: S["Type"]) => unknown;
  const decode = Schema.decodeUnknownSync(schema as never) as unknown as (
    value: unknown,
  ) => S["Type"];
  return (value: S["Type"]): S["Type"] => decode(JSON.parse(JSON.stringify(encode(value))));
};
const frameCodec = EngineConversationFrame;
const rowsCodec = EngineRowsFrame;
const pageCodec = EnginePage;
const detailCodec = EngineDetail;

const fault = (error: unknown) => ({
  outcome: "transient" as const,
  message: error instanceof Error ? error.message : JSON.stringify(error),
});

/** A client of the engine's wire: its account store holds the conversation and its rows. */
export interface Client {
  readonly store: ReturnType<typeof makeAccountStore>;
  readonly conversations: ReturnType<typeof makeMateEngineConversations>;
  readonly reads: () => ReturnType<typeof readsOfState>;
  /** The socket came back: its links subscribe again from where they stood. */
  readonly resubscribe: () => void;
  readonly close: () => void;
}

export const makeOracleWorld = Effect.gen(function* () {
  const w: EngineWorld = yield* makeEngineWorld({ driver: "claudeAgent" });
  yield* w.boot;
  let wire: EngineWireShape = yield* w.within(makeEngineWire({ coalesce: 0 }));
  /** The open subscriptions: a restart ends each, as the socket's close does. */
  const open = new Set<Deferred.Deferred<void>>();
  const ended = <A, E>(stream: Stream.Stream<A, E>) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const done = yield* Deferred.make<void>();
        open.add(done);
        return stream.pipe(
          Stream.interruptWhen(Deferred.await(done)),
          Stream.ensuring(Effect.sync(() => open.delete(done))),
        );
      }),
    );

  const clientWire: EngineConversationWire = {
    subscribe: (key, after) =>
      ended(
        Stream.suspend(() =>
          wire.subscribe(
            {
              protocol: PROTOCOL,
              conversationId: key.conversationId as never,
              ...(after === null ? {} : { after }),
            },
            CALLER,
          ),
        ),
      ).pipe(Stream.map(across(frameCodec)), Stream.mapError(fault)),
    subscribeRows: () =>
      ended(Stream.suspend(() => wire.subscribeRows({ protocol: PROTOCOL }, CALLER))).pipe(
        Stream.map(across(rowsCodec)),
        Stream.mapError(fault),
      ),
    readEarlier: (key, beforeOrdinal) =>
      Effect.suspend(() =>
        wire.readEarlier({
          protocol: PROTOCOL,
          conversationId: key.conversationId as never,
          beforeOrdinal,
        }),
      ).pipe(Effect.map(across(pageCodec)), Effect.mapError(fault)),
    readRun: (key, runId, at) =>
      Effect.suspend(() =>
        wire.readRun({
          protocol: PROTOCOL,
          conversationId: key.conversationId as never,
          runId: runId as never,
          ...(at.before === undefined ? {} : { beforeSeq: at.before }),
          ...(at.after === undefined ? {} : { afterSeq: at.after }),
          ...(at.only === undefined ? {} : { only: at.only }),
        }),
      ).pipe(Effect.map(across(pageCodec)), Effect.mapError(fault)),
    readDetail: (key, itemId, part) =>
      Effect.suspend(() =>
        wire.readDetail({
          protocol: PROTOCOL,
          conversationId: key.conversationId as never,
          itemId: itemId as never,
          part,
        }),
      ).pipe(Effect.map(across(detailCodec)), Effect.mapError(fault)),
  };

  const clients = new Set<Client>();
  const openClient = (): Client => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const never = () => 0;
    const live = makeEngineLiveText({
      policy: ENGINE_LIVE_POLICY,
      setTimer: never,
      clearTimer: () => {},
    });
    const conversations = makeMateEngineConversations({
      store,
      live,
      wire: clientWire,
      setTimer: never,
      clearTimer: () => {},
    });
    let releaseRows = conversations.holdRows(KEY.environmentId);
    let release = conversations.hold(KEY);
    const client: Client = {
      store,
      conversations,
      reads: () => readsOfState(store.state()),
      resubscribe: () => {
        release();
        releaseRows();
        releaseRows = conversations.holdRows(KEY.environmentId);
        release = conversations.hold(KEY);
      },
      close: () => {
        release();
        releaseRows();
        conversations.close();
        live.close();
        store.close();
        registry.dispose();
        clients.delete(client);
      },
    };
    clients.add(client);
    return client;
  };
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const client of clients) client.close();
    }),
  );

  /**
   * Lets the server and every client run until nothing changes: the engine's fibers on the test
   * clock, the client's on the runtime's scheduler, between them a real macrotask.
   */
  const settle = Effect.gen(function* () {
    let still = 0;
    let before = [...clients].map((client) => client.store.state());
    for (let round = 0; round < 60 && still < 3; round++) {
      yield* w.settle;
      yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
      const after = [...clients].map((client) => client.store.state());
      still = after.every((state, index) => state === before[index]) ? still + 1 : 0;
      before = after;
    }
  });

  let commands = 0;
  const commandId = () => CommandId.make(`oracle-${++commands}`);
  const person = {
    send: (text: string) =>
      Effect.gen(function* () {
        const result = yield* wire.send(
          { protocol: PROTOCOL, conversationId: mate, commandId: commandId(), text },
          CALLER,
        );
        yield* settle;
        return result;
      }),
    steer: (runId: string, text: string) =>
      Effect.gen(function* () {
        const result = yield* wire.steer(
          {
            protocol: PROTOCOL,
            conversationId: mate,
            commandId: commandId(),
            runId: RunId.make(runId),
            text,
          },
          CALLER,
        );
        yield* settle;
        return result;
      }),
    stop: Effect.gen(function* () {
      const result = yield* wire.stop(
        { protocol: PROTOCOL, conversationId: mate, commandId: commandId() },
        CALLER,
      );
      yield* settle;
      return result;
    }),
  };

  /** The server dies and boots again on the same file; every open subscription ends with it. */
  const restart = Effect.gen(function* () {
    for (const done of open) Deferred.doneUnsafe(done, Exit.void);
    yield* w.crash;
    yield* w.boot;
    wire = yield* w.within(makeEngineWire({ coalesce: 0 }));
    yield* w.advance(0);
    // The socket comes back at once rather than on the client's backoff clock.
    for (const client of clients) client.resubscribe();
    yield* settle;
  });

  yield* w.tell({
    _tag: "AssignAgent",
    agent: {
      instanceId: "claudeAgent",
      driver: "claudeAgent",
      model: "m1",
      profile: { kind: "mate" },
    },
  });

  return { w, person, openClient, settle, restart };
});

export type OracleWorld = Effect.Success<typeof makeOracleWorld>;
