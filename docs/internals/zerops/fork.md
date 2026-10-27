# Zerops Mate fork rules

## 1. Identity

Zerops Mate is a hard fork of [T3 Code](https://github.com/pingdotgg/t3code) (MIT).
Upstream is not a merge partner. Wire packages are imported; provider drivers are ported behind
our interface. Everything else is ours.

## 2. The freeze

The upstream baseline is `f94a0d646ed78a4788e4af6417f74202a628a5e9`, tagged
`upstream-base-2026-08-28`. Never merge `upstream/*` or rebase onto `upstream/main`.
Versioning belongs to this fork. The executable is `mate`; the release package is `zerops-mate`.
The zcp↔mate release and environment contract belongs to `../zcp/docs/spec-mate.md` §2.8.

## 3. Zones

- **Imported** — `packages/effect-codex-app-server/**`, `packages/effect-acp/**`.
  Never edit them. Re-import a wire package from an upstream SHA in one `import:` commit.
  `imported.lock` owns its upstream identity and any recorded transform. No unrecorded edit is allowed.
- **Ported** — `apps/server/src/provider/**`, `packages/contracts/src/provider*.ts`,
  `apps/server/src/codexModelOptions.ts`. Port upstream changes behind the SPI; keep our edits minimal.
- **Owned core** — the remaining server and web code, shared packages, desktop and mobile source.
  Upstream changes are optional.
- **Owned product** — `apps/server/src/zerops/**`, `apps/server/src/engine/**`,
  `packages/contracts/src/engine*.ts`, `apps/web/src/zerops/**`, `apps/web/src/components/zerops/**`,
  `packages/client-runtime/src/zerops/**`, `apps/mobile/src/features/zerops/**`,
  `packages/shared/src/{brand,threadStatus,crewHome,crewTemplates}.ts` and
  `docs/internals/zerops/**`. This code is ours only. Client code follows the [design guide](design-system.md).
- **Removed** — delete retired code; do not disable it or preserve compatibility shims.

### 3.1 Boundaries

Imported paths must match their locked upstream trees, accounting only for a recorded transform.
Re-import replaces that transform rather than accumulating local patches.

Ported code imports no Zerops code. Owned product reaches providers only through the
[provider runtime SPI](spi.md). The engine is the product's provider consumer; other product code
reaches conversations through the engine. Zerops services enter the engine through its ports.

### 3.2 Provider ports

Repair a changed provider shape at the SPI boundary, never by teaching product consumers its raw
format. A changed public SPI expectation requires explicit contract/version review; do not silently
regenerate goldens. Shared changes preserve affected desktop and mobile compilation. Synthetic
fixtures prove translation, not native CLI enforcement.

## 4. Product constraints

Keep desktop and mobile source. Release only the hosted web client.
Do not offer upstream desktop or mobile packages to users.

Account-backed Zerops access replaces upstream pairing, managed endpoints and Tailscale.
The container is the product environment; do not restore a local backend or a device-local
preview browser as the primary path. Upstream marketing and release pipelines are excluded.
Provider drivers may remain in the ported tree without being offered in the product catalog.
Any retained activity relay belongs to us to host.

### 4.1 Names

Use Zerops Mate in product copy and agent instructions. Keep inherited plumbing identifiers:
`t3`, `t3code`, `T3CODE_*`, `@t3tools/*`, `t3.json` and `/.well-known/t3/environment`.
Keep vendor-facing identifiers and platform registry keys; changing their spelling is not a copy
edit. The zcp-side names and `/mate` base path belong to the zcp↔mate seam.

## 5. Knowledge homes

Knowledge homes and documentation rules live in
[AGENTS.md](../../../AGENTS.md#where-knowledge-lives).
Worktree, checks and shipping commands live in
[Size the work, then verify](../../../AGENTS.md#size-the-work-then-verify).

## 6. Upstream constraints

Never fetch upstream into this repository: no upstream remote, refs or history. Inspect it in a
scratch clone. A port may bring the necessary preimage blobs, but not upstream history.
Keep ported-zone changes explicit; do not hide skipped prerequisites by advancing a review SHA.
Exclude upstream user guides, bot configuration, release pipelines and unconfigured Knip sweeps.
Keep port commits free of upstream PR numbers, handles and trailers.
