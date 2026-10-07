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
  if (hostPlatform !== "win32") {
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

async function installElectronRuntime(electronDir, version, offline) {
  const electronRequire = NodeModule.createRequire(NodePath.join(electronDir, "package.json"));
  const { downloadArtifact } = electronRequire("@electron/get");
  const zipPath = await downloadArtifact({
    version,
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
  // Stage on the same filesystem, then publish only a complete runtime under the kernel lock.
  const staging = NodeFS.mkdtempSync(NodePath.join(electronDir, ".runtime-stage-"));
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
    const platformPath = getPlatformPath();
    const invalid = [
      ...missingRuntimePaths(staging, platformPath),
      ...invalidRuntimePaths(staging, platformPath),
    ];
    if (invalid.length) throw new Error(`Electron archive is incomplete: ${invalid.join(", ")}`);
    ensureExecutable(NodePath.join(dist, platformPath));
    NodeFS.rmSync(NodePath.join(electronDir, "dist"), { recursive: true, force: true });
    NodeFS.renameSync(dist, NodePath.join(electronDir, "dist"));
  } finally {
    NodeFS.rmSync(staging, { recursive: true, force: true });
  }
}

async function ensureLocked(electronDir, offline) {
  const electronPackageJson = JSON.parse(
    NodeFS.readFileSync(NodePath.join(electronDir, "package.json"), "utf8"),
  );
  const platformPath = getPlatformPath();
  const electronPath = NodePath.join(electronDir, "dist", platformPath);
  const versionPath = NodePath.join(electronDir, "dist", "version");
  const versionMatches =
    NodeFS.existsSync(versionPath) &&
    NodeFS.readFileSync(versionPath, "utf8").trim().replace(/^v/u, "") ===
      electronPackageJson.version;
  if (
    !versionMatches ||
    missingRuntimePaths(electronDir, platformPath).length ||
    invalidRuntimePaths(electronDir, platformPath).length
  ) {
    await installElectronRuntime(electronDir, electronPackageJson.version, offline);
  }
  ensureExecutable(electronPath);
  repairPathFile(electronDir, platformPath);
  return electronPath;
}

export function ensureElectronRuntime({ offline = false } = {}) {
  const electronDir = NodeFS.realpathSync(
    NodePath.dirname(require.resolve("electron/package.json")),
  );
  const script = NodeURL.fileURLToPath(import.meta.url);
  // Resolved path fences callers through different workspace symlinks. Kernel releases on death.
  const result = NodeChildProcess.spawnSync(
    "flock",
    [
      "-x",
      `${electronDir}.runtime.lock`,
      process.execPath,
      script,
      "--locked",
      electronDir,
      ...(offline ? ["--offline"] : []),
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(
      result.error?.message || result.stderr.trim() || "Electron runtime repair failed",
    );
  return result.stdout.trim();
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href
) {
  try {
    const electronPath =
      process.argv[2] === "--locked"
        ? await ensureLocked(process.argv[3], process.argv.includes("--offline"))
        : ensureElectronRuntime({ offline: process.argv.includes("--offline") });
    process.stdout.write(`${electronPath}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
