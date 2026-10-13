# mate — Zerops Mate

Zerops Mate is a hard fork of T3 Code: a control surface for coding agents that live inside Zerops
project containers. A Node WebSocket server wraps provider CLIs and serves the hosted web bundle at
`/mate/` on the container's public origin. zcp installs the server from the fork's GitHub release
(package `zerops-mate`, executable `mate`; no npm-registry release) and supervises it as
`zerops@mate`. Users sign in with their Zerops account; nobody installs or pairs a container by hand.
The repository keeps web, desktop and mobile source; only the hosted web client is released.

**Upstream.** Most work never touches it. Never `git merge` or rebase onto `upstream/main`. Importing,
porting, or editing the imported or ported zones (`packages/effect-codex-app-server`,
`packages/effect-acp`, `apps/server/src/provider/**`, provider contracts) follows
[`docs/internals/zerops/fork.md`](docs/internals/zerops/fork.md) — read it first then.

**This machine.** Read `CLAUDE.local.md` when present (in a linked worktree, in the main checkout from
`git worktree list`): local tooling and access. It is local-only; never commit it or its credentials.

## Rules that hold everywhere

- **The client data layer is the only data path.** Read
  [`docs/internals/zerops/data-layer.md`](docs/internals/zerops/data-layer.md) before touching data
  flow, the menu, the HQ client, operations or Zerops reads.
- **Container first.** The container owns the code, provider credentials, zcp MCP tools, the server
  and durable work. Never design the primary path around a local server, a tunnel, a shared
  container secret or a desktop sidecar.
- **Zerops identity is the only door.** Manual pairing is gone; internal identity grants never become
  pairing credentials or an onboarding flow. Local client dev signs in with a Zerops account at the
  printed localhost origin; server integration uses a disposable Zerops container.
- **Performance without compromise.** People drive agents all day and notice dropped frames, lying
  spinners and stale labels. Watch websocket payload growth, needless list rerenders, CSS animation
  GPU cost and continuously repainting effects, especially on high-refresh displays.
- **mate and zcp are one product.** A change that crosses the container seam is a two-repo change;
  the contract is `../zcp/docs/spec-mate.md` §2.8. An unknown `mate serve` flag is fatal to every
  boot of the unit, so a new setting rides the launch environment, never a new flag zcp passes.

## Size the work, then verify

Name the tier before the first tool call. A tier's loop is the whole loop; a higher tier's rituals
are waste on a lower one.

- **Tweak** — the look of what exists: CSS, spacing, colour, copy, an icon, one component's layout.
  Grep the lines, edit, take one look cropped to the surface at the reference viewport (1786 × 1000, the
  menu at 435 px) in the theme the report names, `vp check` the files, one commit. No new test,
  harness, sampler, theme × shell matrix, ledger entry, subagent or release unless asked. A test
  that pinned the old class, pixel or colour is deleted, not updated.
- **Change** — behaviour: state, data, protocol, a new control. RED → GREEN on the logic
  (`*.logic.ts`, server, runtime), targeted `vp test run`, package typecheck, one live look for UI.
- **Pass** — a maintainer calls it a pass, or it redesigns several surfaces or lands a slice: the loop
  below.

The loop:

- Prepare a worktree: `cd "$(node scripts/prepare-worktree.ts <name>)"` (reuses an idle one, installs,
  checks readiness).
- Iterate with targeted `vp test run <files>`. Never repo-wide `vp check`, `vp run -r test` or
  `vp run -r typecheck` in a worktree: CI runs the full suites once per `main` head.
- When the change is complete, run `node scripts/gate-changed.ts` once: guard ledgers and repository
  invariants, `vp check` on touched files, incremental typechecks of touched packages and their
  dependents, owned unit tests, then edited scenario files plus a fixed state-only smoke (door,
  send, reload, approve,
  engine-secret and one sandbox case; no frame sampler). `--list` previews; `--base <ref>` changes
  the comparison. Then re-run only the failed files and the gate once more.
