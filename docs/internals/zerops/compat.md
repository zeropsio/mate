# SPI compatibility matrix

One row per port: the ported upstream SHA against the CLI/SDK/Effect versions and fixture set the
SPI was proven against at that point. A new row lands with every port (`spi.md` §8, porting
checklist step 5) — never edited in place; a later row supersedes an earlier one.

- **0** — 2026-08-29
  - _Ported upstream SHA:_ `f94a0d646` (`upstream-base-2026-08-28`, freeze SHA — `imported.lock`)
  - _Claude CLI:_ `2.1.251` (Claude Code)
  - _Claude Agent SDK:_ `0.3.250`
  - _Codex CLI:_ `0.150.1` on the rig, **not logged in**
  - _Effect:_ `4.0.0-beta.103` (`pnpm-workspace.yaml` catalog)
  - _Fixture set:_ claude: `plain-text-turn`, `turn-abort-error`, `user-input-requested`,
    `zerops-workflow-envelope`; codex: `multi-agent-wire`; cursor/grok/opencode: `hello-baseline`
  - _Goldens/driver:_ claude 4, codex 1, cursor 1, grok 1, opencode 1 (8 total)
  - _Notes:_ See below
- **1** — 2026-09-02
  - _Ported upstream SHA:_ `827345a07` (`upstream/main`; imported zone re-imported, `imported.lock`
    regenerated) — 28 ports, see `intake.md`
  - _Claude CLI:_ `2.1.251` (Claude Code)
  - _Claude Agent SDK:_ `0.3.250`
  - _Codex CLI:_ `0.150.1` on the rig, **not logged in**
  - _Effect:_ `4.0.0-beta.103` (`pnpm-workspace.yaml` catalog)
  - _Fixture set:_ unchanged from row 0: claude `plain-text-turn`, `turn-abort-error`,
    `user-input-requested`, `zerops-workflow-envelope`; codex `multi-agent-wire`;
    cursor/grok/opencode `hello-baseline`
  - _Goldens/driver:_ claude 4, codex 1, cursor 1, grok 1, opencode 1 (8 total)
  - _Notes:_ See below
- **2** — 2026-09-05
  - _Ported upstream SHA:_ `c8f77e0d4` (`upstream/main`; imported zone re-imported, `imported.lock`
    regenerated) — 47 ports + 8 recovered from row 1's window, see `intake.md`
  - _Claude CLI:_ `2.1.251` (Claude Code)
  - _Claude Agent SDK:_ `0.3.260`
  - _Codex CLI:_ `0.150.1` on the rig, **not logged in**
  - _Effect:_ `4.0.0-beta.103` (`pnpm-workspace.yaml` catalog)
  - _Fixture set:_ claude `plain-text-turn`, `turn-abort-error`, `user-input-requested`,
    `zerops-workflow-envelope` (goldens regenerated, see notes); codex `multi-agent-wire`;
    cursor/grok `hello-baseline` (goldens regenerated, additive); opencode `hello-baseline`;
    **antigravity `hello-baseline` (new, synthetic)**
  - _Goldens/driver:_ claude 4, codex 1, cursor 1, grok 1, opencode 1, antigravity 1 (9 total)
  - _Notes:_ See below
- **3** — 2026-09-18
  - _Ported upstream SHA:_ `9ea9c3d5d` (`upstream/main`; imported zone re-imported in `2a26e8e76`) —
    provider slice: 75 ports, 12 skipped, see the intake report
  - _Claude CLI:_ `2.1.251` (Claude Code)
  - _Claude Agent SDK:_ `0.3.260`
  - _Codex CLI:_ `0.150.1` on the rig, **not logged in**
  - _Effect:_ `4.0.0-rc.115` (`pnpm-workspace.yaml` catalog)
  - _Fixture set:_ unchanged from row 2; cursor `hello-baseline` golden regenerated (order only, see
    notes)
  - _Goldens/driver:_ claude 4, codex 1, cursor 1, grok 1, opencode 1, antigravity 1 (9 total)
  - _Notes:_ See below
