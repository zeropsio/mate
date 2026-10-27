/**
 * A live remote view: the latest frame as a plain `<img>` (relayed verbatim,
 * never re-encoded here) under a transparent `<canvas>` that captures pointer
 * and keyboard input in the frame's own coordinates
 * (`mapCanvasPointToDevicePixels`). The agent's browser and the paired Mac's
 * app both show through it; what an input means is the caller's.
 */
import type { ZeropsBrowserFrame } from "@t3tools/contracts";
import {
  frameImageSrc,
  mapCanvasPointToDevicePixels,
  type DevicePoint,
} from "@t3tools/client-runtime/zerops/browserStream";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";

export type LiveFramePointer = "press" | "release" | "drag";

export interface LiveFrameKey {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
}

export interface LiveFrameViewerProps {
  readonly frame: Pick<
    ZeropsBrowserFrame,
    "data" | "mimeType" | "width" | "height" | "pageScaleFactor"
  >;
  /** The box the frame sits in: the owning view's own frame box. */
  readonly boxClassName: string;
  readonly alt: string;
  readonly inputLabel: string;
  readonly inputDisabled: boolean;
  /** A press, a release, or a move while pressed; a bare hover is never reported. */
  readonly onPointer: (kind: LiveFramePointer, point: DevicePoint) => void;
  readonly onKey: (kind: "down" | "up", key: LiveFrameKey) => void;
  /** `data-*` attributes for the input canvas. */
  readonly canvasData?: Readonly<Record<`data-${string}`, string | boolean>>;
}

export function LiveFrameViewer({
  frame,
  boxClassName,
  alt,
  inputLabel,
  inputDisabled,
  onPointer,
  onKey,
  canvasData,
}: LiveFrameViewerProps) {
  const isPointerDownRef = useRef(false);

  const handlePointer = (kind: LiveFramePointer) => (event: PointerEvent<HTMLCanvasElement>) => {
    if (kind === "press") {
      isPointerDownRef.current = true;
      // Keeps every later move/up event targeting this canvas even once the
      // pointer strays outside its bounds mid-drag — without this, a release
      // outside the canvas never reaches "release" below and the drag is
      // stuck pressed.
      event.currentTarget.setPointerCapture(event.pointerId);
    } else if (kind === "release") {
      isPointerDownRef.current = false;
    } else if (!isPointerDownRef.current) {
      // A bare hover would otherwise send one operate-scope RPC per pixel of
      // mouse movement: only moves made while a button is held go through.
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    onPointer(
      kind,
      mapCanvasPointToDevicePixels(
        {
          canvasWidth: rect.width,
          canvasHeight: rect.height,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        },
        frame,
      ),
    );
  };

  /** For a lost or cancelled pointer capture (a touch gesture cancel); `setPointerCapture` handles a release outside. */
  const resetPointerDown = () => {
    isPointerDownRef.current = false;
  };

  const handleKey = (kind: "down" | "up") => (event: KeyboardEvent<HTMLCanvasElement>) => {
    // The canvas owns the keystroke while it has focus — Space/arrows/Tab
    // drive the REMOTE view, never scroll or tab around mate's own.
    event.preventDefault();
    onKey(kind, event);
  };

  return (
    <div className={boxClassName}>
      <img alt={alt} className="block w-full" src={frameImageSrc(frame)} />
      <canvas
        {...canvasData}
        aria-disabled={inputDisabled}
        aria-label={inputLabel}
        className="absolute inset-0 h-full w-full"
        onKeyDown={handleKey("down")}
        onKeyUp={handleKey("up")}
        onPointerCancel={resetPointerDown}
        onPointerDown={handlePointer("press")}
        onPointerLeave={resetPointerDown}
        onPointerMove={handlePointer("drag")}
        onPointerUp={handlePointer("release")}
        style={{ cursor: inputDisabled ? "not-allowed" : "default" }}
        tabIndex={inputDisabled ? -1 : 0}
      />
    </div>
  );
}
