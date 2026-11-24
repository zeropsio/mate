/**
 * The Zerops entry surface, presentational only: one composition in the
 * middle of the page — the live mark, a title, a card — plus the way in the
 * card holds, and the byline at the foot. No bar: the mark is the brand here. Every decision arrives as a prop,
 * so this file renders without a session, a router or a network. Where HQ's bridge serves Mate, the
 * sign-in is HQ's page in the card alone (`ZeropsHqSignInFrame`).
 */

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { bootFrameSlot, showAppFrame } from "~/zerops/bootFrame";
import { useWaitLine } from "~/zerops/useWaitLine";
import { BOOT_WAIT_LINE_MS } from "~/zerops/waitLine.logic";
import { cn } from "~/lib/utils";

import { Button, InlineButton } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { MateMark } from "../../MateMark";
import { ZeropsMark } from "../../ZeropsMark";
import { WaitLine } from "../WaitLine";
import { ZeropsHostedFrame } from "./ZeropsHostedFrame";

export function ZeropsLandingShell({
  title,
  description,
  children,
  foot,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  /** One quiet line under the card: who is signed in, and the way out. */
  readonly foot?: ReactNode;
}) {
  return (
    <ZeropsHostedFrame bar={false} centered footer={<ZeropsByline />}>
      <div className="w-full max-w-md space-y-6">
        <MateMark playful className="mx-auto h-20 w-auto" />
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="text-body text-muted-foreground">{description}</p>
        </div>

        <div className={cn(LANDING_CARD, "px-6 py-6")}>{children}</div>

        {foot === undefined ? null : (
          <p className="text-center text-caption text-muted-foreground">{foot}</p>
        )}
      </div>
    </ZeropsHostedFrame>
  );
}

// Solid, as app.zerops.io's card is: HQ's page in it is transparent, and over a see-through card
// its form hardly stands off the page.
const LANDING_CARD = "rounded-sheet border border-border/55 bg-card shadow-sm/5";

/**
 * HQ's sign-in in the landing's card, the whole composition: HQ's page draws the heading, Mate's mark
 * and name and whether it logs in or signs up, as the person moves between them there. The card is
 * as tall as HQ's page says, at once, and the page fades in once HQ says it shows.
 */
export function ZeropsHqSignInFrame({
  src,
  shown,
  height,
}: {
  /** HQ's page; null while the session package asks HQ whether it may be framed here. */
  readonly src: string | null;
  readonly shown: boolean;
  readonly height: number;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  // Chromium refuses HQ's passkey prompt to a page without focus, and the keyboard works there.
  useEffect(() => {
    if (shown) frame.current?.focus();
  }, [shown]);
  return (
    <ZeropsHostedFrame bar={false} centered tall footer={<ZeropsByline />}>
      {/* HQ's page pads its own content: the frame takes the card's whole width, and the card its
          height. HQ's page is transparent; the card's corners hold whatever it paints. */}
      <div className={cn(LANDING_CARD, "w-full max-w-md self-start overflow-hidden py-2")}>
        <div className="relative" style={{ height }}>
          {shown ? null : <Spinner size="lg" className="absolute inset-0 m-auto" />}
          {src === null ? null : (
            // The address is HQ's, built by the session package from this build's own settings.
            <iframe
              ref={frame}
              className={cn(
                "size-full transition-opacity duration-200",
                shown ? "opacity-100" : "opacity-0",
              )}
              src={src}
              title="Sign in with Zerops"
              allow="publickey-credentials-get; publickey-credentials-create; clipboard-write"
              scrolling="no"
            />
          )}
        </div>
      </div>
    </ZeropsHostedFrame>
  );
}

/**
 * Who made this: one quiet line at the foot of every landing state. The
 * product is Mate; Zerops is the company, and this is where its name lives on
 * a page that otherwise says it only where the account is meant.
 */
export function ZeropsByline() {
  return (
    <span className="text-caption">
      <InlineButton
        data-zerops-byline="true"
        render={<a href="https://zerops.io" rel="noreferrer" target="_blank" />}
        tone="muted"
      >
        <ZeropsMark className="me-1 size-3.5" />
        Mate by Zerops
      </InlineButton>
    </span>
  );
}

/**
 * A wait before the app can draw — the session check on a load, the account's data and inventory,
 * the sign-in's return spending its token. It draws nothing into the page: the first frame
 * index.html painted (`bootFrame.ts`) stands as it was, and the wait's one line, past its beat,
 * goes into that frame's page. A wait that knows the person is signed in draws the app's frame
 * there, the menu column and its mark, even where the load painted the sign-in's.
 */
export function ZeropsFrameWait({
  label,
  signedIn,
  line,
  children,
  ...props
}: {
  /** What the wait is, named on its node; what it says is its one line. */
  readonly label: string;
  readonly signedIn: boolean;
  /** Its own words, where the boot's ("Reading your projects…") are not true: the sign-in's return. */
  readonly line?: string;
  /** What the wait has to say in place of its line: a read that failed, or one that is late. */
  readonly children?: ReactNode;
} & Record<`data-${string}`, string>) {
  useLayoutEffect(() => {
    if (signedIn) showAppFrame();
  }, [signedIn]);
  const shown = useFrameWaitLine(signedIn && children === undefined, line);
  const slot = bootFrameSlot();
  if (slot === null) return null;
  // The frame's page is the one live region every wait draws into: only its visible line is said.
  return createPortal(
    children ?? (
      <div {...props} data-zerops-wait={label}>
        {shown === null ? null : <WaitLine text={shown} />}
      </div>
    ),
    slot,
  );
}

/**
 * The frame's line, shown past the boot's beat from the page's load: only a wait's own words (the
 * sign-in's return); the boot itself says nothing, and the page stands in with its shape.
 */
function useFrameWaitLine(signedIn: boolean, own: string | undefined): string | null {
  const text = signedIn && own !== undefined ? own : null;
  const showing = useWaitLine(text, { delayMs: BOOT_WAIT_LINE_MS, from: "load" });
  return showing ? text : null;
}

export function FormError({ message }: { readonly message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-control border border-border bg-muted/35 px-3 py-2 text-body text-foreground"
    >
      {message}
    </p>
  );
}

/**
 * The way in: the session Zerops HQ shares with every Zerops app. Signing in or
 * up happens in HQ's window — its page in the card, or a device login's window
 * where HQ's bridge refuses this origin — never in a password field here.
 */
export function ZeropsSignInActions({
  onContinue,
  onCreateAccount,
}: {
  readonly onContinue: () => void;
  readonly onCreateAccount: () => void;
}) {
  return (
    <div className="space-y-3">
      <Button className="w-full" onClick={onContinue}>
        <ZeropsMark className="size-4" tone="current" />
        Continue with your Zerops account
      </Button>
      <p className="text-center text-caption text-muted-foreground">
        No account yet?{" "}
        <InlineButton tone="muted" onClick={onCreateAccount}>
          Create one on Zerops
        </InlineButton>
      </p>
    </div>
  );
}
