# Zerops Mate fork rules

Zerops Mate is a **hard fork** of [T3 Code](https://github.com/pingdotgg/t3code) (MIT). Upstream stops
being a merge partner. What we still take from it, we take in two different ways (§3):
**import** (byte-identical, for the wire-protocol packages) and **port** (re-applied behind our
own interface, for the provider drivers). Everything else is ours.

This supersedes the fork's earlier "stay additive so a rebase stays possible" rule — the one
`README.md`/`AGENTS.md` carried before the freeze. Both are rewritten to match.

## 1. Decision

Measured against the real upstream repo, 2026-08-28:

- Upstream moves at 117–197 commits/week; 126 commits / 580 paths in the 7 days before the
  freeze alone, touching 37 of our 100 modified files. Provider work specifically: 85 commits in
  60 days, all vendor-protocol tracking.
- Provider work is **not self-contained**: 37 of those 85 commits (44%) also change
  orchestration, contracts, client state or UI; the drivers import owned server modules
  (`config`, `mcp`, `persistence`, `textGeneration`, telemetry,
  `orchestration/ProjectionSnapshotQuery`); and our own lifecycle/topology feeds import
  `ProviderService` directly. A "checkout the provider dir" import is a bespoke merge every time.
- A full UI rewrite is planned; the server core already diverges (door, git executor, feeds, exec
  RPC).
- Rebase already failed once on our own merge history. A merge model would survive only until the
  UI rewrite anyway.

## 2. The freeze

- Frozen at commit `f94a0d646ed78a4788e4af6417f74202a628a5e9` (`upstream/main`, 2026-08-28),
  tagged `upstream-base-2026-08-28`. The fork's `main` branch is that commit's history renamed —
  it was branch `z3` before the freeze.
- From here on: no `git merge upstream/*`, no `git rebase upstream/main`.
- Versioning is ours: `mate v0.1.0` (§8 item 7). The npm name `t3` survives on the container prefix
  until the release gate picks the bundle channel.

## 3. Zones — the map, machine-checked

| Zone                          | Paths                                                                                                                                                                                                                                                | Rule                                                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Imported** (byte-identical) | `packages/effect-codex-app-server/**`, `packages/effect-acp/**` — the standalone wire-protocol packages; the list is final only once the freeze checklist (§8) proves each imports nothing owned                                                     | Never edited. Re-imported from an upstream SHA in one `import:` commit. Pinned by `imported.lock` (§3.1).                                                                       |
| **Ported**                    | `apps/server/src/provider/**` (drivers, adapters, model manifest, maintenance), `packages/contracts/src/provider*.ts`, `apps/server/src/codexModelOptions.ts`                                                                                        | Ours to compile, upstream's to author: upstream commits are **ported** (cherry-picked + adapted) behind the adapter SPI (§3.2). Our own edits stay minimal so ports stay cheap. |
| **Owned core**                | the rest of `apps/server`, `apps/web` (outside the product sub-paths below), `packages/{contracts,client-runtime,shared,ssh}`, `apps/desktop`, `apps/mobile`                                                                                         | Ours. Upstream changes here are optional cherry-picks chosen by triage (§6).                                                                                                    |
| **Owned product**             | `apps/server/src/zerops/**`, `apps/web/src/zerops/**`, `apps/web/src/components/zerops/**`, `packages/client-runtime/src/zerops/**`, `apps/mobile/src/features/zerops/**`, `packages/shared/src/{brand,threadStatus}.ts`, `docs/internals/zerops/**` | Ours only. The client design system (`design-system.md`) governs the client dirs: tokens only, protected roots render only, one status resolver.                                |
| **Removed**                   | per row in §4                                                                                                                                                                                                                                        | Deleted, not disabled.                                                                                                                                                          |

### 3.1 Enforcement — `imported.lock`, not git history

A checked-in `imported.lock`: for every imported path, the upstream commit SHA it came from and
the git tree/blob OID it must have. CI recomputes the OIDs and fails on any difference; only the
import step regenerates the lock. Commit subjects (`import:`) stay a convention, not the
enforcement. No history inspection, nothing rots on a squash or rename.

Alongside it, a zcp-style architecture test: ported code carries no `zerops` imports; owned
product code reaches providers only through the SPI (§3.2) — today's direct `ProviderService`
imports in the lifecycle/topology feeds were the first violations; the list is empty since SPI-1 (2026-08-29).

### 3.2 The adapter SPI — the contract that makes porting safe

Provider runtime events, persistence, orchestration, contracts and our Zerops reducers share
source-level types today; a port that drops or reclassifies a lifecycle event compiles fine and
breaks at runtime. The full contract — event surface and version policy, the delivery guarantee,
tool-call enrichment, the typed capability wrappers, fixture format and recording, and the porting
checklist — is declared in `spi.md`, not here. Per-port compatibility rows (ported upstream SHA ×
Claude CLI × Codex CLI × Effect version × fixture set) live in `compat.md`.

## 4. What goes, what stays

| Item                                                                                                                                                                                                                                  | What it is                                                                                                                                                                                             | Zerops path?                                                                                     | Decision                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Desktop                                                                                                                                                                                                                               | same web bundle in Electron + local spawn, SSH launch, keychain, deep link, updater                                                                                                                    | yes (S5)                                                                                         | keep                                                                                               |
| Mobile                                                                                                                                                                                                                                | Expo app on the shared client runtime                                                                                                                                                                  | yes (S5)                                                                                         | keep                                                                                               |
| T3 cloud — **reach/pairing** (`app.t3.codes` pairing, CLI token manager, boot service, managed endpoint)                                                                                                                              | how a phone / hosted web reaches a home server                                                                                                                                                         | replaced by the door (D1)                                                                        | delete — the slice waits for S5 to prove mobile connects through the door first                    |
| T3 cloud — **activity relay** (`AgentAwarenessRelay`, its `OrchestrationReactor` hook, `contracts/relay.ts`, client-runtime relay, mobile registration, `infra/relay`)                                                                | mobile push + Live Activities                                                                                                                                                                          | mobile needs it; the relay must be ours to host                                                  | keep and host ourselves — the `infra/relay` deployment is an S5 deliverable                        |
| Tailscale (39 files: `packages/tailscale`, `environment/RemoteOpenTargets.ts`, server lifecycle/config, CLI `pair`/`connect`, desktop exposure/settings/IPC, web settings, contracts)                                                 | an endpoint add-on to reach a t3 server on another machine **the user owns** over their private tailnet                                                                                                | none — mate's server lives in the Zerops container behind the public origin + door               | delete as one refactor slice                                                                       |
| Local spawn (`t3 serve` on a laptop, desktop "local backend")                                                                                                                                                                         | run the server on your own machine                                                                                                                                                                     | none                                                                                             | delete — desktop keeps SSH launch/keychain/deep link/updater, loses the local backend              |
| Providers Cursor / Grok / OpenCode                                                                                                                                                                                                    | drivers in the ported zone                                                                                                                                                                             | not offered                                                                                      | keep the code (ports stay cheap when the tree matches upstream), hide via catalog config           |
| Provider Google Antigravity (ported 2026-09-05, intake row 3)                                                                                                                                                                         | ACP driver in the ported zone with a managed `agy_acp_server` runtime; sign-in is upstream's own flow (Google URL in the settings provider setup, pasted callback forwarded from inside the container) | offered — owner decision 2026-09-04                                                              | keep; the zcp agent-auth door for it (spec §8) is a separate product slice; MCP attachment is Q-14 |
| `apps/marketing`                                                                                                                                                                                                                      | the t3.codes website                                                                                                                                                                                   | none                                                                                             | delete                                                                                             |
| T3 in-app preview browser + MCP server (`apps/server/src/mcp/**`, `apps/server/src/preview/**`, `apps/web/src/browser/**`, `apps/web/src/components/preview/**`, `apps/desktop/src/preview/**`, `packages/contracts/src/preview*.ts`) | an embedded browser panel (webview/`BrowserWindow`-backed) for previewing the user's dev server, with click/type/screenshot automation exposed to every provider adapter over a local MCP server       | none — a Zerops environment is reached over its own public URL, not a device-local browser guest | delete as one slice                                                                                |

### 4.1 Names

The product identity is Zerops Mate: `mate` is the executable, `zerops-mate` the release package,
`/mate` the base path, `zerops@mate` the unit, `ZCP_MATE_*` the zcp-side envs. Upstream's names —
`t3`, `t3code`, the `T3CODE_*` env vars, the `@t3tools/*` packages, `/.well-known/t3/environment` —
are inherited plumbing and are never renamed: they run through the ported and imported zones, no
user sees them, and renaming them would turn every port into a bespoke merge. The same holds for
keys registered on the platform side: the sign-in hand-over asks for mode `zerops-code`
(`ZEROPS_HANDOVER_APP_MODE`), the value the platform client's registry serves — a rename there is a
platform release, not a string sweep.

## 5. How work is done — the zcp loop, transplanted

- **Homes**: design → `../../../../zcp/docs/spec-mate.md`; measured facts → the ledger
  (`verified.md`, `questions.md`, `hacks.md`, `map.md`, dated, with the command; answered
  questions leave `questions.md`); behaviour → tests; the map → this fork's `CLAUDE.md`/
  `AGENTS.md` (never caches product knowledge). Plans are transient.
- **Loop per change**: FRAME → PROVE (live on `z3-eval`) → SHAPE (plan + a `judge` pass; Codex only when the owner asks) →
  BUILD (one worktree per slice, RED → GREEN, Sonnet slices with self-contained briefs, atomic
  commits, no trailers) → ASSEMBLE (targeted tests + typecheck + live smoke through the push loop
  - owner retest pack) → LAND (spec + ledger updated, plan deleted).
- **Verify minimally**: `vp test run <files>` + package typecheck; never the repo-wide suite.
  Live = the push loop to `z3-eval`. Nothing is released before the release gate.
- **Ledger discipline**: subagents report facts as text; one writer edits the ledger.

## 6. Upstream intake — lean

State kept: one `intake.md` (§ next to this file) with the **last-reviewed upstream SHA**, the
decisions taken, and the open security candidates. No per-commit skip bookkeeping.

Trigger: the drift watch (§7) or a monthly tick, whichever comes first. Steps (agent tasks):

1. **Triage**: `git log <last-reviewed>..upstream/main` → three lists only: (a) **every** commit
   that touches the ported zone (`-- apps/server/src/provider packages/contracts/src/provider*`),
   each either ported or named in the intake row with its reason — a ported-zone commit skipped by
   moving the SHA is a hidden prerequisite of the next intake (row 2 hid eight, every one found as a
   missing symbol under a later port); (b) `fix`/security in auth, http, ws, uploads → cherry-pick candidates; (c) ideas for
   the owner (the only list they read). Everything else is implicitly skipped by moving the SHA.
2. **Import** the wire packages from the new SHA (one commit, lock regenerated). The import is
   formatted with whatever vite-plus upstream used; when upstream moved the catalog, the bump rides in
   the same commit — neither half is green alone (row 3: 0.2.2 → 0.3.0).
3. **Port** the provider commits behind the SPI: fixtures replayed, matrix row added, live canary
   (§7) green on `z3-eval`. A port that lands a client test runs that package's whole test suite
   (`vp run --filter @t3tools/web test`, mobile likewise), not only the touched file: the fork's
   components and test mocks diverge from upstream's, and CI's Test job is where that surfaces (row 3
   landed red on three such tests). A port that needs an orchestration/contract change carries it in the
   same slice with a spec note.
4. **Cherry-picks** — each its own slice through the normal loop.
5. Move the last-reviewed SHA.

## 7. Adapter drift watch — parked

A design for automatic upstream/vendor drift detection — an upstream-diff signal, a vendor-CLI
release signal, and a live canary turn that re-records the raw event stream against the checked-in
SPI fixtures, all landing as GitHub issues rather than silent breakage — is parked at
`../../../../zcp/plans/backlog/z3-adapter-drift-watch.md`. It presupposes the adapter SPI and
fixtures of §3.2 and a dedicated canary identity nobody has picked yet; promote it once the SPI
lands, once a vendor-CLI break reaches a user before us, or once the first upstream port turns out
to be more than a mechanical cherry-pick.

## 8. Freeze checklist

| #   | Item                                                                                                                                      | Status                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Tag `upstream-base-2026-08-28`; rename `z3` → `main`; ledger row                                                                          | done                                                                                                                                                                                                                                                   |
| 2   | Adapter SPI + fixtures (§3.2) — the largest item; recorded from `z3-eval` with the real CLIs; the lifecycle/topology feeds move behind it | done 2026-08-29 (live sanity on `z3-eval` pending)                                                                                                                                                                                                     |
| 3   | `imported.lock` + CI (lock check, changed-package tests, typecheck, architecture test)                                                    | done 2026-08-29; first run on GitHub-hosted runners 2026-08-30 surfaced seven pre-existing failures (ledger), green since `07c3d0d8c`                                                                                                                  |
| 4   | Deletions from §4 marked delete — one slice each (Tailscale is a refactor slice, not a `rm`)                                              | Tailscale + `apps/marketing` done 2026-08-29; T3 Connect reach removed from the relay + client-runtime/web/mobile 2026-08-29 (server-side CLI token manager / boot service → S5-5); desktop local spawn/WSL/SSH launch/Clerk removed 2026-08-29 (S5-1) |
| 5   | Mirrored model manifest                                                                                                                   | done 2026-08-29                                                                                                                                                                                                                                        |
| 6   | Fork `CLAUDE.md` (the map) + this document + `intake.md` row 0                                                                            | done 2026-08-29                                                                                                                                                                                                                                        |
| 7   | Versioning `mate v0.1.0`; retire brief §4 rule 6; write `../zcp/docs/spec-mate.md` §7                                                     | 0.1.0 done; `spec-mate.md` §7 written 2026-08-29; brief rule 6 retired                                                                                                                                                                                 |
