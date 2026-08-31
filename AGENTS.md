> **This is `z3`, a Zerops hard fork of T3 Code.** Read [`CLAUDE.md`](CLAUDE.md) and
> [`docs/internals/zerops/fork.md`](docs/internals/zerops/fork.md) first. Two rules override
> upstream's guide below: never `git merge`/`rebase upstream/main` — the fork is frozen at tag
> `upstream-base-2026-08-28`; in the ported zone (`apps/server/src/provider/**`, provider
> contracts) keep edits minimal so future ports stay cheap. Where the two disagree about product
> name or scope, the rules above win.

# z3 — Zerops Code

z3 is a control surface for coding agents that live inside Zerops project containers. A Node
WebSocket server wraps provider CLIs and serves the hosted web bundle at `/z3/` on the container's
public origin. Zerops users sign in with their Zerops account; they do not install or pair the
container by hand.

The server release is pinned and installed by zcp, then supervised as `zerops@z3`. Standalone
server releases are GitHub tarballs whose package is `zerops-code` and executable is `z3`; there is
no npm-registry release. The fork does not currently publish desktop or mobile clients.

## Product constraints

### 1. Container first

The Zerops container is the product environment: it owns the code, provider credentials, zcp MCP
tools, server process, and durable work. Do not design the primary path around a local server, a
tunnel, a shared container secret, or a desktop sidecar.

### 2. Performance without compromise

Users drive agents all day and notice dropped frames, lying spinners, and stale labels. Watch for
websocket payload growth, unnecessary list rerenders, CSS animation GPU cost, and continuously
repainting effects, especially on high-refresh displays.

### 3. Account-backed remote access

Every released web client reaches the server on the container's public origin through the
Zerops-identity door. A standalone server run outside Zerops can use one-time pairing. A Zerops
container never bootstraps a browser session from a pairing credential.

### 4. Multi-surface codebase

The repository retains web, desktop, and mobile source. Only the hosted-static web bundle is
released by this fork today. Changes to shared client behavior still need a decision for desktop
and mobile source so those surfaces do not silently diverge, but user documentation must not direct
people to upstream desktop or mobile packages.

## Working stance

Prefer the smallest model that makes the correct behavior unsurprising. Do not preserve complexity
because it already exists, and do not introduce machinery without a concrete constraint. Most work
is performed through z3 itself, often remotely, so be careful with live data, processes, and dev
servers that may belong to the person directing you.

## Glossary

Use this language when communicating:

- **you** means the agent reading this file and changing z3.
- **we, us, and maintainers** mean the people maintaining this fork.
- **user** means the person using z3 to direct coding agents.
- **agent** means the coding agent a user runs inside z3. Depending on context, that may also
  include you.
- **provider** means the agent runtime or harness z3 talks to, such as Codex, Claude, Cursor, Grok,
  or OpenCode.
- **client** means the web, desktop, or mobile UI source; the released fork client is the hosted
  web bundle.
- **environment** means one running z3 server and the machine, filesystem, provider credentials,
  and state it owns.
- **project** means an environment-local workspace record rooted at a directory.
- **thread** means the durable conversation and work history for a project.
- **turn** means one user-to-agent cycle, including follow-up work such as checkpointing.
- **z3 home** means the base data directory. Runtime state normally lives below its `userdata`
  directory; internal names still use `.t3` and `T3CODE_HOME` where the code does.

## The three ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or kill a PID found by matching a name,
   path, or worktree string. Your own agent process has this worktree's path in its arguments, and
   this machine runs several dev servers. Kill only a PID captured at spawn, or the owner of your
   port from `ss -H -ltnp` after confirming `/proc/<pid>/cwd` is this worktree.
2. **Writing to the live install.** `~/.t3/userdata` is the developer's real database, in use while
   you work. Reading it and copying from it are fine. Never start a server against it, open it
   read-write, or clean it up.
3. **Baking in origins.** Never set `VITE_HTTP_URL` or `VITE_WS_URL` for dev. Dev is single-origin
   and Vite proxies `/api`, `/ws`, `/oauth`, and `/.well-known`. Setting them bakes localhost into
   the bundle and breaks remote browsers.

## Hit every surface

Before calling frontend work done, decide which entries apply:

- **Entry points.** Behavior reachable from chat is often also reachable from Settings, the command
  palette, and a keybinding.
- **Clients.** Web, desktop, and mobile source may have separate navigation and presentation.
  Shared logic lives in `packages/client-runtime`.
- **Providers.** Codex, Claude, Cursor, Grok, and OpenCode each have an adapter. Provider-shaped
  features need a decision per adapter, even when the product catalog hides one.
- **Contracts.** Anything crossing the wire is typed in `packages/contracts`. Schema changes must
  be followed through server, web, mobile, and desktop.
