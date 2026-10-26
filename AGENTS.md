# mate — Zerops Mate

Zerops Mate is a hard fork of T3 Code: a control surface for coding agents in Zerops project
containers. A Node WebSocket server wraps provider CLIs, serving the hosted web bundle at `/mate/`
on the container's public origin. zcp installs the server from the fork's GitHub release (package
`zerops-mate`, executable `mate`; no npm-registry release), supervises it as `zerops@mate`.
Users sign in with their Zerops account; nobody installs or pairs a container by hand.
The repo keeps web, desktop and mobile source; only the hosted web client is released.

**Upstream.** Most work never touches it. Never `git merge` or rebase onto `upstream/main`. Before
importing, porting or editing imported/ported zones (`packages/effect-codex-app-server`,
`packages/effect-acp`, `apps/server/src/provider/**`, provider contracts), read and follow
[`docs/internals/zerops/fork.md`](docs/internals/zerops/fork.md).

**This machine.** Read `CLAUDE.local.md` when present (linked worktrees: main checkout from
`git worktree list`) for local tooling/access. Local-only; never commit it or its credentials.

## Rules that hold everywhere

- **The client data layer is the only data path.** Before touching data flow, the menu, the HQ client,
  operations or Zerops reads, read [`docs/internals/zerops/data-layer.md`](docs/internals/zerops/data-layer.md).
- **Container first.** The container owns code, provider credentials, zcp MCP tools, server and durable
  work. Never base the primary path on a local server, tunnel, shared container secret or desktop sidecar.
- **Zerops identity is the only door.** No manual pairing; internal identity grants never become pairing
  credentials or onboarding. Local client dev signs in with a Zerops account at the printed localhost
  origin; server integration uses a disposable Zerops container.
- **Performance without compromise.** All-day use exposes dropped frames, lying spinners and stale
  labels. Watch websocket payload growth, needless list rerenders, CSS animation GPU cost and
  continuously repainting effects, especially on high-refresh displays.
- **mate and zcp are one product.** Crossing the container seam means a two-repo change.
  Unknown `mate serve` flags kill every unit boot: new settings use
  the launch environment, never a new flag zcp passes.

## Size the work, then verify

Name the tier before the first tool call. Its loop is the whole loop; no higher-tier rituals.

- **Tweak** — existing look: CSS, spacing, colour, copy, icon, one component's layout. Grep, edit, one
  look cropped to the surface at the reference viewport (1786 × 1000, menu at 435 px) in the report's
  theme, `vp check` the files, one commit. No new test, harness, sampler, theme × shell matrix,
  ledger entry, subagent or release unless asked. Delete tests pinning the old class, pixel or colour;
  do not update them.
- **Change** — behaviour: state, data, protocol, new control. RED → GREEN on logic (`*.logic.ts`,
  server, runtime), targeted `vp test run`, package typecheck, one live look for UI.
- **Pass** — a maintainer calls it a pass, or it redesigns several surfaces or lands a slice: loop below.

The loop:

- Prepare a worktree: `cd "$(node scripts/prepare-worktree.ts <name>)"` (reuses an idle one, installs,
  checks readiness).
- Iterate: targeted `vp test run <files>`. Never repo-wide `vp check`, `vp run -r test` or
  `vp run -r typecheck` in a worktree; `main`, `kh-next` and `kh-bisect/**` CI run blocking verification; promotion to main
  reuses a green kh-next run for the same SHA.
- On completion, run `node scripts/gate-changed.ts` once: guard ledgers/repository invariants,
  touched-file `vp check`, incremental typechecks of touched packages and dependents, owned unit tests,
  without browser scenario files or fixed state-only smoke. `--with-scenarios` opts into selected
  scenarios and fixed smoke locally; `--scenarios <file...>` also includes named witnesses.
  `--list` previews; `--base <ref>` changes the comparison.
  About five minutes: one blocking command, timeout at least ten minutes, never detached and polled.
  Then re-run only failed files and the gate once more; it reuses passed stages on unchanged inputs.
  `--full` forces every selected stage to run.
