# mate — Zerops Mate

Zerops Mate is a hard fork of T3 Code: a control surface for coding agents in Zerops project
containers. A Node WebSocket server in each container drives provider CLIs; zcp installs it from
this repo's stable GitHub release. The web client is hosted separately.

**Shared rules.** Every change follows [`docs/engineering-rules.md`](docs/engineering-rules.md),
the rules this repository shares with zcp and HQ: Claude Code loads it with this file
(`CLAUDE.md`); other agents read it before the first edit. This file adds only this repository's
map, commands and traps.

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
- **zcp starts this server.** Unknown `mate serve` flags kill every unit boot: new settings use the
  launch environment, never a new flag (`zeropsio/zcp:docs/spec-mate.md` §2.2).
- **UI goes through the kit.** A look is a kit piece, a surface is drawn by its flow from the component the
  product renders, a key state is a named state of that flow, and fixtures are the only fake: design-system
  §7.

## Size the work, then verify

Name the tier before the first tool call. Its loop is the whole loop; no higher-tier rituals.
T1 (the units) runs at every landing; other suites run only when the owner explicitly asks; normal
verification is T1, lint, typecheck and build (plus its looks for UI).

- **Tweak** — existing look: CSS, spacing, colour, copy, icon, one component's layout. Grep, edit, one
  look at the surface's key state (`/design-<flow>.html?state=<state>`) in the report's theme, `vp check`
  the files, one commit. Nothing extra (test, matrix, ledger entry, subagent, release) unless asked. Delete
  tests pinning the old class, pixel or colour; do not update them.
- **Change** — behaviour: state, data, protocol, new control. Lint and typecheck of the touched
  packages, one look per key state it adds or alters, one live look for UI.
- **Pass** — a maintainer calls it a pass, or it redesigns several surfaces or lands a slice: loop below.

The loop:

- Prepare a worktree: `cd "$(node scripts/prepare-worktree.ts <name>)"`.
- In a worktree, check only the changed packages, never repo-wide `vp check` or `vp run -r
  typecheck`: on completion run `node scripts/gate-changed.ts --no-build` once (`--help` for flags,
  `--list` previews): lint and typecheck (and the guard ledgers) of the changed packages in one
  blocking command, never detached and polled. The two builds (`build web client`, `pack server`)
  run in `scripts/land.ts`'s gate on the rebased tree, each when the diff touches a file it reads;
  to run them before landing, drop the flag. Re-run it after a fix; it reuses
  passed stages. `--tests` adds test suites and test machinery only when the owner asks for tests.
- Work lands on `main` only through `MATE_HQ_CHECKOUT=<mate-hq clone> node scripts/land.ts`, run in
  the committed worktree: without the lock it fetches, rebases onto `origin/main`, checks the
  mate-hq pin and runs the gate; then it queues for the lock, and holding it re-gates only what
  `main`'s new commits changed and fast-forward pushes. Its last stdout line is `LANDED <sha>`; a
  refusal's last stderr line is `land: refused <class>: <reason>` (classes: its `RefusalClass`),
  it exits non-zero and pushes nothing.
- CI runs lint/format, typecheck, build and T1. Other test suites and test machinery run only on a
  manual CI dispatch or through a `kh-bisect/**` manifest (see `docs/operations/release-and-deploy.md`).
- Markdown tables: `vp fmt` the file before committing; unaligned rows fail CI's Check job.
- The server is event-sourced; async flows emit typed receipts. Wait on receipts and worker drains,
  never sleeps or polling.
- Looks use the `test-t3-app` test browser at the reference viewport (1786 × 1000, menu at 435 px).
  Computer use on the person's own desktop needs their consent.

`web-v*` tags deploy the hosted web client (mate.zerops.io) through `zerops.yml`'s `prod` setup.
Release, staging, HQ and container delivery: `docs/operations/release-and-deploy.md`;
contributors follow `CONTRIBUTING.md`.

## The three ways to hurt yourself

Work often runs through mate itself, beside the directing person's processes, data and dev servers.

1. **Killing by pattern** kills the wrong process: your agent's arguments contain this worktree's
   path and several dev servers run here. Kill only a PID captured at spawn, or your port's owner
   after confirming its cwd is this worktree: Linux `ss -H -ltnp` and `/proc/<pid>/cwd`; macOS
   `lsof -nP -iTCP:<port> -sTCP:LISTEN` and `lsof -a -p <pid> -d cwd`.
2. **The live install.** `~/.t3/userdata` is the developer's real, active database: read or copy it,
   never start a server against it, open it read-write or clean it up.
3. **Baking in origins.** `VITE_HTTP_URL` and `VITE_WS_URL` bake localhost into the bundle and break
   remote browsers: never set them for dev. Dev is single-origin; Vite proxies `/api`, `/ws`,
   `/oauth`, `/.well-known`.

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

