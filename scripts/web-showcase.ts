#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Host-side Electron capture automation uses Node subprocess and timing APIs directly.

import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import {
  loadShowcaseScene,
  SHOWCASE_SCENE_IDS,
  type ShowcaseSceneId,
} from "@t3tools/shared/showcaseScenes";
import { PNG } from "pngjs";

// @ts-expect-error The desktop launcher is intentionally a plain JavaScript host script.
import { resolveElectronLaunchCommand as resolveElectronLaunchCommandUntyped } from "../apps/desktop/scripts/electron-launcher.mjs";
import { seedShowcaseScene } from "./showcase-seed.ts";

const resolveElectronLaunchCommand = resolveElectronLaunchCommandUntyped as (
  args: ReadonlyArray<string>,
) => { readonly electronPath: string; readonly args: ReadonlyArray<string> };

const REPO_ROOT = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const CAPTURE_SCRIPT_PATH = NodePath.join(REPO_ROOT, "scripts/web-showcase-capture.mjs");
const SERVER_HOST = "0.0.0.0";
const PAIRING_HOST = "127.0.0.1";

const WEB_SHOWCASE_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

const WEB_SHOWCASE_APPEARANCES = ["light", "dark"] as const;

export type WebShowcaseViewport = keyof typeof WEB_SHOWCASE_VIEWPORTS;
export type WebShowcaseAppearance = (typeof WEB_SHOWCASE_APPEARANCES)[number];

export type WebShowcaseOptions = {
  readonly sceneIds: ReadonlyArray<ShowcaseSceneId>;
  readonly viewports: ReadonlyArray<WebShowcaseViewport>;
  readonly appearances: ReadonlyArray<WebShowcaseAppearance>;
  readonly outputDirectory: string;
  readonly skipBuild: boolean;
};

export type WebShowcaseCapture = {
  readonly sceneId: ShowcaseSceneId;
  readonly viewport: WebShowcaseViewport;
  readonly appearance: WebShowcaseAppearance;
  readonly width: number;
  readonly height: number;
  readonly outputPath: string;
};

export type WebShowcaseNavigationStep =
  | {
      readonly kind: "redeem-browser-session";
      readonly url: string;
      readonly method: "POST";
      readonly pathname: "/api/auth/browser-session";
    }
  | { readonly kind: "navigate"; readonly url: string };

function nextValue(args: ReadonlyArray<string>, index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function isSceneId(value: string): value is ShowcaseSceneId {
  return (SHOWCASE_SCENE_IDS as ReadonlyArray<string>).includes(value);
}

export function parseWebShowcaseCliArgs(args: ReadonlyArray<string>): WebShowcaseOptions {
  let sceneIds: ReadonlyArray<ShowcaseSceneId> = SHOWCASE_SCENE_IDS;
  let viewports: ReadonlyArray<WebShowcaseViewport> = ["desktop", "mobile"];
  let appearances: ReadonlyArray<WebShowcaseAppearance> = WEB_SHOWCASE_APPEARANCES;
  let outputDirectory = "artifacts/web-showcase";
  let skipBuild = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--skip-build") {
      skipBuild = true;
      continue;
    }
    if (argument === "--scene") {
      const value = nextValue(args, index, argument);
      if (value !== "all" && !isSceneId(value)) {
        throw new Error(
          `Unknown showcase scene '${value}'. Valid scene IDs: ${SHOWCASE_SCENE_IDS.join(", ")}.`,
        );
      }
      sceneIds = value === "all" ? SHOWCASE_SCENE_IDS : [value];
      index += 1;
      continue;
    }
    if (argument === "--viewport") {
      const value = nextValue(args, index, argument);
      if (value !== "all" && value !== "desktop" && value !== "mobile") {
        throw new Error(`Unsupported viewport '${value}'.`);
      }
      viewports = value === "all" ? ["desktop", "mobile"] : [value];
      index += 1;
      continue;
    }
    if (argument === "--appearance") {
      const value = nextValue(args, index, argument);
      if (value !== "all" && value !== "light" && value !== "dark") {
        throw new Error(`Unsupported appearance '${value}'.`);
      }
      appearances = value === "all" ? WEB_SHOWCASE_APPEARANCES : [value];
      index += 1;
      continue;
    }
    if (argument === "--out") {
      outputDirectory = nextValue(args, index, argument);
      index += 1;
      continue;
    }
    throw new Error(`Unknown web showcase option '${argument ?? ""}'.`);
  }

  return { sceneIds, viewports, appearances, outputDirectory, skipBuild };
}

