/**
 * The Mac panel: the app an agent opened on the paired Mac, live, through the
 * same viewer as the agent's browser. A click is sent as a click at a pixel of
 * the captured window; printable keys are gathered and sent as one piece of
 * text once the person pauses (agent-device types text on macOS, it has no
 * key presses). A click or typing here is the person's own go-ahead, so it
 * reaches the app even while someone works on the Mac; the line says so.
 */
import type { ScopedThreadRef, ZeropsMacInput } from "@t3tools/contracts";
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  LaptopIcon,
  LinkIcon,
  MoonIcon,
  RefreshCwIcon,
} from "lucide-react";
import { zeropsTokenManagementUrl } from "@t3tools/client-runtime/zerops/gui";
import { useRef, type ReactNode } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { useAtomCommand } from "../../state/use-atom-command";
import { zeropsCommands } from "../../state/zeropsCommands";
import { useMateMacView } from "../../zerops/macViewLinks";
import { LiveFrameViewer, type LiveFrameKey } from "./LiveFrameViewer";
import { MicroLabel } from "./primitives";
import { ZeropsMateUpdateControl } from "./ZeropsMateUpdateControl";
import { Button, InlineButton } from "../ui/button";
import { Card } from "../ui/card";
import { CopyLine } from "../ui/copy-line";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { StepNumber } from "../ui/step-number";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";
import { Text } from "~/components/ui/text";

/** One numbered step of what the person does on the Mac: its words, then its command or more. */
function macStep({
  n,
  words,
  command,
  more,
}: {
  readonly n: number;
  readonly words: string;
  readonly command?: string | undefined;
  readonly more?: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] items-start gap-x-3 gap-y-2" key={words}>
      <StepNumber n={n} />
      <span className="pt-0.5 text-body text-foreground">{words}</span>
      {command === undefined ? null : (
        <span className="col-start-2">
          <CopyLine label="the command" value={command} wrap />
        </span>
      )}
      {more === undefined ? null : <span className="col-start-2">{more}</span>}
    </li>
  );
}

/** A page to install from, opened beside the app. */
function InstallLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <InlineButton render={<a href={href} rel="noreferrer" target="_blank" />}>
      {children}
      <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
    </InlineButton>
  );
}

/** Each thing the Mac needs: its name, then how to get it. */
const READY_NAME_CLASS = "text-body leading-4.5 font-semibold text-foreground";
const READY_HOW_CLASS =
  "flex flex-wrap items-center gap-x-3 gap-y-1 text-body leading-4.5 text-muted-foreground";

/**
 * What the Mac needs before it pairs (the owner, 2026-10-12: "this should like say zcli +
 * wgtools etc and link to install"), as the pairing script checks it: zcli signed in, WireGuard
 * for its VPN, Node.js from its own installer — macOS keeps the permissions it grants node at that
 * path across updates, never at Homebrew's — and, optionally, Xcode's command-line tools for the
 * smooth live view.
 */
function macReady() {
  return (
    <Card data-zerops-mac-ready variant="inset">
      <ul className="flex flex-col gap-3 px-3.5 py-3">
        <li className="flex flex-col gap-1.5">
          <span className={READY_NAME_CLASS}>zcli, signed in</span>
          <span className={READY_HOW_CLASS}>
            <InstallLink href="https://docs.zerops.io/references/cli">Install zcli</InstallLink>
            <InstallLink href={zeropsTokenManagementUrl()}>Make a token</InstallLink>
            <span>
              then{" "}
              <code className="font-mono text-caption text-foreground">
                zcli login &lt;token&gt;
              </code>
            </span>
          </span>
        </li>
        <li className="flex flex-col gap-1.5">
          <span className={READY_NAME_CLASS}>WireGuard tools, for the VPN</span>
          <span className={READY_HOW_CLASS}>
            <InstallLink href="https://brew.sh/">Homebrew</InstallLink>
            <span>then</span>
          </span>
          <CopyLine label="the command" value="brew install wireguard-tools" wrap />
        </li>
        <li className="flex flex-col gap-1.5">
          <span className={READY_NAME_CLASS}>Node.js 22.12 or newer</span>
          <span className={READY_HOW_CLASS}>
            <InstallLink href="https://nodejs.org/en/download">
              The nodejs.org installer
            </InstallLink>
            <span>not Homebrew's: macOS keeps node's permissions across its updates</span>
          </span>
        </li>
        <li className="flex flex-col gap-1.5">
          <span className={READY_NAME_CLASS}>
            Xcode's command-line tools{" "}
            <span className="ms-1.5 font-medium text-muted-foreground">optional</span>
          </span>
          <span className={READY_HOW_CLASS}>
            <span>For the smooth live view and building apps.</span>
          </span>
          <CopyLine label="the command" value="xcode-select --install" wrap />
        </li>
      </ul>
    </Card>
  );
}

