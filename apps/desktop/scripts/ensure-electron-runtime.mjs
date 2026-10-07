import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

const require = NodeModule.createRequire(import.meta.url);
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone repair script has no Effect runtime.
const hostPlatform = NodeOS.platform();
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone repair script has no Effect runtime.
const hostArch = NodeOS.arch();

function getPlatformPath() {
  switch (hostPlatform) {
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "freebsd":
    case "openbsd":
    case "linux":
      return "electron";
    case "win32":
      return "electron.exe";
    default:
      throw new Error(`Electron builds are not available on platform: ${hostPlatform}`);
  }
}

function ensureExecutable(filePath) {
  if (hostPlatform !== "win32" && (NodeFS.statSync(filePath).mode & 0o777) !== 0o755) {
    NodeFS.chmodSync(filePath, 0o755);
  }
}

function repairPathFile(electronDir, platformPath) {
  const pathFile = NodePath.join(electronDir, "path.txt");
  const currentPath = NodeFS.existsSync(pathFile)
    ? NodeFS.readFileSync(pathFile, "utf8")
    : undefined;

  if (currentPath !== platformPath) {
    NodeFS.writeFileSync(pathFile, platformPath);
  }
}

function getRequiredRuntimePaths(electronDir, platformPath) {
  const paths = [
    NodePath.join(electronDir, "dist", platformPath),
    NodePath.join(electronDir, "dist", "version"),
  ];

  if (hostPlatform === "darwin") {
    paths.push(
      NodePath.join(electronDir, "dist", "Electron.app", "Contents", "Info.plist"),
      NodePath.join(
        electronDir,
        "dist",
        "Electron.app",
        "Contents",
        "Frameworks",
        "Electron Framework.framework",
        "Electron Framework",
      ),
    );
  }

  return paths;
}

function isMachO(filePath) {
  if (hostPlatform !== "darwin") {
    return true;
  }

  const result = NodeChildProcess.spawnSync("file", ["-b", filePath], {
    encoding: "utf8",
  });

  return result.status === 0 && result.stdout.includes("Mach-O");
}

function missingRuntimePaths(electronDir, platformPath) {
  return getRequiredRuntimePaths(electronDir, platformPath).filter((runtimePath) => {
    return !NodeFS.existsSync(runtimePath);
  });
}

function invalidRuntimePaths(electronDir, platformPath) {
  if (hostPlatform !== "darwin") {
    return [];
  }

  return [
    NodePath.join(electronDir, "dist", platformPath),
    NodePath.join(
      electronDir,
      "dist",
      "Electron.app",
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Electron Framework",
    ),
  ].filter((runtimePath) => NodeFS.existsSync(runtimePath) && !isMachO(runtimePath));
}

function runChecked(command, args) {
  const result = NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.status === 0) {
    return;
  }

  throw new Error(
    `${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`,
  );
}

function runtimeReady(directory, version) {
  const versionPath = NodePath.join(directory, "dist", "version");
  return (
    NodeFS.existsSync(versionPath) &&
    NodeFS.readFileSync(versionPath, "utf8").trim().replace(/^v/u, "") === version &&
    !missingRuntimePaths(directory, getPlatformPath()).length &&
    !invalidRuntimePaths(directory, getPlatformPath()).length
  );
}

function cacheIdentity(electronDir) {
  const packageJson = JSON.parse(
    NodeFS.readFileSync(NodePath.join(electronDir, "package.json"), "utf8"),
  );
  const filename = `electron-v${packageJson.version}-${hostPlatform}-${hostArch}.zip`;
  const checksums = JSON.parse(
    NodeFS.readFileSync(NodePath.join(electronDir, "checksums.json"), "utf8"),
  );
  const checksum = checksums[filename];
  if (!checksum) throw new Error(`Electron package has no checksum for ${filename}`);
  return { version: packageJson.version, platform: hostPlatform, arch: hostArch, checksum };
}

function cacheReady(cache, identity) {
  const receipt = NodePath.join(cache, "verified.json");
  if (!NodeFS.existsSync(receipt)) return false;
  const recorded = JSON.parse(NodeFS.readFileSync(receipt, "utf8"));
  return (
    Object.entries(identity).every(([key, value]) => recorded[key] === value) &&
    runtimeReady(cache, identity.version)
  );
}

