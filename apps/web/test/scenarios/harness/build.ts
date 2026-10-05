// @effect-diagnostics nodeBuiltinImport:off -- build the real web bundle with the repository's CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import type { TestProject } from "vite-plus/test/node";

declare module "vite-plus/test" {
  interface ProvidedContext {
    scenarioDist: string;
  }
}

export default async function setup(project: TestProject) {
  const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-scenarios-web-"));
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
  try {
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
    project.provide("scenarioDist", dist);
  } catch (error) {
    await NodeFSP.rm(dist, { recursive: true, force: true });
    throw error;
  }
  return () => NodeFSP.rm(dist, { recursive: true, force: true });
}
