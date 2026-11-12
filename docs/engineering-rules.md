# Engineering rules

Zerops Mate is built in three repositories: `zeropsio/mate` (this one: the Mate server and the web
client), `zeropsio/zcp` (the container side) and the private `zeropsio/mate-hq` (HQ, the control
plane). These rules bind every change to any of them, by a person or by an agent. This file is
their only home: each repository's `AGENTS.md` points here and adds only its own map, commands and
traps. When a rule here or there fights the task, state the conflict and get a maintainer's word
before breaking it.

Another repository's file is written `zeropsio/<repo>:<path>`. Read it from your own checkout of
that repository, or from GitHub.

## 1. Architecture has one owner

- The conceptual architecture is `zeropsio/mate-hq:docs/architecture/`: which concepts exist and
  what they are called, which system owns each stored fact and each decision, where the trust
  boundaries run. HQ's wire is `zeropsio/mate-hq:spec/protocol.md`. The zcp↔Mate seam is
  `zeropsio/zcp:docs/spec-mate.md`; its §2.8 is the contract. Code follows these documents. A change
  that needs one of them to say something else changes the document first, in the same landing.
- Read the owning page before a change that adds or alters a domain concept, a stored fact (table,
  column, file, cache), a decision (who owns, who may act, role, membership, access), a credential,
  or a message between two systems.
- Without access to `zeropsio/mate-hq`, add none of those: say what the change needs and ask a
  maintainer. The public contracts in this repository and in the zcp spec cover everything else.
- A change that crosses a seam changes every repository on it: the owning spec first, then each
  side. A seam change that leaves one side on the old contract is unfinished.

## 2. One name, one owner, one source

- **One name and one type per concept**, defined where its owner lives and in the vocabulary:
  `zeropsio/mate-hq:docs/architecture/vocabulary.md` for the system's concepts, this repository's
  [domain terms](internals/zerops/primer.md) and [runtime terms](internals/glossary.md) for the
  words its public contracts use. Where the HQ vocabulary and the domain terms both define a term,
  the HQ vocabulary decides and the domain term is corrected in the same change. Code, tests and
  docs use that name. A new concept lands with its vocabulary line in the same change. Add no
  concept that neither the task nor the existing code has; every new distinction needs evidence in
  a source.
- **One owner per fact.** Before storing anything, find who already owns that fact. A second table,
  column, file or cache for a fact that has an owner is a defect, in whichever system it sits.
  Readers go through the owner.
- **One derivation per verdict.** A domain answer (an owner, a role, an access decision, the state
  of a change) is computed in one place; consumers read that answer and never recompute it.
- **One interface per replaceable source.** Every domain decision sits behind one interface in the
  domain's own terms, in one module; what answers it (an HQ record, the Zerops API, a Mate's own
  list) is one implementation chosen in one wiring place. The same holds for every part we do not
  own or may replace: the Zerops API, object storage, Git, a provider, the clock. No consumer
  imports a source directly. No interface where nothing is swapped or faked.
- **Two surfaces that state one fact:** find the second and delete it. Never keep copies in sync.

## 3. The change itself

- **Root cause first.** Name the cause, the invariant it broke and the single place that owns the
  fix; repair that owner and remove the patches callers grew around it.
- **A design that cannot work by its nature stops.** When a source or credential the behaviour
  needs does not exist, say so and let a maintainer choose: provide what is missing, solve it
  another way, or drop the case. Never ship a mechanism that is right only sometimes.
- **The smallest thing that is correct.** Prefer deleting and simplifying on existing foundations.
  Each new mechanism (abstraction, flag, cache, timer, retry layer) is justified in one line of the
  commit message. Current requirements only.
- **Delete, don't disable.** No commented-out code, no "just in case" flag, no shim. Stale code,
  docs and rules are deleted, never shortened, marked superseded or kept for reference: history is
  git.
- **Follow the chain, leave no orphans.** Removing or changing something cleans up every reference
  (variables, parameters, view data, imports, config keys) in the same change. Nothing written but
  never read, no uncalled function, no component without a live consumer.
- **No compatibility code for our own data and deployments.** No branch for old rows or old state,
  no backfill job, no code for old and new instances running side by side. When a change gives
  existing data a shape the new code does not accept, its description lists that data and the new
  shape; maintainers bring the data over by hand when the change goes live, stopping the service
  if they must. A seam between independently released parts keeps exactly the version rules its
  owning spec states, and no others.
- **Atomic commits.** Each compiles, runs and makes sense on its own. English, a conventional
  plain-language title, reasons and reversals in the body, no `Co-Authored-By` trailer.

## 4. Tests

Which suites run, and when, is each repository's own decision; its `AGENTS.md` says. What may
become a test is the same everywhere.

- **A test is a sentence.** A unit is a package whose `SENTENCES.md` lists `<id> — <sentence>`
  lines: product sentences, or wire, persistence or security invariants. One test per id, every
  test names one id, and a new test needs a new line a maintainer can refuse. A suite that is not a
  unit gets no new case unless a maintainer asks for it; an area becomes units only on a
  maintainer's word.
- **One witness per case.** Above the case stands `witness: <product file> | <old> → <new>`: a
  one-line change of product code that turns the case red on an assertion, never on a compile
  error. The commit that adds the case shows that red once in its body.
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
  thing; the composed system by a short, capped list of live journeys.
- **A unit's tests stay inside the process:** no started process, listener, network call, external
  tool, sleep or wall-clock read. Concurrency is forced by a held lock or a receipt.
- **Recordings** are written only against the real system, carry the steps that reproduce them and
  are decoded through the consumer's real schema. One that no longer decodes is recorded again,
  never edited.
- **A bug** first fixes the missing or wrong sentence. A test the bug slipped past is replaced, not
  joined.
- **A removed test is named** in a commit trailer: `Drops-test-file: <path>` for a whole file, or
  `Drops-test: <title> — <class>` with the class one of `copy`, `duplicate`, `fake-input`, `mock`,
  `dead`, `library`, `trivia`, `harness` or `reworded`; `reworded` also needs a replacement case
  carrying the same witness.
- **No new test machinery** (harness, fixture server, check) without a maintainer's word.

## 5. Verify and deliver

- **Run the repository's gate** (its `AGENTS.md` names it) once, to the end, before pushing. `main`
  feeds production: a red gate is never passed by `--no-verify`, `--force`, or a skipped or disabled
  check.
- **Exercise the change** through the behaviour it changes, locally or in a disposable environment,
  and write what was done and seen in the commit or the pull request. A change that can refuse or
  break a person's operation (a Git push, merge or review, a Mate's link) reaches production only
  after that check has passed.
- **A refusal is not routed around.** No other identity, credential, organisation or target than
  the task gave: stop the dependent step and ask.

## 6. Knowledge and secrets

- **Knowledge has one home.** Each `AGENTS.md` is a map of homes, never a cache of facts. A change
  updates the home it touches in the same commit: the vocabulary, the architecture page, the spec
  section, the verified platform fact. Behaviour is a test's sentence; reasons and reversals are
  the commit message. Never commit a plan, research note or scratch file.
- **Platform facts** come from the Zerops documentation or a live check, never from memory.
- **English** in code, comments, docs and commit messages.
- **References work from any checkout.** Never a path that leaves the repository, a home directory
  or one machine's layout.
- **The public repositories** (`mate`, `zcp`) never name a customer, organisation, project or
  person, an internal host or id, or a private repository's internals beyond a pointer to its
  documentation.
- **Credentials** are never printed, echoed, committed or pasted, and never read out of a file by a
  shell command.
