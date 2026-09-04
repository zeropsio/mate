/**
 * The Browser panel: a live view of the container's agent-browser daemon
 * (S8b) — `../../../../../zcp/docs/spec-mate.md` §5 "Browser surface".
 *
 * NOT a protected root (design-system.md R2): unlike `ZeropsServiceMap` /
 * `ZeropsLifecycleStrip` / `ZeropsOperationCard` / `ZeropsQuickActions`, this
 * panel issues a mutating RPC directly (`zeropsBrowserInput`) — the user's
 * own click/type IS the action, there is no agent-mutates-only boundary to
 * keep here.
 *
 * The frame image is a plain `<img>` (the daemon's own JPEG, relayed
 * verbatim — never re-encoded here); a transparent `<canvas>` sits on top
 * purely to capture pointer/keyboard input at the frame's own coordinate
 * space (`mapCanvasPointToDevicePixels`). Input is disabled while the agent
 * has an in-progress `zerops_browser` call, unless the viewer has toggled
 * "take over" (`resolveBrowserDrivingState`) — that toggle itself resets the
 * moment the agent starts a FRESH `zerops_browser` call, so a stale
 * take-over from a previous turn never silently leaves input enabled for
 * the next one.
 */
import type { ScopedThreadRef, ZeropsBrowserInput } from "@t3tools/contracts";
import {
  frameImageSrc,
  mapCanvasPointToDevicePixels,
  resolveBrowserDrivingState,
} from "@t3tools/client-runtime/zerops/browserStream";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { useAtomCommand } from "../../state/use-atom-command";
import { zeropsCommands } from "../../state/zeropsCommands";
import { useZeropsBrowserStream, useZeropsLifecycle } from "../../zerops/useZeropsFeeds";
import { FlatCard, MicroLabel, StatusDot } from "./primitives";

export interface ZeropsBrowserPanelProps {
  readonly threadRef: ScopedThreadRef | null;
  /** For tests only: seeds the take-over toggle without simulating a click. */
  readonly initialTakeOver?: boolean;
}

/** A printable single character carries CDP's `text` field alongside `key` (e.g. "a"); a named key (`Enter`, `ArrowLeft`, ...) carries `key` only. */
function keyText(key: string): string | undefined {
  return key.length === 1 ? key : undefined;
}

