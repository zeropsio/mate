/**
 * The Zerops entry surface, presentational only: one composition in the
 * middle of the page — the live mark, a title, a card — plus the way in the
 * card holds, and the byline at the foot. No bar: the mark is the brand here. Every decision arrives as a prop,
 * so this file renders without a session, a router or a network.
 *
 * The reusable frame may keep a way out to upstream's manual connect flow.
 * The outer mate account gate deliberately omits it: signed-out users see one
 * product and one next action, while the legacy pairing route stays separate.
 */

import { useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { appBasePath } from "~/basePath";
import { isElectron } from "~/env";
import { environmentIdFromAddress } from "~/routes/-environmentRoute";
import { bootFrameSlot, showAppFrame } from "~/zerops/bootFrame";
import { useWaitLine } from "~/zerops/useWaitLine";
import { BOOT_WAIT_LINE_MS, bootWaitLine } from "~/zerops/waitLine.logic";

import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { MateMark } from "../../MateMark";
import { ZeropsMark } from "../../ZeropsMark";
import { WaitLine } from "../WaitLine";
import { ZeropsHostedFrame } from "./ZeropsHostedFrame";

export function ZeropsLandingShell({
  title,
  description,
  children,
  onManualConnect,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly onManualConnect?: (() => void) | undefined;
}) {
  return (
    <ZeropsHostedFrame bar={false} centered footer={<ZeropsByline />}>
      <div className="w-full max-w-md space-y-6">
        <MateMark playful className="mx-auto h-20 w-auto" />
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        <div className="rounded-3xl border border-border/55 bg-card/20 px-6 py-6 shadow-sm/5">
          {children}
        </div>

        {onManualConnect === undefined ? null : (
          <p className="text-center text-xs text-muted-foreground">
            Not using Zerops?{" "}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={onManualConnect}
            >
              Connect a backend manually
            </button>
          </p>
        )}
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
    <a
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      data-zerops-byline="true"
      href="https://zerops.io"
      rel="noreferrer"
      target="_blank"
    >
      <ZeropsMark className="size-3.5" />
      Mate by Zerops
    </a>
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

/** The frame's line (`bootWaitLine`), shown past the boot's beat from the page's load. */
function useFrameWaitLine(signedIn: boolean, own: string | undefined): string | null {
  // A desktop window routes by its hash.
  const pathname =
    typeof window === "undefined"
      ? ""
      : isElectron
        ? window.location.hash.replace(/^#/u, "").split("?")[0] || "/"
        : window.location.pathname;
  const routed = environmentIdFromAddress(pathname, appBasePath());
  const text = !signedIn ? null : own !== undefined ? own : bootWaitLine(routed !== null);
  const showing = useWaitLine(text, { delayMs: BOOT_WAIT_LINE_MS, from: "load" });
  return showing ? text : null;
}

function FormError({ message }: { readonly message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-border bg-muted/35 px-3 py-2 text-sm text-foreground"
    >
      {message}
    </p>
  );
}

/**
 * The way in: the account lives on Zerops, and signing up or signing in with
 * GitHub only works there — Turnstile's site key is bound to that hostname and
 * the OAuth callback is fixed on Zerops' own OAuth App. Credentials are typed
 * only there; this client never shows a password field.
 */
export function ZeropsHandoverActions({
  onContinue,
  onCreateAccount,
  nativeSignIn,
}: {
  readonly onContinue: () => void;
  readonly onCreateAccount: () => void;
  /**
   * Present only when the desktop bridge runs the hand-over out-of-window,
   * in the system browser. A window that just sits there while the browser
   * has the flow looks like it did nothing, so `busy` names what's
   * happening; `onCancel` is the way back for someone who abandons the
   * browser tab instead of finishing there — the in-flight main-process
   * listener keeps running until it times out, but the UI returns to normal
   * immediately.
   */
  readonly nativeSignIn?:
    | {
        readonly busy: boolean;
        /** A device login's code, the one the Zerops page shows beside the request. */
        readonly userCode?: string | null;
        readonly error: string | null;
        readonly onCancel: () => void;
      }
    | undefined;
}) {
  if (nativeSignIn?.busy) {
    return (
      <div className="space-y-3 text-center">
        <Spinner size="lg" className="mx-auto" />
        <p className="text-sm text-muted-foreground">
          Continue in your browser, then come back here.
        </p>
        {/* The code arrives a moment after the click: its line is held, so nothing moves. */}
        <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
          {nativeSignIn.userCode ? (
            <>
              Zerops shows{" "}
              <span className="font-mono text-foreground">{nativeSignIn.userCode}</span>
            </>
          ) : null}
        </p>
        <button
          type="button"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={nativeSignIn.onCancel}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Button className="w-full" onClick={onContinue}>
        <ZeropsMark className="size-4" tone="current" />
        Continue with your Zerops account
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        No account yet?{" "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={onCreateAccount}
        >
          Create one on Zerops
        </button>
      </p>
      <FormError message={nativeSignIn?.error ?? null} />
    </div>
  );
}
