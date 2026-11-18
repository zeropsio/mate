# Testing in this repository

The shared [testing rules](../testing-rules.md) say what may become a test; this file maps them to
this repository's checks, inputs and suites. Suites other than T1 run only when a maintainer asks
(`AGENTS.md`).

- T1 is `node scripts/t1.ts`: every unit's cases, whole, at every landing (a red case blocks; its
  time is printed) and in CI's `T1` job, which alone enforces the budget constant in that file and
  is required for a release. A wrong or flaky case is retired forward: one commit, on a card naming
  its id, removes the id from `SENTENCES.md` and deletes the case; it is never skipped or retried.

- Unit files are `*.unit.test.ts` directly beside a `SENTENCES.md`. `scripts/check-sentences.ts`,
  always in the gate, holds the list's format, the mapping of ids to cases, witness lines and
  admission, and prints the list's delta against the base. A landing names the ids it retires,
  changes or adds (`node scripts/land.ts --sentences PJ12,PJ40`); a delta that differs is refused.
  `scripts/witness-replay.ts <file>` replays a file's witnesses.
- Wire-shaped test input: `recorded(<schema>, <name>, edit?)` from `packages/test-recordings` (HQ
  from mate-hq conformance; written only by `scripts/sync-recordings.ts`, which keeps only the
  schemas this repository consumes).
- Test visible behaviour against the surface's input (record it reads → what it shows), so swapping
  data sources turns it red.
- Browser scenarios run against two test HQ instances behind one origin; per-area caps in
  `apps/web/test/scenarios/budget.json`, raised only by a maintainer.
- Maintainer-reported visual regressions get a geometry witness in the `owner-reported layout
  regressions` scenario suite, in the fix's change.