export function ZeropsBrowserPanel({ threadRef, initialTakeOver }: ZeropsBrowserPanelProps) {
  const environmentId = threadRef?.environmentId ?? null;
  const read = useZeropsBrowserStream(environmentId);
  const lifecycle = useZeropsLifecycle(environmentId, threadRef?.threadId ?? null);
  const [takeOver, setTakeOver] = useState(initialTakeOver ?? false);
  const lastUserInputAtRef = useRef<number | undefined>(undefined);
  const isPointerDownRef = useRef(false);
  // `undefined` means "no prior render observed yet" — distinct from a real
  // `false`, so mounting straight into an already-in-progress agent call
  // (e.g. a take-over restored from a prior session) is never mistaken for
  // a FRESH false→true transition and does not spuriously reset takeOver.
  const previousAgentDrivingRef = useRef<boolean | undefined>(undefined);
  const sendInputCommand = useAtomCommand(zeropsCommands.browserInput, "zerops browser input");

  const driving = resolveBrowserDrivingState({
    recentTools: lifecycle?.recentTools ?? [],
    takeOver,
    lastUserInputAtMs: lastUserInputAtRef.current,
    nowMs: Date.now(),
  });

  // A FRESH agent call reclaims control by default — a take-over from the
  // agent's PREVIOUS zerops_browser call must never silently carry forward
  // and leave input enabled for the next one. Adjusting state during render
  // from a computed transition is the standard React pattern for this.
  if (driving.agentDriving && previousAgentDrivingRef.current === false && takeOver) {
    setTakeOver(false);
  }
  previousAgentDrivingRef.current = driving.agentDriving;

  if (environmentId === null) {
    return null;
  }

  const frame = read !== undefined && read !== "unavailable" ? read.frame : undefined;

  const sendInput = (input: ZeropsBrowserInput) => {
    if (driving.inputDisabled) {
      return;
    }
    lastUserInputAtRef.current = Date.now();
    void sendInputCommand({ environmentId, input });
  };

  const handlePointer =
    (eventType: "mousePressed" | "mouseReleased" | "mouseMoved") =>
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (eventType === "mousePressed") {
        isPointerDownRef.current = true;
      } else if (eventType === "mouseReleased") {
        isPointerDownRef.current = false;
      } else if (!isPointerDownRef.current) {
        // A bare hover carries nothing CDP needs for this slice (no
        // hover-triggered UI to drive) and would otherwise fire one
        // operate-scope RPC per pixel of mouse movement — only forward
        // moves made while dragging.
        return;
      }
      if (frame === undefined) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const point = mapCanvasPointToDevicePixels(
        {
          canvasWidth: rect.width,
          canvasHeight: rect.height,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        },
        frame,
      );
      sendInput({
        kind: "mouse",
        eventType,
        x: point.x,
        y: point.y,
        // A hover/drag move carries no button; CDP's own "none" value,
        // never "left" — sending "left" on every move would read as
        // dragging on every hover.
        button: eventType === "mouseMoved" ? "none" : "left",
        ...(eventType === "mouseMoved" ? {} : { clickCount: 1 }),
      });
    };

  const handleKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    // The canvas owns the keystroke while it has focus — Space/arrows/Tab
    // must drive the REMOTE page, never scroll or tab around mate's own.
    event.preventDefault();
    sendInput({
      kind: "keyboard",
      eventType: "keyDown",
      key: event.key,
      ...(keyText(event.key) !== undefined ? { text: keyText(event.key) } : {}),
    });
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    sendInput({ kind: "keyboard", eventType: "keyUp", key: event.key });
  };

  const drivingLabel = driving.agentDriving
    ? read !== undefined && read !== "unavailable" && read.url !== undefined
      ? `Agent is driving · verifying ${read.url}`
      : "Agent is driving"
    : driving.userDriving
      ? "You're driving"
      : undefined;

  return (
    <FlatCard className="space-y-2 p-3" data-zerops-browser-panel>
      <div className="flex items-center justify-between gap-2">
        <MicroLabel>Browser</MicroLabel>
        {driving.agentDriving ? (
          <button
            className="text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2"
            data-zerops-browser-take-over
            onClick={() => setTakeOver((current) => !current)}
            type="button"
          >
            {takeOver ? "Let the agent drive" : "Take over"}
          </button>
        ) : null}
      </div>

      {drivingLabel !== undefined ? (
        <p className="text-muted-foreground text-xs" data-zerops-browser-driving>
          {drivingLabel}
        </p>
      ) : null}

      {read === undefined ? null : read === "unavailable" ? (
        <p className="text-muted-foreground text-xs" data-zerops-browser-unavailable>
          Live browser view isn't available on this server yet.
        </p>
      ) : read.status === "no-browser" ? (
        <p className="text-muted-foreground text-xs">The agent hasn't opened a browser yet.</p>
      ) : frame === undefined ? (
        <StatusDot label="Connecting" pulse tone="busy" />
      ) : (
        <div className="relative overflow-hidden rounded-[var(--zerops-card-radius)] border border-[var(--zerops-flat-card-border)]">
          {/** biome-ignore lint/a11y/noNoninteractiveElementInteractions: the frame is a live remote viewport, not a static image. */}
          <img
            alt="Live view of the agent's browser"
            className="block w-full"
            src={frameImageSrc(frame)}
          />
          <canvas
            aria-disabled={driving.inputDisabled}
            aria-label="Browser viewport — click or type to interact"
            className="absolute inset-0 h-full w-full"
            data-zerops-browser-input-disabled={driving.inputDisabled}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onPointerDown={handlePointer("mousePressed")}
            onPointerMove={handlePointer("mouseMoved")}
            onPointerUp={handlePointer("mouseReleased")}
            style={{ cursor: driving.inputDisabled ? "not-allowed" : "default" }}
            tabIndex={driving.inputDisabled ? -1 : 0}
          />
        </div>
      )}
    </FlatCard>
  );
}
