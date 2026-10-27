/**
 * The one place the page reaches its dev-only hooks. `import.meta.env.DEV` is
 * a constant false in a production build, so the bundler drops the import and
 * `devSession.ts` with it (`devHooks.test.ts` builds both modes to check).
 */
import type { MateDevSession } from "./devSession";

export function installDevHooks(adoptSession: (session: MateDevSession) => Promise<void>): void {
  if (import.meta.env.DEV) {
    void import("./devSession").then(({ installMateDevSession }) => {
      installMateDevSession(window, adoptSession);
    });
  }
}