- `node scripts/ci-local.ts` (CI's Check job) only after touching guard ledgers, exceptions,
  `surfaces.json`, theme tokens or tooling. Whoever assembles several worktrees' work runs it plus
  the full unit and scenario suites before pushing.
- Rebase once, right before the push, and re-run only what the rebase changed in your files. A push
  rejected because `main` moved is rebased and pushed again without re-running.
- CI's Check job runs `vp check` repo-wide, ledger markdown included: a table row committed past
  the pre-commit hook leaves unaligned columns and a red job — `vp fmt` the file first.
- The server is event-sourced and async flows emit typed receipts: wait on receipts and worker
  drains, never on sleeps or polling.
- A live look runs in a test browser (`test-t3-app` for web, `test-t3-mobile` for mobile). Computer
  use on the person's own desktop needs their consent.

Shipping: a push to `main` deploys the hosted web client (mate.zerops.io), so `main` stays
releasable. A release is `node scripts/release-mate.ts` (`--minor` when the client's floor rises,
`--dry-run` prints the plan). Delivery to a running container is `../zcp/eval/scripts/mate-dev-push.sh`,
not a release; a container restart wipes a dev build.

## The three ways to hurt yourself

Most work runs through mate itself, often remotely, next to processes, data and dev servers that
belong to the person directing you.

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or kill a PID found by matching a name,
   path or worktree string: your own agent process has this worktree's path in its arguments, and
   the machine runs several dev servers. Kill only a PID captured at spawn, or the owner of your port
   from `ss -H -ltnp` after confirming `/proc/<pid>/cwd` is this worktree.
2. **Writing to the live install.** `~/.t3/userdata` is the developer's real database, in use while
   you work. Read and copy it; never start a server against it, open it read-write or clean it up.
3. **Baking in origins.** Never set `VITE_HTTP_URL` or `VITE_WS_URL` for dev. Dev is single-origin
   and Vite proxies `/api`, `/ws`, `/oauth` and `/.well-known`; setting them bakes localhost into the
   bundle and breaks remote browsers.

## Dev servers and test data

- `vp i` installs dependencies; worktrees get it from the `t3.json` setup script, so broken module
  resolution usually means it did not run.
- `vp run dev` starts server and web. In a worktree, state defaults to the worktree's gitignored
  `.t3`, which outranks an ambient `T3CODE_HOME`; an explicit `--home-dir` still wins. Ports derive
  from the worktree path; read the real ones from the `[dev-runner]` line, since occupied ports shift.
- Stop only what you started, by the PID you tracked.
- An empty database is a poor test. Seed `<worktree>/.t3/userdata` from `~/.t3/userdata` or
  `~/.t3/dev`: snapshot a live SQLite database with `VACUUM INTO` (a plain copy is safe only when no
  server has it open, and must include its WAL and SHM siblings). Bring `secrets` and
  `settings.json` only when the flow needs them. Copy in, never symlink: data flows into the
  sandbox, never back out.

## Hit every surface

Before calling frontend work done, decide which entries apply:

- **Entry points.** Behaviour reachable from chat is often also reachable from Settings, the command
  palette and a keybinding.
- **Clients.** Web, desktop and mobile source have separate navigation and presentation; shared
  logic lives in `packages/client-runtime`. A shared change needs a decision for desktop and mobile
  so they do not silently diverge; user docs never point people at upstream desktop or mobile apps.
- **Providers.** Codex, Claude, Cursor, Grok and OpenCode each have an adapter. A provider-shaped
  feature needs a decision per adapter, even when the product catalog hides one.
- **Contracts.** Anything crossing the wire is typed in `packages/contracts`; follow a schema change
  through server, web, mobile and desktop.
- **Reverse states.** A way in needs a way out and a way to see it.
- **Accounts.** Multi-device and multi-project cases are real.

## Where knowledge lives

This file is a map, not a knowledge store: it never caches a fact that lives in code, tests or
another document. To answer a question, go to the home:

| Knowledge                                                                     | Home                                                                       |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| The zcp↔mate seam                                                             | `../zcp/docs/spec-mate.md` §2.8                                            |
| Domain terms — Mate, HQ, application, environments, release and crew          | `docs/internals/zerops/primer.md`                                          |
| Runtime terms and architecture — thread, turn, decider, projector, reactor    | `docs/internals/glossary.md`                                               |
| Fork rules — zones, freeze, product constraints, upstream boundaries          | `docs/internals/zerops/fork.md`                                            |
| Provider runtime SPI boundary and ownership rules                             | `docs/internals/zerops/spi.md`                                             |
| Server services and thin transports                                           | `docs/internals/effect-services.md`                                        |
| Platform assumptions our code relies on                                       | `docs/internals/zerops/verified.md` or a comment beside the dependent code |
| Shared UI principles, copy glossary, tokens, guard rules and exception policy | `docs/internals/zerops/design-system.md`                                   |
| User-visible behaviour · runbooks                                             | `docs/user/` · `docs/operations/`                                          |
| Behaviour invariant                                                           | a test whose title is the product sentence                                 |

- A line in `docs/` must hold for something that does not exist yet: a rule across surfaces, a term,
  the zcp↔mate seam, a platform fact our code relies on. Anything about one surface, flow or
  component is a test (behaviour: its title is the product sentence, plus a one-line why when the
  owner decided against the obvious) or the code itself (look). Reasons and reversals go in the
  commit message.
- A rewrite keeps every test sentence: it changes how a test arranges its input, never what its title
  says. Deleting a sentence removes the behaviour and needs the owner's word: a
  `Drops-test: <exact title>` commit trailer, enforced by `scripts/check-test-sentences.ts`.
- A behaviour a person sees is tested against the surface's input (the record it reads → what it
  shows), so swapping the data source turns it red.
- A paragraph-sized doc entry is a list item, never a table row: the formatter pads every row to its
  table's widest cell.
- `verified.md` has one writer, the lead: helpers report facts as text and never edit it.
- Never commit plans, research notes or scratch files; `.plans/` is gitignored as a safety net.

## Where code lives

- `apps/server` — WebSocket, orchestration, providers, checkpointing. Read
  [Effect services](docs/internals/effect-services.md) before adding server code, and
  `.repos/effect-smol/LLMS.md` for the Effect library.
