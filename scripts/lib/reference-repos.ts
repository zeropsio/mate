/**
 * Where a reference repo's default ref comes from: the version this workspace installs
 * (read from a package manifest and prefixed into a tag), or a fixed ref for a repo no
 * workspace package depends on.
 */
export type ReferenceRepoVersion =
  | {
      readonly kind: "installed";
      readonly sourcePath: string;
      readonly packageVersionPath: ReadonlyArray<string>;
      readonly tagPrefix: string;
    }
  | { readonly kind: "pinned"; readonly ref: string };

export interface ReferenceRepo {
  readonly id: string;
  /** Gitignored checkout path, fetched on demand by `vpr sync:repos`. */
  readonly prefix: string;
  readonly repository: string;
  readonly latestRef: string;
  readonly version: ReferenceRepoVersion;
}

export const referenceRepos: ReadonlyArray<ReferenceRepo> = [
  {
    id: "effect-smol",
    prefix: ".repos/effect-smol",
    repository: "https://github.com/Effect-TS/effect.git",
    latestRef: "main",
    version: {
      kind: "installed",
      sourcePath: "pnpm-workspace.yaml",
      packageVersionPath: ["catalog", "effect"],
      tagPrefix: "effect@",
    },
  },
  {
    id: "alchemy-effect",
    prefix: ".repos/alchemy-effect",
    repository: "https://github.com/alchemy-run/alchemy-effect.git",
    latestRef: "main",
    version: { kind: "pinned", ref: "v2.0.0-beta.78" },
  },
];
