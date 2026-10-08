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
  `orchestration/ProjectionSnapshotQuery`); and our own Zerops feeds imported
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

- **Imported** (byte-identical) — `packages/effect-codex-app-server/**`, `packages/effect-acp/**` —
  the standalone wire-protocol packages; the list is final only once the freeze checklist (§8)
  proves each imports nothing owned
  - _Rule:_ Never edited. Re-imported from an upstream SHA in one `import:` commit. Pinned by
    `imported.lock` (§3.1).
- **Ported** — `apps/server/src/provider/**` (drivers, adapters, model manifest, maintenance),
  `packages/contracts/src/provider*.ts`, `apps/server/src/codexModelOptions.ts`
  - _Rule:_ Ours to compile, upstream's to author: upstream commits are **ported** (cherry-picked +
    adapted) behind the adapter SPI (§3.2). Our own edits stay minimal so ports stay cheap.
- **Owned core** — the rest of `apps/server`, `apps/web` (outside the product sub-paths below),
  `packages/{contracts,client-runtime,shared,ssh}`, `apps/desktop`, `apps/mobile`
  - _Rule:_ Ours. Upstream changes here are optional cherry-picks chosen by triage (§6).
- **Owned product** — `apps/server/src/zerops/**`, `apps/server/src/engine/**` (the Mate
  engine), `packages/contracts/src/engine*.ts`, `apps/web/src/zerops/**`,
  `apps/web/src/components/zerops/**`, `packages/client-runtime/src/zerops/**`,
  `apps/mobile/src/features/zerops/**`,
  `packages/shared/src/{brand,threadStatus,crewHome,crewTemplates}.ts`, `apps/hq/**`, `packages/hq-git/**`,
  `docs/internals/zerops/**`
  - _Rule:_ Ours only. The client design system (`design-system.md`) governs the client dirs: tokens
    only, protected roots render only, one status resolver.
- **Removed** — per row in §4
  - _Rule:_ Deleted, not disabled.

### 3.1 Enforcement — `imported.lock`, not git history

A checked-in `imported.lock`: for every imported path, the upstream commit SHA it came from and
the git tree/blob OID it must have. CI recomputes the OIDs and fails on any difference; only the
import step regenerates the lock. Commit subjects (`import:`) stay a convention, not the
enforcement. No history inspection, nothing rots on a squash or rename.

Alongside it, a zcp-style architecture test: ported code carries no `zerops` imports; owned
product code reaches providers only through the SPI (§3.2); its list of violations is empty since
SPI-1 (2026-08-29).

- The Mate engine (`apps/server/src/engine/**`) is the SPI's one consumer: it reaches the drivers
  through `ProviderService` and its bridge, and imports no other provider file. The rest of owned
  product reaches conversations through the engine, not the drivers.
- The engine imports nothing from `zerops/**` or V1's `orchestration/**` directly: Zerops reaches
  it through `engine/ports.ts`. The rule is about direct imports — a neutral module the engine
  uses (`checkpointing/WorkspaceHistory.ts`) may itself import `zerops/` modules.

### 3.2 The adapter SPI — the contract that makes porting safe

Provider runtime events, persistence, orchestration, contracts and our Zerops reducers share
source-level types today; a port that drops or reclassifies a lifecycle event compiles fine and
breaks at runtime. The full contract — event surface and version policy, the delivery guarantee,
tool-call enrichment, the typed capability wrappers, fixture format and recording, and the porting
checklist — is declared in `spi.md`, not here. Per-port compatibility rows (ported upstream SHA ×
Claude CLI × Codex CLI × Effect version × fixture set) live in `compat.md`.

## 4. What goes, what stays

- Desktop
  - _What it is:_ same web bundle in Electron + local spawn, SSH launch, keychain, deep link,
    updater
  - _Zerops path?:_ yes (S5)
  - _Decision:_ keep
- Mobile
  - _What it is:_ Expo app on the shared client runtime
  - _Zerops path?:_ yes (S5)
  - _Decision:_ keep
- T3 cloud — **reach/pairing** (`app.t3.codes` pairing, CLI token manager, boot service, managed
  endpoint)
  - _What it is:_ how a phone / hosted web reaches a home server
  - _Zerops path?:_ replaced by the door (D1)
  - _Decision:_ delete — the slice waits for S5 to prove mobile connects through the door first
