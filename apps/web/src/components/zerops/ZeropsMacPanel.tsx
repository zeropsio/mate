/**
 * The Mac panel: the app an agent opened on the paired Mac, live, through the
 * same viewer as the agent's browser. A click is sent as a click at a pixel of
 * the captured window; printable keys are gathered and sent as one piece of
 * text once the person pauses (agent-device types text on macOS, it has no
 * key presses). While someone is working on the Mac, the window keeps
 * updating but input pauses: a click would take over their screen.
 */
import type { ScopedThreadRef, ZeropsMacInput } from "@t3tools/contracts";
import { useRef } from "react";

import { useAtomCommand } from "../../state/use-atom-command";
import { zeropsCommands } from "../../state/zeropsCommands";
import { useMateMacView } from "../../zerops/macViewLinks";
import { LiveFrameViewer, type LiveFrameKey } from "./LiveFrameViewer";
import { MicroLabel, StatusDot } from "./primitives";
import { FRAME_BOX } from "./ZeropsBrowserPanel";

/** How long typing pauses before what was typed goes to the app. */
const TYPING_PAUSE_MS = 150;

/** A key that types a character: one printable character, without a shortcut's modifier. */
function typedText(key: LiveFrameKey): string | undefined {
  return key.key.length === 1 && !key.metaKey && !key.ctrlKey ? key.key : undefined;
}

export function ZeropsMacPanel({ threadRef }: { readonly threadRef: ScopedThreadRef | null }) {
  const environmentId = threadRef?.environmentId ?? null;
  const view = useMateMacView(environmentId);
  const sendInputCommand = useAtomCommand(zeropsCommands.macInput, "zerops mac input");
  const typedRef = useRef("");
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const send = (input: ZeropsMacInput) => {
    if (environmentId !== null) void sendInputCommand({ environmentId, input });
  };
  const flushTyped = () => {
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = undefined;
    const text = typedRef.current;
    typedRef.current = "";
    if (text !== "") send({ kind: "text", text });
  };
  if (environmentId === null) return null;

  const live = view !== undefined && view !== "unavailable" ? view : undefined;
  const macName = live?.macName ?? "the Mac";
  const frame = live?.status === "live" ? live.frame : undefined;
  const inputDisabled = live?.inUse ?? true;

  const line =
    view === "unavailable"
      ? "The Mac view isn't available on this Mate yet."
      : live === undefined
        ? null
        : live.status === "not-paired"
          ? "No Mac is paired with this Mate. Ask it to pair one."
          : live.status === "unreachable"
            ? `${macName} does not answer — is it awake and on the project VPN?`
            : live.status === "no-app"
              ? `Nothing open on ${macName} yet.`
              : live.status === "no-helper"
                ? "Run the pairing on the Mac again to see it here."
                : live.status === "live" && live.inUse
                  ? `Someone is using ${macName} right now, so clicks and typing are paused.`
                  : null;

  const handlePointer = (kind: "press" | "release" | "drag", point: { x: number; y: number }) => {
    if (kind !== "press" || inputDisabled) return;
    flushTyped();
    send({ kind: "click", x: Math.round(point.x), y: Math.round(point.y) });
  };

  const handleKey = (kind: "down" | "up", key: LiveFrameKey) => {
    const text = typedText(key);
    if (kind !== "down" || inputDisabled || text === undefined) return;
    typedRef.current += text;
    clearTimeout(typingTimerRef.current);
    // Fires even once the panel closed, so what was typed last still reaches the app.
    typingTimerRef.current = setTimeout(flushTyped, TYPING_PAUSE_MS);
  };

  return (
    <section aria-label="The paired Mac" className="flex flex-col gap-1.5" data-zerops-mac-panel>
      <div className="flex min-h-6 items-center gap-2 px-1">
        <MicroLabel>{live?.macName ?? "Mac"}</MicroLabel>
      </div>
      {line !== null ? (
        <p className="px-1 text-muted-foreground text-xs" data-zerops-mac-line>
          {line}
        </p>
      ) : null}
      {frame !== undefined ? (
        <LiveFrameViewer
          alt={live?.app === undefined ? "The app on the Mac" : `${live.app} on ${macName}`}
          boxClassName={FRAME_BOX}
          canvasData={{ "data-zerops-mac-input-disabled": inputDisabled }}
          frame={frame}
          inputDisabled={inputDisabled}
          inputLabel="The app on the Mac — click or type to use it"
          onKey={handleKey}
          onPointer={handlePointer}
        />
      ) : live?.status === "connecting" || live?.status === "live" ? (
        <StatusDot className="px-1" label="Connecting" pulse tone="busy" />
      ) : null}
    </section>
  );
}