- Browser scenario shards run in the non-blocking `Signal` workflow on `kh-next`,
  `kh-bisect/signal-**` and pull requests; other `kh-bisect/**` refs run CI only. Diagnostic and PR
  pushes cancel older runs of the same workflow/ref; integration runs finish. Signal
  failures get one same-commit rerun for classification. CI's required State Smoke runs sign-in,
  fixed state-only smoke and the uncapped affected scenario selection against the commit's base.
- CI's Check job runs repo-wide `vp check`, ledger markdown included. Local
  `node scripts/ci-local.ts` remains a manual diagnostic; the integrator certifies assembled work
  through fast/final CI. The formatter pads every table row to the table's widest
  cell; table rows committed past the pre-commit hook leave unaligned columns and a red job:
  `vp fmt` the file first.
- Agents push `wt/<card>`, never `main` or `kh-next`; the integrator verifies and promotes. Returned
  cards add commits, merging `kh-next` for conflicts; never force-push. Hotfixes may push `main`
  (rebase before pushing; re-run only what the rebase changed).
- The server is event-sourced; async flows emit typed receipts. Wait on receipts and worker drains,
  never sleeps or polling.
- Live looks use test browsers (`test-t3-app` web, `test-t3-mobile` mobile). Computer use on the person's
  own desktop needs their consent.

Shipping: push tested work to `wt/<card>` and stop; the integrator verifies and promotes to `main`,
which deploys the hosted web client (mate.zerops.io) through `zerops.yml`'s `prod` setup. That build
also packages the retained legacy HQ Core under `hq-core/`; the shared production HQ deploys from
mate-hq's `scripts/deploy-hq.ts`. Hotfixes may push `main`; keep it releasable.
Release: `node scripts/release-mate.ts` (`--minor` when the client's floor rises, `--dry-run` prints
the plan). Running-container delivery: `../zcp/eval/scripts/mate-dev-push.sh`, not a release;
container restart wipes a dev build.

## The three ways to hurt yourself

Most work runs through mate itself, often remotely, beside the directing person's processes, data
and dev servers.

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or kill a PID matched by name, path or
   worktree string: your agent's arguments contain this worktree's path; several dev servers run here.
   Kill only a PID captured at spawn, or your port's owner from `ss -H -ltnp` after confirming
   `/proc/<pid>/cwd` is this worktree.
2. **Writing to the live install.** `~/.t3/userdata` is the developer's real, active database. Read/copy
   it; never start a server against it, open it read-write or clean it up.
3. **Baking in origins.** Never set `VITE_HTTP_URL` or `VITE_WS_URL` for dev. Dev is single-origin;
   Vite proxies `/api`, `/ws`, `/oauth`, `/.well-known`. Those variables bake localhost into the bundle,
   breaking remote browsers.

## Dev servers and test data

- `vp i` installs dependencies; worktrees run it via the `t3.json` setup script. Broken module
  resolution usually means it did not run.
- `vp run dev` starts server/web. Worktree state defaults to its gitignored `.t3`, outranking ambient
  `T3CODE_HOME`; explicit `--home-dir` wins. Ports derive from the worktree path; occupied ports shift,
  so read actual ports from `[dev-runner]`.
- Stop only what you started, by the PID you tracked.
- Empty databases are poor tests. Seed `<worktree>/.t3/userdata` from `~/.t3/userdata` or `~/.t3/dev`:
  snapshot live SQLite with `VACUUM INTO`. A plain copy is safe only when no server has the DB open,
  and must include its WAL/SHM siblings. Bring `secrets`/`settings.json` only if the flow needs them.
  Copy in, never symlink: data flows into the sandbox, never back out.

## Hit every surface

Before calling frontend work done, decide which apply:

