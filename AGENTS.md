# mate — Zerops Mate

Zerops Mate is a hard fork of T3 Code: a control surface for coding agents in Zerops project
containers. A Node WebSocket server in each container drives provider CLIs and serves the web client
at `/mate/`; zcp installs it from this repo's GitHub release.

**Upstream.** Never `git merge` or rebase onto `upstream/main`. Before importing, porting or editing
imported/ported zones, read and follow [`docs/internals/zerops/fork.md`](docs/internals/zerops/fork.md).

**This machine.** Read `CLAUDE.local.md` when present (linked worktrees: the main checkout's, from
`git worktree list`), and any owner file it names; it holds this machine's tooling, access and
delivery. Local-only: never commit it or its credentials.

## Rules that hold everywhere

- **The client data layer is the only data path.** Before touching data flow, the menu, the HQ client,
  operations or Zerops reads, read [`docs/internals/zerops/data-layer.md`](docs/internals/zerops/data-layer.md).
- **Container first.** The container owns code, provider credentials, zcp MCP tools, server and durable
  work. Never base the primary path on a local server, tunnel, shared container secret or desktop sidecar.
- **Zerops identity is the only door.** No manual pairing; internal identity grants never become pairing
  credentials or onboarding. Local dev signs in with a Zerops account at
  the printed localhost origin; server integration runs in a disposable Zerops container.
- **Performance without compromise.** Watch websocket payload growth, needless list rerenders and
  continuously repainting effects, especially on high-refresh displays.
- **mate and zcp are one product.** Crossing the container seam means a two-repo change. Unknown
  `mate serve` flags kill every unit boot: new settings use the launch environment, never a new flag.

## Size the work, then verify

Name the tier before the first tool call. Its loop is the whole loop; no higher-tier rituals.

- **Tweak** — existing look: CSS, spacing, colour, copy, icon, one component's layout. Grep, edit, one
  look cropped to the surface at the reference viewport (1786 × 1000, menu at 435 px) in the report's
  theme, `vp check` the files, one commit. Nothing extra (test, harness, matrix, ledger entry,
  subagent, release) unless asked. Delete tests pinning the old class, pixel or colour; do not update them.
- **Change** — behaviour: state, data, protocol, new control. RED → GREEN on logic (`*.logic.ts`,
  server, runtime), targeted `vp test run`, package typecheck, one live look for UI.
- **Pass** — a maintainer calls it a pass, or it redesigns several surfaces or lands a slice: loop below.

The loop:

- Prepare a worktree: `cd "$(node scripts/prepare-worktree.ts <name>)"`.
- Iterate with targeted `vp test run <files>`. Never repo-wide `vp check`, `vp run -r test` or
  `vp run -r typecheck` in a worktree.
- On completion run `node scripts/gate-changed.ts` once (`--help` for flags, `--list` previews): one
  blocking command, timeout at least ten minutes, never detached and polled. Then re-run only failed
  files, and the gate once more; it reuses passed stages.
- CI runs blocking verification on `main`, `kh-next`, `kh-bisect/**` and pull requests (a newer push
  cancels older runs except on `main`; `kh-next` is the integration branch that fast-forwards `main`);
  browser scenario shards run in the non-blocking `Signal` workflow, where a failure gets one
  same-commit rerun to tell a flake from a regression.
- Markdown tables: `vp fmt` the file before committing; unaligned rows fail CI's Check job.
- The server is event-sourced; async flows emit typed receipts. Wait on receipts and worker drains,
  never sleeps or polling.
- Live looks use test browsers (`test-t3-app` web, `test-t3-mobile` mobile). Computer use on the
  person's own desktop needs their consent.

`main` deploys the hosted web client (mate.zerops.io) through `zerops.yml`'s `prod` setup.
Release, staging, HQ and container delivery: `docs/operations/release-and-deploy.md`;
contributors follow `CONTRIBUTING.md`.

## The three ways to hurt yourself