- T3 cloud — **activity relay** (`AgentAwarenessRelay`, its `OrchestrationReactor` hook,
  `contracts/relay.ts`, client-runtime relay, mobile registration, `infra/relay`)
  - _What it is:_ mobile push + Live Activities
  - _Zerops path?:_ mobile needs it; the relay must be ours to host
  - _Decision:_ keep and host ourselves — the `infra/relay` deployment is an S5 deliverable
- Tailscale (39 files: `packages/tailscale`, `environment/RemoteOpenTargets.ts`, server
  lifecycle/config, CLI `pair`/`connect`, desktop exposure/settings/IPC, web settings, contracts)
  - _What it is:_ an endpoint add-on to reach a t3 server on another machine **the user owns** over
    their private tailnet
  - _Zerops path?:_ none — mate's server lives in the Zerops container behind the public origin +
    door
  - _Decision:_ delete as one refactor slice
- Local spawn (`t3 serve` on a laptop, desktop "local backend")
  - _What it is:_ run the server on your own machine
  - _Zerops path?:_ none
  - _Decision:_ delete — desktop keeps SSH launch/keychain/deep link/updater, loses the local
    backend
- Providers Cursor / Grok / OpenCode
  - _What it is:_ drivers in the ported zone
  - _Zerops path?:_ not offered
  - _Decision:_ keep the code (ports stay cheap when the tree matches upstream), hide via catalog
    config
- Provider Google Antigravity (ported 2026-09-05, intake row 3)
  - _What it is:_ ACP driver in the ported zone with a managed `agy_acp_server` runtime; sign-in is
    upstream's own flow (Google URL in the settings provider setup, pasted callback forwarded from
    inside the container)
  - _Zerops path?:_ offered — owner decision 2026-09-04
  - _Decision:_ keep; the zcp agent-auth door for it (spec §8) is a separate product slice; MCP
    attachment is Q-14
- `apps/marketing`
  - _What it is:_ the t3.codes website
  - _Zerops path?:_ none
  - _Decision:_ delete
- T3 in-app preview browser + MCP server (`apps/server/src/mcp/**`, `apps/server/src/preview/**`,
  `apps/web/src/browser/**`, `apps/web/src/components/preview/**`, `apps/desktop/src/preview/**`,
  `packages/contracts/src/preview*.ts`)
  - _What it is:_ an embedded browser panel (webview/`BrowserWindow`-backed) for previewing the
    user's dev server, with click/type/screenshot automation exposed to every provider adapter over
    a local MCP server
  - _Zerops path?:_ none — a Zerops environment is reached over its own public URL, not a
    device-local browser guest
  - _Decision:_ delete as one slice
- The Mate's summary to HQ (`apps/server/src/zerops/zeropsHqSummary.ts`) and HQ's live merge of it
  into the structure (`apps/hq/src/mateLive.ts`)
  - _What it is:_ the link's first upstream message — a Mate's main chat, its running and waiting
    counts and its signers — which HQ merged into every structure it streamed
  - _Zerops path?:_ replaced by the Mate's overview (step A): the Mate sends it
    (`zeropsHqOverview.ts`), HQ keeps it (`mateOverviews.ts`) and streams each Mate's view beside
    the structure
  - _Decision:_ deleted — `b04a59ac81` (A1), `61d9a5e9ba` (A2); the link's `summary` type and its
    schemas with `dd4ea18dd3` (A12)
- Auto-connect (`packages/client-runtime/src/zerops/autoConnect.ts`) and the desktop's keep-alive
  (`apps/web/src/components/RunningThreadKeepAlive.tsx`)
  - _What it is:_ auto-connect wanted every ready Mate of the active organization, up to 48, beside
    every Mate the browser remembered; the keep-alive held a detail stream open for each running
    thread of every saved environment
  - _Zerops path?:_ replaced by leases (step A): a Mate is connected while the route, the Mate on
    screen, the one left last, an action or a Connect holds it, and parked otherwise; what draws a
    Mate this tab has not opened reads HQ's overview of it
  - _Decision:_ deleted — `90f1f5aff7` (auto-connect), `a5d8a35435` (keep-alive), with A9
    (`2a78cb1ede`)