- **Entry points.** Chat behaviour is often also reachable from Settings, command palette, keybinding.
- **Clients.** During the test phase only the hosted web client and HQ are in use. Desktop and mobile
  source stay in the repository and must keep compiling (the gate typechecks them; CI still runs their
  jobs); no per-client behaviour decision until a maintainer reopens them.
- **Providers.** Codex, Claude, Cursor, Grok and OpenCode each have an adapter. Provider-shaped features
  need a decision per adapter, even when the product catalog hides one.
- **Contracts.** Anything crossing the wire is typed in `packages/contracts`; follow schema changes
  through server, web, mobile and desktop.
- **Reverse states.** A way in needs a way out and a way to see it.
- **Accounts.** Multi-device and multi-project cases are real.

## Where knowledge lives

This file is a map, never a cache of facts from code, tests or other documents.
To answer a question, go to the home:

- The zcp↔mate seam → `../zcp/docs/spec-mate.md` §2.8.
- Domain terms — Mate, HQ, application, environments, release and crew → `docs/internals/zerops/primer.md`.
- Runtime terms and architecture — thread, turn, decider, projector, reactor → `docs/internals/glossary.md`.
- Fork rules — zones, freeze, product constraints, upstream boundaries → `docs/internals/zerops/fork.md`.
- Provider runtime SPI boundary and ownership rules → `docs/internals/zerops/spi.md`.
- Server services and thin transports → `docs/internals/effect-services.md` (Effect services);
  read before adding server code.
- Platform assumptions our code relies on → `docs/internals/zerops/verified.md` or a comment beside the dependent code.
- Shared UI principles, copy glossary, tokens, guard rules and exception policy → `docs/internals/zerops/design-system.md`.
- User-visible behaviour · runbooks → `docs/user/` · `docs/operations/`.
- Behaviour invariant → a test whose title is the product sentence.

- `docs/` lines must hold for something not yet existing: cross-surface rule, term, zcp↔mate seam,
  platform fact our code relies on. One surface/flow/component belongs in tests (behaviour: title is
  the product sentence; one-line why when the owner decided against the obvious) or code (look).
  Reasons/reversals belong in the commit message.
- Rewrites keep every test sentence: change input arrangement, never what its title says. Deleting
  a sentence removes behaviour and needs the owner's word: `Drops-test: <exact title>` commit trailer,
  enforced by `scripts/check-test-sentences.ts`.
- Test visible behaviour against the surface's input (record it reads → what it shows), so swapping
  data sources turns it red.
- Paragraph-sized doc entries are list items, never table rows.
- `verified.md` has one writer, the lead; helpers report facts as text, never edit it.
  Platform-fact entries are short and carry their verification command.
- Never commit plans, research notes or scratch files; `.plans/` is gitignored as a safety net.

## Where code lives

- `apps/server` — WebSocket, orchestration, providers, checkpointing. For Effect, read `.repos/effect-smol/LLMS.md`.
- `apps/web` — React/Vite client; `apps/desktop` wraps it; `apps/mobile` — React Native.
- `packages/contracts` — Effect Schema contracts, small derived helpers; no heavy runtime logic.
- `packages/shared` — shared runtime utilities, subpath exports, no barrel.
- `packages/client-runtime` — web/mobile shared client logic.
- `.repos/` — vendored read-only references: prefer their patterns, never edit/import from them;
  `vpr sync:repos` when bumping a matching dependency.
- Owned product code (Zerops, engine, HQ) and path zones: `fork.md` §3.

## Taste

- Prefer the smallest model making correct behaviour unsurprising. Do not keep complexity just because
  it exists; no machinery without a concrete constraint.
- Complexity belongs at the adapter boundary; pure orchestration, dumb UI.
- Server features are services; thin transports. A `ws.ts` RPC handler, HTTP route or CLI command
  decodes input, calls one service method, maps errors.