Work often runs through mate itself, beside the directing person's processes, data and dev servers.

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or kill a PID matched by name, path or
   worktree string: your agent's arguments contain this worktree's path; several dev servers run
   here. Kill only a PID captured at spawn, or your port's owner after confirming its cwd is this
   worktree: Linux `ss -H -ltnp` and `/proc/<pid>/cwd`; macOS `lsof -nP -iTCP:<port> -sTCP:LISTEN`
   and `lsof -a -p <pid> -d cwd`.
2. **Writing to the live install.** `~/.t3/userdata` is the developer's real, active database. Read/copy
   it; never start a server against it, open it read-write or clean it up.
3. **Baking in origins.** Never set `VITE_HTTP_URL` or `VITE_WS_URL` for dev. Dev is single-origin;
   Vite proxies `/api`, `/ws`, `/oauth`, `/.well-known`. Those variables bake localhost into the bundle,
   breaking remote browsers.

## Dev servers and test data

- Broken module resolution usually means `vp i` did not run.
- `vp run dev` starts server/web. Worktree state defaults to its gitignored `.t3`, outranking ambient
  `T3CODE_HOME`; explicit `--home-dir` wins. Ports derive from the worktree path; occupied ports shift,
  so read actual ports from `[dev-runner]`.
- Empty databases are poor tests. Seed `<worktree>/.t3/userdata` from `~/.t3/userdata` or `~/.t3/dev`:
  snapshot live SQLite with `VACUUM INTO` (a plain copy only with no server open, WAL/SHM included).
  Copy in, never symlink; bring `secrets`/`settings.json` only if the flow needs them.

## Hit every surface

Before calling frontend work done, decide which apply:

- **Entry points.** Chat behaviour is often also in Settings, the command palette, a keybinding.
- **Clients.** Only the hosted web client and HQ are in use. Desktop and mobile source stay in the
  repository and must keep compiling (their CI jobs run when they or their packages change); no
  per-client behaviour decision until a maintainer reopens them.
- **Providers.** Provider-shaped features need a decision per adapter in `apps/server/src/provider/**`,
  even ones the product catalog hides.
- **Contracts.** Anything crossing the wire is typed in `packages/contracts`; follow schema changes
  through server, web, mobile and desktop.
- **Reverse states.** A way in needs a way out and a way to see it.
- **Accounts.** Multi-device and multi-project cases are real.

## Where knowledge lives

This file is a map, never a cache of facts from code, tests or other documents.
To answer a question, go to the home:

- The zcp↔mate seam → `../zcp/docs/spec-mate.md` §2.8 (sibling repo zeropsio/zcp).
- Domain terms (Mate, HQ, application, environments, release, crew) → `docs/internals/zerops/primer.md`.
- Runtime terms (thread, turn, decider, projector, reactor) → `docs/internals/glossary.md`.
- Fork rules (zones, freeze, product constraints, upstream) → `docs/internals/zerops/fork.md`.
- Provider SPI boundary → `docs/internals/zerops/spi.md`.
- Server services and thin transports → `docs/internals/effect-services.md`; read before adding server code.
- Platform assumptions our code relies on → `docs/internals/zerops/verified.md` or a comment beside the code.
- UI principles, copy glossary, tokens, guards, exception policy → `docs/internals/zerops/design-system.md`.
- User-visible behaviour · runbooks → `docs/user/` · `docs/operations/`.
- Behaviour invariant → a test whose title is the product sentence.

- `docs/` lines must hold for something not yet existing: cross-surface rule, term, zcp↔mate seam,
  platform fact. One surface/flow/component belongs in tests (title is the product sentence; one-line
  why when the owner decided against the obvious) or code. Reasons/reversals belong in the commit message.
- Few tests, highest value, fast: a test earns its cost or goes. Delete one that pins gone behaviour,
  duplicates another or checks trivia, with a `Drops-test: <exact title>` commit trailer
  (`scripts/check-test-sentences.ts`) and a line why. Rewrites change input arrangement, never what a
  kept title says; removing a behaviour itself is the owner's call.
- Test visible behaviour against the surface's input (record it reads → what it shows), so swapping
  data sources turns it red.
