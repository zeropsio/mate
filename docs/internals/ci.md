# CI quality gates

> For maintainers. Using T3 Code? See [docs/user](../user/).

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs these quality gates on pull requests
and pushes to `main`:

- **Check**: `node scripts/imported-lock.ts --check` verifies the byte-identical import zone
  (`imported.lock`) against `HEAD`, then `vp test run scripts/mate-zone-architecture.test.ts` checks
  the import-direction rules between the ported, owned-product, and zerops zones. Then `vp check`
  (format and lint; this repo sets `typeCheck: false` in its lint options), then `vpr typecheck` for
  the workspace type check, then `vp run --filter t3 build`, the production web and server bundles.
- **Test**: `vp run test` across the workspace except `t3`, `@t3tools/web` and `@t3tools/mobile`,
  which run on jobs of their own: **Test Server 1–3** shards `apps/server` (its files run one at a
  time), **Test Web 1–2** shards `apps/web`, which alone used to set the length of every run, and
  **Test Mobile** is gated below.
- **Changes** gates the jobs for clients the container bundle does not ship. On a pull request each
  runs only when the diff touches its area; a push to `main` runs all of them except the macOS lint,
  which keeps its own gate there too. Every client area includes the workspace manifests, the
  lockfile, `tsconfig.base.json`, the root `vite.config.ts`, `ci.yml`, and `packages/contracts`,
  `packages/shared`, `packages/client-runtime` — the clients never import `apps/server`, so a
  server-only diff skips them all. Renames are matched on both their old and new path. The gate fails
  open: if the changed-file list cannot be resolved, GitHub truncates it, or the gate job itself
  fails, every gated job runs. A skipped job is reported as success.
  - **Desktop Smoke** (`desktop`: also `apps/desktop`, `apps/web`, `scripts/`): builds the desktop
    pipeline (`vp run build:desktop`), verifies the preload bundle exists and uses only imports that
    Electron's sandbox can load — parsing its imports, then executing the trusted artifact with
    controlled bridge stubs to confirm its required APIs are callable — and launches the app under
    xvfb.
  - **Test Mobile** (`mobile`: also `apps/mobile`, `native/libghostty-vt`): the `@t3tools/mobile`
    suite.
  - **Rust** (`resource_monitor`: `native/resource-monitor`, `ci.yml`): `cargo fmt --check` and
    `cargo test` for the desktop's resource monitor.
  - **Mobile Native Static Analysis** (`mobile_native`): `vp run lint:mobile` on macOS, wrapping
    `scripts/mobile-native-static-check.ts`, when the diff touches `apps/mobile` Swift/Kotlin
    sources, the SwiftLint/detekt/ktlint configuration, the `Brewfile`, the check script, the root
    `package.json` that defines `lint:mobile`, or `ci.yml`.
- **Release Smoke**: exercises release-only workflow steps through `scripts/release-smoke.ts`, so
  release breakage surfaces on PRs rather than at tag time.

`release.yml` publishes the container bundle on a `v*` tag and does not wait for CI. The fork removed
the upstream community/publish workflows (`deploy-relay`, `desktop-macos-preview`, `issue-labels`,
`mobile-eas-preview`, `mobile-eas-production`, `mobile-fingerprint-check`,
`mobile-showcase-screenshots`, `pr-size`, `pr-vouch`, `publish-aur`, `thread-transfer-report`,
`web-preview`). [Release Checklist](../operations/release.md) still
records the signing/publish process those workflows implemented; it is not wired to CI yet.
