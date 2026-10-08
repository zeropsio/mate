/**
 * An engine conversation as a stream of thread states, for a reader that draws one thread state at
 * a time — mobile's feed, which re-derives itself from each state V1's replay hands it, a delta at
 * a time. The account's projection of the records (`engineThread`), held while read, with each
 * streaming message's words so far laid in from the live text (`engineLive.ts`): a note grows as
 * it is written, and its record replaces it whole once it settles. The live text stays out of the
 * store; it is read here, at the reader's edge, as the web's leaf reads it.
 *
 * @module data/engineThreadChanges
 */
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import type { EnvironmentThreadState } from "../state/threadState.ts";
import { registerOlderThreadTurns } from "./adapters/mateThreadReplay.ts";
import type { MateEngineHost } from "./engineHost.ts";
import type { EngineConversationKey } from "./families/mateEngine.ts";
import {
  engineHeldTurns,
  engineRows,
  engineThread,
  overlayEngineShell,
} from "./projections/mateEngine.ts";
import type { EnvironmentShellState } from "./adapters/mateShellReplay.ts";

type LiveRead = (itemId: string, stream: "text" | "reasoning") => string | null;

const streamOf = (role: string) => (role === "reasoning" ? "reasoning" : "text");

/** The thread with each streaming message's words so far, where the live text holds more. */
export function withEngineLiveText(
  state: EnvironmentThreadState,
  read: LiveRead,
): EnvironmentThreadState {
  const thread = Option.getOrNull(state.data);
  if (thread === null || !thread.messages.some((message) => message.streaming)) return state;
  let changed = false;
  const messages = thread.messages.map((message) => {
    if (!message.streaming) return message;
    const live = read(message.id, streamOf(message.role));
    if (live === null || live.length < message.text.length || live === message.text) return message;
    changed = true;
    return { ...message, text: live };
  });
  return changed ? { ...state, data: Option.some({ ...thread, messages }) } : state;
}

/**
 * The conversation's thread states while the stream runs: held, its earlier run groups loaded when
 * the reader asks for older turns, each change of its records and of a streaming message's words.
 */
export function engineThreadChanges(
  host: MateEngineHost,
  key: EngineConversationKey,
): Stream.Stream<EnvironmentThreadState> {
  return Stream.callback<EnvironmentThreadState>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const atom = host.store.data.project(engineThread, key);
        const read: LiveRead = (itemId, stream) =>
          host.live.read(key.environmentId, itemId, stream);
        const watched = new Map<string, () => void>();
        let state: EnvironmentThreadState | undefined;
        const emit = () => {
          if (state !== undefined) Queue.offerUnsafe(queue, withEngineLiveText(state, read));
        };
        const watch = () => {
          const streaming = new Set<string>(
            Option.match(state?.data ?? Option.none(), {
              onNone: () => [],
              onSome: (thread) =>
                thread.messages.filter((message) => message.streaming).map(({ id }) => id),
            }),
          );
          for (const [id, stop] of watched)
            if (!streaming.has(id)) {
              stop();
              watched.delete(id);
            }
          for (const id of streaming)
            if (!watched.has(id)) watched.set(id, host.live.watch(key.environmentId, id, emit));
        };
        const release = host.conversations.hold(key);
        const releaseEarlier = registerOlderThreadTurns(
          key.environmentId as EnvironmentId,
          key.conversationId as ThreadId,
          () => {
            host.conversations.readEarlier(key);
          },
        );
        const unsubscribe = host.atoms.subscribe(
          atom,
          (next) => {
            state = next;
            watch();
            emit();
          },
          { immediate: true },
        );
        return () => {
          unsubscribe();
          for (const stop of watched.values()) stop();
          releaseEarlier();
          release();
        };
      }),
      (close) => Effect.sync(close),
    ),
  );
}

/** What a Mate's engine rows lay over the V1 shell a reader draws its menu from. */
export type EngineShellOverlay = (shell: EnvironmentShellState) => EnvironmentShellState;

/**
 * A Mate's engine conversation rows while the stream runs, held while read: each change as the
 * overlay that lays them, and the turns of the conversations the account holds, over the V1 shell.
 */
export function engineShellChanges(
  host: MateEngineHost,
  environmentId: string,
): Stream.Stream<EngineShellOverlay> {
  return Stream.callback<EngineShellOverlay>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const rowsAtom = host.store.data.project(engineRows, environmentId);
        const heldAtom = host.store.data.project(engineHeldTurns, environmentId);
        const release = host.conversations.holdRows(environmentId);
        let rows = host.atoms.get(rowsAtom);
        let held = host.atoms.get(heldAtom);
        const emit = () =>
          Queue.offerUnsafe(queue, (shell: EnvironmentShellState) =>
            overlayEngineShell(shell, rows, held),
          );
        const unsubscribeRows = host.atoms.subscribe(rowsAtom, (next) => {
          rows = next;
          emit();
        });
        const unsubscribeHeld = host.atoms.subscribe(heldAtom, (next) => {
          held = next;
          emit();
        });
        emit();
        return () => {
          unsubscribeHeld();
          unsubscribeRows();
          release();
        };
      }),
      (close) => Effect.sync(close),
    ),
  );
}
