// @effect-diagnostics nodeBuiltinImport:off - a synchronous read of a packed bundle's sourcemaps, no Effect runtime.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/**
 * What builds the artifact besides the bundled sources: the build and pack scripts with their
 * configuration, the dependency install (it also stands for every bundled third-party module),
 * the native helper the release workflow compiles into `dist`, and that workflow itself.
 */
const BUILD_TOOLING = [
  ".github/workflows/release.yml",
  "apps/server/package.json",
  "apps/server/scripts/bundleNodePty.ts",
  "apps/server/scripts/cli.ts",
  "apps/server/scripts/cliErrors.ts",
  "apps/server/scripts/releaseManifest.ts",
  "apps/server/tsconfig.json",
  "apps/server/vite.config.ts",
  "native/health-events",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/lib/cli-external-packages.ts",
  "scripts/lib/public-config.ts",
  "scripts/lib/resolve-catalog.ts",
  "tsconfig.base.json",
  "vite.config.ts",
];

/**
 * The repository paths (files, or directories standing for everything below them) the server
 * artifact packed in `dist` was built from: every repository source its bundle's sourcemaps name,
 * plus the build tooling. A file the bundle newly imports is reached through a changed importer.
 */
export function serverArtifactInputs(dist: string): ReadonlyArray<string> {
  const inputs = new Set(BUILD_TOOLING);
  for (const file of NodeFS.readdirSync(dist).filter((name) => name.endsWith(".map"))) {
    const map = JSON.parse(NodeFS.readFileSync(NodePath.join(dist, file), "utf8")) as {
      readonly sources: ReadonlyArray<string>;
    };
    for (const source of map.sources) {
      // Sources are relative to apps/server/dist, where the bundle is built.
      const path = NodePath.posix.join("apps/server/dist", source);
      if (!path.startsWith("../") && !path.split("/").includes("node_modules")) inputs.add(path);
    }
  }
  return [...inputs].toSorted();
}