export function planWebShowcaseCaptures(
  options: WebShowcaseOptions,
): ReadonlyArray<WebShowcaseCapture> {
  return options.sceneIds.flatMap((sceneId) =>
    options.viewports.flatMap((viewport) => {
      const dimensions = WEB_SHOWCASE_VIEWPORTS[viewport];
      return options.appearances.map((appearance) => ({
        sceneId,
        viewport,
        appearance,
        ...dimensions,
        outputPath: NodePath.join(
          options.outputDirectory,
          sceneId.slice("web:".length),
          `${viewport}-${appearance}.png`,
        ),
      }));
    }),
  );
}

export function buildShowcasePairUrl(host: string, port: number, credential: string): string {
  const url = new URL(`http://${host}:${port}/pair`);
  url.hash = new URLSearchParams([["token", credential]]).toString();
  return url.toString();
}

export function buildShowcaseDeepLinkUrl(
  host: string,
  port: number,
  environmentId: string,
  threadId: string,
): string {
  const url = new URL(`http://${host}:${port}`);
  url.pathname = `/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
  return url.toString();
}

export function planWebShowcaseNavigation(input: {
  readonly pairUrl: string;
  readonly deepLinkUrl: string;
}): ReadonlyArray<WebShowcaseNavigationStep> {
  return [
    {
      kind: "redeem-browser-session",
      url: input.pairUrl,
      method: "POST",
      pathname: "/api/auth/browser-session",
    },
    { kind: "navigate", url: input.deepLinkUrl },
  ];
}

export function buildElectronCaptureArgs(
  captureScriptPath: string,
  input: {
    readonly navigation: ReadonlyArray<WebShowcaseNavigationStep>;
    readonly profileDirectory: string;
    readonly capture: WebShowcaseCapture;
  },
): ReadonlyArray<string> {
  return [
    "--force-device-scale-factor=1",
    captureScriptPath,
    "--navigation",
    JSON.stringify(input.navigation),
    "--width",
    String(input.capture.width),
    "--height",
    String(input.capture.height),
    "--appearance",
    input.capture.appearance,
    "--out",
    input.capture.outputPath,
    "--profile",
    input.profileDirectory,
  ];
}

function spawnProcess(
  command: string,
  args: ReadonlyArray<string>,
  options: NodeChildProcess.SpawnOptions = {},
): NodeChildProcess.ChildProcess {
  return NodeChildProcess.spawn(command, [...args], {
    cwd: REPO_ROOT,
    env: NodeProcess.env,
    stdio: "inherit",
    ...options,
  });
}

async function runCommand(command: string, args: ReadonlyArray<string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(command, args);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed ${signal === null ? `with code ${String(code)}` : `with signal ${signal}`}.`,
        ),
      );
    });
  });
}

async function commandOutput(
  command: string,
  args: ReadonlyArray<string>,
  options: NodeChildProcess.ExecFileOptions = {},
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    NodeChildProcess.execFile(
      command,
      [...args],
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, ...options },
      (error, stdout) => (error === null ? resolve(String(stdout)) : reject(error)),
    );
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stopProcess(child: NodeChildProcess.ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(5_000)]);
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await Promise.race([exited, delay(1_000)]);
}

async function waitForPort(port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = NodeNet.createConnection({ host: PAIRING_HOST, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
      socket.setTimeout(500, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (open) return;
    await delay(500);
  }
  throw new Error(`Showcase server did not listen on port ${port} within ${timeoutMs}ms.`);
}

async function waitForFileContent(filePath: string, timeoutMs = 60_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const content = await NodeFSP.readFile(filePath, "utf8").then(
      (value) => value.trim(),
      () => "",
    );
    if (content.length > 0) return content;
    await delay(250);
  }
  throw new Error(`${filePath} was not written within ${timeoutMs}ms.`);
}

async function reserveAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, PAIRING_HOST, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a local web showcase port."));
        return;
      }
      server.close((error) => (error === undefined ? resolve(address.port) : reject(error)));
    });
  });
}

function startShowcaseServer(
  baseDir: string,
  workspaceRoot: string,
  port: number,
  sceneId: ShowcaseSceneId,
): NodeChildProcess.ChildProcess {
  return spawnProcess(
    "node",
    [
      "apps/server/src/bin.ts",
      "serve",
      "--host",
      SERVER_HOST,
      "--port",
      String(port),
      "--base-dir",
      baseDir,
      "--no-browser",
      "--log-level",
      "error",
      workspaceRoot,
    ],
    {
      env: { ...NodeProcess.env, T3CODE_ZEROPS_FIXTURES: sceneId },
    },
  );
}

