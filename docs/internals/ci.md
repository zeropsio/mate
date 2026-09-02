# CI quality gates

> For maintainers. Using T3 Code? See [docs/user](../user/).

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs these quality gates on pull requests
and pushes to `main`:

- **Check**: `node scripts/imported-lock.ts --check` verifies the byte-identical import zone
  (`imported.lock`) against `HEAD`, then `vp test run scripts/mate-zone-architecture.test.ts` checks
  the import-direction rules between the ported, owned-product, and zerops zones. Then `vp check`
  (format and lint; this repo sets `typeCheck: false` in its lint options), then `vpr typecheck` for
  the workspace type check. The same job builds the desktop pipeline (`vp run build:desktop`) and
  verifies the preload bundle exists and uses only imports that Electron's sandbox can load. The
  verifier parses imports, then executes the trusted artifact with controlled bridge stubs to
  confirm that its required APIs are callable.
- **Test**: `vp run test` across the workspace.
- **Mobile Native Static Analysis**: `vp run lint:mobile` on macOS, wrapping
  `scripts/mobile-native-static-check.ts`. A cheap Linux **Mobile Native Changes** job gates it:
  the macOS runner only boots when the diff touches `apps/mobile` Swift/Kotlin sources, the
  SwiftLint/detekt/ktlint configuration, the `Brewfile`, the check script, the root `package.json`
  that defines `lint:mobile`, or `ci.yml`. Otherwise the job is skipped, which GitHub reports as
  success for the required check. Renames are matched on both their old and new path. The gate fails
  open in every other case: if the changed-file list cannot be resolved, GitHub truncates it, or the
  gate job itself fails, the lint runs.
- **Release Smoke**: exercises release-only workflow steps through `scripts/release-smoke.ts`, so
  release breakage surfaces on PRs rather than at tag time.

The fork removed `release.yml` and the other upstream community/publish workflows (`deploy-relay`,
`desktop-macos-preview`, `issue-labels`, `mobile-eas-preview`, `mobile-eas-production`,
`mobile-fingerprint-check`, `mobile-showcase-screenshots`, `pr-size`, `pr-vouch`, `publish-aur`,
`thread-transfer-report`, `web-preview`) — `ci.yml` is the only workflow the fork keeps.
[Release Checklist](../operations/release.md) still records the signing/publish process those
workflows implemented; it is not wired to CI yet.