- **4** — 2026-09-25
  - _Ported upstream SHA:_ `7a12aff47` (`upstream/main`; imported zone re-imported in `f5c49952c`) —
    provider slice: 19 ports + the import (which also carries `de6a230db` and `567783ecd`), 1
    blocked on the core slice, see the intake report
  - _Claude CLI:_ `2.1.251` (Claude Code)
  - _Claude Agent SDK:_ `0.3.276`
  - _Codex CLI:_ `0.155.1` measured against the new protocol (a local build, not the rig); fixture
    `0.145.0`
  - _Effect:_ `4.0.0-rc.115` (`pnpm-workspace.yaml` catalog)
  - _Fixture set:_ unchanged from row 3; codex `multi-agent-wire` gains `projectId: null` on its one
    thread, its golden moves by that field
  - _Goldens/driver:_ claude 4, codex 1, cursor 1, grok 1, opencode 1, antigravity 1 (9 total)
  - _Notes:_ See below
- **5** — 2026-09-27
  - _Ported upstream SHA:_ none — no import or port; a fork-side ported-zone edit for the crew
    policy seam (`ClaudeAdapter.ts`, `providerRuntime.ts`), see the notes
  - _Claude CLI:_ `2.1.251` (Claude Code)
  - _Claude Agent SDK:_ `0.3.276`
  - _Codex CLI:_ unchanged from row 4
  - _Effect:_ `4.0.0-rc.115` (`pnpm-workspace.yaml` catalog)
  - _Fixture set:_ row 4 + claude `crew-hooks` (new, synthetic); the four Claude goldens gain
    `terminalReason`
  - _Goldens/driver:_ claude 5, codex 1, cursor 1, grok 1, opencode 1, antigravity 1 (10 total)
  - _Notes:_ See below
- **6** — 2026-09-27
  - _Ported upstream SHA:_ none — no import or port; a fork-side ported-zone edit for the Codex crew
    seam (`CodexAdapter.ts`, `CodexSessionRuntime.ts`), see the notes
  - _Claude CLI:_ unchanged from row 5
  - _Claude Agent SDK:_ unchanged from row 5
  - _Codex CLI:_ unchanged from row 4
  - _Effect:_ unchanged from row 5
  - _Fixture set:_ row 5; no replay golden moved
  - _Goldens/driver:_ unchanged from row 5
  - _Notes:_ See below
- **7** — 2026-10-07
  - _Ported upstream SHA:_ `10f39eb9a` (nightly `v0.0.46-nightly.20261007.2761`; imported zone
    re-imported at `422248515` in `2d0691977`) — provider slice: 19 ports + the import + 2 fork
    fixes, see `intake.md`
  - _Claude CLI:_ unchanged from row 5
  - _Claude Agent SDK:_ unchanged from row 5
  - _Codex CLI:_ floor `0.155.1` unchanged; no field became required in the new protocol (checked
    offline); a live 0.155.1 decode was not run
  - _Antigravity:_ `1.3.0` ported (`4dbc0129c`), **needs a live turn**; the manifest stays `=1.1.1`
  - _Effect:_ unchanged from row 5
  - _Fixture set:_ row 5; no replay golden moved (chat-gate A byte-identical)
  - _Goldens/driver:_ unchanged from row 5
  - _Notes:_ See below

## Row 0 notes

- **Claude**: all 4 fixtures are real recordings from `z3-eval`'s `zcp` service, captured
  2026-08-29 with the CLI/SDK versions above and model `claude-opus-5[1m]`
  (`fixtures/claude/*.meta.json`).
- **Codex**: `multi-agent-wire` is not a recording from this rig — Codex is not logged in on
  `z3-eval`. It is `apps/server/src/provider/testFixtures/codexMultiAgentWire.json` (an existing
  upstream ported-zone test fixture, itself a real wire capture) converted once to the SPI JSONL
  format; its own `meta.json` records `codex-cli 0.145.0`, the version that capture was made
  with — **not** the rig's installed `0.150.1`. Treat the Codex column as "rig has 0.150.1
  installed, unverified against a live session" until a logged-in capture replaces this row.
