# z3 — Zerops Code

A control surface for coding agents that live **inside Zerops containers**.

A **hard fork** of [T3 Code](https://github.com/pingdotgg/t3code) (MIT), frozen at upstream commit
`f94a0d646ed78a4788e4af6417f74202a628a5e9` (tag `upstream-base-2026-08-28`) — no further
`git merge`/`rebase upstream/main`. Upstream's own README is kept unmodified at
[`docs/upstream-README.md`](docs/upstream-README.md); their `LICENSE` and copyright notice are
untouched, as MIT requires. What continues past the freeze, and how: see "Where to read next"
below.

## The idea in one paragraph

Every Zerops project already runs a `zcp` container: Ubuntu, a shell, the project's code, and
Claude Code + Codex already installed and authorized. So z3's server runs **inside that
container**, under `/z3/`, and its released client is the web bundle served there: a user signs in
with their own Zerops account and reaches the container directly, no pairing code and no shared
container secret. The agent sits next to the code — file operations are local, work survives
closing your laptop — and it already has the platform in its hands: the `zerops_*` MCP tools
(deploy, logs, import, scale, env, subdomain…) that make this different from a generic agent GUI.

```
  browser                                     zcp container (one per Zerops project)
 ┌──────────────────────────┐                ┌─────────────────────────────────────┐
 │  z3 client                │   signs in    │  z3 server, served at /z3/          │
 │  threads, approvals,      │◄──────────────►  spawns `claude` / `codex` ──► the  │
 │  diffs, terminal          │  with Zerops   │  zcp MCP tools; /var/www, git, term │
 └──────────────────────────┘   identity     └─────────────────────────────────────┘
```

## What runs where

- **Sign-in is a Zerops identity, not a pairing code.** The door checks project membership and
  mints a session; there is no code to copy and no secret shared out of band. Design:
  `../zcp/docs/spec-z3.md` §3.
- **zcp installs the pinned GitHub release at boot** and supervises it as `zerops@z3`. Nginx
  publishes the bundled web client at `/z3/` on the container's public origin. Delivery:
  `../zcp/docs/spec-z3.md` §2.
- **The agent's leverage is the `zerops_*` MCP toolset** already wired into the container. That
  toolset lives in `zcp`, not here — z3 is the client and the harness around it.

## Releases

Releases are published on [GitHub](https://github.com/zeropsio/z3/releases). The first release is
[`v0.1.0`](https://github.com/zeropsio/z3/releases/tag/v0.1.0), with the server tarball
`zerops-code-0.1.0.tgz` and `SHA256SUMS`. Installing the tarball links the executable as `z3`; it
reports `z3 v0.1.0`.

Nothing is published to npm under the `zerops-code` name. Zerops users do not install the tarball
themselves because zcp owns the pinned installation. The fork does not currently publish desktop
or mobile clients; package-manager builds with the upstream T3 Code name are not z3 releases.

## What is Zerops-specific here

Most of this repo is upstream T3 Code, either **imported** byte-identical (the wire-protocol
packages) or **ported** behind our own interface (the provider drivers). The parts that are ours
alone: `apps/server/src/zerops/**` and `apps/web/src/zerops/**`. The full zone map — what's
imported, ported, owned, or deleted, and why — is `docs/internals/zerops/fork.md` §3–§4.

## Where to read next

- [`CLAUDE.md`](CLAUDE.md) — the knowledge map: where design, rules, measured facts, and tests
  each live.
- [`docs/internals/zerops/fork.md`](docs/internals/zerops/fork.md) — the fork rules: the hard-fork
  decision, the zones, what was kept and what was deleted, how work gets done, upstream intake.
- `../zcp/docs/spec-z3.md` — the design spec: the envelope on the wire, delivery, the door, client
  flow, the Zerops-aware client, git.
- [`docs/internals/zerops/`](docs/internals/zerops/) — the measured-facts ledger
  (`verified.md`, `questions.md`, `hacks.md`, `map.md`, `poc-findings.md`) and `intake.md`.

## Delivering a dev build

Not a release — the push loop in the sibling `zcp` repo builds and installs a dev build onto a
running container: `../zcp/eval/scripts/z3-dev-push.sh z3`. A container restart wipes a dev
build; push again after.