export function parsePairingCredentialOutput(output: string): string {
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd < jsonStart) {
    throw new Error("Pairing credential command did not return JSON.");
  }
  const parsed = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as {
    readonly credential?: unknown;
  };
  if (typeof parsed.credential !== "string" || parsed.credential.length === 0) {
    throw new Error("Pairing credential command returned no credential.");
  }
  return parsed.credential;
}

async function issuePairingCredential(baseDir: string): Promise<string> {
  const output = await commandOutput(
    "node",
    ["apps/server/src/bin.ts", "auth", "pairing", "create", "--base-dir", baseDir, "--json"],
    { env: { ...NodeProcess.env, NO_COLOR: "1" } },
  );
  return parsePairingCredentialOutput(output);
}

async function captureWithElectron(args: ReadonlyArray<string>): Promise<void> {
  const command = resolveElectronLaunchCommand([...args]);
  await runCommand(command.electronPath, command.args);
}

async function verifyCapture(capture: WebShowcaseCapture): Promise<void> {
  const png = PNG.sync.read(await NodeFSP.readFile(capture.outputPath));
  if (png.width !== capture.width || png.height !== capture.height) {
    throw new Error(
      `${capture.outputPath} is ${png.width}×${png.height}; expected ${capture.width}×${capture.height}.`,
    );
  }
}

function printHelp(): void {
  NodeProcess.stdout.write(`Usage: node scripts/web-showcase.ts [options]

  --scene <id|all>                Default: all
  --viewport <desktop|mobile|all> Default: all
  --appearance <light|dark|all>   Default: all
  --out <directory>               Default: artifacts/web-showcase
  --skip-build                    Reuse apps/web/dist

Scenes: ${SHOWCASE_SCENE_IDS.join(", ")}
`);
}

async function main(): Promise<void> {
  if (NodeProcess.argv.includes("--help")) {
    printHelp();
    return;
  }
  const parsed = parseWebShowcaseCliArgs(NodeProcess.argv.slice(2));
  const options = {
    ...parsed,
    outputDirectory: NodePath.resolve(REPO_ROOT, parsed.outputDirectory),
  };
  if (!options.skipBuild) {
    await runCommand("vp", ["run", "--filter", "@t3tools/web", "build"]);
  }
  const webEntry = NodePath.join(REPO_ROOT, "apps/web/dist/index.html");
  await NodeFSP.access(webEntry).catch(() => {
    throw new Error(`${webEntry} is missing. Run without --skip-build to create it.`);
  });

  const captures = planWebShowcaseCaptures(options);
  for (const sceneId of options.sceneIds) {
    const scene = loadShowcaseScene(sceneId);
    const baseDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-web-showcase-"));
    const workspaceRoot = NodePath.join(baseDir, "workspace");
    await NodeFSP.mkdir(workspaceRoot, { recursive: true });
    const port = await reserveAvailablePort();
    const server = startShowcaseServer(baseDir, workspaceRoot, port, sceneId);
    try {
      await waitForPort(port);
      await seedShowcaseScene({ baseDir, scene });
      const environmentId = await waitForFileContent(
        NodePath.join(baseDir, "userdata/environment-id"),
      );
      const thread =
        scene.threads.find((candidate) => candidate.id === scene.lifecycle.threadId) ??
        scene.threads[0];
      if (thread === undefined) {
        throw new Error(`Showcase scene ${sceneId} has no thread to capture.`);
      }
      const deepLinkUrl = buildShowcaseDeepLinkUrl(PAIRING_HOST, port, environmentId, thread.id);
      for (const capture of captures.filter((candidate) => candidate.sceneId === sceneId)) {
        const credential = await issuePairingCredential(baseDir);
        const navigation = planWebShowcaseNavigation({
          pairUrl: buildShowcasePairUrl(PAIRING_HOST, port, credential),
          deepLinkUrl,
        });
        const profileDirectory = NodePath.join(
          baseDir,
          "electron-profile",
          `${capture.viewport}-${capture.appearance}`,
        );
        await NodeFSP.mkdir(NodePath.dirname(capture.outputPath), { recursive: true });
        await captureWithElectron(
          buildElectronCaptureArgs(CAPTURE_SCRIPT_PATH, { navigation, profileDirectory, capture }),
        );
        await verifyCapture(capture);
        NodeProcess.stdout.write(
          `Captured ${NodePath.relative(REPO_ROOT, capture.outputPath)} (${capture.width}×${capture.height})\n`,
        );
      }
    } finally {
      await stopProcess(server);
      await NodeFSP.rm(baseDir, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  void main().catch((error: unknown) => {
    NodeProcess.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    NodeProcess.exit(1);
  });
}
