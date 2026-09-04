/**
 * Pure client-side reads of the browser stream (S8b) — frame decoding and
 * canvas→device-pixel coordinate mapping. UI-free and platform-free
 * (client-runtime R1): no DOM, no RPC client, no React.
 *
 * See `../../../../zcp/docs/spec-mate.md` §5 "Browser surface".
 */
import type {
  ZeropsBrowserFrame,
  ZeropsBrowserStreamEvent,
  ZeropsBrowserStreamStatus,
} from "@t3tools/contracts";

/** The daemon relays JPEG frames (S8b brief), never re-encoded — `data` is base64 as received. */
export function frameImageSrc(frame: ZeropsBrowserFrame): string {
  return `data:image/jpeg;base64,${frame.data}`;
}

export interface CanvasPoint {
  /** CSS pixels: the `<canvas>` element's own displayed size (`getBoundingClientRect()`). */
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /** CSS pixels: the pointer position within the canvas (e.g. a `PointerEvent`'s `offsetX`/`offsetY`). */
  readonly x: number;
  readonly y: number;
}

export interface DevicePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Maps a pointer position on the displayed `<canvas>` (CSS pixels) to the
 * page-absolute device-pixel position the daemon's input dispatch expects:
 * scales by the ratio between the frame's own device dimensions and the
 * canvas's displayed size (the canvas is drawn at CSS size, the frame is
 * device-pixel size — a HiDPI display or a resized panel makes these
 * differ), then adds the frame's current scroll offset so the result is
 * stable across scroll position, not just viewport-relative. Falls back to
 * scale `1` when the canvas reports a zero dimension (not yet laid out)
 * rather than producing `Infinity`/`NaN`.
 */
export function mapCanvasPointToDevicePixels(
  point: CanvasPoint,
  frame: Pick<ZeropsBrowserFrame, "width" | "height" | "scrollX" | "scrollY">,
): DevicePoint {
  const scaleX = point.canvasWidth > 0 ? frame.width / point.canvasWidth : 1;
  const scaleY = point.canvasHeight > 0 ? frame.height / point.canvasHeight : 1;
  return {
    x: point.x * scaleX + (frame.scrollX ?? 0),
    y: point.y * scaleY + (frame.scrollY ?? 0),
  };
}

/**
 * `subscribeZeropsBrowserStream` interleaves two kinds of event (state
 * transitions, frames) on one stream; a viewer needs both at once (the
 * current connection status AND the last frame, so it never renders a stale
 * frame under a "no-browser" caption). This is the accumulated snapshot a
 * client folds the raw event stream into — every consumer reads this, never
 * the raw `ZeropsBrowserStreamEvent` union.
 */
export interface ZeropsBrowserStreamState {
  readonly status: ZeropsBrowserStreamStatus;
  /** The page the daemon last reported, once known. */
  readonly url?: string;
  /** The most recent frame while `status` is `"live"`; absent otherwise — a stale frame from a prior session never lingers as "current". */
  readonly frame?: ZeropsBrowserFrame;
}

export const INITIAL_BROWSER_STREAM_STATE: ZeropsBrowserStreamState = { status: "no-browser" };

/** Pure fold: `(state, next event) → state`. The server's own first emission on subscribe re-seeds `status`, so a reconnect never has to be special-cased here. */
export function foldBrowserStreamEvent(
  state: ZeropsBrowserStreamState,
  event: ZeropsBrowserStreamEvent,
): ZeropsBrowserStreamState {
  if (event.type === "frame") {
    return { ...state, frame: event };
  }
  return {
    status: event.status,
    // Sticky: a reconnect/state event with no URL of its own keeps showing
    // the last known page rather than blanking the "what page" line.
    ...(event.url !== undefined
      ? { url: event.url }
      : state.url !== undefined
        ? { url: state.url }
        : {}),
    ...(event.status === "live" ? { frame: state.frame } : {}),
  };
}
