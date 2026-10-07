# Local test runs

Lanes run `node scripts/gate-changed.ts --list` to preview, then `node scripts/gate-changed.ts`.
An unchanged lane exits without scanning the guard ledgers. Root test discovery excludes private
worktrees under `.plans` and `.claude/worktrees`. While editing, run the selected tests
rather than repeating the entire gate.

The lane runner assumes eight concurrent jobs by default. It passes `MATE_TEST_JOBS=8` to its
children; the root Vitest configuration divides available cores, reserving one for the runner,
between those jobs. On an 18-core host that permits two workers per run. Set `MATE_TEST_JOBS=1`
for a standalone lane, or set it to the actual concurrent job count. An explicit Vitest
`--maxWorkers` still overrides the budget. Suites with `fileParallelism: false` remain serial.
HQ and scenario configurations own their PostgreSQL lifecycle separately.

For direct package runs on a shared host, set the same budget explicitly:

```sh
MATE_TEST_JOBS=8 vp test run src/some.test.ts
```

Direct runs without `MATE_TEST_JOBS`, including CI, retain Vitest's default worker count. A lower
worker count reduces memory and CPU contention; it can increase a standalone suite's wall time.
It does not constrain compiler or bundler threads, or parallel package commands.

The integrator runs `node scripts/ci-local.ts` once on the assembled change, plus the required
unit and scenario suites. Lanes should not also run that full check: it repeats guard scans,
package typechecks and production builds. GitHub Actions owns repository-wide validation; use
remote full-suite runs when many lanes share one laptop. The local script's `--list` shows its
steps, and words select individual steps when investigating a failure.

Scenario bundles are content-addressed and cached under
`node_modules/.cache/mate-scenario-web`. Use the workspace's installed tools consistently:
the key includes the Node version, so different host Vite+ runtimes build separate copies.
A cache miss builds once per scenario invocation, not once per file. Scenarios create fresh
HQ Core state and browser processes per fixture; sharing Core requires preserving test isolation.
Provider test fakes must exit when their input pipe closes, even when their worker is killed.
