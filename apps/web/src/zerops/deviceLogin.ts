/**
 * The browser half of Zerops device login (`client-runtime/zerops/deviceLogin`): the Zerops
 * window, and this build's choice of way in.
 *
 * **Why a window opened on the click.** Popup blockers allow only what a click opens directly,
 * and the request starts after an await. So the window opens blank on the click and is pointed
 * at the consent page once the request exists. Where the browser blocked it, the person gets a
 * link, and their own click opens the same page in a tab.
 *
 * **Why polling.** Nothing comes back to this origin: the tab asks the API until the person
 * approves or denies in the Zerops window. A container-served copy collects its own session the
 * same way, with no destination for the platform to check.
 *
 * The build picks the way in (`VITE_ZEROPS_SIGN_IN`): `handover` (the default) sends the tab to
 * app.zerops.io's `/authorize-app`; `device-login` runs this. `VITE_ZEROPS_LOGIN_APP_CODE` names
 * the app the consent page asks for (`mate`), and `VITE_ZEROPS_CONSENT_ORIGIN` swaps the consent
 * page's origin (a local HQ).
 */
import {
  checkZeropsDeviceLogin,
  pollZeropsDeviceLogin,
  startZeropsDeviceLogin,
  zeropsDeviceLoginUrl,
  type ZeropsDeviceLoginIntent,
  type ZeropsDeviceLoginKind,
  type ZeropsDeviceLoginOutcome,
} from "@t3tools/client-runtime/zerops/deviceLogin";
import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { browserTransportFetch } from "@t3tools/client-runtime/data";

export type ZeropsSignInMode = "handover" | "device-login";

export function zeropsSignInMode(): ZeropsSignInMode {
  return import.meta.env.VITE_ZEROPS_SIGN_IN === "device-login" ? "device-login" : "handover";
}

const DEFAULT_LOGIN_APP_CODE = "mate";

/** A sudo request asked of a session about to expire would die with it: renew first. */
const SUDO_RENEWAL_MARGIN_MS = 15 * 60_000;

/** An early wake (the tab shown, the window focused) asks at once, but not more than this often. */
const EARLY_WAKE_FLOOR_MS = 1_000;

export type ZeropsDeviceLoginStage =
  /** The request is starting; the window is blank. */
  | { readonly kind: "opening" }
  /**
   * The consent page is open, or `blocked`: the browser kept the window from opening, and `url`
   * is the link the person opens themselves.
   */
  | { readonly kind: "waiting"; readonly url: string; readonly blocked: boolean };

export interface ZeropsDeviceLoginRun {
  /** Settles once. Rejects only when the request could not start. */
  readonly outcome: Promise<ZeropsDeviceLoginOutcome>;
  /** Brings the Zerops window back, or opens it again where it closed. Call it on a click. */
  readonly reopen: () => void;
  /** Stops asking; the request lapses by itself. */
  readonly cancel: () => void;
}

export interface ZeropsDeviceLoginPorts {
  readonly open: (url: string) => Window | null;
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  readonly nowMs: () => number;
  readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly appCode: string;
  readonly consentOrigin: string | undefined;
}

/**
 * Resolves after `ms`, or as soon as asking is worth it: the tab shown again or its window
 * focused (the Zerops window just closed), or the run stopped.
 */
function browserWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const began = performance.now();
    const done = () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", early);
      window.removeEventListener("focus", early);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const early = () => {
      if (document.visibilityState !== "visible") return;
      if (performance.now() - began < EARLY_WAKE_FLOOR_MS) return;
      done();
    };
    const timer = window.setTimeout(done, ms);
    document.addEventListener("visibilitychange", early);
    window.addEventListener("focus", early);
    signal.addEventListener("abort", done, { once: true });
  });
}

function browserPorts(): ZeropsDeviceLoginPorts {
  const appCode = import.meta.env.VITE_ZEROPS_LOGIN_APP_CODE;
  const consentOrigin = import.meta.env.VITE_ZEROPS_CONSENT_ORIGIN;
  return {
    open: (url) => window.open(url, "zerops-hq", "popup,width=520,height=760"),
    fetch: browserTransportFetch,
    nowMs: () => performance.now(),
    wait: browserWait,
    appCode: appCode === undefined || appCode === "" ? DEFAULT_LOGIN_APP_CODE : appCode,
    consentOrigin: consentOrigin === undefined || consentOrigin === "" ? undefined : consentOrigin,
  };
}