/** Numbered steps on the Mac, in one card, each with its command to copy when it has one. */
function stepList(
  steps: ReadonlyArray<{
    readonly words: string;
    readonly command?: string | undefined;
    readonly more?: ReactNode;
  }>,
  name: string,
  /** Its room above: 24 px under the panel's line, 12 px under *Remove this Mac*. */
  room: "under-line" | "under-press" = "under-line",
) {
  return (
    <Card
      className={room === "under-line" ? "mt-6 w-full" : "mt-3 w-full"}
      data-zerops-mac-steps={name}
    >
      <ol className="flex flex-col gap-4 p-4 text-left">
        {steps.map((step, index) =>
          macStep({ command: step.command, more: step.more, n: index + 1, words: step.words }),
        )}
      </ol>
    </Card>
  );
}

/**
 * What the person does on their Mac while the view waits on them, with the Mate's own commands
 * (the VPN first, then the pairing): pairing it, reaching it again — pairing it again folded
 * under that, for when nothing else helps — or pairing it again.
 */
function macSteps({
  status,
  pairCommands,
}: {
  readonly status: "not-paired" | "unreachable" | "no-helper";
  readonly pairCommands: ReadonlyArray<string>;
}) {
  const [vpn, pair] = pairCommands;
  if (status === "not-paired") {
    return stepList(
      [
        { words: "Get the Mac ready.", more: macReady() },
        {
          words: "In Terminal, connect it to this project's VPN. It asks for the Mac's password.",
          command: vpn,
        },
        {
          words:
            "Then pair it with this Mate. Allow node in Accessibility and Screen Recording when macOS asks.",
          command: pair,
        },
      ],
      status,
    );
  }
  if (status === "no-helper") {
    return stepList([{ words: "In Terminal on the Mac, pair it again.", command: pair }], status);
  }
  return (
    <>
      {stepList(
        [
          { words: "Wake it and sign in." },
          { words: "Connect its VPN in Terminal.", command: vpn },
        ],
        status,
      )}
      {pair === undefined ? null : (
        <Collapsible data-zerops-mac-again render={<div className="mt-3.5 w-full text-left" />}>
          <CollapsibleTrigger className="group/more ms-1 inline-flex items-center gap-1.5 rounded-mark text-body text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            Still not answering? Pair it again
            <ChevronDownIcon
              aria-hidden="true"
              className="size-3.5 transition-[rotate] duration-150 ease-out-strong group-data-panel-open/more:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="pt-2.5">
              <CopyLine label="the command" value={pair} wrap />
            </div>
          </CollapsiblePanel>
        </Collapsible>
      )}
    </>
  );
}

/** The Mac's glyph for the state it waits in: the laptop, and on its corner why it waits. */
function macGlyph(status: MacWaitKind) {
  const Badge =
    status === "unreachable"
      ? MoonIcon
      : status === "not-paired"
        ? LinkIcon
        : status === "no-helper"
          ? RefreshCwIcon
          : undefined;
  return (
    <span
      aria-hidden="true"
      className="relative mb-4 grid size-14 place-items-center rounded-card bg-muted text-muted-foreground"
    >
      <LaptopIcon className="size-7" strokeWidth={1.5} />
      {Badge === undefined ? null : (
        <span
          className={cn(
            "absolute -end-1.25 -bottom-1.25 grid size-6 place-items-center rounded-full bg-background inset-ring inset-ring-border",
            status === "unreachable" ? "text-status-attention-text" : "text-muted-foreground",
          )}
        >
          <Badge className="size-3.25" />
        </span>
      )}
    </span>
  );
}

/** The panel's states with nothing to show: each its glyph, its headline and its one line. */
type MacWaitKind = "not-paired" | "unreachable" | "no-helper" | "no-app" | "unavailable";

/**
 * The way out of a pairing, folded away at the panel's foot: the Mac's setup removed (which also
 * has the Mate forget the Mac) and the VPN, or, for a Mac that is gone or does not answer, the
 * Mate forgetting it right here.
 */
