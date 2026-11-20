/**
 * Which `zerops_browser` call an image belongs to, from explicit identity only: the SPI call's own
 * result images, or a live daemon frame while zcp names the call that holds the shared browser
 * (`/run/zcp-browser/default.call`, zcp `docs/spec-mate.md` §5.6 "Whose call it is", C-16) and
 * that call runs here. The browser is shared and calls queue, so a frame is never given to a call
 * merely because it is running.
 */
import type { SpiEvent, ZeropsBrowserCallResult, ZeropsBrowserFrame } from "@t3tools/contracts";

const identity = (threadId: string, turnId: string, callId: string): string =>
  JSON.stringify([threadId, turnId, callId]);
export function makeBrowserCallFrames() {
  const revisions = new Map<string, number>();
  const completed = new Set<string>();
  /** The browser calls started and not yet completed, by their call id: where a named frame goes. */
  const running = new Map<string, { readonly threadId: string; readonly turnId: string }>();
  return {
    ingest(event: SpiEvent): ZeropsBrowserCallResult | undefined {
      if (
        event.type === "turn.completed" ||
        event.type === "turn.aborted" ||
        event.type === "session.exited"
      ) {
        if (event.type === "session.exited" || event.turnId !== undefined) {
          const prefix =
            JSON.stringify(
              event.type === "session.exited"
                ? [String(event.threadId)]
                : [String(event.threadId), String(event.turnId)],
            ).slice(0, -1) + ",";
          // Only ordering/dedup metadata ends here; emitted call facts are retained by clients.
          for (const key of revisions.keys()) if (key.startsWith(prefix)) revisions.delete(key);
          for (const key of completed) if (key.startsWith(prefix)) completed.delete(key);
          for (const [callId, call] of running)
            if (identity(call.threadId, call.turnId, callId).startsWith(prefix))
              running.delete(callId);
        }
        return;
      }
      if (
        (event.type !== "item.started" &&
          event.type !== "item.updated" &&
          event.type !== "item.completed") ||
        event.toolCall?.name !== "zerops_browser" ||
        event.itemId === undefined ||
        event.turnId === undefined
      )
        return;
      const callId = String(event.itemId);
      const threadId = String(event.threadId);
      const turnId = String(event.turnId);
      const key = identity(threadId, turnId, callId);
      if (event.type !== "item.completed") {
        if (!completed.has(key)) running.set(callId, { threadId, turnId });
        return;
      }
      running.delete(callId);
      if (completed.has(key)) return;
      completed.add(key);
      const revision = (revisions.get(key) ?? 0) + 1;
      revisions.set(key, revision);
      const result = event.toolCall.result;
      // Omitted/dropped images never prove a viewport absence, even when the call was observed:
      // the card keeps the live frame it last showed.
      const images = result?.images;
      if (
        images === undefined ||
        result?.imagesDropped === true ||
        event.payload.unreturned === true
      )
        return { type: "call-result", callId, threadId, turnId, revision, completeness: "partial" };
      const image = images.at(-1);
      const frame: ZeropsBrowserFrame | null =
        image === undefined
          ? null
          : {
              type: "frame",
              callId,
              threadId,
              turnId,
              revision,
              completeness: "complete",
              data: image.data,
              mimeType: image.mimeType,
              width: image.width ?? 0,
              height: image.height ?? 0,
            };
      return {
        type: "call-result",
        callId,
        threadId,
        turnId,
        revision,
        completeness: "complete",
        frame,
      };
    },
    /**
     * A live daemon frame, tied to `holder` — the call zcp names as holding the browser — when that
     * call runs here; as it came, on no call's card, otherwise.
     */
    live(frame: ZeropsBrowserFrame, holder: string | undefined): ZeropsBrowserFrame {
      const call = holder === undefined ? undefined : running.get(holder);
      if (holder === undefined || call === undefined) return frame;
      const key = identity(call.threadId, call.turnId, holder);
      const revision = (revisions.get(key) ?? 0) + 1;
      revisions.set(key, revision);
      return {
        ...frame,
        callId: holder,
        threadId: call.threadId,
        turnId: call.turnId,
        revision,
        completeness: "complete",
      };
    },
  };
}
