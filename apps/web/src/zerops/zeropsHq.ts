/**
 * Zerops HQ's shared session (`@zerops/session`), for a `zerops-hq` build. On an origin HQ's bridge
 * serves, the session is HQ's, shared with every Zerops app, and its refresh token never reaches
 * Mate. On any other origin the package keeps a session of Mate's own, signed in by a device login.
 *
 * The prompts are HQ's pages over Mate: its sign-in, and its sudo prompt for a reveal that needs one.
 * In device-login mode they are a popup, so they start from a click.
 */
import { BridgeUnavailable } from "@zerops/session/session.bridge-client";
import {
  SudoEnded,
  createSessionClient,
  type ZeropsSessionClient,
} from "@zerops/session/session.client";
import { DeviceLoginError, type DeviceLoginProgress } from "@zerops/session/session.device-login";
import type { SessionView } from "@zerops/session/session.model";
import type { FrameSizes } from "@zerops/session/session.protocol";
import type { ZeropsSession } from "@t3tools/client-runtime/zerops";

import { zeropsHqOrigin, zeropsLoginAppCode } from "./signInMode";

/** The device-login session's key, where HQ's bridge refuses this origin. */
export const ZEROPS_HQ_LOCAL_KEY = "zerops-mate.zerops-hq-session.v1";

export function makeZeropsHqClient(apiBase: string): ZeropsSessionClient {
  return createSessionClient({
    apiUrl: `${apiBase}/api/rest/public`,
    hqOrigin: zeropsHqOrigin(),
    appCode: zeropsLoginAppCode(),
    localKey: ZEROPS_HQ_LOCAL_KEY,
  });
}

/** What Mate's client holds of HQ's session. */
export function zeropsSessionOf(view: SessionView): ZeropsSession {
  return {
    accessToken: view.accessToken,
    expiresAt: view.expiresAt,
    expiresIn: view.expiresIn,
    userId: view.userId,
    tokenType: view.tokenType,
  };
}

/** HQ's login, which sends the tab back here. */
export function zeropsHqLoginUrl(back: string): string {
  const url = new URL("/login", zeropsHqOrigin());
  url.searchParams.set("redirect", back);
  return url.toString();
}

export type ZeropsHqPrompt =
  | { readonly kind: "closed" }
  | {
      readonly kind: "sign-in" | "sudo";
      /**
       * `framed` while HQ's page loads in `frame`, `shown` once it shows. `waiting` is a device
       * login's popup, with its `progress`.
       */
      readonly phase: "starting" | "framed" | "shown" | "waiting" | "unreachable" | "failed";
      readonly frame: string | null;
      /** HQ says closing now would lose something: a check that is out, a recovery code to save. */
      readonly busy: boolean;
      readonly progress: DeviceLoginProgress | null;
      readonly failure: string | null;
      readonly intent: "register" | null;
    };

const CLOSED: ZeropsHqPrompt = { kind: "closed" };

const DEVICE_LOGIN_FAILURES: Record<DeviceLoginError["reason"], string> = {
  "not-started": "Zerops didn't start the sign-in. Try again.",
  denied: "The sign-in was denied in Zerops.",
  expired: "The Zerops window timed out. Try again.",
  failed: "Zerops approved the sign-in, but no session came back. Try again.",
  cancelled: "The sign-in was cancelled.",
};

/** Why a sudo prompt ended without sudo, as the reveal that asked for it says. */
function sudoFailure(cause: unknown): string {
  if (cause instanceof BridgeUnavailable) return "Can't reach Zerops HQ. Try again.";
  if (cause instanceof SudoEnded) return "Sign in to Zerops again.";
  if (cause instanceof DeviceLoginError)
    return cause.reason === "denied"
      ? "Zerops didn't confirm it."
      : "The Zerops window timed out. Try again.";
  return "Zerops didn't confirm it. Try again.";
}

export interface ZeropsHqPrompts {
  readonly state: () => ZeropsHqPrompt;
  readonly subscribe: (listener: () => void) => () => void;
  /** HQ's sign-in over the page; in device-login mode, its popup, so call it from a click there. */
  readonly signIn: (intent?: "register") => void;
  /**
   * HQ's sudo prompt, for a reveal refused for it: `confirmed` once the session is in sudo,
   * `cancelled` when the person closed it. It rejects with the words to show when it can't be.
   */
  readonly sudo: () => Promise<"confirmed" | "cancelled">;
  readonly close: () => void;
  readonly retry: () => void;
  /** Device-login mode: brings the popup forward, or opens it again. Call it from a click. */
  readonly reopen: () => void;
  /** The least size HQ's pages need, as its bridge says; null in device-login mode. */
  readonly frameSizes: () => FrameSizes | null;
}

