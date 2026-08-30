#!/usr/bin/env node

import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import serverPackageJson from "../apps/server/package.json" with { type: "json" };
import { applyWebBrandAssets } from "./apply-web-brand-assets.ts";
import { resolveWebAssetBrandForChannel, type WebAssetBrand } from "./lib/brand-assets.ts";

const COMMAND_OUTPUT_TAIL_LENGTH = 8_000;

export function resolveDesktopUpdateChannel(version: string): "latest" | "nightly" {
  return /-nightly\.\d{8}\.\d+$/.test(version) ? "nightly" : "latest";
}

function appendOutputTail(acc: string, chunk: string): string {
  const next = acc + chunk;
  return next.length > COMMAND_OUTPUT_TAIL_LENGTH ? next.slice(-COMMAND_OUTPUT_TAIL_LENGTH) : next;
}

function formatOutputSection(label: string, output: string): string | undefined {
  const trimmed = output.trim();
  return trimmed.length === 0 ? undefined : `${label} tail:\n${trimmed}`;
}

export class DesktopWebBuildCommandFailedError extends Schema.TaggedErrorClass<DesktopWebBuildCommandFailedError>()(
  "DesktopWebBuildCommandFailedError",
  {
    exitCode: Schema.Int,
    stdoutTail: Schema.optionalKey(Schema.String),
    stderrTail: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    const outputSections = [
      formatOutputSection("stdout", this.stdoutTail ?? ""),
      formatOutputSection("stderr", this.stderrTail ?? ""),
    ].filter((section): section is string => section !== undefined);
    const outputSuffix = outputSections.length > 0 ? `\n\n${outputSections.join("\n\n")}` : "";
    return `Hosted web build exited with code ${this.exitCode}.${outputSuffix}`;
  }
}

export class DesktopWebBuildMissingError extends Schema.TaggedErrorClass<DesktopWebBuildMissingError>()(
  "DesktopWebBuildMissingError",
  { entryPath: Schema.String },
) {
  override get message(): string {
    return `Hosted web build is missing at ${this.entryPath}. Run 'node scripts/stage-desktop-web.ts' first.`;
  }
}

export class DesktopWebBuildAssetsMissingError extends Schema.TaggedErrorClass<DesktopWebBuildAssetsMissingError>()(
  "DesktopWebBuildAssetsMissingError",
  {
    indexPath: Schema.String,
    missingFiles: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    const preview = this.missingFiles.slice(0, 6).join(", ");
    const suffix = this.missingFiles.length > 6 ? ` (+${this.missingFiles.length - 6} more)` : "";
    return `Bundled client references missing files in ${this.indexPath}: ${preview}${suffix}. Rebuild the hosted web bundle.`;
  }
}

const collectCommandStream = <E>(
  stream: Stream.Stream<Uint8Array, E>,
  output: NodeJS.WriteStream,
  verbose: boolean,
): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFoldEffect(
      () => "",
      (acc, chunk) =>
        Effect.as(
          verbose ? Effect.sync(() => output.write(chunk)) : Effect.void,
          appendOutputTail(acc, chunk),
        ),
    ),
  );

const runWebBuild = Effect.fn("runDesktopWebBuild")(function* (input: {
  readonly repoRoot: string;
  readonly appVersion: string;
  readonly verbose: boolean;
}) {
  const spawnCommand = yield* resolveSpawnCommand("vp", [
    "run",
    "--filter",
    "@t3tools/web",
    "build",
  ]);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      cwd: input.repoRoot,
      shell: spawnCommand.shell,
      env: {
        ...process.env,
        VITE_HOSTED_APP_CHANNEL: resolveDesktopUpdateChannel(input.appVersion),
        // A configured backend URL makes the web app non-hosted. Scrub both
        // so developer-local env files cannot leak a backend into this bundle.
        VITE_HTTP_URL: "",
        VITE_WS_URL: "",
      },
    }),
  );
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      collectCommandStream(child.stdout, process.stdout, input.verbose),
      collectCommandStream(child.stderr, process.stderr, input.verbose),
      child.exitCode.pipe(Effect.map(Number)),
    ],
    { concurrency: "unbounded" },
  );

  if (exitCode !== 0) {
    return yield* new DesktopWebBuildCommandFailedError({
      exitCode,
      ...(stdout.trim() ? { stdoutTail: stdout } : {}),
      ...(stderr.trim() ? { stderrTail: stderr } : {}),
    });
  }
});