### 4.1 Names

The product identity is Zerops Mate: `mate` is the executable, `zerops-mate` the release package,
`/mate` the base path, `zerops@mate` the unit, `ZCP_MATE_*` the zcp-side envs. Upstream's names —
`t3`, `t3code`, the `T3CODE_*` env vars, the `@t3tools/*` packages, `/.well-known/t3/environment` —
are inherited plumbing and are never renamed: they run through the ported and imported zones, no
user sees them, and renaming them would turn every port into a bespoke merge. The same holds for
keys registered on the platform side: the sign-in hand-over asks for mode `zerops-code`
(`ZEROPS_HANDOVER_APP_MODE`), the value the platform client's registry serves — a rename there is a
platform release, not a string sweep.

Copy is the other way round. What an agent is told about where it runs and what a person reads in
a message names the product Zerops Mate, never "T3 Code" — the owner's call on 2026-09-26.
`scripts/product-name.test.ts` parses every string, template and JSX text literal in
`apps/server/src` and the shared packages and fails on the old name, so a port that brings it back
is reworded in the same slice. Comments and vendor-facing identifiers stay: the Codex originator
`t3code_desktop`, the Grok OAuth referrer `t3code` and the ACP client names identify the client to
a vendor, and `t3.json` is the project file's name.

## 5. How work is done — the zcp loop, transplanted

- **Homes**: general rules → the design guide; domain terms → one domain document; the zcp↔mate
  seam → `../../../../zcp/docs/spec-mate.md` §2.8. Surface, flow and component behaviour → tests
  whose titles are product sentences, with a one-line why for an owner's counterintuitive choice;
  appearance → code. Reasons and reversals → commit messages, never the decision log. Platform
  facts our code relies on → a comment beside that code or a short ledger entry with its verification
  command (one writer). The map → `CLAUDE.md` / `AGENTS.md`; plans are transient. Follow
  `CLAUDE.md`'s “What a doc may hold”; a rewrite keeps every test sentence.
- **Loop per pass or slice** (a tweak or a one-surface change runs its own tier in `CLAUDE.md`,
  "Size the work first"): FRAME → PROVE (live on `z3-eval`) → SHAPE (plan + a `judge` pass; Codex only when the owner asks) →
  BUILD (one worktree per slice, RED → GREEN, Sonnet slices with self-contained briefs, atomic
  commits, no trailers) → ASSEMBLE (targeted tests + typecheck + live smoke through the push loop
  - owner retest pack) → LAND (spec + ledger updated, plan deleted).
- **Verify minimally**: `vp test run <files>` + package typecheck; never the repo-wide suite.
  Live = the push loop to `z3-eval`. Nothing is released before the release gate.
- **Ledger discipline**: subagents report facts as text; one writer edits the ledger.

## 6. Upstream intake — lean

State kept: one `intake.md` (§ next to this file) with the **last-reviewed upstream SHA**, the
decisions taken, and the open security candidates. No per-commit skip bookkeeping.

Standing exclusions, so no intake re-argues them: **upstream's user guides** (the product's are the
Mate's, and they live with Zerops), **Knip** (unconfigured against this tree it calls 199 files
unused; dead surfaces are `check-guard-exceptions.ts` and `surface-manifest.test.ts` against
`surfaces.json`, and the Import zone is `imported.lock`'s), **bot configuration** (no bot reviews
this fork) and **upstream's release pipeline** (zcp owns the binary). Name any of them in a row only
when the reason changes.

Trigger: the drift watch (§7) or a monthly tick, whichever comes first.

