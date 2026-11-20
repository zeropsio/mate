/**
 * The SPI goldens as the bridge meets them in a running session. A Codex golden replays the
 * adapter's mapper alone (`spi/replay/codexReplay.ts`), not the session runtime's routing
 * (`CodexSessionRuntime.readRouteFields`), so `asSessionRoutes` adds what the runtime would:
 * - the parent's events keep their native thread id in the replay, while the runtime hands them
 *   to the session's own thread: the parent (the thread of the first turn) is routed onto the
 *   session's thread, the first event's; a helper's thread stays its own;
 * - a delta names its item by `params.itemId`, which the replay never reads: the delta takes the
 *   item its raw notification names.
 */
import type { SpiEvent } from "@t3tools/contracts";

const rawItemId = (event: SpiEvent): string | undefined => {
  const payload = (event.raw as { readonly payload?: { readonly itemId?: unknown } } | undefined)
    ?.payload;
  return typeof payload?.itemId === "string" ? payload.itemId : undefined;
};

/** A replay's events as the session runtime would route them (see the module's note). */
export const asSessionRoutes = (events: ReadonlyArray<SpiEvent>): ReadonlyArray<SpiEvent> => {
  const session = events[0]?.threadId;
  const parent = events.find((event) => event.type === "turn.started")?.threadId;
  return events.map((event) => {
    const item = event.type === "content.delta" && event.itemId === undefined && rawItemId(event);
    const routed = parent !== undefined && session !== undefined && event.threadId === parent;
    if (!item && !routed) return event;
    return {
      ...event,
      ...(routed ? { threadId: session } : {}),
      ...(item ? { itemId: item } : {}),
    } as SpiEvent;
  });
};
