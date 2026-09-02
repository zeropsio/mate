import {
  findStaticImportedPackages,
  selectCliRuntimeExternalDependencies,
} from "../../../scripts/lib/cli-external-packages.ts";
import { resolveCatalogDependencies } from "../../../scripts/lib/resolve-catalog.ts";

/**
 * The workspace keeps upstream's `t3` name because 124 Effect service-tag keys
 * in the ported server zone derive from it. The installed artifact carries the
 * Zerops Mate identity instead.
 */
export const RELEASE_PACKAGE_NAME = "zerops-mate";

/** The fields of `apps/server/package.json` the release manifest is built from. */
export interface ReleaseManifestSource {
  readonly repository: { readonly type: string; readonly url: string; readonly directory: string };
  readonly bin: Readonly<Record<string, string>>;
  readonly type: string;
  readonly engines: Readonly<Record<string, string>>;
  readonly files: ReadonlyArray<string>;
  readonly dependencies: Readonly<Record<string, string>>;
}

export interface ReleaseManifest {
  readonly name: string;
  readonly repository: ReleaseManifestSource["repository"];
  readonly bin: Readonly<Record<string, string>>;
  readonly type: string;
  readonly version: string;
  readonly engines: Readonly<Record<string, string>>;
  readonly files: ReadonlyArray<string>;
  readonly dependencies: Readonly<Record<string, string>>;
}

/**
 * Build the package.json that ships inside the release tarball.
 *
 * `dependencies` is pruned to the packages the emitted bundle still resolves
 * from the real filesystem — the native addons and their dlopen wrappers. Every
 * other declared dependency is inlined into `dist/` by the bundler, so leaving
 * it in the manifest makes the container download a second copy as source and
 * never load it. Measured on 0.1.7: 159 packages / 500 MB installed and 9.2 s of
 * `npm install`, against 7 packages / 158 MB and 2.7 s once pruned, of which
 * 210 MB was a per-platform Claude binary the SDK never spawns (the server
 * always passes an explicit `pathToClaudeCodeExecutable`, see
 * `src/provider/Drivers/ClaudeExecutable.ts`).
 *
 * The prune runs first — selection is by package name, so it needs no versions
 * — and only the survivors are catalog-resolved. A native dependency that is one
 * day catalogued still emits a concrete version, while a `catalog:` spec on a
 * package the bundler inlines can no longer fail a release it does not reach.
 *
 * No `overrides`: npm honours that field only in the root project, never in an
 * installed dependency's manifest. 0.1.7 shipped `"…claude-agent-sdk-darwin-
 * arm64": "-"` and npm installed those 192 MB anyway — the block was inert, and
 * after the prune it has nothing left to name.
 */
export function buildReleaseManifest(input: {
  readonly serverPackageJson: ReleaseManifestSource;
  readonly catalog: Readonly<Record<string, string>>;
  readonly version: string;
}): ReleaseManifest {
  const kept = selectCliRuntimeExternalDependencies({ ...input.serverPackageJson.dependencies });
  const dependencies = resolveCatalogDependencies(kept, { ...input.catalog }, "apps/server");

  return {
    name: RELEASE_PACKAGE_NAME,
    repository: input.serverPackageJson.repository,
    bin: input.serverPackageJson.bin,
    type: input.serverPackageJson.type,
    version: input.version,
    engines: input.serverPackageJson.engines,
    files: input.serverPackageJson.files,
    dependencies,
  };
}

/**
 * Package roots the emitted bundle imports statically but the release manifest
 * does not declare — i.e. what would fail to resolve on the container.
 *
 * The prune's failure mode is silent here and fatal there: a static import that
 * resolves to nothing throws at load, inside `zerops@mate`, after the release is
 * published. So the pack command reads the chunks it just built rather than
 * trusting `neverBundle` to describe them.
 */
export function findUndeclaredStaticImports(
  dependencies: Readonly<Record<string, string>>,
  bundleSources: Iterable<string>,
): ReadonlyArray<string> {
  const undeclared = new Set<string>();
  for (const source of bundleSources) {
    for (const root of findStaticImportedPackages(source)) {
      if (!Object.hasOwn(dependencies, root)) undeclared.add(root);
    }
  }
  return [...undeclared].sort();
}
