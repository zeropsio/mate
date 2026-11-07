/**
 * This build's way in (`VITE_ZEROPS_SIGN_IN`): `handover` (the default) sends the tab to
 * app.zerops.io's `/authorize-app`; `zerops-hq` takes the session Zerops HQ shares with every app
 * (`zeropsHq.ts`). `VITE_ZEROPS_HQ_ORIGIN` names that HQ and `VITE_ZEROPS_LOGIN_APP_CODE` the app
 * its device login asks for (`mate`), where HQ's bridge refuses this origin.
 */
export type ZeropsSignInMode = "handover" | "zerops-hq";

export function zeropsSignInMode(): ZeropsSignInMode {
  return import.meta.env.VITE_ZEROPS_SIGN_IN === "zerops-hq" ? "zerops-hq" : "handover";
}

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