const validateBundledClientAssets = Effect.fn("validateDesktopWebBuildAssets")(function* (
  clientDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const indexPath = path.join(clientDir, "index.html");
  const indexHtml = yield* fs.readFileString(indexPath);
  const refs = [...indexHtml.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);
  const missing: string[] = [];

  for (const ref of refs) {
    const normalizedRef = ref.split("#")[0]?.split("?")[0] ?? "";
    if (!normalizedRef) continue;
    if (normalizedRef.startsWith("http://") || normalizedRef.startsWith("https://")) continue;
    if (normalizedRef.startsWith("data:") || normalizedRef.startsWith("mailto:")) continue;
    if (!path.extname(normalizedRef)) continue;

    const assetPath = path.join(clientDir, normalizedRef.replace(/^\/+/, ""));
    if (!(yield* fs.exists(assetPath))) {
      missing.push(normalizedRef);
    }
  }

  if (missing.length > 0) {
    return yield* new DesktopWebBuildAssetsMissingError({ indexPath, missingFiles: missing });
  }
});

// This is the single hosted-web staging path for both repository smoke runs
// and temporary electron-builder stage trees.
export const stageHostedWebBundle = Effect.fn("stageHostedWebBundle")(function* (input: {
  readonly repoRoot: string;
  readonly webDistDir: string;
  readonly stageWebResourcesDir: string;
  readonly appVersion: string;
  readonly webAssetBrand: WebAssetBrand;
  readonly skipBuild: boolean;
  readonly verbose: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  if (!input.skipBuild) {
    yield* Effect.log("[desktop-web] Building hosted-static web bundle...");
    yield* runWebBuild(input);
  }

  const webBundleEntry = path.join(input.webDistDir, "index.html");
  if (!(yield* fs.exists(webBundleEntry))) {
    return yield* new DesktopWebBuildMissingError({ entryPath: webBundleEntry });
  }

  // applyWebBrandAssets resolves paths from the repository root, so its
  // target remains repo-relative even when packaging stages elsewhere.
  yield* applyWebBrandAssets(input.webAssetBrand, "apps/web/dist");
  yield* Effect.log(`[desktop-web] Applied ${input.webAssetBrand} web client branding.`);
  yield* validateBundledClientAssets(input.webDistDir);

  yield* fs
    .remove(input.stageWebResourcesDir, { recursive: true, force: true })
    .pipe(Effect.ignore);
  yield* fs.makeDirectory(path.dirname(input.stageWebResourcesDir), { recursive: true });
  yield* fs.copy(input.webDistDir, input.stageWebResourcesDir);
  yield* Effect.log(`[desktop-web] Staged hosted web bundle at ${input.stageWebResourcesDir}.`);
});

const stageDesktopWebCommand = Command.make(
  "stage-desktop-web",
  {
    skipBuild: Flag.boolean("skip-build").pipe(
      Flag.withDescription("Stage the existing apps/web/dist without rebuilding it."),
      Flag.optional,
    ),
  },
  ({ skipBuild }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const repoRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
      yield* stageHostedWebBundle({
        repoRoot,
        webDistDir: path.join(repoRoot, "apps/web/dist"),
        // For a dev-tree launch, DesktopEnvironment's second resource
        // candidate resolves here from apps/desktop/dist-electron.
        stageWebResourcesDir: path.join(repoRoot, "apps/desktop/prod-resources/web"),
        appVersion: serverPackageJson.version,
        webAssetBrand: resolveWebAssetBrandForChannel(
          resolveDesktopUpdateChannel(serverPackageJson.version),
        ),
        skipBuild: Option.getOrElse(skipBuild, () => false),
        verbose: true,
      });
    }),
).pipe(Command.withDescription("Stage the hosted-static web bundle for a desktop dev-tree run."));

if (import.meta.main) {
  Command.run(stageDesktopWebCommand, { version: "0.0.0" }).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