- **Cursor/Grok/OpenCode**: no CLI/SDK version applies — these three goldens are not wire
  captures. Cursor and Grok replay `apps/server/scripts/acp-mock-agent.ts` (a scripted ACP peer)
  through the real, unmodified `makeCursorAdapter`/`makeGrokAdapter`; OpenCode replays a canned
  SSE sequence through the real `makeOpenCodeAdapter` against a minimal test double of
  `OpenCodeRuntime`. All three are `synthetic: true` — see `spi.md` §7.
- **Effect**: the workspace-wide `effect` catalog version; every `@effect/*` package pins to the
  same catalog entry (`pnpm-workspace.yaml`).

## Row 1 notes

- **No fixture was re-recorded.** Every `.jsonl` and `.meta.json` is byte-identical to row 0, so
  the CLI/SDK/Codex columns carry row 0's provenance unchanged. Three of the eight goldens moved,
  all three explained below; the other five are untouched.
- **Claude goldens moved on `c131f2892`** ("stop querying Claude context usage after turns").
  `zerops-workflow-envelope` (39 events) and `user-input-requested` (21 events) keep a
  **byte-identical event-kind sequence** — only three numbers change (`usedTokens`,
  `lastUsedTokens`, `outputTokens` on the final `thread.token-usage.updated`), because the removed
  post-turn re-query no longer pads the last snapshot. `turn-abort-error` goes 14 → 15 events,
  gaining a `thread.token-usage.updated` before `turn.completed`: the abort path previously emitted
  no usage update at all and now derives one from the result message. `plain-text-turn` unchanged.
  No `zerops_workflow`/`zerops_mount` tool-call content and no StateEnvelope content was lost —
  verified by diffing the kind sequences and grepping the envelope golden.
- **Cursor + Grok goldens moved on `a434677ec`**, purely additively (+40 lines each, zero
  removals): `scripts/acp-mock-agent.ts`, which both live baselines drive, now advertises
  `_meta.modelState` on `initialize` as part of that commit's own diff.
- **The OpenCode golden did NOT move**, and that is the interesting one. `cb49e5d72` made it
  diverge (6 events vs 5, a new `runtime.warning`), but the cause was **fixture incompleteness, not
  a driver reshape**: the adapter's new startup path waits on a `server.connected` SSE event and
  then runs pending-request recovery (`permission.list()`/`question.list()`), none of which the fake
  SDK client in `replay/openCodeReplay.ts` provided. Completing the fake restored the golden with
  zero changes. **Root-cause a divergence before reaching for `SPI_UPDATE_GOLDENS=1`.**
- **`SPI_UPDATE_GOLDENS=1` writes unformatted JSON** (arrays one element per line). A `vp fmt` pass
  is required afterwards or the diff is drowned in formatting noise that reads like a real change.

## Row 2 notes

- **No fixture was re-recorded.** The eight `.jsonl`/`.meta.json` from row 0 are byte-identical; the
  CLI/SDK/Codex columns carry row 0's provenance. The SDK column is the npm dependency the adapter
  compiles against (`560afffde`), not a new recording. The ninth golden, `antigravity/hello-baseline`,
  is a new synthetic recording: `apps/server/scripts/acp-mock-agent.ts` (its existing
  `T3_ACP_ANTIGRAVITY=1` profile) through the real, unmodified `makeAntigravityAdapter`, driver
  install/profile/Google-auth bypassed at the `makeRuntime`/`withProcess` seam the driver itself uses.
- **Claude goldens moved on `19d8ab2ae`** (usage limits): each of the four loses exactly one
  `account.rate-limits.updated` (`evt-7`); every other hunk is an `eventId` renumbered by one. Root
  cause is upstream's design, not fixture incompleteness: the new normaliser
  (`provider/Layers/claudeUsageLimits.ts`) returns nothing unless `rate_limit_info.utilization` is a
  flat number, and the 2.1.251 CLI these fixtures were recorded from emits utilization only under
  `unifiedWindows.{five_hour,seven_day}`. Usage limits arrive on the driver snapshot (`get_usage`
  probe) instead. No `thread.token-usage.updated` value, tool-call payload or envelope content changed
  in `zerops-workflow-envelope`. Consequence for a 2.1.251 CLI: mid-turn Claude limit updates are
  dropped and the Limits tab rests on the probe (`questions.md` Q-15).