export function makeZeropsHqPrompts(
  client: ZeropsSessionClient,
  ports: {
    readonly scheme: () => "light" | "dark";
    readonly reload: () => void;
  },
): ZeropsHqPrompts {
  const listeners = new Set<() => void>();
  let state: ZeropsHqPrompt = CLOSED;
  /** The prompt shown now: an earlier one's late answers change nothing. */
  let run = 0;
  let abort: AbortController | null = null;

  const set = (next: ZeropsHqPrompt) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const step = (asked: number, change: Partial<Exclude<ZeropsHqPrompt, { kind: "closed" }>>) => {
    if (asked === run && state.kind !== "closed") set({ ...state, ...change });
  };
  const end = (asked: number) => {
    if (asked !== run) return;
    abort = null;
    set(CLOSED);
  };
  const close = () => {
    abort?.abort();
    abort = null;
    run += 1;
    set(CLOSED);
  };
  const begin = (kind: "sign-in" | "sudo", intent: "register" | null) => {
    abort?.abort();
    abort = new AbortController();
    const asked = ++run;
    set({
      kind,
      phase: "starting",
      frame: null,
      busy: false,
      progress: null,
      failure: null,
      intent,
    });
    return { asked, signal: abort.signal };
  };
  const frameOptions = (asked: number, signal: AbortSignal) => ({
    scheme: ports.scheme(),
    signal,
    onFrame: (frame: string) => step(asked, { phase: "framed", frame }),
    onFrameShown: () => step(asked, { phase: "shown" }),
    onFrameCancel: () => {
      if (asked === run) close();
    },
    onFrameBusy: (busy: boolean) => step(asked, { busy }),
    onProgress: (progress: DeviceLoginProgress) => step(asked, { phase: "waiting", progress }),
  });

  const signIn = (intent?: "register") => {
    // One already out is brought forward, as the package waits for the same one.
    if (state.kind === "sign-in" && state.phase !== "unreachable" && state.phase !== "failed") {
      client.reopenSignIn();
      return;
    }
    const { asked, signal } = begin("sign-in", intent ?? null);
    client
      .signIn({
        display: "overlay",
        ...(intent === undefined ? {} : { intent }),
        ...frameOptions(asked, signal),
      })
      .then(
        () => end(asked),
        (cause: unknown) => {
          if (asked !== run || signal.aborted) return;
          if (cause instanceof BridgeUnavailable)
            step(asked, { phase: "unreachable", frame: null });
          else if (cause instanceof DeviceLoginError && cause.reason === "cancelled") end(asked);
          else
            step(asked, {
              phase: "failed",
              frame: null,
              failure:
                cause instanceof DeviceLoginError
                  ? DEVICE_LOGIN_FAILURES[cause.reason]
                  : "Signing in with Zerops didn't finish. Try again.",
            });
        },
      );
  };

  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    signIn,
    sudo: () => {
      const { asked, signal } = begin("sudo", null);
      return client.sudo(frameOptions(asked, signal)).then(
        () => {
          end(asked);
          return "confirmed" as const;
        },
        (cause: unknown) => {
          const cancelled = asked !== run || signal.aborted;
          end(asked);
          if (cancelled || (cause instanceof DeviceLoginError && cause.reason === "cancelled"))
            return "cancelled" as const;
          throw new Error(sudoFailure(cause));
        },
      );
    },
    close,
    retry: () => {
      if (state.kind !== "sign-in") return;
      // HQ never answered this load: only a new one asks its bridge again.
      if (client.mode() === null) {
        ports.reload();
        return;
      }
      // A sign-up that didn't finish may have made the account: Zerops's sign-in offers one to whoever has none.
      signIn(state.phase === "failed" ? undefined : (state.intent ?? undefined));
    },
    reopen: () => {
      if (state.kind === "sudo") client.reopenSudo();
      else client.reopenSignIn();
    },
    frameSizes: () => client.frameSizes(),
  };
}