- `apps/web/src/components/ui` exports own their look: pick a `variant`/`size`, never restyle with
  `className`. If none fits, generic looks get a variant; feature-specific looks stay in that feature's
  component. Layout classes (width, flex, margin, position) belong on the parent. `t3code/no-restyle`
  fails lint on violations absent from its exception ledger.
- Tests pin behaviour (state, data, protocol, guards, render output, click effects), never class
  strings, pixels or colours; the owner judges looks by eye.
- Owner-reported visual regressions get a geometry witness for the broken relation in the
  `owner-reported layout regressions` scenario suite in the Signal tier, in the fix's change.
- Behaviour TDD: RED → GREEN, table-driven tests. Backend behaviour ships with focused tests.
- Important invariants get deterministic checks (lint rule, script, test) with an exception ledger
  that may only shrink; data-layer guards are the model.
- Any part can fail — HQ, a Mate's container, the Zerops platform, a provider. Defend reasonably:
  bounded waits, honest user state, recovery when the part returns. No machinery for failures not yet
  encountered or costing more than they save.
- Delete, don't disable: no commented-out code or compatibility shims.
- Prefer inferred types; never `any`. Comments explain use and move with code.
- Security matters; do not over-index for dev-mode or maintainer-only features.
- If a rule fights the task, state the conflict and get a maintainer's sign-off before breaking it.

## When something that is not your code fails

Accounts, APIs, credentials, infrastructure, tools: classify by evidence, then act. Before each
attempt write "hypothesis: … / test: …" on one line. Never repeat an identical action expecting a
different result, except class B.

- **A — yours** (server, database, browser, worktree, dependency or runtime you started,
  or a wrong path, ID or variable in your command): fix and continue; each attempt changes something.
- **B — transient** (timeout, 5xx, 429, "at capacity", connection reset, DNS SERVFAIL): same action
  up to three times in all, pausing ~10 s, 30 s, 90 s; still failing → D.
- **C — refused** (401/403, 404, 409, 422, "not found", "permission denied", missing credential): read
  the whole error body, name the account, credential and target in use (never a secret's value),
  confirm with one read-only call. Your mistake → A; otherwise → D.
- **Unknown:** at most three distinct hypotheses, each tested once by the cheapest read-only probe.
- **D — park:** stop only dependent steps, finish every independent one, end with
  `BLOCKED: <step> — <exact error> — <class> — tried: <hypotheses> — need: <one concrete question>`.

Never a workaround, always D: another identity/authority (account, credential, organization, token,
permission), a target the task does not name, `--no-verify` / `--force`, disabled check,
substitute infrastructure.

## Context is the cost

Every step re-sends the whole conversation: keep task context small.

- Parallel helpers/worktrees are for a pass's independent part or long read-only search, never a
  tweak or one-surface change.
- Hot files (`ChatView.tsx`, `index.css`, `SidebarZeropsTree.tsx`, `MessagesTimeline*`, `RunChat.tsx`)
  and reference files run 2–9k lines: grep the symbol, read the range.
- Output: failures only (`… 2>&1 | tail -40`). Screenshots: crop to surface, one per question.

## Commits and pull requests

- Atomic English commits, conventional plain-language title; never a `Co-Authored-By` trailer.
- Never open a PR unless asked. One concern per PR; body: problem, fix; end with model/harness used.
  UI changes need before/after images, motion a short video; upload to GitHub, never commit.
  Babysitting: act on checks/comments newer than the last push, verify each against source, fix real
  ones, explain dismissed ones, stop when bots are green on the latest commit. Merged PRs are the
  implementation record; external proposals follow `CONTRIBUTING.md`.

## Maintaining this file

Only cross-cutting traps or disciplines not test-/spec-shaped earn a line; otherwise follow "Where
knowledge lives". Delete lines already stated at their home. `CLAUDE.md` imports
this file and holds only Claude Code-specific instructions.
