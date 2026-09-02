# SPI compatibility matrix

One row per port: the ported upstream SHA against the CLI/SDK/Effect versions and fixture set the
SPI was proven against at that point. A new row lands with every port (`spi.md` §8, porting
checklist step 5) — never edited in place; a later row supersedes an earlier one.

| #   | Date       | Ported upstream SHA                                                                                               | Claude CLI              | Claude Agent SDK | Codex CLI                               | Effect                                           | Fixture set                                                                                                                                                                             | Goldens/driver                                            | Notes     |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------- | --------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------- |
| 0   | 2026-08-29 | `f94a0d646` (`upstream-base-2026-08-28`, freeze SHA — `imported.lock`)                                            | `2.1.251` (Claude Code) | `0.3.250`        | `0.150.1` on the rig, **not logged in** | `4.0.0-beta.103` (`pnpm-workspace.yaml` catalog) | claude: `plain-text-turn`, `turn-abort-error`, `user-input-requested`, `zerops-workflow-envelope`; codex: `multi-agent-wire`; cursor/grok/opencode: `hello-baseline`                    | claude 4, codex 1, cursor 1, grok 1, opencode 1 (8 total) | See below |
| 1   | 2026-09-02 | `827345a07` (`upstream/main`; imported zone re-imported, `imported.lock` regenerated) — 28 ports, see `intake.md` | `2.1.251` (Claude Code) | `0.3.250`        | `0.150.1` on the rig, **not logged in** | `4.0.0-beta.103` (`pnpm-workspace.yaml` catalog) | unchanged from row 0: claude `plain-text-turn`, `turn-abort-error`, `user-input-requested`, `zerops-workflow-envelope`; codex `multi-agent-wire`; cursor/grok/opencode `hello-baseline` | claude 4, codex 1, cursor 1, grok 1, opencode 1 (8 total) | See below |

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
