/**
 * The Zerops entry surface, presentational only: a frame plus the three forms
 * it can hold (sign in, sign up, two-factor). Every decision arrives as a
 * prop, so this file renders without a session, a router or a network.
 *
 * The reusable frame may keep a way out to upstream's manual connect flow.
 * The outer mate account gate deliberately omits it: signed-out users see one
 * product and one next action, while the legacy pairing route stays separate.
 */

import { ExternalLinkIcon } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { SidebarInset } from "../../ui/sidebar";
import { Spinner } from "../../ui/spinner";
import { WorkspacePageHeader } from "../../WorkspacePageHeader";

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
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader className="border-b border-border">
          <span className="text-sm font-medium text-foreground">Zerops Mate</span>
        </WorkspacePageHeader>

        <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
          <div className="w-full max-w-md space-y-6">
            <div className="space-y-1 text-center">
              <h1 className="text-xl font-semibold text-foreground">{title}</h1>
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
        </div>
      </div>
    </SidebarInset>
  );
}

function FormError({ message }: { readonly message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
      {message}
    </p>
  );
}

function SubmitButton({
  busy,
  label,
  blocked = false,
}: {
  readonly busy: boolean;
  readonly label: string;
  readonly blocked?: boolean;
}) {
  return (
    <Button type="submit" className="w-full" disabled={busy || blocked}>
      {busy ? <Spinner className="size-4" /> : null}
      {label}
    </Button>
  );
}

/**
 * Where a user can sign up when this origin cannot: the platform's own form,
 * carrying the pool claim the same way our request does.
 */
export const ZEROPS_GUI_REGISTRATION_URL = "https://app.zerops.io/registration?zcp=true";

/**
 * Cloudflare Turnstile only renders on hostnames its site key allows, and the
 * platform refuses a registration without a token — so on any other origin
 * signing up here is impossible until Zerops allows the hostname. Rather than
 * a dead form, the primary action is a real hand-off to the sign-up that does
 * work, with a way back once it is done.
 */
export function ZeropsRegistrationUnavailable({
  reason,
  onSignIn,
  onHandOff,
}: {
  readonly reason: string;
  readonly onSignIn: () => void;
  /** Called when the user follows the hand-off; the caller opens the tab and moves the landing on. */
  readonly onHandOff: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground">
        Creating an account is not available from this address yet.
      </p>
      <p className="text-xs text-muted-foreground">Sign-up runs on app.zerops.io.</p>
      <Button
        className="w-full"
        render={
          <a
            href={ZEROPS_GUI_REGISTRATION_URL}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              // The href/target already work with no JS at all; when JS does
              // run, the caller takes over so it can also move the landing on.
              event.preventDefault();
              onHandOff();
            }}
          >
            <ExternalLinkIcon className="size-4" />
            Sign up at app.zerops.io
          </a>
        }
      />
      <p className="text-center text-xs text-muted-foreground">
        Done, or already have an account?{" "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={onSignIn}
        >
          Sign in here
        </button>
      </p>
      <p className="text-center text-[11px] text-muted-foreground/70">Reported reason: {reason}</p>
    </div>
  );
}

/**
 * Shown above the sign-in form once the user has been sent to app.zerops.io
 * to register: the account they are creating there already comes with a
 * project prepared, so the way back in is to sign in, not to register again.
 */
export function ZeropsHandedOffBanner({
  onOpenSignUpAgain,
}: {
  readonly onOpenSignUpAgain: () => void;
}) {
  return (
    <div className="mb-4 space-y-2 rounded-2xl border border-border/55 bg-card/30 px-4 py-3 text-xs text-muted-foreground">
      <p>
        Finish creating your account in the Zerops tab — it prepares a project with Zerops Mate for
        you. Then sign in here.
      </p>
      <a
        href={ZEROPS_GUI_REGISTRATION_URL}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2 hover:text-foreground"
        onClick={(event) => {
          event.preventDefault();
          onOpenSignUpAgain();
        }}
      >
        Open the sign-up page again
      </a>
    </div>
  );
}