**The fork never fetches upstream.** No upstream remote, no upstream refs, no upstream history in
this repository — the owner's rule since row 5. Upstream lives in a scratch clone
(`git clone --filter=blob:none https://github.com/pingdotgg/t3code.git`) where triage runs. A port is
`git format-patch -1 --full-index --binary -M <sha>` in the clone, applied in a fork worktree with
`git apply --3way` after writing only that commit's **preimage blobs** into the fork's object store
(`git -C <clone> cat-file blob <pre> | git hash-object -w --stdin`) — content, never history — so the
3-way merge has its base. Paths the fork deleted are excluded up front; a file the fork keeps at
another path (row 5: `NodeSqliteClient.ts`) is ported by hand. Commits come out as
`port: <sha9> <subject>` with no upstream references (PR numbers, handles, trailers). Row 5's
helpers (`port.py`, `commit.py`, the CI-mirror `gate.sh`) did exactly this; the gate runs every
`ci.yml` Check and Test step by exit code — after `vp install` in a fresh worktree, `hash -r`, or the
shell keeps the main checkout's `vp` and the tests load its vite-plus.

Steps (agent tasks):

1. **Triage** (in the scratch clone): `git log <last-reviewed>..origin/main` → three lists only: (a) **every** commit
   that touches the ported zone (`-- apps/server/src/provider packages/contracts/src/provider*`),
   each either ported or named in the intake row with its reason — a ported-zone commit skipped by
   moving the SHA is a hidden prerequisite of the next intake (row 2 hid eight, every one found as a
   missing symbol under a later port); (b) `fix`/security in auth, http, ws, uploads → cherry-pick candidates; (c) ideas for
   the owner (the only list they read). Everything else is implicitly skipped by moving the SHA.
2. **Import** the wire packages from the new SHA (one commit, lock regenerated; the lock tool's
   write mode resolves `<ref>:<path>` in the fork, where no upstream objects exist, so write the
   lock from the scratch clone's tree OIDs and prove it with `imported-lock.ts --check`). The
   import is formatted with whatever vite-plus upstream used; when upstream moved the catalog, the bump rides in
   the same commit — neither half is green alone (row 3: 0.2.2 → 0.3.0).
3. **Port** the provider commits behind the SPI: matrix row added and
   `node scripts/chat-gate.ts` green. The chat contract gate runs all provider SPI goldens (A),
   all hosted C wire journeys (B), and server/contracts/client-runtime/web plus scenario
   typechecks. It reports each stage's result and duration separately. A proves event translation;
   B proves the built client's response to source evidence, not production server execution.
   Implementation unit tests may be kept, replaced or removed as the implementation changes;
   they do not require restoring obsolete internals or add a third contract boundary. A changed
   public SPI expectation requires an explicit contract/version review, not silent golden regeneration.
   Shared imports/types still require checks of affected desktop/mobile consumers; hosted B proves
   no native-mobile behavior. A port that needs an orchestration/contract change carries it in the
   same slice with a spec note. Live disposable-container vendor validation is optional evidence
   when replay cannot settle a CLI behavior; the gate does not require a paid canary.
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

- **1** — Tag `upstream-base-2026-08-28`; rename `z3` → `main`; ledger row
  - _Status:_ done
- **2** — Adapter SPI + fixtures (§3.2) — the largest item; recorded from `z3-eval` with the real
  CLIs; the Zerops feeds move behind it
  - _Status:_ done 2026-08-29 (live sanity on `z3-eval` pending)
- **3** — `imported.lock` + CI (lock check, changed-package tests, typecheck, architecture test)
  - _Status:_ done 2026-08-29; first run on GitHub-hosted runners 2026-08-30 surfaced seven
    pre-existing failures (ledger), green since `07c3d0d8c`
- **4** — Deletions from §4 marked delete — one slice each (Tailscale is a refactor slice, not a
  `rm`)
  - _Status:_ Tailscale + `apps/marketing` done 2026-08-29; T3 Connect reach removed from the
    relay + client-runtime/web/mobile 2026-08-29 (server-side CLI token manager / boot service →
    S5-5); desktop local spawn/WSL/SSH launch/Clerk removed 2026-08-29 (S5-1)
- **5** — Mirrored model manifest
  - _Status:_ done 2026-08-29
- **6** — Fork `CLAUDE.md` (the map) + this document + `intake.md` row 0
  - _Status:_ done 2026-08-29
- **7** — Versioning `mate v0.1.0`; retire brief §4 rule 6; write `../zcp/docs/spec-mate.md` §7
  - _Status:_ 0.1.0 done; `spec-mate.md` §7 written 2026-08-29; brief rule 6 retired
