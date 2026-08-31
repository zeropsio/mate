#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { resolveCatalogDependencies } from "../../../scripts/lib/resolve-catalog.ts";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import { fromYaml } from "@t3tools/shared/schemaYaml";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import serverPackageJson from "../package.json" with { type: "json" };
import { ServerCliBuildAssetMissingError, ServerCliCommandExitError } from "./cliErrors.ts";

interface PackageJson {
  name: string;
  repository: {
    type: string;
    url: string;
    directory: string;
  };
  bin: Record<string, string>;
  type: string;
  version: string;
  engines: Record<string, string>;
  files: string[];
  dependencies: Record<string, string>;
  overrides: Record<string, string>;
}

const PackageJsonPrettyJson = fromJsonStringPretty(Schema.Unknown);
const encodePackageJson = Schema.encodeEffect(PackageJsonPrettyJson);

const WorkspaceConfig = Schema.Struct({
  catalog: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  overrides: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
type WorkspaceConfig = typeof WorkspaceConfig.Type;
const decodeWorkspaceConfig = Schema.decodeEffect(fromYaml(WorkspaceConfig));

const RepoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("../../..", import.meta.url))),
);

const readWorkspaceConfig = Effect.fn("readWorkspaceConfig")(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const repoRoot = yield* RepoRoot;
  const workspaceYaml = yield* fs.readFileString(path.join(repoRoot, "pnpm-workspace.yaml"));
  return yield* decodeWorkspaceConfig(workspaceYaml);
});

const runCommand = Effect.fn("runCommand")(function* (command: ChildProcess.StandardCommand) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(command);
  const exitCode = yield* child.exitCode;

  if (exitCode !== 0) {
    return yield* new ServerCliCommandExitError({
      command: command.command,
      args: command.args,
      cwd: command.options.cwd,
      exitCode,
    });
  }
});

// ---------------------------------------------------------------------------
// build subcommand
// ---------------------------------------------------------------------------

const buildCmd = Command.make(
  "build",
  {
    verbose: Flag.boolean("verbose").pipe(Flag.withDefault(false)),
  },
  (config) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const repoRoot = yield* RepoRoot;
      const serverDir = path.join(repoRoot, "apps/server");

      yield* Effect.log("[cli] Running tsdown...");
      yield* runCommand(
        ChildProcess.make(process.execPath, ["--run", "build:bundle"], {
          cwd: serverDir,
          stdout: config.verbose ? "inherit" : "ignore",
          stderr: "inherit",
          shell: false,
        }),
      );

      const webDist = path.join(repoRoot, "apps/web/dist");
      const clientTarget = path.join(serverDir, "dist/client");

      if (yield* fs.exists(webDist)) {
        yield* fs.copy(webDist, clientTarget);
        yield* Effect.log("[cli] Bundled web app into dist/client");
      } else {
        yield* Effect.logWarning("[cli] Web dist not found — skipping client bundle.");
      }
    }),
).pipe(Command.withDescription("Build the server package (tsdown + bundle web client)."));

// ---------------------------------------------------------------------------
// publish subcommand
// ---------------------------------------------------------------------------

interface PublishCommandConfig {
  readonly access: string;
  readonly tag: string;
  readonly provenance: boolean;
  readonly dryRun: boolean;
}

const createVpPmPublishArgs = (config: PublishCommandConfig): ReadonlyArray<string> => {
  const args = [
    "publish",
    "--filter",
    "t3",
    "--access",
    config.access,
    "--tag",
    config.tag,
    "--no-git-checks",
  ];

  if (config.provenance) args.push("--provenance");
  if (config.dryRun) args.push("--dry-run");

  return args;
};