- Conceptual architecture (concepts, owners of facts and decisions, trust boundaries) → private
  `zeropsio/mate-hq:docs/architecture/README.md`; public product contracts here and in the zcp spec
  remain self-contained.
- Seams between this repository's parts (which may import which, and the lint rule that holds it) → "Seams" in
  private `zeropsio/mate-hq:docs/architecture/client-data.md` (client) and `agent-runtime.md` (server); the test
  units are derived: `node scripts/check-sentences.ts units`.
- The zcp↔mate seam → `zeropsio/zcp:docs/spec-mate.md` §2.8.
- Domain terms (Mate, HQ, application, environments, release, crew) → `docs/internals/zerops/primer.md`.
- Runtime terms (thread, turn, decider, projector) → `docs/internals/glossary.md`.
- Conversation engine terms and rules (conversation, session, run, effect, wake, owner) → `docs/internals/zerops/engine.md`.
- Fork rules (zones, freeze, product constraints, upstream) → `docs/internals/zerops/fork.md`.
- Upstream intake → `docs/internals/zerops/intake.md`.
- Provider SPI boundary → `docs/internals/zerops/spi.md`.
- Usage terms → `docs/internals/zerops/usage-ledger.md`.
- Workspace history rules → `docs/internals/zerops/workspace-history.md`.
- Terminal renderers → `docs/architecture/terminal-renderers.md`.
- Server services and thin transports → `docs/internals/effect-services.md`; read before adding server code.
- Platform assumptions our code relies on → `docs/internals/zerops/verified.md` or a comment beside the code.
- UI principles, copy glossary, tokens, guards, exception policy, the kit and its flows →
  `docs/internals/zerops/design-system.md`; UI work starts at its §7.
- Platform editing rules → `docs/internals/zerops/platform-data-architecture.md`.
- Instrumentation rules → `docs/operations/observability.md`.
- Runbooks → `docs/operations/`.
- Behaviour invariant → a line in its unit's `SENTENCES.md`, with one case.

- What may be a `docs/` line: engineering rules §6. This repository owns no seam: HQ's wire is
  `zeropsio/mate-hq:spec/`, the zcp↔mate seam is `zeropsio/zcp:docs/spec-mate.md`.
- Test admission and removal: `docs/testing-rules.md`; this repository's checks and test inputs:
  `docs/internals/testing.md`. Both are read before test work.
- Paragraph-sized doc entries are list items, never table rows.
- `verified.md` has one writer, the lead; helpers report facts as text, never edit it.
- Scratch files go in the gitignored `.plans/`.

## Where code lives

- `apps/server` — for Effect, read `.repos/effect-smol/LLMS.md` (see `.repos/` below when missing).
- `apps/web/src/styles/` — the web client's foundation stylesheets (theme, tokens, base, markdown)
  and keyframes (`motion-*.css`); a surface draws with the kit and utilities in its own code
  (design-system R13).
- `packages/contracts` — schemas only, no heavy runtime logic.
- `packages/shared` — subpath exports, no barrel.
- `.repos/` — read-only reference repos (Effect, Alchemy), gitignored and absent in a fresh checkout:
  `vpr sync:repos` fetches them as shallow clones at the pinned versions, again after bumping a
  matching dependency. Prefer their patterns, never edit/import from them.
- Owned product code and path zones: `fork.md` §3.

## Taste

- Complexity at the adapter boundary; pure orchestration, dumb UI.
- An RPC handler (a `register*Rpc.ts` module), HTTP route or CLI command decodes input, calls one service method, maps errors.
- Important invariants get deterministic checks with an exception ledger that may only shrink.
- Any part (HQ, a Mate's container, the Zerops platform, a provider) can fail: bounded waits, honest
  user state, recovery on return; no machinery for failures not yet seen.
- Never `any`; prefer inferred types. Comments explain use and move with code.
- Security matters; do not over-index for dev-mode or maintainer-only features.

## When something that is not your code fails

Accounts, APIs, credentials, infrastructure, tools: classify the failure per
`docs/engineering-rules.md` §5 (classes A–D) before any retry.

## Context and pull requests

- Hot files (`ChatView.tsx`, `SidebarZeropsTree.tsx`, `MessagesTimeline*`, `RunChat.tsx`)
  and reference files run up to ~15k lines: grep the symbol, read the range.
- Output: failures only (`… 2>&1 | tail -40`). Screenshots: crop to surface, one per question.
- PRs only when asked: one concern; body problem and fix, ending with model/harness used. UI changes
  need before/after images, motion a short video.

## Maintaining this file

Only this repository's cross-cutting traps or disciplines that are not test-/spec-shaped earn a
line; a rule that also holds for zcp and HQ belongs in `docs/engineering-rules.md`; otherwise follow
"Where knowledge lives". Delete lines already stated at their home. `CLAUDE.md` imports this file and
holds only Claude Code-specific instructions.
