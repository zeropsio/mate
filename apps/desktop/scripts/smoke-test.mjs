import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";
import { resolveElectronLaunchCommand } from "./electron-launcher.mjs";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const desktopDir = NodePath.resolve(__dirname, "..");
const mainJs = NodePath.resolve(desktopDir, "dist-electron/main.cjs");
const webBundleDir = NodePath.resolve(desktopDir, "prod-resources/web");
const stagedWebEntry = NodePath.join(webBundleDir, "index.html");
const stageCommand = "node scripts/stage-desktop-web.ts";
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const smokeTimeoutMs = 30_000;
const terminateGraceMs = 2_000;

const STATIC_FILE_CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

function contentTypeFor(filePath) {
  return (
    STATIC_FILE_CONTENT_TYPES[NodePath.extname(filePath).toLowerCase()] ??
    "application/octet-stream"
  );
}

/**
 * Resolves a request path to a file inside `rootDir`, falling back to
 * index.html for the bundle root and for any path that isn't a real file on
 * disk (the client only ever uses hash routing here, but this keeps parity
 * with how the packaged app's offline/static origins used to behave).
 * Guards against escaping `rootDir` the same way.
 */
async function resolveStaticFilePath(rootDir, pathname) {
  const indexPath = NodePath.join(rootDir, "index.html");
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/u, "");
  if (relativePath.length === 0) {
    return indexPath;
  }

  const candidatePath = NodePath.join(rootDir, relativePath);
  const relativeToRoot = NodePath.relative(rootDir, candidatePath);
  if (relativeToRoot.startsWith("..") || NodePath.isAbsolute(relativeToRoot)) {
    return indexPath;
  }

  try {
    const stat = await NodeFSP.stat(candidatePath);
    return stat.isFile() ? candidatePath : indexPath;
  } catch {
    return indexPath;
  }
}

/**
 * A loopback static server for the desktop smoke test: it starts this,
 * points T3CODE_DESKTOP_APP_URL at it, and the shell loads it exactly like
 * it would load any other application url — no network involved, but the
 * real staged hosted-static client rather than a mock.
 */
export function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = NodeHttp.createServer((request, response) => {
      void (async () => {
        try {
          const requestUrl = new NodeURL.URL(request.url ?? "/", "http://127.0.0.1");
          const filePath = await resolveStaticFilePath(rootDir, requestUrl.pathname);
          const body = await NodeFSP.readFile(filePath);
          response.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
          response.end(body);
        } catch {
          response.writeHead(404);
          response.end();
        }
      })();
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/`,
        close: () => new Promise((closeResolve) => server.close(() => closeResolve())),
      });
    });
  });
}

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

async function runElectronSmoke(capturePath, appUrl) {
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
      T3CODE_DESKTOP_APP_URL: appUrl,
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
  let staticServer;
  try {
    staticServer = await startStaticServer(webBundleDir);
    exitCode = await runElectronSmoke(
      NodePath.join(captureDirectory, "smoke.png"),
      staticServer.url,
    );
  } finally {
    await staticServer?.close();
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
