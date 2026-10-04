/**
 * Dev builds only: a door for agents testing as a real Zerops account.
 *
 * An agent signs in with `POST /auth/login` itself and hands the session to
 * the page through `window.__mateDev.adoptSession`, skipping the hand-over a
 * person goes through on the Zerops app. A full session with its refresh token
 * is fine here: the agent minted it, and the agent logs it out
 * (`signInAs` in `@t3tools/client-runtime/zerops/testing`).
 *
 * Reached only through `devHooks.ts`, behind `import.meta.env.DEV`, so a
 * production bundle carries none of it (`devHooks.test.ts` builds one to
 * check).
 */

export interface MateDevSession {
  readonly accessToken: string;
  readonly refreshToken?: string;
}

export interface MateDevHooks {
  readonly adoptSession: (session: MateDevSession) => Promise<void>;
}

declare global {
  interface Window {
    /** Dev builds only; see `devSession.ts`. */
    __mateDev?: MateDevHooks;
  }
}

/** Where the hooks go: the tab's `window`. */
export type MateDevHost = Pick<Window, "__mateDev">;

export function installMateDevSession(
  host: MateDevHost,
  adopt: (session: MateDevSession) => Promise<void>,
): void {
  host.__mateDev = { adoptSession: adopt };
}