function readField(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === "string" ? value : "";
}

export function ZeropsSignInForm({
  busy,
  error,
  onSubmit,
  onSwitchToRegister,
}: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: (input: { readonly email: string; readonly password: string }) => void;
  readonly onSwitchToRegister: () => void;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit({
          email: readField(event.currentTarget, "email"),
          password: readField(event.currentTarget, "password"),
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="zerops-email">Email</Label>
        <Input id="zerops-email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="zerops-password">Password</Label>
        <Input
          id="zerops-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <FormError message={error} />
      <SubmitButton busy={busy} label="Sign in" />
      <p className="text-center text-xs text-muted-foreground">
        No Zerops account?{" "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={onSwitchToRegister}
        >
          Create one
        </button>
      </p>
    </form>
  );
}

export function ZeropsRegisterForm({
  busy,
  error,
  captcha,
  captchaPending,
  onSubmit,
  onSwitchToSignIn,
}: {
  readonly busy: boolean;
  readonly error: string | null;
  /** The Turnstile widget. The platform enforces it, so it is always rendered. */
  readonly captcha: ReactNode | null;
  /** True until the captcha hands over a token; submitting before then is refused. */
  readonly captchaPending: boolean;
  readonly onSubmit: (input: {
    readonly email: string;
    readonly password: string;
    readonly fullName: string;
    readonly organizationName: string;
  }) => void;
  readonly onSwitchToSignIn: () => void;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit({
          email: readField(event.currentTarget, "email"),
          password: readField(event.currentTarget, "password"),
          fullName: readField(event.currentTarget, "fullName"),
          organizationName: readField(event.currentTarget, "organizationName"),
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="zerops-signup-name">Your name</Label>
        <Input id="zerops-signup-name" name="fullName" autoComplete="name" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="zerops-signup-org">Organization</Label>
        <Input
          id="zerops-signup-org"
          name="organizationName"
          autoComplete="organization"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="zerops-signup-email">Email</Label>
        <Input id="zerops-signup-email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="zerops-signup-password">Password</Label>
        <Input
          id="zerops-signup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      {captcha}
      <FormError message={error} />
      <SubmitButton busy={busy} blocked={captchaPending} label="Create account" />
      <p className="text-center text-xs text-muted-foreground">
        Already have one?{" "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={onSwitchToSignIn}
        >
          Sign in
        </button>
      </p>
    </form>
  );
}

export function ZeropsTotpForm({
  busy,
  error,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: (code: string) => void;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit(readField(event.currentTarget, "code"));
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="zerops-totp">Two-factor code</Label>
        <Input
          id="zerops-totp"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
      </div>
      <FormError message={error} />
      <SubmitButton busy={busy} label="Verify" />
    </form>
  );
}

/**
 * The way in, and the primary one: the account lives on Zerops, and signing up
 * or signing in with GitHub only works there — Turnstile's site key is bound to
 * that hostname and the OAuth callback is fixed on Zerops' own OAuth App. The
 * password form stays underneath for anyone who wants it, and for the origins
 * the hand-over is not registered for.
 */
export function ZeropsHandoverActions({
  onContinue,
  onCreateAccount,
}: {
  readonly onContinue: () => void;
  readonly onCreateAccount: () => void;
}) {
  return (
    <div className="space-y-3">
      <Button className="w-full" onClick={onContinue}>
        Continue with Zerops
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
    </div>
  );
}

/** Collapses the password form behind the hand-over without hiding it. */
export function ZeropsPasswordDisclosure({
  open,
  onToggle,
  children,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border/60" />
        <button
          type="button"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={onToggle}
        >
          {open ? "Hide the password form" : "Sign in with a password instead"}
        </button>
        <span className="h-px flex-1 bg-border/60" />
      </div>
      {open ? children : null}
    </div>
  );
}
