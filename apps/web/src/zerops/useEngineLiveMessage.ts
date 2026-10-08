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
