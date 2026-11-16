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
- **No borrowed duties.** A duty never moves onto a part, credential or person whose primary job
  it is not (for example any member's token proving a fact for an operation nobody started). Like a
  cache or a polling loop it is never automatic and never proposed as a solution; at most a
  maintainer is told it exists as a conscious last-resort hack. Where the source a behaviour needs
  is missing, it is a gap: the rule above.
- **The smallest thing that is correct.** The smallest model that makes correct behaviour
  unsurprising; no machinery without a concrete constraint. Prefer deleting and simplifying on
  existing foundations. Each new mechanism (abstraction, flag, cache, timer, retry layer) is
  justified in one line of the commit message. Current requirements only; remove shallow wrappers
  that add caller knowledge.
- **Delete, don't disable.** No commented-out code, no "just in case" flag, no shim. Stale code,
  docs and rules are deleted, never shortened, marked superseded or kept for reference: history is
  git.
- **Follow the chain, leave no orphans.** Removing or changing something cleans up every reference
  (variables, parameters, view data, imports, config keys) in the same change. Nothing written but
  never read, no uncalled function, no component without a live consumer: delete them in the same
  change, never polish them.
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
become a test, where it lives and how it is witnessed and removed is the same everywhere:
[testing rules](testing-rules.md), read before adding, changing, removing or running a test.

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
- **When something that is not your code fails** (accounts, APIs, credentials, infrastructure,
  tools), classify by evidence, then act. Before each attempt write "hypothesis: … / test: …" on
  one line. Never repeat an identical action expecting a different result, except class B.
  - **A — yours** (something you started, or a wrong path, ID or variable in your command): fix and
    continue; each attempt changes something.
  - **B — transient** (timeout, 5xx, 429, "at capacity", connection reset, DNS SERVFAIL): same
    action up to three times, pausing ~10 s, 30 s, 90 s; still failing → D.
  - **C — refused** (401/403, 404, 409, 422, "not found", "permission denied", missing credential):
    read the whole error body, name the account, credential and target in use (never a secret's
    value), confirm with one read-only call. Your mistake → A; otherwise → D.
  - **Unknown:** at most three distinct hypotheses, each tested once by the cheapest read-only probe.
  - **D — park:** stop only dependent steps, finish every independent one, end with
    `BLOCKED: <step> — <exact error> — <class> — tried: <hypotheses> — need: <one concrete
    question>`. Whatever this section forbids, and substitute infrastructure, is never worked
    around: it goes to D.

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
