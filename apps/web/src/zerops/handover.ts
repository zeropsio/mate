/**
 * The browser half of the Zerops sign-in hand-over.
 *
 * `client-runtime/zerops/handover` owns the wire contract and is pure; this
 * file owns the two things a browser has to supply — the nonce's randomness,
 * and somewhere to keep it while the tab navigates to `app.zerops.io` and
 * back.
 *
 * **Why the nonce is stored at all.** Without it, `…/zerops/authorized#refreshToken=<attacker's>`
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

export const ZEROPS_HANDOVER_NONCE_KEY = "zerops-code.handover-nonce.v1";

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

/**
 * The port to ask the callback to return to, or null when this is not a dev
 * server. Matched on the hostname `localhost` and deliberately not
 * `127.0.0.1`, the same line `apps/server/src/zerops/origin.ts` draws for the
 * CORS allowlist — the trust is on the hostname. `URL.port` is empty when the
 * origin leaves the scheme's default implicit, so it is filled in here rather
 * than sending nothing.
 */
function currentOrigin(): string {
  try {
    return window.location.origin;
  } catch {
    // Not a browser — no loopback to come back to, so the production mode is
    // the honest answer rather than a crash.
    return "";
  }
}

function loopbackPortOf(origin: string): number | null {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.hostname !== "localhost") return null;
  if (parsed.port) return Number(parsed.port);
  return parsed.protocol === "https:" ? 443 : 80;
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
    readonly guiBaseUrl?: string;
  } = {},
): string {
  const store = input.store ?? sessionHandoverNonceStore;
  const state = mintNonce();
  store.remember(state);
  const loopbackPort = loopbackPortOf(input.origin ?? currentOrigin());
  return buildZeropsAuthorizeUrl({
    state,
    ...(loopbackPort === null ? {} : { loopbackPort }),
    ...(input.intent ? { intent: input.intent } : {}),
    ...(input.guiBaseUrl ? { guiBaseUrl: input.guiBaseUrl } : {}),
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