// `publish` and `pack` share one thing: while `vp pm` runs, apps/server must
// carry the release package.json (catalog: → concrete versions, overrides,
// the release version), and the original must come back afterwards, whatever
// happened in between.
const withReleaseAssets = <A, E, R>(
  repoRoot: string,
  appVersion: Option.Option<string>,
  verbose: boolean,
  use: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const serverDir = path.join(repoRoot, "apps/server");
    const packageJsonPath = path.join(serverDir, "package.json");

    // Assert build assets exist
    for (const relPath of ["dist/bin.mjs", "dist/service-launcher.mjs", "dist/client/index.html"]) {
      const abs = path.join(serverDir, relPath);
      if (!(yield* fs.exists(abs))) {
        return yield* new ServerCliBuildAssetMissingError({ assetPath: abs });
      }
    }

    return yield* Effect.acquireUseRelease(
      // Acquire: resolve publish metadata and read every original before mutation.
      Effect.gen(function* () {
        const version = Option.getOrElse(appVersion, () => serverPackageJson.version);
        const workspaceConfig = yield* readWorkspaceConfig();
        const workspaceCatalog = workspaceConfig.catalog ?? {};
        const workspaceOverrides = workspaceConfig.overrides ?? {};
        const pkg: PackageJson = {
          name: serverPackageJson.name,
          repository: serverPackageJson.repository,
          bin: serverPackageJson.bin,
          type: serverPackageJson.type,
          version,
          engines: serverPackageJson.engines,
          files: serverPackageJson.files,
          dependencies: resolveCatalogDependencies(
            serverPackageJson.dependencies,
            workspaceCatalog,
            "apps/server",
          ),
          overrides: resolveCatalogDependencies(
            workspaceOverrides,
            workspaceCatalog,
            "apps/server",
          ),
        };

        return {
          packageJsonString: yield* encodePackageJson(pkg),
          originalPackageJson: yield* fs.readFile(packageJsonPath),
        };
      }),
      // Use: apply the release package metadata, then run the caller's vp pm step.
      (resource) =>
        Effect.gen(function* () {
          yield* fs.writeFileString(packageJsonPath, `${resource.packageJsonString}\n`);
          yield* Effect.log("[cli] Applied package metadata");
          return yield* use;
        }),
      // Release: restore package.json even if the step fails.
      (resource) =>
        Effect.gen(function* () {
          yield* fs.writeFile(packageJsonPath, resource.originalPackageJson);
          if (verbose) yield* Effect.log("[cli] Restored original package metadata");
        }),
    );
  });

// vp pm from the workspace root so pnpm-only workspace config, including
// override selectors, is interpreted correctly.
const runVpPm = Effect.fn("runVpPm")(function* (
  repoRoot: string,
  args: ReadonlyArray<string>,
  verbose: boolean,
) {
  const spawnCommand = yield* resolveSpawnCommand("vp", ["pm", ...args]);
  yield* Effect.log(`[cli] Running: vp pm ${args.join(" ")}`);
  yield* runCommand(
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      cwd: repoRoot,
      stdout: verbose ? "inherit" : "ignore",
      stderr: "inherit",
      shell: spawnCommand.shell,
    }),
  );
});

const publishCmd = Command.make(
  "publish",
  {
    tag: Flag.string("tag").pipe(Flag.withDefault("latest")),
    access: Flag.string("access").pipe(Flag.withDefault("public")),
    appVersion: Flag.string("app-version").pipe(Flag.optional),
    provenance: Flag.boolean("provenance").pipe(Flag.withDefault(false)),
    dryRun: Flag.boolean("dry-run").pipe(Flag.withDefault(false)),
    verbose: Flag.boolean("verbose").pipe(Flag.withDefault(false)),
  },
  (config) =>
    Effect.gen(function* () {
      const repoRoot = yield* RepoRoot;
      yield* withReleaseAssets(
        repoRoot,
        config.appVersion,
        config.verbose,
        runVpPm(repoRoot, createVpPmPublishArgs(config), config.verbose),
      );
    }),
).pipe(Command.withDescription("Publish the server package to npm."));

// ---------------------------------------------------------------------------
// pack subcommand — the publish rewrite, ending in a local tarball instead of
// a registry upload. Used by hand-delivered dev builds (a container that runs
// the fork before it is ever published) and by any release-asset channel.
// ---------------------------------------------------------------------------

const packCmd = Command.make(
  "pack",
  {
    out: Flag.string("out").pipe(Flag.withDefault("apps/server/dist")),
    appVersion: Flag.string("app-version").pipe(Flag.optional),
    verbose: Flag.boolean("verbose").pipe(Flag.withDefault(false)),
  },
  (config) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const repoRoot = yield* RepoRoot;
      const outDir = path.resolve(config.out);
      yield* fs.makeDirectory(outDir, { recursive: true });
      yield* withReleaseAssets(
        repoRoot,
        config.appVersion,
        config.verbose,
        runVpPm(repoRoot, ["pack", "--filter", "t3", "--pack-destination", outDir], config.verbose),
      );
      yield* Effect.log(`[cli] Packed t3 into ${outDir}`);
    }),
).pipe(
  Command.withDescription(
    "Pack the server package into a tarball (the publish rewrite, no upload).",
  ),
);

// ---------------------------------------------------------------------------
// root command
// ---------------------------------------------------------------------------

const cli = Command.make("cli").pipe(
  Command.withDescription("T3 server build & publish CLI."),
  Command.withSubcommands([buildCmd, publishCmd, packCmd]),
);

Command.run(cli, { version: "0.0.0" }).pipe(
  Effect.scoped,
  Effect.provide([Logger.layer([Logger.consolePretty()]), NodeServices.layer]),
  NodeRuntime.runMain,
);
