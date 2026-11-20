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
  changes or adds (`node scripts/land.ts --sentences PJ12,PJ+1`); a delta that differs is refused.
  `scripts/witness-replay.ts <file>` replays a file's witnesses.
- A list starts `next: <PREFIX><n>`, the next free number; its sentences are `- <ID> — <sentence>`
  and each case title is `"<ID>: <sentence>"`. On `main` every id is numbered (`PJ12`). A branch
  never writes a final id: it adds `- PJ+<k> — <sentence>` with the case `"PJ+<k>: <sentence>"`
  (k = 1, 2, … within the list), never touches `next:`, and starts a new unit's list
  `next: <PREFIX>+`, its prefix a proposal. `check-sentences.ts --base` (the gate's run) refuses a
  branch that changes a `next:` line, adds a numbered id or starts a list otherwise.
  `SENTENCES.md merge=union` (`.gitattributes`) keeps the lines two branches append on rebase.
- `scripts/land.ts`, the only writer of `main`, numbers them after the gate passes on the rebased
  tree: a new list gets its proposed prefix when no other list holds it, else the first free of the
  proposal with one letter appended (up to four letters), then with its last letter replaced; each
  `<PREFIX>+<k>`, in k order, becomes the next number in its list line and its case title, and
  `next:` moves above it. It pushes this as one commit, `test: number the sentences this landing
  adds`, whose body lists each `<unit>: <old> → <new>`. A landing that stops after that commit
  without landing resets the branch to the commit before it.
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
