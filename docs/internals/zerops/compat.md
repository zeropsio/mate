# SPI compatibility matrix

One row per port: the ported upstream SHA against the CLI/SDK/Effect versions and fixture set the
SPI was proven against at that point. A new row lands with every port (`spi.md` §8, porting
checklist step 5) — never edited in place; a later row supersedes an earlier one.

| #   | Date       | Ported upstream SHA                                                                                                                                 | Claude CLI              | Claude Agent SDK | Codex CLI                               | Effect                                           | Fixture set                                                                                                                                                                                                                                                                                             | Goldens/driver                                                           | Notes     |
| --- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------- | --------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------- |
| 0   | 2026-08-29 | `f94a0d646` (`upstream-base-2026-08-28`, freeze SHA — `imported.lock`)                                                                              | `2.1.251` (Claude Code) | `0.3.250`        | `0.150.1` on the rig, **not logged in** | `4.0.0-beta.103` (`pnpm-workspace.yaml` catalog) | claude: `plain-text-turn`, `turn-abort-error`, `user-input-requested`, `zerops-workflow-envelope`; codex: `multi-agent-wire`; cursor/grok/opencode: `hello-baseline`                                                                                                                                    | claude 4, codex 1, cursor 1, grok 1, opencode 1 (8 total)                | See below |
| 1   | 2026-09-02 | `827345a07` (`upstream/main`; imported zone re-imported, `imported.lock` regenerated) — 28 ports, see `intake.md`                                   | `2.1.251` (Claude Code) | `0.3.250`        | `0.150.1` on the rig, **not logged in** | `4.0.0-beta.103` (`pnpm-workspace.yaml` catalog) | unchanged from row 0: claude `plain-text-turn`, `turn-abort-error`, `user-input-requested`, `zerops-workflow-envelope`; codex `multi-agent-wire`; cursor/grok/opencode `hello-baseline`                                                                                                                 | claude 4, codex 1, cursor 1, grok 1, opencode 1 (8 total)                | See below |
| 2   | 2026-09-05 | `c8f77e0d4` (`upstream/main`; imported zone re-imported, `imported.lock` regenerated) — 47 ports + 8 recovered from row 1's window, see `intake.md` | `2.1.251` (Claude Code) | `0.3.260`        | `0.150.1` on the rig, **not logged in** | `4.0.0-beta.103` (`pnpm-workspace.yaml` catalog) | claude `plain-text-turn`, `turn-abort-error`, `user-input-requested`, `zerops-workflow-envelope` (goldens regenerated, see notes); codex `multi-agent-wire`; cursor/grok `hello-baseline` (goldens regenerated, additive); opencode `hello-baseline`; **antigravity `hello-baseline` (new, synthetic)** | claude 4, codex 1, cursor 1, grok 1, opencode 1, antigravity 1 (9 total) | See below |

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