- Paragraph-sized doc entries are list items, never table rows.
- `verified.md` has one writer, the lead; helpers report facts as text, never edit it.
- Never commit plans, research notes or scratch files; `.plans/` is gitignored as a safety net.

## Where code lives

- `apps/server` — for Effect, read `.repos/effect-smol/LLMS.md`.
- `packages/contracts` — schemas only, no heavy runtime logic.
- `packages/shared` — subpath exports, no barrel.
- `.repos/` — vendored read-only references: prefer their patterns, never edit/import from them;
  `vpr sync:repos` when bumping a matching dependency.
- Owned product code and path zones: `fork.md` §3.

## Taste

- Prefer the smallest model making correct behaviour unsurprising; no machinery without a concrete
  constraint. Complexity at the adapter boundary; pure orchestration, dumb UI.
- A `ws.ts` RPC handler, HTTP route or CLI command decodes input, calls one service method, maps errors.
- `apps/web/src/components/ui` exports own their look: pick a `variant`/`size`, never restyle with
  `className`, never add a `t3code/no-restyle` exception. If none fits, generic looks get a variant;
  feature-specific looks stay in the feature. Layout classes belong on the parent.
- Tests pin behaviour (state, data, protocol, guards, render output, click effects), never class
  strings, pixels or colours; the owner judges looks by eye. Backend behaviour ships with focused tests.
- Owner-reported visual regressions get a geometry witness in the `owner-reported layout regressions`
  scenario suite, in the fix's change.
- Important invariants get deterministic checks with an exception ledger that may only shrink.
- Any part (HQ, a Mate's container, the Zerops platform, a provider) can fail: bounded waits, honest
  user state, recovery on return; no machinery for failures not yet seen.
- Delete, don't disable: no commented-out code or compatibility shims.
- Never `any`; prefer inferred types. Comments explain use and move with code.
- Security matters; do not over-index for dev-mode or maintainer-only features.
- If a rule fights the task, state the conflict and get a maintainer's sign-off before breaking it.

## When something that is not your code fails

Accounts, APIs, credentials, infrastructure, tools: classify by evidence, then act. Before each
attempt write "hypothesis: … / test: …" on one line. Never repeat an identical action expecting a
different result, except class B.

- **A — yours** (something you started, or a wrong path, ID or variable in your command): fix and
  continue; each attempt changes something.
- **B — transient** (timeout, 5xx, 429, "at capacity", connection reset, DNS SERVFAIL): same action
  up to three times, pausing ~10 s, 30 s, 90 s; still failing → D.
- **C — refused** (401/403, 404, 409, 422, "not found", "permission denied", missing credential): read
  the whole error body, name the account, credential and target in use (never a secret's value),
  confirm with one read-only call. Your mistake → A; otherwise → D.
- **Unknown:** at most three distinct hypotheses, each tested once by the cheapest read-only probe.
- **D — park:** stop only dependent steps, finish every independent one, end with
  `BLOCKED: <step> — <exact error> — <class> — tried: <hypotheses> — need: <one concrete question>`.

Never a workaround, always D: another identity/authority (account, credential, organization, token,
permission), a target the task does not name, `--no-verify` / `--force`, disabled check,
substitute infrastructure.

## Context and commits

- Every step re-sends the conversation: keep context small. Parallel helpers/worktrees are for a
  pass's independent part or long read-only search, never a tweak or one-surface change.
- Hot files (`ChatView.tsx`, `index.css`, `SidebarZeropsTree.tsx`, `MessagesTimeline*`, `RunChat.tsx`)
  and reference files run up to ~15k lines: grep the symbol, read the range.
- Output: failures only (`… 2>&1 | tail -40`). Screenshots: crop to surface, one per question.
- Atomic English commits, conventional plain-language title; never a `Co-Authored-By` trailer.
- PRs only when asked: one concern; body problem and fix, ending with model/harness used. UI changes
  need before/after images, motion a short video.

## Maintaining this file

Only cross-cutting traps or disciplines not test-/spec-shaped earn a line; otherwise follow "Where
knowledge lives". Delete lines already stated at their home. `CLAUDE.md` imports
this file and holds only Claude Code-specific instructions.
