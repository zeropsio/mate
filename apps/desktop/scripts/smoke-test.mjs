import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";
import { resolveElectronLaunchCommand } from "./electron-launcher.mjs";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const desktopDir = NodePath.resolve(__dirname, "..");
const mainJs = NodePath.resolve(desktopDir, "dist-electron/main.cjs");
const stagedWebEntry = NodePath.resolve(desktopDir, "prod-resources/web/index.html");
const stageCommand = "node scripts/stage-desktop-web.ts";
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const smokeTimeoutMs = 30_000;
const terminateGraceMs = 2_000;

function outputTail(output, lineCount = 80) {
  const tail = output.trimEnd().split(/\r?\n/u).slice(-lineCount).join("\n");
  return tail.length === 0 ? "(no output)" : tail;
}

function printFailures(failures, output) {
  console.error("\nDesktop smoke test failed:");
  for (const failure of failures) {
    console.error(` - ${failure}`);
  }
  console.error(`\nOutput tail:\n${outputTail(output)}`);
}

async function runElectronSmoke(capturePath) {
  console.log("\nLaunching Electron smoke test...");

  let electronCommand;
  try {
    electronCommand = resolveElectronLaunchCommand([mainJs]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    printFailures([`Electron launcher setup failed: ${detail}`], "");
    return 1;
  }

  const child = NodeChildProcess.spawn(electronCommand.electronPath, electronCommand.args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...NodeProcess.env,
      VITE_DEV_SERVER_URL: "",
      ELECTRON_ENABLE_LOGGING: "1",
      T3CODE_SMOKE_CAPTURE: capturePath,
    },
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  let timedOut = false;
  let forceKillTimeout;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKillTimeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, terminateGraceMs);
  }, smokeTimeoutMs);

  const childResult = await new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.once("error", (error) => {
      settle({ code: null, signal: null, spawnError: error });
    });
    child.once("exit", (code, signal) => {
      settle({ code, signal, spawnError: undefined });
    });
  });
  clearTimeout(timeout);
  if (forceKillTimeout !== undefined) {
    clearTimeout(forceKillTimeout);
  }

  const fatalPatterns = [
    "Cannot find module",
    "MODULE_NOT_FOUND",
    "Refused to execute",
    "Uncaught Error",
    "Uncaught TypeError",
    "Uncaught ReferenceError",
    "fatal startup error",
    "DesktopWebBundleMissingError",
  ];
  const failures = fatalPatterns
    .filter((pattern) => output.includes(pattern))
    .map((pattern) => `fatal output: ${pattern}`);

  if (timedOut) {
    failures.push(`Electron did not finish within ${smokeTimeoutMs / 1_000} seconds`);
  }
  if (childResult.spawnError !== undefined) {
    failures.push(`Electron failed to launch: ${childResult.spawnError.message}`);
  } else if (childResult.code !== 0) {
    failures.push(
      `Electron exited with ${childResult.code === null ? `signal ${childResult.signal}` : `code ${childResult.code}`}`,
    );
  }

  let dimensions;
  try {
    const bytes = await NodeFSP.readFile(capturePath);
    if (bytes.length < 24 || !bytes.subarray(0, pngSignature.length).equals(pngSignature)) {
      failures.push("capture is not a PNG");
    } else if (bytes.toString("ascii", 12, 16) !== "IHDR") {
      failures.push("capture has no leading IHDR chunk");
    } else {
      dimensions = {
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
      };
      if (dimensions.width < 800 || dimensions.height < 600) {
        failures.push(
          `capture is ${dimensions.width}x${dimensions.height}; expected at least 800x600`,
        );
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    failures.push(`capture file was not written: ${detail}`);
  }

  const captureLogLine = `smoke capture written: ${capturePath}`;
  if (!output.includes(captureLogLine)) {
    console.warn("Desktop did not report the completed capture; using the validated PNG.");
  }

  if (failures.length > 0) {
    printFailures(failures, output);
    return 1;
  }

  console.log(captureLogLine);
  console.log(`Desktop smoke capture dimensions: ${dimensions.width}x${dimensions.height}`);
  console.log("Desktop smoke test passed.");
  return 0;
}

export async function cleanupCaptureDirectory(
  captureDirectory,
  { runnerTemp, exitCode, remove = NodeFSP.rm, report = console.error },
) {
  if (exitCode !== 0) {
    report(`Desktop smoke failure evidence kept at: ${captureDirectory}`);
    return exitCode;
  }
  if (runnerTemp !== undefined) {
    return exitCode;
  }

  try {
    await remove(captureDirectory, { recursive: true, force: true });
    return exitCode;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    report(`Desktop smoke temp cleanup warning: ${detail}`);
    return exitCode;
  }
}

export async function main() {
  try {
    await NodeFSP.access(stagedWebEntry);
  } catch {
    console.error(`Desktop web bundle is not staged; run '${stageCommand}' before the smoke test.`);
    return 1;
  }

  const runnerTemp = NodeProcess.env.RUNNER_TEMP;
  const captureDirectory = await NodeFSP.mkdtemp(
    NodePath.join(runnerTemp ?? NodeOS.tmpdir(), "desktop-smoke-"),
  );
  let exitCode = 1;
  try {
    exitCode = await runElectronSmoke(NodePath.join(captureDirectory, "smoke.png"));
  } finally {
    exitCode = await cleanupCaptureDirectory(captureDirectory, { runnerTemp, exitCode });
  }
  return exitCode;
}

if (
  NodeProcess.argv[1] !== undefined &&
  import.meta.url === NodeURL.pathToFileURL(NodeProcess.argv[1]).href
) {
  NodeProcess.exit(await main());
}
