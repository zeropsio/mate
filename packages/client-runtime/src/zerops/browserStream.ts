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

/**
 * Each frame's address, built once: it is the whole frame as text (up to
 * 1.4 MB in run 12), and every draw of a card showing the live frame asks
 * for it — built anew each time, each draw held a copy of its own.
 */
const frameSrcs = new WeakMap<object, string>();

/** The source image is never re-encoded; the daemon defaults to JPEG and tool images name their format. */
export function frameImageSrc<Frame extends Pick<ZeropsBrowserFrame, "data" | "mimeType">>(
  frame: Frame,
): string {
  const known = frameSrcs.get(frame);
  if (known !== undefined) return known;
  const src = `data:${frame.mimeType ?? "image/jpeg"};base64,${frame.data}`;
  frameSrcs.set(frame, src);
  return src;
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
 * CSS-viewport coordinates CDP's `Input.dispatchMouseEvent` expects: scales
 * by the ratio between the frame's own captured-image pixel dimensions and
 * the canvas's displayed size (the canvas is drawn at CSS size, the frame is
 * captured-image size — a HiDPI display or a resized panel makes these
 * differ), then divides by the page's current zoom level (`pageScaleFactor`,
 * defaults to `1`) so a pinch-zoomed page still lands the click in the right
 * place.
 *
 * Never adds scroll: CDP's own mouse dispatch is already viewport-relative,
 * not page-absolute — adding the page's scroll offset would land every
 * click on a scrolled page too far down (`frame.scrollX`/`scrollY` are
 * carried for display/telemetry only, never folded into this mapping).
 *
 * Falls back to scale `1` when the canvas reports a zero dimension (not yet
 * laid out) rather than producing `Infinity`/`NaN`.
 */
export function mapCanvasPointToDevicePixels(
  point: CanvasPoint,
  frame: Pick<ZeropsBrowserFrame, "width" | "height" | "pageScaleFactor">,
): DevicePoint {
  const scaleX = point.canvasWidth > 0 ? frame.width / point.canvasWidth : 1;
  const scaleY = point.canvasHeight > 0 ? frame.height / point.canvasHeight : 1;
  const pageScaleFactor = frame.pageScaleFactor ?? 1;
  return {
    x: (point.x * scaleX) / pageScaleFactor,
    y: (point.y * scaleY) / pageScaleFactor,
  };
}

/**
 * `subscribeZeropsBrowserStream` interleaves state transitions, frames and
 * call results on one stream; a viewer needs both at once (the
 * current connection status AND the last frame, so it never renders a stale
 * frame under a "no-browser" caption). This is the accumulated snapshot a
 * adapter folds the raw event stream into. The account stores the live viewport
 * separately from the source-proven call result slots.
 */
export interface ZeropsBrowserStreamState {
  readonly status: ZeropsBrowserStreamStatus;
  /** The page the daemon last reported, once known (its active tab's `url`). */
  readonly url?: string;
  /** The active tab's title, once known. */
  readonly title?: string;
  /** The most recent frame while `status` is `"live"`; absent otherwise — a stale frame from a prior session never lingers as "current". */
  readonly frame?: ZeropsBrowserFrame;
}

export const INITIAL_BROWSER_STREAM_STATE: ZeropsBrowserStreamState = { status: "no-browser" };

/** Pure fold: `(state, next event) → state`. The server's own first emission on subscribe re-seeds `status`, so a reconnect never has to be special-cased here. */
export function foldBrowserStreamEvent(
  state: ZeropsBrowserStreamState,
  event: ZeropsBrowserStreamEvent,
): ZeropsBrowserStreamState {
  if (event.type === "call-result") return state;
  if (event.type === "frame") {
    return { ...state, frame: event };
  }
  return {
    status: event.status,
    // Sticky: a reconnect/tab-update event that carries only part of the
    // page info keeps showing the rest of the last known page rather than
    // blanking the "what page" line.
    ...(event.url !== undefined
      ? { url: event.url }
      : state.url !== undefined
        ? { url: state.url }
        : {}),
    ...(event.title !== undefined
      ? { title: event.title }
      : state.title !== undefined
        ? { title: state.title }
        : {}),
    ...(event.status === "live" ? { frame: state.frame } : {}),
  };
}