- `apps/web` — the React/Vite client; `apps/desktop` wraps it; `apps/mobile` is React Native.
- `packages/contracts` — Effect Schema contracts and small derived helpers; no heavy runtime logic.
- `packages/shared` — shared runtime utilities, subpath exports, no barrel.
- `packages/client-runtime` — client logic shared by web and mobile.
- `.repos/` — vendored read-only references: prefer their patterns, never edit or import from them;
  `vpr sync:repos` when bumping a matching dependency.
- Owned product code (Zerops, engine, HQ) and which zone each path is in: `fork.md` §3.

## Taste

- Prefer the smallest model that makes the correct behaviour unsurprising. Do not keep complexity
  because it exists, and add no machinery without a concrete constraint.
- Complexity belongs at the adapter boundary. Keep orchestration pure and UI dumb.
- Server features are services; transports stay thin. A `ws.ts` RPC handler, HTTP route or CLI
  command decodes input, calls one service method and maps errors.
- `apps/web/src/components/ui` exports own their look. Pick a `variant` or `size`; never restyle one
  with `className`. If none fits and the look is a generic concept, add a variant; a look that
  belongs to one feature stays in that feature's component. Layout classes (width, flex, margin,
  position) belong on the parent. `t3code/no-restyle` fails lint on a violation its exception
  ledger does not list.
- Tests pin behaviour — state, data, protocol, guards, what a render shows and what a click does —
  never a class string, a pixel or a colour: the owner judges the look by eye.
- A visual regression the owner reports gets a geometry witness for the relation that broke in the
  `owner-reported layout regressions` scenario suite, in the same change as its fix.
- TDD for behaviour: RED → GREEN, table-driven tests. Backend behaviour ships with focused tests.
- An invariant that matters goes into a deterministic check — a lint rule, a script, a test — with
  an exception ledger that may only shrink (the data-layer guards are the model).
- Any part can fail — HQ, a Mate's container, the Zerops platform, a provider. Defend reasonably:
  bounded waits, an honest state for the user, recovery when the part returns. No machinery for
  failures that have not happened or cost more than they save.
- Delete, don't disable: no commented-out code or compatibility shims.
- Prefer inferred types; never `any`. Comments say how something is used and move with the code.
- Security matters, but do not over-index on it for dev-mode or maintainer-only features.
- If a rule fights the task, state the conflict and get a maintainer's sign-off before breaking it.

## When something that is not your code fails

Accounts, APIs, credentials, infrastructure, tools. Classify by the evidence, then act; before each
attempt write one line, "hypothesis: … / test: …". Never repeat an identical action expecting a
different result, except in class B.

- **A — yours** (a server, database, browser, worktree, dependency or runtime you started, or a wrong
  path, ID or variable in your command): fix it and continue; each attempt changes something.
- **B — transient** (timeout, 5xx, 429, "at capacity", connection reset, DNS SERVFAIL): the same
  action up to three times in all, pausing ~10 s, 30 s, 90 s; still failing → D.
- **C — refused** (401/403, 404, 409, 422, "not found", "permission denied", a missing credential):
  read the whole error body, name the account, credential and target in use (never a secret's
  value), confirm with one read-only call. Your mistake → A; otherwise → D.
- **Unknown:** at most three distinct hypotheses, each tested once by the cheapest read-only probe.
- **D — park:** stop only the dependent steps, finish every independent one, and end with
  `BLOCKED: <step> — <exact error> — <class> — tried: <hypotheses> — need: <one concrete question>`.

Never a workaround, always D: another identity or authority (account, credential, organization,
token, permission), a target the task does not name, `--no-verify` / `--force`, a disabled check,
substitute infrastructure.

## Context is the cost

Every step re-sends the whole conversation, so a task keeps its context small.

- A parallel helper or a worktree is for a pass's independent part or a long read-only search,
  never for a tweak or a one-surface change.
- Hot files run 2–9k lines (`ChatView.tsx`, `index.css`, `SidebarZeropsTree.tsx`,
  `MessagesTimeline*`, `RunChat.tsx`) and so do reference files: grep the symbol, read the range.
- Command output shows failures only (`… 2>&1 | tail -40`); a screenshot is cropped to the surface,
  one per question.

## Commits and pull requests

- Atomic commits in English, conventional title in plain language; never a `Co-Authored-By` trailer.
- Never open a PR unless asked. One concern per PR; the body states the problem, then the fix, and
  ends with the model and harness used. UI changes need before/after images, motion a short video,
  uploaded to GitHub rather than committed. When babysitting, act on checks and comments newer than
  the last push, verify each against the source, fix real ones, explain dismissed ones, and stop when
  the bots are green on the latest commit. A merged PR is the implementation record; external
  proposals follow `CONTRIBUTING.md`.

## Maintaining this file

It earns a line only for a cross-cutting trap or a discipline that is not test- or spec-shaped; follow
"Where knowledge lives" for anything else. A fork rule belongs in `fork.md`; a platform fact beside
the code that relies on it or in a short `verified.md` entry with its verification command. When a home already
states a line, delete it here. `CLAUDE.md` imports this file; it holds only what applies to Claude
Code alone.
