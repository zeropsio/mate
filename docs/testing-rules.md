# Testing rules

Part of the [engineering rules](engineering-rules.md) (§4), shared by `zeropsio/mate`,
`zeropsio/zcp` and `zeropsio/mate-hq`, and binding exactly as they do. Which suites run, and when,
is each repository's own decision; its `AGENTS.md` says, and its own testing doc maps these rules
to its fixtures, checks and live program. Read this file before adding, changing, removing or
running a test, a recording or test machinery.

- **A test is a sentence.** A unit is a package whose `SENTENCES.md` lists `<id> — <sentence>`
  lines: product sentences, or wire, persistence or security invariants. One test per id, every
  test names one id, and a new test needs a new line a maintainer can refuse. A suite that is not a
  unit gets no new case unless a maintainer asks for it; an area becomes units only on a
  maintainer's word. The list's first line names the next free id (`next: <prefix><n>`); every id
  carries the unit's own prefix and a number below it, and an id is never reused. A case with no
  sentence and a sentence with no case both fail the static check.
- **One witness per case.** Above the case stands `witness: <product file> | <old> → <new>`: a
  one-line change of product code that turns the case red on an assertion, never on a compile
  error. The commit that adds the case shows that red once in its body. Witnesses are replayed on
  every arrival; no case is admitted on a green run alone.
- **A case earns its place** by catching a plausible bug that would hurt a person or another part
  of the system: a flipped condition, a dropped field, a wrong order or bound. Its sentence names
  that break. Sabotage (returning nothing, panicking) is no witness. When an existing case already
  fails on the witness, the new case is a duplicate and is not added.
- **Nothing in product code exists for a test.** No branch, parameter, export or flag whose only
  reader is a test or its witness. A behaviour that can be tested only end to end is a design
  defect: move the decision into a function the product itself calls.
- **Inputs and expectations.** Literals or recordings go in; expected values come from the spec or
  the task, never from running the code. Never assert copy, pixels, class names, mock call counts,
  unread state, harness glue, or the behaviour of a library or the platform.
- **Where a test lives follows the code:** a decision is tested on literals; our own store on the
  repository's one store fixture; a seam to something we do not own on recordings of the real
  thing, written by a live contract; the composed system by a short, capped list of live journeys.
  A library's or the platform's own behaviour is a verified platform fact or a recording, never a
  case.
- **A unit's tests stay inside the process,** in the unit's package: literals, temporary files, an
  injected clock, an in-process handler call, the repository's one store fixture and committed
  recordings; no started process, listener, network call, external tool, sleep or wall-clock read.
  Concurrency is forced by a held lock or a receipt.
- **Recordings** are written only against the real system, carry the steps that reproduce them and
  are decoded through the consumer's real schema. One that no longer decodes is recorded again,
  never edited.
- **A bug** first fixes the missing or wrong sentence. A test the bug slipped past is replaced, not
  joined.
- **A removed test is named** in a commit trailer: `Drops-test-file: <path>` for a whole file, or
  `Drops-test: <title> — <class>` with the class one of `copy`, `duplicate`, `fake-input`, `mock`,
  `dead`, `library`, `trivia`, `harness` or `reworded`; `reworded` also needs a replacement case
  carrying the same witness. Where a repository's check compares a unit's cases to its list
  (`zeropsio/mate`), the list's diff is the record of a retired or changed sentence, and no trailer
  is written for it.
- **No new test machinery** (harness, fixture server, check) without a maintainer's word.
