# The provider runtime SPI

The declared contract between the **ported** driver zone (`apps/server/src/provider/**`,
`packages/contracts/src/provider*.ts`) and everything **owned** that consumes provider events. A
port that drops or reshapes a lifecycle event fails a test here, not at runtime for a user.
Enforcement: `scripts/mate-zone-architecture.test.ts`'s four rules — ported zone imports nothing
matching `zerops`; owned product reaches providers only through the SPI; only `spi/**` and one
named exception (`provider/Services/ProviderInstanceRegistry.ts`, consumed directly by
`TextGeneration.ts`'s `resolveInstance`) may import provider internals from
`textGeneration/**`/`usage/**`; owned product never contains the literal text `payload.data`.

## 1. The boundary

The SPI surface is `ProviderRuntimeEventV2` (49 `type`-discriminated members,
`packages/contracts/src/providerRuntime.ts`, upstream's file — never moved/renamed so a port never
re-applies a move) plus the `streamEvents` port, re-declared with a version and changelog in the
one owned file `packages/contracts/src/providerRuntimeSpi.ts`. Owned code never reads the raw port
directly: `apps/server/src/spi/ProviderRuntimeEventBus.ts` wraps it in a `Context.Service` tag
exposing `events: Stream<SpiEvent>` (the raw union plus an enrichment) and `enrichmentFailures:
Stream<SpiEnrichmentFailure>` (§5). Today only `apps/server/src/zerops/**` consumes the bus —
`ZeropsLifecycle.ts:243` and `ZeropsTopology.ts:331` both do `yield* ProviderRuntimeEventBus`.
`apps/server/src/orchestration/**` does not yet (§9).

Consumers never read `payload.data` (a driver's raw, per-provider item shape) — that is
`toolCall.ts`'s job alone (§5); everything downstream reads `event.toolCall`
(`zeropsToolResult.ts:31`, `zeropsActivityResult.ts:51-53`).

## 2. Version + changelog

`PROVIDER_RUNTIME_SPI_VERSION` is `"2.3"` (`providerRuntimeSpi.ts`). Bump it, and add a
changelog entry in that file's doc comment, whenever a change to `ProviderRuntimeEventV2` or the
`toolCall` enrichment changes what owned code may depend on — a new member, a renamed field, a
narrowed payload shape. 2.2 (S8b) added an optional `images`/`imagesDropped` on `SpiToolCall.result`,
read from an MCP result's image content blocks — the `zerops_browser` screenshot is the first
consumer; a reader that does not know about `images` still gets `text` exactly as before. 2.3
(intake row 3, 2026-09-05) renames `account.rate-limits.updated`'s payload to a typed `limits`
(the snapshot's `usageLimits` is the primary carrier) and adds optional `beforeTokens`/`afterTokens`
to `thread.state.changed` for context compaction. The bus
carries its build-time version (`bus.version`,
`ProviderRuntimeEventBus.ts:39-43`) as a hook for a future adapter-version gate at startup — that
gate is a **stated intent, not implemented**; nothing reads `bus.version` today (the "exposes the
SPI version it was built against" test only proves the field itself works).

## 3. Event kinds owned code depends on

Verified by grepping `zerops/**` and `orchestration/**` for each event's `type` discriminant:

- `item.started`/`item.updated`/`item.completed` — `ZeropsLifecycle.ts:180,208`, `ZeropsTopology.ts:305`, `orchestration/Layers/ProviderRuntimeIngestion.ts:792,827,855`.
- `user-input.requested`/`user-input.resolved` — `orchestration/decider.ts:75,77,1395`, `orchestration/Layers/ProjectionPipeline.ts:147-182`, `.../ProviderRuntimeIngestion.ts:511,529,1714`.
- `turn.started`/`turn.completed` (incl. the `state: "interrupted"` variant) — `orchestration/Layers/CheckpointReactor.ts:945,950,1012`, `.../ProviderRuntimeIngestion.ts:1531-1624,1846,1979`, `.../ProjectionPipeline.ts:1364,1408,1422`.
- `runtime.error` — `.../ProviderRuntimeIngestion.ts:434,440,1886`.
- `thread.state.changed` — `.../ProviderRuntimeIngestion.ts:750`.

## 4. Delivery guarantee

Measured directly against `ProviderService.ts` in `ProviderRuntimeEventBus.test.ts` (D6): the
pubsub backing `streamEvents` is `PubSub.unbounded` and every access of the getter returns a
**fresh** subscription. So: **lossless while subscribed** — `publish` never blocks and a
subscriber's queue never drops an accepted message, even one that has fallen behind and stopped
pulling (proved by "a subscriber that stops pulling never blocks the producer or another
subscriber, and loses nothing once it resumes"); **no replay** — an event published before a
subscription starts running is invisible to it (proved by "an event published before a subscriber
starts running is invisible to it"). `ProviderRuntimeEventBus` adds exactly one synchronous
per-element transform (the `toolCall` enrichment) and no buffering of its own, so the guarantee
holds through the bus too (proved by "adds no buffering of its own — a subscriber that starts late
still misses only what a late ProviderService subscriber would miss").

## 5. Enrichment failure semantics

`apps/server/src/spi/toolCall.ts` is the one place that reads `payload.data`. `readToolCall`
returns `toolCall` (recognized), `notATool` (the item's classified `itemType` is not
tool-lifecycle, or the provider has no reader — cursor/grok/opencode have none), or
`unrecognized` — only when `isToolLifecycleItemType(payload.itemType)` is true (the driver itself
classified this as a tool call) but the reader could not decode `data`. `unrecognized` never
collapses to a silent `undefined`: the bus's `enrich` publishes every occurrence onto
`enrichmentFailures` and logs `Effect.logWarning` once per `(provider, itemType, reason)`
signature over its lifetime — pinned by "reports an enrichment failure..." and "logs the
enrichment-failure warning once per ... signature, even across many events". The event itself is
never dropped; a failed enrichment just leaves `event.toolCall` absent. Readers exist for
`claudeAgent` and `codex` only (`toolCall.ts`'s `READERS` map).

## 6. Typed capabilities

Each wraps ported driver internals behind an owned, typed surface with its own contract test —
`textGeneration/**`/`usage/**` depend on the wrapper, never the driver file, so a port that
changes the wrapped shape fails the named test, not a spawn call site:

- **`driverHomes.ts`** — `claudeHomePath`, `claudeEnvironment`, `codexHomeLayout`; wraps `provider/Drivers/ClaudeHome.ts` + `CodexHomeLayout.ts`. Test: `driverHomes.test.ts`.
- **`driverLaunch.ts`** — `resolveCodexLaunchArgs`, `codexExecLaunchArgs`; wraps `provider/Layers/codexLaunchArgs.ts`. Test: `driverLaunch.test.ts`.
- **`acpSupport.ts`** — `makeCursorAcpRuntime`/`makeGrokAcpRuntime`, model-selection application + extraction for both; wraps `provider/acp/{Cursor,Grok}AcpSupport.ts`. Test: `acpSupport.test.ts`.
- **`claudeProvider.ts`** — `getClaudeModelCapabilities`, `resolveClaudeEffort`, `normalizeClaudeCliEffort`, `isClaudeUltracodeEffort`, `resolveClaudeApiModelId`; wraps `provider/Layers/ClaudeProvider.ts`. Test: `claudeProvider.test.ts`.
- **`openCodeRuntime.ts`** — `openCodeRuntimeCapability` (narrowed to 2 of the driver's 6-member `OpenCodeRuntimeShape`: `startOpenCodeServerProcess` + `createOpenCodeSdkClient`), plus `openCodeRuntimeErrorDetail`/`parseOpenCodeModelSlug`/`toOpenCodeFileParts`; wraps `provider/opencodeRuntime.ts`. Test: `openCodeRuntime.test.ts`.
- **`antigravityAcp.ts`** — `AntigravityTextRuntime` (a member-list narrowing of the driver's `AcpSessionRuntime`, pinned by typecheck), `applyAntigravityAcpModelSelection`, `removeAntigravitySessionFiles`; wraps `provider/acp/AntigravityAcpSupport.ts` for `textGeneration/AntigravityTextGeneration.ts`. Test: the re-exported helpers through `provider/acp/AntigravityAcpSupport.test.ts`; no contract test of its own yet.
- **`usageLimitsSupport.ts`** — `codexPlanLabel`, `clampPercent`, `makeUsageLimits`; wraps `provider/Layers/CodexProvider.ts` + `provider/providerUsageLimits.ts` for `usage/cliproxyUsageLimits.ts`. Test: `usageLimitsSupport.test.ts`.

`ProviderRegistryTest.ts`/`ProviderInstanceTest.ts` are not capabilities — owned test-only fakes so
a test outside `spi/**` never has to import driver internals to satisfy those tags.

## 7. Fixtures

A fixture is `apps/server/src/spi/fixtures/<driver>/<name>.jsonl` (`types.ts`: lines are either
`{"kind":"message","message":<raw wire message>}` or `{"kind":"control","name":...,"args":...,
"answer":...}`) plus a sidecar `<name>.meta.json` (`driver`, `cliVersion`, `sdkVersion`/`model`,
`capturedAt/On/By`, `notes`, `synthetic`). `loader.ts`'s `loadFixture` parses both, naming the file
and line on any structural error. Cursor/Grok/OpenCode have no `.jsonl` — those drivers speak to a
real child process or SDK client, so their "fixture" is meta-only, documenting a fixed
deterministic scenario (`replay/acpReplay.ts`, `replay/openCodeReplay.ts`) driven live each run,
`synthetic: true`.

**Recording** (Claude only, `recording/record-claude.mjs` + its `README.md`): run on a container
with the Claude Agent SDK installed and Claude Code logged in (`z3-eval`'s `zcp` service); `scp`
the zero-dependency script over, then e.g. `node record-claude.mjs --prompt "..." --out
plain-text-turn.jsonl`. It drives `@anthropic-ai/claude-agent-sdk`'s `query()` directly with the
same streaming-input options `ClaudeAdapter.ts` passes, teeing every `SDKMessage` and control
callback invocation to the JSONL. `--allowed-tools` (default: read-only `zerops_workflow`/
`zerops_mount`/`zerops_discover`) is a recorder-side `canUseTool` gate, not an SDK option — never
widen it to a mutating tool on a shared rig. `synthetic: true` marks a fixture hand-authored to
prove a code path rather than recorded from a real driver run.

**Regenerating goldens**: `goldens.test.ts` runs every driver's replay/record function
(`replayClaude`/`replayCodex` for the two JSONL drivers; `recordCursorBaseline`/
`recordGrokBaseline`/`recordOpenCodeBaseline` for the three live ones), applies `applyToolCall`
(goldens pin the enriched bus shape, not the driver's raw output), redacts, then diffs against the
checked-in `<name>.expected.json` via `checkOrUpdateGolden`. Set `SPI_UPDATE_GOLDENS=1` to rewrite
every golden instead of comparing — state the reason in the commit message; nothing enforces that
except review.

**Redaction** (`redact.ts`, pure over an already-produced event list): `eventId` → `evt-<index>`;
`createdAt` → the fixed `REDACTED_CREATED_AT` placeholder; every value of a `turnId`/
`providerTurnId`, `itemId`/`providerItemId`, or `requestId`/`providerRequestId` field is rewritten
**by value**, wherever it occurs (nested in `payload`/`raw` too), to a stable
`turn-<n>`/`item-<n>`/`req-<n>` so two events sharing a real id keep sharing their placeholder; any
string equal to (or path-prefixed by) `process.cwd()`, `os.homedir()`, or `os.tmpdir()` becomes
`<CWD>`/`<HOME>`/`<TMPDIR>`, longest path first.

Current set: 4 Claude fixtures (real recordings, SDK 0.3.250 / CLI 2.1.251 / `claude-opus-5[1m]`)

- 1 Codex fixture (`multi-agent-wire`, converted once from the upstream ported-zone test fixture
  `testFixtures/codexMultiAgentWire.json`, `synthetic: false`) + 4 live baselines (cursor, grok,
  antigravity, opencode, each `synthetic: true`) = 9 goldens total.

## 8. Porting checklist

1. **Import the wire packages** — regenerate `imported.lock` from the new upstream ref: `imported-lock --write --upstream <ref>` (`scripts/imported-lock.ts`); it refuses to write if HEAD has diverged from the ref for either imported path (an import must stay byte-identical).
2. **Port the driver commits** behind the SPI, minimally — the ported zone (`provider/**`, `packages/effect-codex-app-server/**`, `packages/effect-acp/**`) must still import nothing matching `zerops`.
3. **Run the goldens** (`replay/goldens.test.ts`) **+ the zone test** (`scripts/mate-zone-architecture.test.ts`) **+ package typecheck**.
4. If a golden diverges: fix `toolCall.ts`'s readers or the typed capabilities (§6) to match the new driver shape — **never edit `apps/server/src/zerops/**`to chase a driver change**; that tree only ever reads`event.toolCall`, never `payload.data`.
5. Add a `compat.md` row for the new port.
6. Bump `PROVIDER_RUNTIME_SPI_VERSION` (§2) only when the change alters what owned code may depend on — not for every port.

## 9. Known gaps

- `orchestration/Layers/ProviderRuntimeIngestion.ts` and `CheckpointReactor.ts` read `ProviderService.streamEvents` directly (`ProviderRuntimeIngestion.ts:32,896,2071`) — **by design, not a gap**: orchestration is owned core, the service tags are its sanctioned seam (`fork.md` §3), durable ingestion must sit on the raw lossless stream before any observational fan-out, and it needs no `toolCall`. The bus + enrichment are the owned-product boundary (`zerops/**`), which is exactly what the zone test scans. Revisit only if orchestration ever needs the enriched view.
- Codex's collab-agent synthesis (`CodexSessionRuntime`'s child-registration step) is not replayed — `replay/codexReplay.ts` addresses each captured notification at its own wire `threadId` directly rather than through that synthesis path (covered elsewhere by `CodexCollabWire.test.ts`/`CodexCollabRuntime.integration.test.ts`).
- Claude's `onUserDialog` control line is not replayed — `replay/claudeReplay.ts` implements only `canUseTool`; a fixture with an `onUserDialog` line throws naming the gap.
- Codex non-MCP tool items (`commandExecution`, `fileChange`, `collabAgentToolCall`, `webSearch`, ...) are `unrecognized` by design — the Codex reader only decodes the `mcpToolCall` item variant.
- `openCodeRuntimeCapability`'s Effect keeps the driver's own `OpenCodeRuntime.OpenCodeRuntime` Context.Service tag identity rather than declaring an owned tag — the narrowing is in the returned shape, not the dependency it resolves through.