- **Cursor + Grok goldens moved on `06336460c`** (Antigravity), additively: the mock agent now
  advertises `sessionCapabilities: { resume: {} }` on `initialize`, so `session.started`'s
  `agentCapabilities` gains that one field. Same event-kind sequence.
- **The OpenCode golden did not move.** `01f3e50ec` (approvals/stop) made the replay hang 15 s:
  `replay/openCodeReplay.ts`'s canned SSE generator waited on a raw Promise that fiber interruption
  cannot settle; it now waits on the `AbortSignal` the adapter passes to `event.subscribe` and aborts
  in its finalizer. Test-double fix only; the adapter is byte-identical to upstream there.
- **`560afffde` (SDK 0.3.260) moved no golden**; the `terminal_reason`/529 classification it adds is
  not exercised by the four recorded turns.

## Row 3 notes

- **Provider slice only.** This row covers the provider-zone commits of the 2026-09-18 intake
  (`apps/server/src/provider/**`, provider contracts, `codexModelOptions.ts`). The other slices of
  the same intake add their own notes. No fixture was re-recorded; every `.jsonl`/`.meta.json` is
  byte-identical to row 2, so the CLI/SDK/Codex columns carry row 0's provenance. The Effect column
  is the catalog version the import commit moved to.
- **The Cursor golden moved on `6134b90ff`** (Cursor transport errors), and only in order:
  `item.completed` for the assistant message now arrives before `turn.completed` (it was after).
  Both events and their payloads are unchanged.
- **The Claude goldens did not move on `052c7ae53`** (thinking traces), although the adapter now
  asks for summarized thinking and emits `content.delta` with `streamKind: "reasoning_summary_text"`.
  None of the four recorded turns has a thinking block. The first thinking-bearing recording will
  show those deltas; `reasoning_summary_text` is an existing stream kind, so the event union is
  unchanged.
- **The SPI stays at 2.3.** `b7d6e6502` adds `tool.denied` to the runtime event-type literal list,
  but the `ProviderRuntimeToolDeniedEvent` member was already in the union, so no member changes.
  The new `reasoning` message role and its commands are orchestration contracts and are not part of
  `ProviderRuntimeEventV2`.
- **`usage/cliproxyUsageLimits.ts` is gone** (`0a89364f1`); `usage/cliproxyApi.ts` replaces it.
  `spi.md` §6 names the new consumer of `usageLimitsSupport.ts`.

## Row 4 notes

- **Provider slice only**, as row 3. The import pins upstream `7a12aff47` (the range end), so the
  import-zone half of `568c9bc4d` (Effect language-service cleanup, landing last) is already in.
- **The Codex protocol moved to 0.156; the fork's floor did not.** Measured 2026-09-25 with the
  `codex-cli` 0.155.1 and 0.156.0 npm builds (darwin-arm64) and their own
  `app-server generate-json-schema`: between the two the only removal is `thread/rollback`, and no
  field became required. A 0.155.1 app-server's `initialize`, `thread/start`, `thread/started`,
  `thread/read`, `account/read`, `model/list`, `config/read` and `skills/list` decode under the
  imported schema (a missing `Thread.projectId` fails, so the check is not vacuous). 0.155.1 starts
  threads `paginated`, already sends `projectId` and `isBlocking`, accepts `params: null` on
  `account/rateLimits/read`, marks `thread/rollback` deprecated, and supports the experimental
  `turn/start.additionalContext` and `thread/inject_items` that `6391be272` uses. The manifest keeps
  Codex `>=0.155.1` supported where upstream requires `>=0.156.0`.
- **The codex golden moved by one raw field.** `multi-agent-wire` is a 0.145.0 capture without
  `Thread.projectId`, which the new schema requires (Codex 0.149 on); its `thread/started` failed to
  decode and dropped `thread.started`. The fixture gains `"projectId": null`, the edit upstream made
  to the file it was converted from; the golden gains that one field in `raw`. No event kind moved.
- **The ACP goldens did not move** on `e759847f9`, although `acp-mock-agent.ts` gained a
  tool-progress scenario: the baselines do not drive it.