async function buildHostCache(electronDir, cache, offline) {
  const identity = cacheIdentity(electronDir);
  if (cacheReady(cache, identity)) return cache;
  const electronRequire = NodeModule.createRequire(NodePath.join(electronDir, "package.json"));
  const { downloadArtifact } = electronRequire("@electron/get");
  const zipPath = await downloadArtifact({
    version: identity.version,
    artifactName: "electron",
    platform: hostPlatform,
    arch: hostArch,
    cacheRoot: process.env.electron_config_cache,
    checksums: electronRequire("./checksums.json"),
    ...(offline
      ? {
          downloader: {
            download() {
              throw new Error(
                "Electron archive is missing or invalid in the cache; run pnpm rebuild electron to populate it, then prepare again.",
              );
            },
          },
        }
      : {}),
  });
  const staging = NodeFS.mkdtempSync(NodePath.join(NodePath.dirname(cache), ".electron-stage-"));
  try {
    const dist = NodePath.join(staging, "dist");
    if (hostPlatform === "darwin") {
      runChecked("ditto", ["-x", "-k", zipPath, dist]);
    } else {
      runChecked("python3", [
        "-c",
        "import os, sys, zipfile; os.makedirs(sys.argv[2], exist_ok=True); zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
        zipPath,
        dist,
      ]);
    }
    if (!runtimeReady(staging, identity.version))
      throw new Error("Verified Electron archive contains an incomplete runtime");
    ensureExecutable(NodePath.join(dist, getPlatformPath()));
    NodeFS.writeFileSync(NodePath.join(staging, "verified.json"), JSON.stringify(identity));
    NodeFS.rmSync(cache, { recursive: true, force: true });
    NodeFS.renameSync(staging, cache);
    return cache;
  } finally {
    NodeFS.rmSync(staging, { recursive: true, force: true });
  }
}

function lockedWorker(lock, args) {
  const result = NodeChildProcess.spawnSync(
    "flock",
    ["-x", lock, process.execPath, NodeURL.fileURLToPath(import.meta.url), ...args],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(
      result.error?.message || result.stderr.trim() || "Electron runtime repair failed",
    );
  return result.stdout.trim();
}

function hostCache(electronDir, offline) {
  const identity = cacheIdentity(electronDir);
  const base =
    process.env.MATE_ELECTRON_CACHE ?? NodePath.join(NodeOS.homedir(), ".cache", "mate-electron");
  const cache = NodePath.join(base, identity.version, `${hostPlatform}-${hostArch}`);
  NodeFS.mkdirSync(NodePath.dirname(cache), { recursive: true });
  return lockedWorker(`${cache}.lock`, [
    "--cache",
    electronDir,
    cache,
    ...(offline ? ["--offline"] : []),
  ]);
}

function cloneRuntime(cache, destination) {
  if (hostPlatform === "darwin") {
    const result = NodeChildProcess.spawnSync(
      "cp",
      ["-cR", NodePath.join(cache, "dist"), destination],
      { encoding: "utf8" },
    );
    if (result.status === 0) return;
    if (!/not supported|cross-device|invalid argument/iu.test(result.stderr))
      throw new Error(result.error?.message || result.stderr || "Electron clone failed");
    NodeFS.rmSync(destination, { recursive: true, force: true });
  }
  NodeFS.cpSync(NodePath.join(cache, "dist"), destination, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
}

function installElectronRuntime(electronDir, version, offline) {
  const cache = hostCache(electronDir, offline);
  const staging = NodeFS.mkdtempSync(NodePath.join(electronDir, ".runtime-stage-"));
  try {
    cloneRuntime(cache, NodePath.join(staging, "dist"));
    if (!runtimeReady(staging, version)) throw new Error("Cloned Electron runtime is incomplete");
    NodeFS.rmSync(NodePath.join(electronDir, "dist"), { recursive: true, force: true });
    NodeFS.renameSync(NodePath.join(staging, "dist"), NodePath.join(electronDir, "dist"));
  } finally {
    NodeFS.rmSync(staging, { recursive: true, force: true });
  }
}

function ensureLocked(electronDir, offline) {
  const electronPackageJson = JSON.parse(
    NodeFS.readFileSync(NodePath.join(electronDir, "package.json"), "utf8"),
  );
  const platformPath = getPlatformPath();
  const electronPath = NodePath.join(electronDir, "dist", platformPath);
  if (!runtimeReady(electronDir, electronPackageJson.version)) {
    installElectronRuntime(electronDir, electronPackageJson.version, offline);
  }
  ensureExecutable(electronPath);
  repairPathFile(electronDir, platformPath);
  return electronPath;
}

export function ensureElectronRuntime({ offline = false, workspace } = {}) {
  const workspaceRequire = workspace
    ? NodeModule.createRequire(NodePath.join(workspace, "apps/desktop/package.json"))
    : require;
  const electronDir = NodeFS.realpathSync(
    NodePath.dirname(workspaceRequire.resolve("electron/package.json")),
  );
  return lockedWorker(`${electronDir}.runtime.lock`, [
    "--locked",
    electronDir,
    ...(offline ? ["--offline"] : []),
  ]);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href
) {
  try {
    const electronPath =
      process.argv[2] === "--cache"
        ? await buildHostCache(process.argv[3], process.argv[4], process.argv.includes("--offline"))
        : process.argv[2] === "--locked"
          ? ensureLocked(process.argv[3], process.argv.includes("--offline"))
          : ensureElectronRuntime({
              offline: process.argv.includes("--offline"),
              workspace: process.argv[2] === "--workspace" ? process.argv[3] : undefined,
            });
    process.stdout.write(`${electronPath}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
