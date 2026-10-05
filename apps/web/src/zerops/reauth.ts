/**
 * The way back to a fresh hand-over when the platform refuses this tab's session.
 *
 * The hand-over delivers a personal access token with no refresh token and no
 * expiry: it ends only when the person revokes it. A 401 then sends the tab
 * back to the Zerops app, which mints a fresh one, and the callback returns
 * the person to the route they were on (`navigationStorage.ts`).
 */
import { startZeropsHandover } from "./handover";
import { readZeropsNativeSignInBridge } from "./nativeSignIn";

export interface ZeropsReauthDeps {
  readonly storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** A desktop build signs in through the system browser, never this window. */
  readonly native: () => boolean;
  readonly go: (url: string) => void;
  /** Mints the hand-over request; remembers the route to return to. */
  readonly start: () => string;
}

export interface ZeropsReauth {
  /** The platform refused this tab's session. */
  readonly ask: () => void;
  /** A fresh load verified its stored session. */
  readonly settled: () => void;
}

/**
 * Set when this tab is sent for a fresh hand-over, cleared once a fresh load
 * verified the session it brought. Per tab (`sessionStorage`): it guards this
 * tab's round trip, and survives the navigation there and back.
 */
export const ZEROPS_REAUTH_GUARD_KEY = "zerops-mate.reauth-asked.v1";

export function makeZeropsReauth(deps: ZeropsReauthDeps): ZeropsReauth {
  return {
    ask: () => {
      if (deps.native()) return;
      try {
        const storage = deps.storage();
        // Already sent once and not yet settled: the fresh token was refused
        // at once, and another round trip would loop.
        if (storage.getItem(ZEROPS_REAUTH_GUARD_KEY) !== null) return;
        storage.setItem(ZEROPS_REAUTH_GUARD_KEY, "1");
      } catch {
        // No storage, no guard: stay signed out rather than risk a loop.
        return;
      }
      deps.go(deps.start());
    },
    settled: () => {
      try {
        deps.storage().removeItem(ZEROPS_REAUTH_GUARD_KEY);
      } catch {
        /* Nothing was guarded where storage is blocked. */
      }
    },
  };
}

/** This tab's: its `sessionStorage`, its desktop bridge, its location. */
export const browserZeropsReauth = makeZeropsReauth({
  storage: () => window.sessionStorage,
  native: () => readZeropsNativeSignInBridge() !== null,
  go: (url) => window.location.replace(url),
  start: () => startZeropsHandover(),
});
