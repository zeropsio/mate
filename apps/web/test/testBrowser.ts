// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- Host tooling for disposable test browsers.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { Browser, computeExecutablePath, install } from "@puppeteer/browsers";

// The current Stable Chrome for Testing, so tests run the engine users run. A host cache is shared
// by every worktree.
const buildId = "155.0.8059.39";
const cacheDir = NodePath.join(NodeOS.homedir(), ".cache", "mate-test-browser");

export function testBrowserOptions(directory = cacheDir) {
  return { browser: Browser.CHROME, buildId, cacheDir: directory };
}

export async function resolveTestBrowser(override: string | undefined, directory = cacheDir) {
  const executable = override ?? computeExecutablePath(testBrowserOptions(directory));
  try {
    await NodeFSP.access(executable, NodeFS.constants.X_OK);
  } catch (cause) {
    throw new Error(
      override === undefined
        ? "Test browser is missing. Run `vp run test:browser` once on this host."
        : `MATE_CHROME_BIN is not executable: ${override}`,
      { cause },
    );
  }
  return executable;
}

/** The named chat gate owns provisioning; cached and explicit browsers never download. */
export async function ensureTestBrowser(
  override: string | undefined,
  directory = cacheDir,
  provision: (options: ReturnType<typeof testBrowserOptions>) => Promise<unknown> = install,
) {
  const executable = override ?? computeExecutablePath(testBrowserOptions(directory));
  try {
    await NodeFSP.access(executable, NodeFS.constants.X_OK);
  } catch (cause) {
    if (override !== undefined) return resolveTestBrowser(override, directory);
    if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "ENOENT") throw cause;
    await provision(testBrowserOptions(directory));
  }
  return resolveTestBrowser(override, directory);
}

if (import.meta.main) {
  console.log(await ensureTestBrowser(process.env.MATE_CHROME_BIN));
}
