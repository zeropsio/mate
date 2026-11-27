# Testing in this repository

The shared [testing rules](../testing-rules.md) say what may become a test; this file maps them to
this repository's checks, inputs and suites. Suites other than T1 run only when a maintainer asks
(`AGENTS.md`).

- T1 is `node scripts/t1.ts`: every unit's cases, whole, at every landing and in CI's `T1` job.
  The gate and CI run it with the budget constant in that file; a red case or an over-budget run
  blocks. A wrong or flaky case is retired forward: one commit, on a card naming
  its id, removes the id from `SENTENCES.md` and deletes the case; it is never skipped or retried.
- The gate (`scripts/gate-changed.ts`) and CI's required jobs run the same stage table. T1, the
  sentence check, guard ledgers and the repository guards run on every diff. Other stages run when
  the diff touches their inputs: these include workflow schema, lockfile policy, release smoke,
  typecheck, the runtime cycle ratchet, the web build and the server pack. The web build takes the
  switches of the `prod` setup in `zerops.yml`, including the service worker and the design
  harness, and fails if they are missing. CI runs the stages against its clean checkout.

- Unit files are `*.unit.test.ts` directly beside a `SENTENCES.md`. `scripts/check-sentences.ts`,
  always in the gate, holds the list's format, the mapping of ids to cases, witness lines and
  admission, and prints the list's delta against the base. A landing reads the delta from the branch
  and checks its lists before numbering them.
  `scripts/witness-replay.ts <file>` replays a file's witnesses.
- The server's engine cases that need the store run on `engineDatabase`
  (`apps/server/src/engine/testing/fixtures.ts`): the engine's migrated tables on an in-process
  SQLite, in memory, or on a temporary file when a case spans a restart (two lifetimes over one
  file). A failing write is forced by a SQLite trigger the case creates, never by a product hook.
- A list starts `next: <PREFIX><n>`, the next free number; its sentences are `- <ID> — <sentence>`
  and each case title is `"<ID>: <sentence>"`. A branch never writes a final id: it adds
  `- PJ+<k> — <sentence>` with the case `"PJ+<k>: <sentence>"`
  (k = 1, 2, … within the list), never touches `next:`, and starts a new unit's list
  `next: <PREFIX>+`, its prefix a proposal. `check-sentences.ts --base` (the gate's run) refuses a
  branch that changes a `next:` line, adds a numbered id or starts a list otherwise; CI applies it
  to pull requests and the landing to its branch's rebased tree, refusing it `gate`.
  `SENTENCES.md merge=union` (`.gitattributes`) keeps the lines two branches append on rebase;
  lane-local ids identify their sentences by both id and text, so the same id with different text
  may occur twice in one list, but the same id and text may not.
- A pull request merged on `main` leaves its lane-local ids there. `scripts/land.ts`, the only
  giver of final ids, numbers all lane-local ids on the branch's tree rebased onto
  `origin/main` once that tree passes the branch rule (again after a rebase onto a `main` that
  moved while it queued): a new list gets its proposed prefix when no other list holds
  it, else the first free of the proposal with one letter appended (up to four letters), then with
  its last letter replaced; each `<PREFIX>+<k>`, in list order, becomes the next number in its list
  line and its case title, and `next:` moves above it. It amends this into the branch's last
  commit, whose body gains each `<unit>: <old> → <new>`, never a commit of its own. Its gate judges
  the numbered tip with `check-sentences.ts --base <base> --landing`, which applies the landing
  rule instead of the branch rule the numbering breaks: every id is final, a list keeps its
  prefix, the ids it adds run on from the base's `next:` without a gap (from 1 in a new list), and
  `next:` stands right past them. The landing delta treats base placeholders that were numbered as
  renamings, not additions by the branch. A landing that stops after numbering without
  landing resets the branch to its rebased commit before the numbers.
- Wire-shaped input a unit reads as its producer sent it comes from
  `recorded(<schema>, "<producer>/<name>")` (`packages/client-runtime/src/data/__fixtures__/recorded.ts`).
  It decodes a committed recording through the consumer's schema for the wire name in its header.
  `scripts/sync-recordings.ts` is the only writer of `__fixtures__/recordings/mate-hq/`. It copies
  files byte for byte from `zeropsio/mate-hq:recordings/answers/` at `.mate-hq-ref`. A landing that
  moves the pin or a copy is refused while a copy differs from mate-hq at the pin. See “Answers for the public
  repository” in `zeropsio/mate-hq:docs/architecture/testing.md` for how they are recorded.
  A recording that no longer decodes is recorded again there, never edited here. Copy a recording
  only in the card whose case reads it.
- Test visible behaviour against the surface's input (record it reads → what it shows), so swapping
  data sources turns it red.
- Model catalogue entries are configuration. Validate their schema; do not pin individual names,
  aliases, badges, version boundaries or profile assignments in tests. Test changes to catalogue
  semantics with synthetic providers and model names.
