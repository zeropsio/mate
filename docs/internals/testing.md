# Testing in this repository

The shared [testing rules](../testing-rules.md) say what may become a test; this file maps them to
this repository's checks, inputs and suites. Tests run only when a maintainer asks (`AGENTS.md`).

- Unit files are `*.unit.test.ts` directly beside a `SENTENCES.md`. `scripts/check-sentences.ts`,
  always in the gate, holds the list's format, the mapping of ids to cases, witness lines and
  admission, and prints the list's delta against the base. `scripts/check-test-sentences.ts` still
  runs only with `--tests` until it is removed; `scripts/witness-replay.ts <file>` replays a file's
  witnesses.
- Wire-shaped test input: `recorded(<schema>, <name>, edit?)` from `packages/test-recordings` (HQ
  from mate-hq conformance; written only by `scripts/sync-recordings.ts`, which keeps only the
  schemas this repository consumes). Casts and annotations to contract types in tests only decrease
  (`scripts/check-test-inputs.ts`).
- Test visible behaviour against the surface's input (record it reads → what it shows), so swapping
  data sources turns it red.
- Browser scenarios run against two test HQ instances behind one origin; per-area caps in
  `apps/web/test/scenarios/budget.json`, raised only by a maintainer.
- Maintainer-reported visual regressions get a geometry witness in the `owner-reported layout
  regressions` scenario suite, in the fix's change.
