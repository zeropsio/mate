// @effect-diagnostics nodeBuiltinImport:off -- build the real web bundle with the repository's CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import { cachedBundle } from "./buildCache.ts";
import type { TestProject } from "vite-plus/test/node";

declare module "vite-plus/test" {
  interface ProvidedContext {
    scenarioDist: string;
  }
}

export default async function setup(project: TestProject) {
  const root = NodeURL.fileURLToPath(new URL("../../../../../", import.meta.url));
  const buildEnv: NodeJS.ProcessEnv = {
    ...process.env,
    VITE_HOSTED_APP_CHANNEL: "latest",
    VITE_HOSTED_APP_URL: "",
    VITE_BASE_PATH: "",
    T3CODE_SINGLE_ORIGIN_DEV: "1",
    T3CODE_WEB_SOURCEMAP: "0",
  };
  delete buildEnv.VITE_HTTP_URL;
  delete buildEnv.VITE_WS_URL;
  const started = performance.now();
  let built = false;
  const dist = await cachedBundle(root, buildEnv, async (dist) => {
    built = true;
    await new Promise<void>((resolve, reject) => {
      const child = NodeChildProcess.spawn("vp", ["build", "--outDir", dist], {
        cwd: NodeURL.fileURLToPath(new URL("../../../", import.meta.url)),
        env: buildEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let log = "";
      child.stdout.on("data", (data) => {
        log = (log + String(data)).slice(-8000);
      });
      child.stderr.on("data", (data) => {
        log = (log + String(data)).slice(-8000);
      });
      child.on("error", reject);
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(log))));
    });
  });
  console.log(
    `scenario web: ${built ? "built" : "reused"} (${((performance.now() - started) / 1000).toFixed(2)}s)`,
  );
  project.provide("scenarioDist", dist);
}
