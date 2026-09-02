# Release Tooling

> For maintainers. Using Zerops Code? See [docs/user](../user/).

Zerops Code releases are GitHub releases in
[`zeropsio/mate`](https://github.com/zeropsio/mate/releases). The release is an npm-compatible tarball
only because that gives zcp and standalone operators a standard local installation format. There
is no npm publication step: nothing is published under the `zerops-code` name. The running server
also has no in-app update path.

## Server Release Path

1. Set `apps/server/package.json` to the intended stable version and make sure the release commit is
   green.
2. Push a `v<version>` tag whose version exactly matches that package version.
3. [`.github/workflows/release.yml`](../../.github/workflows/release.yml) builds the hosted web
   client with `VITE_BASE_PATH=/z3`, builds the server, and packs `zerops-code-<version>.tgz`.
4. The workflow installs that tarball into a scratch npm project, runs the installed
   `./node_modules/.bin/z3 --version` binary, and loads the native addons. A tarball that cannot be
   installed and executed never reaches a release.
5. The workflow writes `SHA256SUMS`, transfers both verified assets to its release job, checks the
   checksum again, and creates the GitHub release for that tag.
6. A zcp release may then pin the z3 version and digest together in `internal/z3/z3.go`. In a Zerops
   project, zcp downloads and verifies that asset and supervises it as `zerops@z3`.

The zcp version and digest are one pin. Bumping either without the other makes the selected asset
and the digest used to verify it disagree.

`workflow_dispatch` rehearses the build and verification with an explicit version but deliberately
does not create a GitHub release.

## What the Release Manifest Declares

The bundler inlines the server's JavaScript dependencies into `dist/`, so the manifest inside the
tarball declares only the packages the emitted bundle still resolves from the real filesystem: the
native addons and their dlopen wrappers (`node-pty`, `msgpackr-extract`, `@ff-labs/fff-node`, via
`CLI_RUNTIME_EXTERNAL_PREFIXES`). `buildReleaseManifest` in
[`apps/server/scripts/releaseManifest.ts`](../../apps/server/scripts/releaseManifest.ts) applies
that prune; declaring the inlined packages too made the container download a second, unused copy of
every one of them — 159 packages and 500 MB installed on 0.1.7, against 7 packages and 158 MB.

The manifest carries no `overrides`: npm honours that field only in the root project, never in an
installed dependency, so the block 0.1.7 shipped had no effect on what was installed.

Because the manifest is derived from the bundler's external list, `pack` reads the chunks it just
built and fails when one statically imports a package the manifest does not declare. That check is
what keeps the prune honest if the bundler stops inlining something.

## Local Packaging Check

Build the web and server before packing when reproducing the workflow locally. The pack command is:

```sh
node apps/server/scripts/cli.ts pack --out <release-directory> --app-version <version>
```

Verify the resulting archive the same way a standalone installation does: write or check its
SHA-256 digest, install the local tarball in an empty directory, and run the installed
`./node_modules/.bin/z3 --version`. There is intentionally no `publish` subcommand.

The release-only transformation smoke test remains available for shared build tooling:

```sh
node scripts/release-smoke.ts
```

It exercises release-version alignment, nightly metadata, lockfile regeneration, and desktop
update-manifest merging in a temporary directory. It does not upload an artifact.

## Surviving Release Scripts

The repository retains desktop source and artifact builders, but this fork does not currently
publish desktop clients. These scripts remain build inputs and must continue to work:

- `scripts/update-release-package-versions.ts` writes one release version to the server, desktop,
  web, and contracts package manifests.
- `scripts/resolve-nightly-release.ts` derives nightly desktop release metadata from the desktop
  base version, date, workflow run number, and commit SHA.
- `scripts/build-desktop-artifact.ts` builds macOS DMG, Linux AppImage, and Windows NSIS artifacts;
  the root `dist:desktop:*` scripts select platform and architecture.
- `scripts/merge-update-manifests.ts` combines two per-architecture Electron updater manifests into
  one multi-architecture manifest.
- `scripts/stage-desktop-web.ts` builds the hosted-static web bundle and stages it at
  `resources/web` for packaged desktop artifacts.

The desktop updater source uses GitHub Releases when a downstream build enables distribution. Its
repository slug comes from `T3CODE_DESKTOP_UPDATE_REPOSITORY`, falling back to
`GITHUB_REPOSITORY`. This is separate from the z3 server release and is not an installation path
published by this fork.

## Release Checklist

1. Confirm the intended commit is green and `apps/server/package.json` has the release version.
2. Run focused release tests and `node scripts/release-smoke.ts`.
3. Create and push the matching `v<version>` tag.
4. Confirm the workflow's tarball-install check and both checksum checks pass.
5. Confirm the GitHub release contains exactly the expected `zerops-code-<version>.tgz` and
   `SHA256SUMS` assets.
6. Hand the release version and digest to the zcp maintainers for an explicit pin.
