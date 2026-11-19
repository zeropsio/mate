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
- Wire-shaped input a unit reads as its producer sent it comes from
  `recorded(<schema>, "<producer>/<name>")` (`packages/client-runtime/src/data/__fixtures__/recorded.ts`).
  It decodes a committed recording through the consumer's schema for the wire name in its header.
  `scripts/sync-recordings.ts` is the only writer of `__fixtures__/recordings/mate-hq/`. It copies
  files byte for byte from `zeropsio/mate-hq:recordings/answers/`. See “Answers for the public
  repository” in `zeropsio/mate-hq:docs/architecture/testing.md` for how they are recorded.
  A recording that no longer decodes is recorded again there, never edited here. Copy a recording
  only in the card whose case reads it.
- Test visible behaviour against the surface's input (record it reads → what it shows), so swapping
  data sources turns it red.
