import { appBasePath } from "../basePath";
import { rememberSignInReturn } from "./navigationStorage";
/**
 * The browser half of the Zerops sign-in hand-over.
 *
 * `client-runtime/zerops/handover` owns the wire contract and is pure; this
 * file owns what a browser has to supply — the nonce's randomness, somewhere
 * to keep it while the tab navigates to the Zerops app and back, and where
 * this tab lives: its origin and base path, plus the build's Zerops app
 * (`VITE_ZEROPS_APP_URL`).
 *
 * **Why the nonce is stored at all.** Without it, `…/zerops/authorized#token=<attacker's>`
 * is a working link: whoever opens it signs this browser into the attacker's
 * account and then works inside it. The nonce makes the callback answerable
 * only to a request this tab actually started.
 *
 * **Why `sessionStorage`.** The value has to survive a full-page navigation on
 * our own origin and nothing more: same tab, gone when the tab closes, never
 * shared with another tab. `localStorage` would leak it across tabs and
 * outlive the attempt; memory does not survive the navigation at all. It is
 * spent on read (`take`), so one authorization signs in exactly once — a back
 * button or a restored tab replays nothing.
 *
 * The store is a parameter so that choice stays visible and swappable in one
 * place rather than spread through the route.
 */

import {
  buildZeropsAuthorizeUrl,
  readZeropsHandover,
  type ZeropsHandoverIntent,
  type ZeropsHandoverOutcome,
} from "@t3tools/client-runtime/zerops/handover";

export const ZEROPS_HANDOVER_NONCE_KEY = "zerops-mate.handover-nonce.v1";

/** Remember the nonce across the round trip; `take` spends it. */
export interface ZeropsHandoverNonceStore {
  readonly remember: (nonce: string) => void;
  readonly take: () => string | null;
}

/**
 * `sessionStorage` behind the store contract. Every access is guarded: a
 * browser with site data blocked throws on the global itself, and a hand-over
 * that cannot be verified must fail closed rather than take the page down.
 */
export const sessionHandoverNonceStore: ZeropsHandoverNonceStore = {
  remember: (nonce) => {
    try {
      window.sessionStorage.setItem(ZEROPS_HANDOVER_NONCE_KEY, nonce);
    } catch {
      // The callback will read nothing back and refuse the credential, which
      // is the safe end of this failure.
    }
  },
  take: () => {
    try {
      const nonce = window.sessionStorage.getItem(ZEROPS_HANDOVER_NONCE_KEY);
      window.sessionStorage.removeItem(ZEROPS_HANDOVER_NONCE_KEY);
      return nonce;
    } catch {
      return null;
    }
  },
};

function mintNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function currentOrigin(): string {
  try {
    return window.location.origin;
  } catch {
    // Not a browser: the request builder refuses an empty origin.
    return "";
  }
}

/**
 * Mints and remembers a nonce, and returns it bare. Used directly by the
 * native (desktop-bridge) sign-in, which hands the nonce to the main process
 * as `state` rather than building a browser URL with it — the platform is
 * opened by Electron's shell, not this tab's location. `startZeropsHandover`
 * below is this plus the browser URL, for the ordinary in-tab flow.
 */
export function mintZeropsHandoverNonce(
  input: { readonly store?: ZeropsHandoverNonceStore } = {},
): string {
  if (!input.store) rememberSignInReturn();
  const store = input.store ?? sessionHandoverNonceStore;
  const state = mintNonce();
  store.remember(state);
  return state;
}

/**
 * Mints and remembers a nonce, and returns the URL to send the tab to. Same
 * tab, always: the callback lands back here and reads the nonce out of this
 * tab's storage, which a new tab would not have.
 */
export function startZeropsHandover(
  input: {
    readonly store?: ZeropsHandoverNonceStore;
    readonly intent?: ZeropsHandoverIntent;
    readonly origin?: string;
    readonly path?: string;
    readonly guiBaseUrl?: string;
  } = {},
): string {
  if (!input.store) rememberSignInReturn();
  const store = input.store ?? sessionHandoverNonceStore;
  const nonce = mintZeropsHandoverNonce({ store });
  const guiBaseUrl = input.guiBaseUrl ?? import.meta.env.VITE_ZEROPS_APP_URL;
  return buildZeropsAuthorizeUrl({
    nonce,
    origin: input.origin ?? currentOrigin(),
    path: input.path ?? appBasePath(),
    ...(input.intent ? { intent: input.intent } : {}),
    ...(guiBaseUrl ? { guiBaseUrl } : {}),
  });
}

/**
 * Reads the callback out of a fragment and checks it against the stored nonce.
 * The nonce is spent only when there is actually a hand-over to judge, so an
 * ordinary visit to the route does not burn one still in flight.
 */
export function completeZeropsHandover(input: {
  readonly fragment: string;
  readonly store?: ZeropsHandoverNonceStore;
}): ZeropsHandoverOutcome {
  const store = input.store ?? sessionHandoverNonceStore;
  const withoutNonce = readZeropsHandover(input.fragment, null);
  if (withoutNonce.kind === "absent") {
    return withoutNonce;
  }
  return readZeropsHandover(input.fragment, store.take());
}

/**
 * Wraps a destructive callback read so it happens exactly once, and every later
 * caller gets the same answer.
 *
 * TanStack's `beforeLoad` runs more than once for a single navigation, and the
 * read it performs cannot be repeated: the first one spends the nonce and
 * scrubs the fragment out of the URL. Measured against a live dev server, run 1
 * returned the session and run 2 — looking at the now-empty fragment —
 * returned `absent`. The component receives the LAST run's value, so the user
 * was silently returned to the landing holding no session, with the credential
 * already consumed and unrecoverable.
 *
 * A module-level cache is the right scope: one page load handles one callback,
 * and a second hand-over always arrives as a fresh document.
 */
export function readHandoverOnce(read: () => ZeropsHandoverOutcome): () => ZeropsHandoverOutcome {
  let captured: ZeropsHandoverOutcome | null = null;
  return () => {
    captured ??= read();
    return captured;
  };
}
