/**
 * The words an engine Mate is still writing, read where they are drawn: a streaming note's or
 * thought's record holds what was said when it opened, and the account's live text
 * (`data/engineLive.ts`) holds the rest as it streams. Only the leaf drawing a streaming message
 * reads it, so a delta re-renders that leaf alone; once the record settles it carries the same
 * words and the live text goes, so nothing moves.
 *
 * A V1 Mate's message is drawn as it is: the live text never holds its ids.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { TimelineEntry } from "../session-logic";
import { messageHasText } from "../components/chat/runCard.logic";
import { mateEngineHostAtom } from "@t3tools/client-runtime/data";
import { use, useCallback, useMemo, useSyncExternalStore } from "react";

import { TimelineRowCtx } from "../components/chat/timelineContext";
import type { ChatMessage } from "../types";

const unwatched = () => () => {};

/** The message with the words streamed so far, while its record is still being written. */
export function liveMessage(message: ChatMessage, live: string | null): ChatMessage {
  if (live === null || !message.streaming || live.length < message.text.length) return message;
  return live === message.text ? message : { ...message, text: live };
}

/** The live text of the streaming message `message`, if the account holds any. */
function useLiveText(message: ChatMessage | null): string | null {
  const environmentId = use(TimelineRowCtx).threadRef?.environmentId ?? null;
  const host = useAtomValue(mateEngineHostAtom);
  const live = message?.streaming === true && environmentId !== null ? (host?.live ?? null) : null;
  const id = message?.id ?? null;
  const stream = message?.role === "reasoning" ? "reasoning" : "text";
  const subscribe = useCallback(
    (listener: () => void) =>
      live === null || environmentId === null || id === null
        ? unwatched()
        : live.watch(environmentId, id, listener),
    [environmentId, id, live],
  );
  const read = () =>
    live === null || environmentId === null || id === null
      ? null
      : live.read(environmentId, id, stream);
  return useSyncExternalStore(subscribe, read, read);
}

export function useEngineLiveMessage(message: ChatMessage): ChatMessage {
  const text = useLiveText(message);
  return useMemo(() => liveMessage(message, text), [message, text]);
}

/** A stretch of messages, the one still streaming with its words so far. */
export function useEngineLiveMessages(
  messages: ReadonlyArray<ChatMessage>,
): ReadonlyArray<ChatMessage> {
  const index = messages.findLastIndex((message) => message.streaming === true);
  const streaming = index === -1 ? null : messages[index]!;
  const text = useLiveText(streaming);
  return useMemo(() => {
    if (streaming === null) return messages;
    const drawn = liveMessage(streaming, text);
    return drawn === streaming ? messages : messages.with(index, drawn);
  }, [index, messages, streaming, text]);
}

/**
 * What a run is doing now, with the words streamed so far: the thought it is having, or the note
 * it is writing — the live slot and its line decide what to draw from them.
 */
export function useEngineLiveNow<
  Now extends {
    readonly kind: string;
    readonly messages?: ReadonlyArray<ChatMessage>;
    readonly note?: { readonly key: string; readonly message: ChatMessage };
  },
>(now: Now | null): Now | null {
  const recorded = now?.kind === "thinking" ? (now.messages ?? NO_MESSAGES) : NO_MESSAGES;
  const messages = useEngineLiveMessages(recorded);
  const written = now?.kind === "writing" ? (now.note?.message ?? null) : null;
  const writing = useLiveText(written);
  return useMemo(() => {
    if (now === null) return now;
    if (messages !== recorded) return { ...now, messages };
    if (written === null || now.note === undefined) return now;
    const message = liveMessage(written, writing);
    return message === written ? now : { ...now, note: { ...now.note, message } };
  }, [messages, now, recorded, writing, written]);
}

const NO_MESSAGES: ReadonlyArray<ChatMessage> = [];

/** Only empty/meaningful transitions reach record assembly, never the streamed bytes. */
export function useEngineLiveStructure(
  threadRef: ScopedThreadRef | null,
  entries: ReadonlyArray<TimelineEntry>,
): ReadonlyMap<string, boolean> {
  const host = useAtomValue(mateEngineHostAtom);
  const live = host?.live ?? null;
  const environmentId = threadRef?.environmentId ?? null;
  const messages = useMemo(
    () =>
      entries.flatMap((entry) =>
        entry.kind === "message" && entry.message.streaming ? [entry.message] : [],
      ),
    [entries],
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      if (live === null || environmentId === null) return unwatched();
      const releases = messages.map((message) => live.watch(environmentId, message.id, listener));
      return () => releases.forEach((release) => release());
    },
    [environmentId, live, messages],
  );
  const read = () =>
    messages
      .map((message) => {
        const text =
          live === null || environmentId === null
            ? null
            : live.read(
                environmentId,
                message.id,
                message.role === "reasoning" ? "reasoning" : "text",
              );
        return messageHasText(liveMessage(message, text)) ? "1" : "0";
      })
      .join("");
  const visibility = useSyncExternalStore(subscribe, read, read);
  return useMemo(
    () => new Map(messages.map((message, index) => [message.id, visibility[index] === "1"])),
    [messages, visibility],
  );
}
