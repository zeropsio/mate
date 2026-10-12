/**
 * The Mac panel: the app an agent opened on the paired Mac, live, through the
 * same viewer as the agent's browser. A click is sent as a click at a pixel of
 * the captured window; printable keys are gathered and sent as one piece of
 * text once the person pauses (agent-device types text on macOS, it has no
 * key presses). A click or typing here is the person's own go-ahead, so it
 * reaches the app even while someone works on the Mac; the line says so.
 */
import type { ScopedThreadRef, ZeropsMacInput } from "@t3tools/contracts";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useRef, useState } from "react";

import { useAtomCommand } from "../../state/use-atom-command";
import { zeropsCommands } from "../../state/zeropsCommands";
import { useMateMacView } from "../../zerops/macViewLinks";
import { LiveFrameViewer, type LiveFrameKey } from "./LiveFrameViewer";
import { MicroLabel, StatusDot } from "./primitives";
import { FRAME_BOX } from "./ZeropsBrowserPanel";
import { ZeropsMateUpdateControl } from "./ZeropsMateUpdateControl";
import { Button } from "../ui/button";

/** How long a copy button says so. */
const COPIED_MS = 2_000;

/** One command for the Mac's Terminal, copied with one press. */
export function MacCommand({ command }: { readonly command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex min-w-0 items-start gap-2">
      <code className="min-w-0 flex-1 select-all rounded-md border border-border bg-muted px-2 py-1.5 font-mono text-xs break-all text-foreground">
        {command}
      </code>
      <Button
        onClick={() => {
          void navigator.clipboard.writeText(command).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), COPIED_MS);
            },
            () => undefined,
          );
        }}
        size="sm"
        variant="outline"
      >
        {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </span>
  );
}

/** One numbered step of what the person does on the Mac: its words, then its command if it has one. */
function macStep({
  n,
  words,
  command,
}: {
  readonly n: number;
  readonly words: string;
  readonly command?: string | undefined;
}) {
  return (
    <li className="arrival-open-step" key={words}>
      <span className="arrival-num">{n}</span>
      <span className="arrival-open-step-words text-sm">{words}</span>
      <span />
      {command === undefined ? null : (
        <span className="arrival-open-step-field">
          <MacCommand command={command} />
        </span>
      )}
    </li>
  );
}

/**
 * What the person does on their Mac while the view waits on them, with the Mate's own commands
 * (the VPN first, then the pairing): pairing it, reaching it again, or pairing it again.
 */
function macSteps({
  status,
  pairCommands,
}: {
  readonly status: "not-paired" | "unreachable" | "no-helper";
  readonly pairCommands: ReadonlyArray<string>;
}) {
  const [vpn, pair] = pairCommands;
  const steps =
    status === "not-paired"
      ? [
          { words: "On the Mac, have zcli (signed in) and Node.js ready." },
          {
            words: "In Terminal, connect it to this project's VPN. It asks for the Mac's password.",
            command: vpn,
          },
          { words: "Then set it up for this Mate. Allow node if macOS asks.", command: pair },
        ]
      : status === "unreachable"
        ? [
            { words: "Wake the Mac and sign in." },
            { words: "Connect its VPN in Terminal.", command: vpn },
            { words: "Still no answer? Pair it again.", command: pair },
          ]
        : [{ words: "In Terminal on the Mac, run the pairing again.", command: pair }];
  return (
    <ol className="flex flex-col gap-4 px-1 pt-1" data-zerops-mac-steps={status}>
      {steps.map((step, index) =>
        macStep({ command: step.command, n: index + 1, words: step.words }),
      )}
    </ol>
  );
}

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
  const inputDisabled = live?.status !== "live";

  const line =
    view === "unavailable"
      ? "This Mate's version doesn't include the Mac view yet."
      : live === undefined
        ? null
        : live.status === "not-paired"
          ? "Pair a Mac to build and run macOS apps on it from here."
          : live.status === "unreachable"
            ? `${macName} does not answer.`
            : live.status === "no-app"
              ? `Nothing open on ${macName} yet.`
              : live.status === "no-helper"
                ? `${macName} was paired before the live view. Pair it again to see it here.`
                : live.status === "live" && live.inUse
                  ? `Someone is using ${macName} right now. Clicks and typing here still reach the app.`
                  : null;
  // The person's next step on the Mac, wherever the view waits on one and the Mate said how.
  const steps =
    live !== undefined &&
    live.pairCommands !== undefined &&
    (live.status === "not-paired" || live.status === "unreachable" || live.status === "no-helper")
      ? macSteps({ pairCommands: live.pairCommands, status: live.status })
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
      {steps}
      {view === "unavailable" ? (
        <div className="px-1">
          <ZeropsMateUpdateControl environmentId={environmentId}>
            {({ line: update }) => update}
          </ZeropsMateUpdateControl>
        </div>
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
