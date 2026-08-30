# Release Tooling

> For maintainers. Using T3 Code? See [docs/user](../user/).

This repository has no automated publication workflow. It keeps focused tooling for aligning release
versions, deriving nightly metadata, publishing the CLI package, building desktop artifacts, and
checking release-only transformations.

## Version and artifact scripts

- `scripts/update-release-package-versions.ts` aligns the release package versions before building
  or publishing.
- `scripts/resolve-nightly-release.ts` derives the next nightly version, tag, and release name.
- `scripts/build-desktop-artifact.ts` builds macOS DMG, Linux AppImage, and Windows NSIS artifacts;
  the root `dist:desktop:*` scripts provide the supported platform and architecture combinations.
- `scripts/merge-update-manifests.ts` combines per-architecture updater metadata for distribution.

## Server self-update release invariant

Connected servers update to the client's exact version, not to an npm dist-tag. Every released
desktop client version must therefore have a matching `t3@<version>` package available on npm before
users can receive that client. Publish the exact stable or nightly CLI version before exposing the
matching desktop artifacts. Publishing a client first would leave the **Update server** action
targeting a package version that does not exist yet.

For a release smoke test, confirm `npm view t3@<version> version` returns the expected version, then
connect the new client to a server on the previous version and verify that the update action
reconnects to the matching server. When the release adds database migrations, verify that the
remote update applies them and reconnects. A failed trial must restore the database snapshot and
restart the previous server. If the installed launcher does not support the target protocol,
verify that the update stops before restart and run `npx t3@<version> service update` once on the
server machine. Also test the manual pairing guidance when a headless environment is available.

## Desktop auto-update notes

- Updater runtime: `apps/desktop/src/updates/DesktopUpdates.ts`.
- `electron-updater` adapter: `apps/desktop/src/electron/ElectronUpdater.ts`.
- `apps/desktop/src/main.ts` only wires the updater layers into the desktop runtime.
- Update UX:
  - Background checks run on startup delay + interval.
  - No automatic download or install.
  - The desktop UI shows a rocket update button when an update is available; click once to download, click again after download to restart/install.
- Provider: GitHub Releases (`provider: github`) configured at build time.
- Repository slug source:
  - `T3CODE_DESKTOP_UPDATE_REPOSITORY` (format `owner/repo`), if set.
  - otherwise `GITHUB_REPOSITORY` from GitHub Actions.
- Required release assets for updater:
  - platform installers (`.exe`, `.dmg`, `.AppImage`, plus macOS `.zip` for Squirrel.Mac update payloads)
  - channel metadata: `latest*.yml` for stable releases, `nightly*.yml` for nightly releases
  - `*.blockmap` files (used for differential downloads)
- macOS metadata note:
  - `electron-updater` reads `latest-mac.yml` on stable and `nightly-mac.yml` on nightly, for both Intel and Apple Silicon.
  - Run `scripts/merge-update-manifests.ts` to combine per-architecture manifests before distribution.

### Packaged web bundle topology

The desktop app has no embedded server. `scripts/stage-desktop-web.ts`'s
`stageHostedWebBundle` builds `apps/web` in hosted-static mode
(`VITE_HOSTED_APP_CHANNEL` set to the desktop's own update channel,
`VITE_HTTP_URL`/`VITE_WS_URL` both scrubbed) and stages the resulting dist as an
unconditional `extraResources` entry, landing at `resources/web` in every
packaged build (mac, Windows, Linux alike — there is no more Windows-only
sidecar path). At runtime `DesktopEnvironment.resolveResourcePathCandidates`
finds `resources/web/index.html`, and `ElectronProtocol` serves the rest of
that directory from disk with an `index.html` SPA fallback.

For a development-tree smoke run, stage that same bundle with
`node scripts/stage-desktop-web.ts`.

The staging script rejects a package when the hosted web build is missing
(`DesktopWebBuildMissingError`) or references missing assets
(`DesktopWebBuildAssetsMissingError`).

NSIS differential packaging remains enabled.

## npm publication

Publish the aligned server package from the repository root:

```sh
node apps/server/scripts/cli.ts publish --app-version <version> --tag latest --provenance
```

Use `--tag nightly` for a nightly version and `--dry-run` to exercise package preparation without
uploading. The helper temporarily applies publish metadata and icons, runs `vp pm publish --filter t3`
with workspace configuration, and restores the source files even when publication fails.

## Release script smoke test

Run the release-only transformation checks without publishing anything:

```sh
node scripts/release-smoke.ts
```

The smoke test copies the workspace manifests into a temporary directory, exercises release version
alignment and nightly metadata, regenerates a lockfile, and verifies merged macOS and Windows updater
manifests. CI runs the same script after installing the workspace.

## Apple signing and notarization setup (macOS)

Set these environment variables for signed builds:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `APPLE_TEAM_ID`

Checklist:

1. Apple Developer account access:
   - Team has rights to create Developer ID certificates.
2. Create an explicit App ID for `com.t3tools.t3code`.
3. Create a `Developer ID Application` certificate for that App ID.
4. Export the certificate + private key as `.p12` from Keychain.
5. Base64-encode the `.p12` and store as `CSC_LINK`.
6. Store the `.p12` export password as `CSC_KEY_PASSWORD`, and set `APPLE_TEAM_ID` to the
   10-character Apple Developer Team ID.
7. In App Store Connect, create an API key (Team key).
8. Add API key values:
   - `APPLE_API_KEY`: contents of the downloaded `.p8`
   - `APPLE_API_KEY_ID`: Key ID
   - `APPLE_API_ISSUER`: Issuer ID
9. Re-run a tag release and confirm macOS artifacts are signed and notarized.

Notes:

- `APPLE_API_KEY` is stored as raw key text in secrets.

## Azure Trusted Signing setup (Windows)

Set these environment variables for signed builds:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

Checklist:

1. Create Azure Trusted Signing account and certificate profile.
2. Record ATS values:
   - Endpoint
   - Account name
   - Certificate profile name
   - Publisher name
3. Create/choose an Entra app registration (service principal).
4. Grant service principal permissions required by Trusted Signing.
5. Create a client secret for the service principal.
6. Export the Azure variables listed above.
7. Build an installer and confirm it is signed.

## Manual release checklist

1. Ensure `main` is green in CI.
2. Align package versions with `scripts/update-release-package-versions.ts`.
3. Run `node scripts/release-smoke.ts`.
4. Publish the exact CLI version before distributing matching desktop artifacts.
5. Build the required desktop artifacts with the root `dist:desktop:*` scripts.
6. Smoke test the artifacts selected for distribution.

## Troubleshooting

- macOS build unsigned when expected signed:
  - Check all Apple signing variables are populated and non-empty.
- Windows build unsigned when expected signed:
  - Check all Azure ATS and auth secrets are populated and non-empty.
- Build fails with signing error:
  - Retry with secrets removed to confirm unsigned path still works.
  - Re-check certificate/profile names and tenant/client credentials.