- **Reverse states.** If you add a way in, add the way out and the way to see it.
- **Connection modes.** The Zerops identity door and standalone one-time pairing have different
  rules. Multi-device and multi-project cases are real.
- **Docs.** User-visible behavior belongs in `docs/user/`; architecture and contributor changes in
  `docs/internals/`; runbooks in `docs/operations/`; new vocabulary in
  `docs/internals/glossary.md`.

## Dev servers

- `vp i` installs dependencies. Worktrees get this from the `t3.json` setup script; if module
  resolution looks broken, it probably did not run.
- `vp run dev` starts server and web. In a worktree, state defaults to that worktree's gitignored
  `.t3`, which deliberately outranks an ambient `T3CODE_HOME`. An explicit `--home-dir` still wins.
- Ports derive from the worktree path and are stable across restarts, but read the real ones from
  the `[dev-runner]` line because occupied ports shift.
- Local dev web requires pairing. Hand over the pairing URL, not the bare origin. If its token was
  consumed, mint a fresh one with `node apps/server/src/bin.ts pair`; the startup URL carries admin
  scopes needed for Connections management while `pair` carries standard scopes.
- Stop only what you started, by the PID you tracked.

## Test data

An empty database is a poor test. Seed the worktree's `.t3` with a snapshot instead of pointing a
server at live state:

- Copy from `~/.t3/userdata` or `~/.t3/dev`. Worktree state lives at
  `<worktree>/.t3/userdata`.
- Snapshot a live SQLite database with `VACUUM INTO`; it yields one consistent file while the source
  stays open. A plain copy is safe only when no server has the source open and must include its WAL
  and SHM siblings.
- Bring `secrets` and `settings.json` only when the flow under test needs them.
- Copy in, never symlink. Data flows into the sandbox, never back out.

## Verifying

- Use the smallest proof that the change works: `vp test run <files>` for touched tests, plus
  targeted lint and package typecheck.
- Do not run repo-wide checks such as `vp check`, `vp run -r test`, or `vp run -r typecheck` unless
  asked. CI owns the full suite.
- Backend behavior changes ship with focused tests.
- The server is event-sourced and async flows emit typed receipts. Wait on receipts and worker
  drains, never sleeps or polling.
- Upon request, run one integrated pass in a real client after integration: `test-t3-app` for web,
  `test-t3-mobile` for mobile. Ask permission before computer use or opening browsers.

## Pull requests

- Never make a PR unless explicitly asked.
- Use a conventional commit title in plain language.
- State the problem, then the fix. End the body with the model and harness used.
- UI changes need before/after images; motion or timing needs a short video.
- Upload PR evidence to GitHub. Do not commit PR-only screenshots or assets.
- Keep one concern per PR.
- When babysitting, review checks and comments newer than the last push, verify findings against the
  source, fix real ones, and explain dismissed false positives. Stop when bots are green on the
  latest commit.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or scratch files. `.plans/` is gitignored only
  as a safety net for legacy tooling.
- Track active maintainer work in its GitHub issue or project item. External proposals follow
  `CONTRIBUTING.md` and belong in Ideas discussions.
- Put durable architecture, constraints, and decisions in `docs/internals/`.
- A merged PR is the implementation record. Close or update its tracking item when the work lands.

## How it works

Clients send typed WebSocket requests. The server turns them into commands, a pure decider turns
commands into persisted events, and a projector derives the read model. Provider adapters translate
native CLI protocols into orchestration events. Queue-backed reactors perform side effects and emit
receipts. Each turn ends with a checkpoint, stored as a hidden git ref, so the app can diff and
restore.

Full glossary with file links: `docs/internals/glossary.md`.

## Where code lives

- `apps/server` — WebSocket, orchestration, providers, checkpointing. Read
  `.repos/effect-smol/LLMS.md` before writing Effect code.
- `apps/web` — the React/Vite client; `apps/desktop` wraps it and `apps/mobile` is React Native.
- `packages/contracts` — Effect Schema contracts and small derived helpers; no heavy runtime logic.
- `packages/shared` — shared runtime utilities, subpath exports, no barrel.
- `packages/client-runtime` — client logic shared by web and mobile.
- `.repos/` — vendored read-only references. Prefer their patterns, never edit or import from them,
  and use `vpr sync:repos` when bumping a matching dependency.

## Taste

- Complexity belongs at the adapter boundary. Keep orchestration pure and UI dumb.
- Prefer inferred types. Do not use `any`.
- Comments describe how something is used and move when the code moves.
- Avoid continuously repainting animations.
- If a rule fights the task, state the conflict and get maintainer sign-off before breaking it.

## Additional tips

- Do not verify with browsers or computer use unless the user explicitly agrees or requests it.
- Security matters, but do not over-index on it for dev-mode or maintainer-only features.
