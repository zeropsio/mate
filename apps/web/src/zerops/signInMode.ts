/**
 * The web signs in through the session Zerops HQ shares with every app (`zeropsHq.ts`).
 * `VITE_ZEROPS_HQ_ORIGIN` names that HQ and `VITE_ZEROPS_LOGIN_APP_CODE` the app its device login
 * asks for (`mate`), where HQ's bridge refuses this origin.
 */

/** Zerops HQ, where people sign in to every Zerops app; not Mate HQ (`VITE_HQ_ORIGIN`). */
export function zeropsHqOrigin(): string {
  return (import.meta.env.VITE_ZEROPS_HQ_ORIGIN?.trim() || "https://hq.zerops.io").replace(
    /\/+$/u,
    "",
  );
}

export function zeropsLoginAppCode(): string {
  return import.meta.env.VITE_ZEROPS_LOGIN_APP_CODE?.trim() || "mate";
}