- **SPI stays at 2.3.** `efb96939f` adds `permission_approval` to `CanonicalRequestType` and
  `permission` to `ProviderRequestKind`; no owned-product code reads either, and no event member
  changed. `9cb586acd` deletes the unused `ProviderRuntimeEventType` literal list, not a member.
- **`driverHomes.claudeHomePath` changed meaning** (`63ff33756`): an unconfigured Claude home is now
  `~/.claude` (or an inherited `CLAUDE_CONFIG_DIR`), no longer the bare home directory. The contract
  test moved with it; nothing owned reads the value.

## Row 5 notes

- **Not a port.** The upstream SHA is row 4's. The row exists because a fork-side edit in the
  ported zone moved goldens: the crew policy seam (`spi.md` §1a) and SPI 2.5.
- **The four Claude goldens gain `terminalReason`.** The recordings already carry
  `terminal_reason`, so each `turn.completed` gains exactly that field (`completed` ×3,
  `aborted_streaming` ×1); no other golden moved.
- **`crew-hooks` is hand-authored** (`synthetic: true`; its meta names CLI 2.1.283, but nothing was
  recorded) and replays with `replay/crewReplayPolicy.ts`. It is the only golden that pins
  `permissionMode: "dontAsk"` and a hook round trip. A recording from probes 1, 2, 14 and 15
  replaces it.
- **What a port must carry.** The adapter edit sits in six places: the imports, the registry read
  when the adapter is built, and at session start the profile, the model selection, the permission
  fold and the patched options; in `sendTurn` the model selection; the `turn.completed` emit. A
  port that rewrites those lines re-applies them; `claudeNoCrewSnapshot.test.ts` fails if a port
  changes what a thread without a profile gets, and the Ported↔spi zone rule fails if the adapter
  imports any other `spi/` file.

## Row 6 notes

- **Not a port.** The upstream SHA is row 4's. The row exists because a fork-side edit in the
  ported zone must be re-applied by the next port: the Codex side of the crew policy seam
  (`spi.md` §1a). No replay golden moved; the new `fixtures/codex-options/no-crew.expected.json`
  is not a replay golden.
- **What a port must carry.** `CodexAdapter.ts`: the `spi/codexThreadProfile.ts` import, the
  registry read when the adapter is built (`readCodexThreadPolicies`), `codexThreadStart` at
  session start (model, service tier and `threadSetup` into the runtime options) and
  `codexTurnModelSelection` in `sendTurn`. `CodexSessionRuntime.ts`: `threadSetup` on the runtime
  options; `overrides` through `buildThreadStartParams`, `openCodexThread` and
  `buildTurnStartParams` (laid over the runtime mode's policy and sandbox); the `item/started` and
  `item/completed` handlers that keep a gated thread's file changes; `correlateGated`, which
  records a gated answer's request kind for its `serverRequest/resolved`; and the gated branch at
  the top of the command, file change, MCP elicitation and permissions approval handlers. A port that
  rewrites those lines re-applies them; `codexNoCrewSnapshot.test.ts` fails if a port changes what
  a thread without a profile gets, `codexThreadProfile.contract.test.ts` if the seam is lost, and
  the Ported↔spi zone rule if either file imports any other `spi/` file.

## Row 7 notes

- **The import pins `422248515`, not the range end.** At `10f39eb9a` effect-acp is rewritten for
  the V2 orchestrator and Effect 4.0.1, which the fork declines; `422248515` is the last commit
  whose wire packages still serve the V1 adapters. effect-codex-app-server moves (tree `3ab6b38f6`),
  effect-acp does not (`1c70adfcc`).
- **The Codex protocol gains no required field.** Parsing every object type in `schema.gen.ts`
  before and after the import: 993 types, 2009 required fields, none added, none removed. The live
  decode of a real Codex 0.155.1 session against the new import is still owed.
- **Antigravity 1.3.0 is unproven.** `4dbc0129c` pins the sha256-checked `agy` 1.3.0 download, but
  no turn has run against the fork's effect-acp. An installed 1.3.0 resolves to `unknown` until one
  live turn passes and the manifest range moves to `=1.3.0`.
- **SPI stays at 2.6.** The interim effect-acp guard (`81ebf0815`) wraps every session-update
  handler in `AcpSessionRuntime.ts` with a logged defect catch; it changes no event member.