function removal(removeCommands: ReadonlyArray<string>, forget: () => void) {
  const [remove, vpn] = removeCommands;
  return (
    <Collapsible
      data-zerops-mac-remove
      render={<div className="mx-auto mt-8 w-full max-w-lg px-4" />}
    >
      <CollapsibleTrigger className="mx-auto flex rounded-mark text-body text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        Remove this Mac
      </CollapsibleTrigger>
      <CollapsiblePanel>
        {stepList(
          [
            {
              words:
                "In Terminal on the Mac, remove this Mate's setup. The Mate forgets the Mac too.",
              command: remove,
            },
            { words: "Then disconnect the VPN, if nothing else needs it.", command: vpn },
          ],
          "remove",
          "under-press",
        )}
        <Text
          className="mt-3.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5"
          render={<p />}
          variant="description"
        >
          Mac gone, or not answering?
          <Button onClick={forget} size="sm" variant="destructive">
            Forget it here
          </Button>
        </Text>
      </CollapsiblePanel>
    </Collapsible>
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
  const forgetCommand = useAtomCommand(zeropsCommands.macForget, "zerops mac forget");
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

  // While there is nothing to show, the panel says so in the middle of its room: the Mac's glyph,
  // a headline, one plain line, and the person's steps on the Mac where it waits on them.
  const wait: { readonly kind: MacWaitKind; readonly title: string; readonly line: string } | null =
    view === "unavailable"
      ? {
          kind: "unavailable",
          title: "The Mac view needs an update",
          line: "This Mate's version doesn't include it yet.",
        }
      : live === undefined
        ? null
        : live.status === "not-paired"
          ? {
              kind: "not-paired",
              title: "Pair a Mac",
              line: "Build and run macOS apps on it, and use them from here.",
            }
          : live.status === "unreachable"
            ? {
                kind: "unreachable",
                title: `${macName} isn't answering`,
                line: "It's asleep, signed out, or off this project's VPN.",
              }
            : live.status === "no-app"
              ? {
                  kind: "no-app",
                  title: `Nothing open on ${macName}`,
                  line: "An app a Mate opens there shows here, live.",
                }
              : live.status === "no-helper"
                ? {
                    kind: "no-helper",
                    title: `Pair ${macName} again`,
                    line: "It was paired before the live view, so nothing shows here yet.",
                  }
                : null;
  const line =
    live?.status === "live" && live.inUse
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
      {wait === null ? (
        <div className="flex min-h-6 items-center gap-2 px-1">
          <MicroLabel>{live?.macName ?? "Mac"}</MicroLabel>
        </div>
      ) : (
        <div
          className="mx-auto mt-14 flex w-full max-w-lg flex-col items-center px-4 text-center"
          data-zerops-mac-wait={wait.kind}
        >
          {macGlyph(wait.kind)}
          <h3 className="text-emphasis leading-5.5 font-semibold text-foreground">{wait.title}</h3>
          <Text className="mt-1" render={<p />} variant="description" data-zerops-mac-line>
            {wait.line}
          </Text>
          {steps}
          {view === "unavailable" ? (
            <div className="mt-5">
              <ZeropsMateUpdateControl environmentId={environmentId}>
                {({ line: update }) => update}
              </ZeropsMateUpdateControl>
            </div>
          ) : null}
        </div>
      )}
      {line !== null ? (
        <Text className="px-1" render={<p />} variant="note" data-zerops-mac-line>
          {line}
        </Text>
      ) : null}
      {frame !== undefined ? (
        <LiveFrameViewer
          alt={live?.app === undefined ? "The app on the Mac" : `${live.app} on ${macName}`}
          boxClassName="relative overflow-hidden rounded-card border border-(--zerops-flat-card-border)"
          canvasData={{ "data-zerops-mac-input-disabled": inputDisabled }}
          frame={frame}
          inputDisabled={inputDisabled}
          inputLabel="The app on the Mac — click or type to use it"
          onKey={handleKey}
          onPointer={handlePointer}
        />
      ) : live?.status === "connecting" || live?.status === "live" ? (
        <span className="px-1">
          <Badge dot pulse tone="info">
            Connecting
          </Badge>
        </span>
      ) : null}
      {live?.removeCommands === undefined
        ? null
        : removal(live.removeCommands, () => {
            if (environmentId === null) return;
            void requestConfirmDialog(
              [
                `Forget ${macName}?`,
                "This Mate stops using it, and the Mac tab offers pairing again. Whatever the pairing set up on the Mac stays there until you remove it.",
              ].join("\n"),
              { variant: "destructive" },
            )?.then((yes) => {
              if (yes) void forgetCommand({ environmentId, input: {} });
            });
          })}
    </section>
  );
}