/**
 * The bearer a sudo request is asked with: the held session's, renewed first when it expires
 * within the margin. A renewal during the approval would revoke the token the request is bound
 * to, so it happens before the request, never during.
 */
export async function sudoBearer(
  client: Pick<ZeropsApiClient, "session" | "renewHeldSession">,
  wallNowMs: number,
): Promise<string> {
  const held = client.session;
  if (held === null) throw new Error("Sign in to Zerops again.");
  const expiresAtMs = held.expiresAt === undefined ? Number.NaN : Date.parse(held.expiresAt);
  if (
    held.refreshToken !== undefined &&
    Number.isFinite(expiresAtMs) &&
    expiresAtMs - wallNowMs < SUDO_RENEWAL_MARGIN_MS
  ) {
    await client.renewHeldSession();
  }
  const current = client.session;
  if (current === null) throw new Error("Sign in to Zerops again.");
  return current.accessToken;
}

/**
 * Runs one device login. Call it on the person's click: the Zerops window opens synchronously
 * here, before anything is awaited. The window is closed once the run settles; HQ's own page
 * would close itself, app.zerops.io's would not.
 */
export function runZeropsDeviceLogin(input: {
  readonly kind: ZeropsDeviceLoginKind;
  readonly apiBase: string;
  readonly intent?: ZeropsDeviceLoginIntent;
  /** A sudo request's: the session's bearer, renewed first where needed (`sudoBearer`). */
  readonly bearer?: () => Promise<string>;
  readonly onStage: (stage: ZeropsDeviceLoginStage) => void;
  readonly ports?: ZeropsDeviceLoginPorts;
}): ZeropsDeviceLoginRun {
  const ports = input.ports ?? browserPorts();
  const controller = new AbortController();
  let zeropsWindow = ports.open("about:blank");
  let consentUrl: string | null = null;
  input.onStage({ kind: "opening" });
  const linkFor = (verificationUrl: string, popup: boolean) =>
    zeropsDeviceLoginUrl({
      verificationUrl,
      ...(ports.consentOrigin === undefined ? {} : { consentOrigin: ports.consentOrigin }),
      ...(input.intent === undefined ? {} : { intent: input.intent }),
      popup,
    });
  const closeWindow = () => {
    try {
      if (zeropsWindow !== null && !zeropsWindow.closed) zeropsWindow.close();
    } catch {
      // A window another origin took over may refuse; it closes itself or stays as the person left it.
    }
  };
  const outcome = (async (): Promise<ZeropsDeviceLoginOutcome> => {
    try {
      const bearer = input.bearer === undefined ? undefined : await input.bearer();
      const request = await startZeropsDeviceLogin({
        fetch: ports.fetch,
        apiBase: input.apiBase,
        appCode: ports.appCode,
        kind: input.kind,
        ...(bearer === undefined ? {} : { bearer }),
        nowMs: ports.nowMs(),
      });
      if (controller.signal.aborted) return { kind: "cancelled" };
      // Closed before the request existed reads as blocked: the person opens the link themselves.
      const opened = zeropsWindow !== null && !zeropsWindow.closed ? zeropsWindow : null;
      consentUrl = linkFor(request.verificationUrl, opened !== null);
      if (opened !== null) opened.location.href = consentUrl;
      input.onStage({ kind: "waiting", url: consentUrl, blocked: opened === null });
      return await pollZeropsDeviceLogin({
        request,
        check: () =>
          checkZeropsDeviceLogin({ fetch: ports.fetch, apiBase: input.apiBase, request }),
        wait: ports.wait,
        nowMs: ports.nowMs,
        signal: controller.signal,
      });
    } finally {
      closeWindow();
    }
  })();
  return {
    outcome,
    reopen: () => {
      if (consentUrl === null) return;
      if (zeropsWindow !== null && !zeropsWindow.closed) {
        zeropsWindow.focus();
        return;
      }
      zeropsWindow = ports.open(consentUrl);
    },
    cancel: () => controller.abort(),
  };
}
