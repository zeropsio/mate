/** Only explicit daemon identity or the SPI call's own result images can establish a call image. */
import type { SpiEvent, ZeropsBrowserCallResult, ZeropsBrowserFrame } from "@t3tools/contracts";

const identity = (threadId: string, turnId: string, callId: string): string =>
  JSON.stringify([threadId, turnId, callId]);
export function makeBrowserCallFrames() {
  const revisions = new Map<string, number>();
  const completed = new Set<string>();
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
        }
        return;
      }
      if (
        event.type !== "item.completed" ||
        event.toolCall?.name !== "zerops_browser" ||
        event.itemId === undefined ||
        event.turnId === undefined
      )
        return;
      const callId = String(event.itemId);
      const threadId = String(event.threadId);
      const turnId = String(event.turnId);
      const key = identity(threadId, turnId, callId);
      if (completed.has(key)) return;
      completed.add(key);
      const revision = (revisions.get(key) ?? 0) + 1;
      revisions.set(key, revision);
      const result = event.toolCall.result;
      // Omitted/dropped images never prove a viewport absence, even when the call was observed.
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
    frame(frame: ZeropsBrowserFrame): ZeropsBrowserFrame {
      if (
        frame.callId !== undefined &&
        frame.threadId !== undefined &&
        frame.turnId !== undefined &&
        frame.revision !== undefined &&
        frame.completeness === "complete"
      ) {
        const key = identity(frame.threadId, frame.turnId, frame.callId);
        revisions.set(key, Math.max(revisions.get(key) ?? 0, frame.revision));
      }
      return frame;
    },
  };
}
