/**
 * A SessionHost on its own, for the pump's unit tests: the actor is a double that records every
 * batch it is told (and can fail the first n), the live plane is real, ProviderService is a mock.
 */
import * as Effect from "effect/Effect";
import { CommandId, ConversationId, ThreadId, type CommandResult } from "@t3tools/contracts";

import type { ProviderServiceShape } from "../../../provider/Services/ProviderService.ts";
import type { BridgeDriver } from "../../bridge/spi3.ts";
import type { ConversationsShape } from "../../Conversations.ts";
import type { Envelope, ProviderSignal } from "../../domain/command.ts";
import { EngineStoreError } from "../../store/EngineStore.ts";
import { makeLiveBus } from "../../LiveBus.ts";
import type { CallPictures } from "../../pump/callPictures.ts";
import { makeSessionHost } from "../../pump/SessionHost.ts";

export const hostConversation = ConversationId.make("mate");
export const hostThread = ThreadId.make("mate/s/1");

export const makeHostHarness = (
  options: {
    readonly driver?: BridgeDriver;
    readonly failFirst?: number;
    readonly pictures?: CallPictures;
    readonly interruptTurn?: Effect.Effect<void>;
    readonly stopSession?: Effect.Effect<void>;
    readonly changed?: Effect.Effect<void>;
  } = {},
) =>
  Effect.gen(function* () {
    const told: Array<ReadonlyArray<ProviderSignal>> = [];
    let failures = options.failFirst ?? 0;
    const tell = (envelope: Envelope) =>
      Effect.suspend(() => {
        if (failures > 0) {
          failures -= 1;
          return Effect.fail(
            new EngineStoreError({ operation: "test", cause: "the actor failed" }),
          );
        }
        if (envelope.command._tag === "ProviderSignals") told.push(envelope.command.signals);
        return Effect.succeed<CommandResult>({ _tag: "Accepted", seq: told.length });
      });
    const conversations = {
      ask: () => Effect.die("not used"),
      tell,
      subscribe: () => Effect.die("not used") as never,
    } as unknown as ConversationsShape;
    const provider = {
      stopSession: () => options.stopSession ?? Effect.void,
      interruptTurn: () => options.interruptTurn ?? Effect.void,
    } as unknown as ProviderServiceShape;
    const host = yield* makeSessionHost(
      { conversationId: hostConversation, thread: hostThread, driver: options.driver ?? "codex" },
      {
        conversations,
        live: yield* makeLiveBus(),
        provider,
        scope: yield* Effect.scope,
        stopping: () => false,
        quiet: Effect.void,
        ...(options.pictures === undefined ? {} : { pictures: options.pictures }),
        ...(options.changed === undefined ? {} : { changed: options.changed }),
      },
    );
    return { host, told, commandId: CommandId.make("unused") };
  });

/** A provider event on the harness's thread. */
let events = 0;
export const hostEvent = (type: string, fields: Record<string, unknown> = {}) =>
  ({
    type,
    eventId: `h${++events}`,
    provider: "codex",
    threadId: hostThread,
    createdAt: "2026-10-07T00:00:00.000Z",
    payload: {},
    ...fields,
  }) as never;
