# The provider runtime SPI

The declared contract between the **ported** driver zone (`apps/server/src/provider/**`,
`packages/contracts/src/provider*.ts`) and everything **owned** that consumes provider events. A
port that drops or reshapes a lifecycle event fails a test here, not at runtime for a user.
Enforcement: `scripts/mate-zone-architecture.test.ts`'s five rules — ported zone imports nothing
matching `zerops`; owned product reaches providers only through the SPI; only `spi/**` and one
named exception (`provider/Services/ProviderInstanceRegistry.ts`, consumed directly by
`TextGeneration.ts`'s `resolveInstance`) may import provider internals from
`textGeneration/**`/`usage/**`; owned product never contains the literal text `payload.data`; and
the Ported↔spi rule — `provider/**` imports from `spi/` only the inbound files of §1a, which import
only each other.

## 1. The boundary

The SPI surface is `ProviderRuntimeEventV2` (the `type`-discriminated event union,
`packages/contracts/src/providerRuntime.ts`, upstream's file — never moved/renamed so a port never
re-applies a move) plus the `streamEvents` port, re-declared with a version and changelog in the
one owned file `packages/contracts/src/providerRuntimeSpi.ts`. Owned code never reads the raw port
directly: `apps/server/src/spi/ProviderRuntimeEventBus.ts` wraps it in a `Context.Service` tag
exposing `events: Stream<SpiEvent>` (the raw union plus an enrichment) and `enrichmentFailures:
Stream<SpiEnrichmentFailure>` (§5). Today only `apps/server/src/zerops/**` consumes the bus —
`ZeropsLifecycle.ts:309` and `ZeropsAgentAuth.ts:927` both do `yield* ProviderRuntimeEventBus`.
`apps/server/src/orchestration/**` does not yet (§9).

Consumers never read `payload.data` (a driver's raw, per-provider item shape) — that is
`toolCall.ts`'s job alone (§5); everything downstream reads `event.toolCall`
(`zeropsToolResult.ts:31`, `zeropsActivityResult.ts:51-53`).

## 1a. The inbound direction: thread tool policy

Everything above wraps the ported zone from outside. A few files point the other way, so a driver can
ask owned code how to run one thread (the ACP, OpenCode and MCP-server ones are listed under _The ACP
and OpenCode seams_ below): `apps/server/src/spi/threadToolPolicy.ts` (provider-neutral —
`ThreadToolProfile`, `ToolDecision`, `ThreadToolPolicy`, `ThreadToolPolicyRegistry`),
`apps/server/src/spi/claudeThreadProfile.ts` (Claude's extension — `ClaudeThreadExtension`,
`ClaudeThreadExtensionRegistry`, and `claudeQueryOptionsPatch`, the translation of a profile into SDK
options) and `apps/server/src/spi/codexThreadProfile.ts` (Codex's — `codexThreadSetup`, the
translation of a profile into thread and turn params and an approval gate), and `apps/server/src/spi/mcpControl.ts`
(the MCP tab's one driver hook, `ProviderAdapterShape.mcp`, built from Claude's, Codex's and OpenCode's
native MCP calls; `mcpLive.ts` routes it across the instances from outside), and
`apps/server/src/spi/mcpToolTitle.ts` (the whole-name rule an ACP call's title names an MCP tool by,
shared by the ACP gate and the tool-call reader; it imports nothing), and
`apps/server/src/spi/responseUsage.ts` (normalizes only completed native response meters, with no
provider or owned-service imports). They are the only `spi/`
files `provider/**` may import, and they import only each other and packages (effect, contracts, the
Claude Agent SDK, the Codex app-server schema) — any other spi file reaches `provider/**`, so one hop
through it would make the two directories import each other.

- **Registries.** Each is a one-entry slot a policy is installed into for the life of a scope; a
  later install wins, and closing an earlier install's scope never clears a later one. Both are
  provided at the bottom of the server layer (`server.ts`, beside `ZeropsGitSpawner.layer`); nothing
  installs a policy yet.
- **The Claude seam.** `ClaudeAdapter.ts` reads both registries once, when a driver builds it
  (`Effect.serviceOption`, so the driver's and the replay's requirements are unchanged), and asks for
  the thread's profile at session start. A thread with a profile runs in `dontAsk` ahead of launch
  args and runtime mode, so every default-mode turn restores it; its session context follows the
  runtime instructions; its settings carry the profile's context window as `autoCompactWindow`; a
  `PreToolUse` hook turns `decideTool` into the tool decision and denies when it fails or stays
  silent for 15 s; the extension receives each session start and compaction summary — the CLI runs
  a process's own startup or resume `SessionStart` before the SDK has registered any callback
  (CLI 2.1.283, measured), so that start arrives with the process's first prompt through a
  `UserPromptSubmit` hook and its context rides on that prompt, while compaction and `/clear` arrive
  through `SessionStart` itself (a fork as a resume) and summaries through `PostCompact` — and should
  a compaction's `SessionStart` not arrive (auto-compaction is unmeasured), `PreCompact` marks it and
  the next prompt hands it over, once; its tools are served as an in-process `crew`
  MCP server with their JSON Schemas as given; its spend cap becomes `maxBudgetUsd`; the dialog
  kinds are dropped. The profile's model and effort override the thread's selection at session
  start and again at every turn, so a change applies from the thread's next turn.
- **The Codex seam.** `CodexAdapter.ts` reads the policy registry once, when a driver builds it, and
  asks for the thread's profile at session start and every turn (model, and effort as
  `reasoningEffort`). A thread with a profile starts and resumes with approval policy `untrusted`,
  the user as reviewer, zcp's MCP server (`zerops`, as `zcp init` registers it) off through the
  thread's `config` overrides, not the app-server argv, with the profile's context window as
  `model_auto_compact_token_limit` beside it, its session context as `developerInstructions`
  (Codex has no spend cap, so `maxBudgetUsd` is not mapped), and the read-only sandbox when the
  profile says `readOnly` (the crew sets it for every crewmate but a writer, and for a retired
  stint; Claude ignores it, its gate already refuses the writes); every `turn/start` carries the same
  policy and sandbox, so the runtime mode never restores its own. `CodexSessionRuntime.ts` answers
  that thread's approval requests from the gate and parks none for a person: a command is a `Bash`
  call `{ command }`, the command inside Codex's `<shell> -lc|-c "<command>"` wrapper (zsh, bash,
  sh; its argv read back from the quoted string the approval names); a patch, whose request names
  no file, is an `Edit` per updated or deleted file and a `Write` per added file or move target,
  from the changes its `fileChange` item listed when it started, relative paths against the
  session's cwd — every call must allow. A failing or silent (15 s) gate declines, and so does an
  allow that rewrites the call: Codex's answer carries a decision only, so it would run what it
  asked, not what the gate allowed. So a profile may carry
  `exactCallsContext`, how to write calls the gate allows as they are, which the Codex setup adds
  after the session context in `developerInstructions`: the crew sets it for a writer, whose
  commands the gate allows unchanged only in their lane form, byte for byte (`ssh` to its host,
  `cd` into its copy, its port and `env:`, a timeout, the command for `sh -c`), and gives the model
  that exact form. The form carries the crewmate's `env:` values, so they reach the model's
  instructions; they are the dev service's own values, which the agent can read there anyway. Its
  permission and MCP elicitation requests are declined unasked. The deny reason does not reach the
  model; Codex reports a plain rejection. Its `request_user_input` questions still wait for the
  person, in the crewmate's chat, which is the person's surface — unlike Claude, whose gate denies
  `AskUserQuestion` and sends the crewmate to `crew_report`.
- **The capability.** An adapter that reads the policy declares `capabilities.threadProfile`
  (`{ tools, reportsSpend }`, `ThreadProfileSupport` in `threadToolPolicy.ts`): Claude and OpenCode
  report their spend, Codex and Grok do not; Codex hosts no tools. Cursor and Antigravity declare
  none until their gate is seen live (zcp pre-approves the Zerops tools in Cursor's project config). The instance registry
  stamps it on every snapshot (`ServerProvider.threadProfile`); owned code reads it through
  `ProviderInstances.agentOf`. A thread with a profile is never put on an adapter that declares none.
- **The ACP and OpenCode seams.** `threadToolsMcp.ts` serves a profile's tools on a loopback port for
  the session's life and hands back a stdio MCP entry (this runtime, `-e`, a token on the first
  line). `acpThreadProfile.ts` is the one translation for Cursor, Grok and Antigravity: the stdio
  entry rides `session/new`/`load`/`resume` as server `crew`; every `session/request_permission` is
  shaped as Claude's calls (`execute` a `Bash`, unwrapping `<shell> -c`, declined when its `cwd` is
  outside the session; `edit`/`delete`/`move` an `Edit` per path, `..` resolved; `read`, `search`,
  `fetch`; an MCP call by its title) and answered `allow_once` only when every call passes unchanged,
  else `reject_once`, never an always option; the context follows the runtime instructions on every
  prompt; the model and effort (Cursor `reasoning`, Grok `reasoningEffort`) apply at start and every
  turn; ACP's `max_tokens`, `max_turn_requests` and `refusal` stop reasons become `terminalReason`.
  `openCodeThreadProfile.ts`: a profiled session's ruleset asks for every tool, the MCP server is
  added per thread (`crew-<hash>`, keys `crew-<hash>_<tool>`), each ask is judged with the input
  its tool part streamed (bash's `command` and `workdir`, an MCP tool's arguments), replied `once` or
  `reject`; the context joins the prompt's `system`; effort is `variant`. What only a live CLI
  settles: that each ACP agent asks for every MCP call (zcp's tools included) and every write in
  approval-required mode, and that it starts the stdio entry.
- **What a Codex crewmate is in phase C.** Code only: no zcp tools, and no crew tools either — they
  are an in-process MCP server only the Claude SDK can host — so its prompt names none
  (`CrewPromptInput.crewTools: false`). A Codex crewmate never reports its task done; its task
  completes when the person lands it (_Land_, or _Land now_: WIP commit, merge-in, check, land),
  which the engine already supports.
- **Byte identity without a profile.** `claudeNoCrewSnapshot.test.ts` pins the options, the
  session config and the permission calls of three input rows against a golden taken before the
  seam existed (`fixtures/claude-options/no-crew.expected.json`), under no registries, empty
  registries and a policy with no profile for the thread. `threadToolPolicy.contract.test.ts`
  pins what a profile changes, through the real adapter. For Codex, `codexNoCrewSnapshot.test.ts`
  pins the spawn argv and everything written to the app-server — thread start or resume, default
  and plan turns, a person's answers to a patch and a command — against
  `fixtures/codex-options/no-crew.expected.json`, taken before the Codex seam, under the same three
  setups; `codexThreadProfile.contract.test.ts` pins what a profile changes. Both run the real
  adapter and session runtime against `codexAdapterHarness.ts`, an app-server peer in memory.
- **What only a live CLI settles.** That `dontAsk` plus a `PreToolUse` allow runs a tool without a
  prompt is CLI behavior: probes 1, 2, 14 and 15. The tests pin the options the adapter hands the SDK.
  `claudeSessionStartCliProbe.test.ts` (opt-in, `T3_CLAUDE_CLI_PROBE=1`, one Haiku turn on the local
  login) runs the real adapter against the real CLI: the extension sees the session start once,
  with the CLI's session id and transcript path, and the model answers from its context.
  For Codex, probe 25: that the dotted `config` key turns zcp's server off for that thread alone
  (no `zerops_*` tool listed) and the compaction limit applies, whether `untrusted` sends every command and patch as an approval
  request or runs the commands Codex holds known-safe unasked, past the gate, that the thread's
  `developerInstructions` survive each turn's collaboration-mode instructions, and that the
  read-only sandbox refuses writes in the zcp container.

`apps/server/src/spi/serverCommandReadiness.ts` sits beside them without being SPI: a `Deferred`
the runtime startup completes where it opens its command gate, for layers beneath the startup that
must not dispatch before it.

## 2. Version + changelog

`PROVIDER_RUNTIME_SPI_VERSION` is `"2.10"` (`providerRuntimeSpi.ts`). Bump it, and add a
changelog entry in that file's doc comment, whenever a change to `ProviderRuntimeEventV2` or the
`toolCall` enrichment changes what owned code may depend on — a new member, a renamed field, a
narrowed payload shape. 2.2 (S8b) added an optional `images`/`imagesDropped` on `SpiToolCall.result`,
read from an MCP result's image content blocks — the `zerops_browser` screenshot is the first
consumer; a reader that does not know about `images` still gets `text` exactly as before. 2.3
(intake row 3, 2026-09-05) renames `account.rate-limits.updated`'s payload to a typed `limits`
(the snapshot's `usageLimits` is the primary carrier) and adds optional `beforeTokens`/`afterTokens`
to `thread.state.changed` for context compaction. 2.4 adds an optional `blocked: { window, resetsAt }`
to `account.rate-limits.updated` — a closed usage window and when it reopens, reported whether or not
a turn runs — which `orchestration/Layers/ThreadUsagePauseReactor.ts` turns into the thread's usage
pause; Claude emits it, the other drivers do not yet. 2.5 adds an optional `terminalReason` to
`turn.completed` — the driver's own word for why its agent loop ended (Claude's `terminal_reason`),
which before reached owned code only as `errorMessage` prose; it is for the crew engine, and no owned
code reads it yet. Claude emits it, the other drivers do not yet. 2.6 adds an optional `responseId`
to an item's lifecycle payload, on the start of each of the agent's own calls — the model response
it was written in — and an optional `unreturned` on the completion a turn's end gives a call that
never returned; the live run card and the menu row's live step read a batch as one model response
by it. Claude emits both, the other drivers do not. 2.7 adds an optional `presentation` to an
item's lifecycle payload — an MCP tool's own title and its server, by name and icon — which Claude
reads from Claude Code's `tool_use_meta`; the other drivers do not yet.
2.8 adds `stopped` to an item's `status`: a
call cancelled before it ran to an answer, told apart from one that failed or was declined; Claude
emits it from its own `non_execution_kind`, the other drivers do not yet. 2.9 adds optional
`refused` to `account.rate-limits.updated`: explicit refusal/recovery for a parked turn independent of a
reset time. Claude emits it; terminal usage-limit errors remain the other adapters' path. Codex
also emits the existing typed `blocked` reset when its refused turn has an exhausted window.
2.10 adds `turn.usage.completed`: immutable own-turn consumption, native thread/turn identity,
model lines and a separately reported turn cost. Claude takes a live `get_usage` ledger baseline
before Mate supplies input (`skipBehaviors: true` skips the provider's optional transcript scan).
The native print runtime restores resumed/forked history before accepting this control. Final
results supply cumulative `modelUsage`, which includes Task/sidechains and query-pipeline calls;
Mate subtracts the baseline/previous result and keys the fact by `session_id` plus result `uuid`.
Individual message meters and main-only `result.usage` are not added. A native
result without model increments records its turn with empty model lines and retains its
separately reported cost; unchanged historical counters do not identify participating models. A native
`conversation_reset` supplies an explicit reset receipt: the native reset empties model counters
and USD before the next result. Mate adopts that known-zero ledger, retires the old native
session, and reads the next native session identity from its result (the conversation marker
is a separate identity). Replayed reset receipts do not reset accounting twice. An
unannounced ledger decrease, changed result receipt or incompatible cost basis stops accounting
with a runtime warning. Native USD costs preserve the provider's reported estimated basis.
Codex fresh `thread/start` opts into the installed native protocol's `experimentalRawEvents`
through the raw request SPI; its generated public start schema omits that internal option.
The app-server inherits the raw flag when attaching children and buffers their earlier events.
Mate routes raw usage and native completions before child UI registration, deduplicates exact
response IDs inside each native thread/turn, and emits one aggregate at own turn completion.
No context/lifetime counter participates. The raw meter supplies no model, so that model is null.
Raw response usage is optional: an absent meter creates no fact and does not stop later
reported parent or child usage from being recorded.
Codex 0.160.1's native `ThreadResumeParams` has no raw opt-in, and its resume listener defaults
raw off. Resumed chat continues with an explicit usage-unavailable warning and creates no guessed
facts. Provider child creation broadcast lag is a native delivery limitation; no end-to-end
fresh-child capture is yet available to verify this internal path.
The real Claude plain-text recording proves 21,460 main-model plus 909 auxiliary-model tokens
in one result; it contains no Task run. The real Codex multi-agent capture contains only counters
and emits no exact facts. Positive parent/child aggregation tests use constructed schema-native
raw frames; they are not recorded subagent completion evidence.

The bus
carries its build-time version (`bus.version`,
`ProviderRuntimeEventBus.ts:39-43`) as a hook for a future adapter-version gate at startup — that
gate is a **stated intent, not implemented**; nothing reads `bus.version` today (the "exposes the
SPI version it was built against" test only proves the field itself works).

## 3. Event kinds owned code depends on

Verified by grepping `zerops/**` and `orchestration/**` for each event's `type` discriminant:

- `item.started`/`item.updated`/`item.completed` — `ZeropsLifecycle.ts:217,245`, `orchestration/Layers/ProviderRuntimeIngestion.ts:901,936,964`.
- `user-input.requested`/`user-input.resolved` — `orchestration/decider.ts:81,83,1777`, `orchestration/Layers/ProjectionPipeline.ts:161-196`, `.../ProviderRuntimeIngestion.ts:610,629,2054`.
- `turn.started`/`turn.completed` (incl. the `state: "interrupted"` variant) — `orchestration/Layers/CheckpointReactor.ts:1021,1058,1108`, `.../ProviderRuntimeIngestion.ts:1751-1872,2302,2443`, `.../ProjectionPipeline.ts:1536,1580,1594`.
- `runtime.error` — `zeropsTurnAuthFailure.ts:37`, `orchestration/Layers/ProviderRuntimeIngestion.ts:533,539,2384`.
- `thread.state.changed` — `.../ProviderRuntimeIngestion.ts:850`.
- `turn.usage.completed` — the local usage outbox; each fact retains native turn/thread identity and model lines.
- `account.rate-limits.updated` (its `blocked`), `task.completed` (outside a turn) and `turn.completed` (`state: "completed"`) — `orchestration/usagePause.ts`, read by `orchestration/Layers/ThreadUsagePauseReactor.ts`.

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
tool-lifecycle, or the provider has no reader), or
`unrecognized` — only when `isToolLifecycleItemType(payload.itemType)` is true (the driver itself
classified this as a tool call) but the reader could not decode `data`. `unrecognized` never
collapses to a silent `undefined`: the bus's `enrich` publishes every occurrence onto
`enrichmentFailures` and logs `Effect.logWarning` once per `(provider, itemType, reason)`
signature over its lifetime — pinned by "reports an enrichment failure..." and "logs the
enrichment-failure warning once per ... signature, even across many events". The event itself is
never dropped; a failed enrichment just leaves `event.toolCall` absent. Readers exist for every
driver (`toolCall.ts`'s `READERS` map):

- `claudeAgent` — `{toolName, input, result}`; an MCP tool is `mcp__<server>__<tool>`.
- `codex` — the `mcpToolCall` item only (see below).
- `opencode` — `{tool, state}`; an MCP tool is `<server>_<tool>` (`zerops_zerops_deploy`), split
  at the first `_` — OpenCode's own underscored tools (`apply_patch`, `plan_exit`, `plan_enter`,
  `lsp_*`) are never split; the result is `state.output`, a failure `state.error`, a picture a
  data-URL attachment.
- `cursor`, `grok`, `antigravity` (ACP) — `{toolCallId, kind, title, rawInput, rawOutput, content,
locations}` and no tool name (`AcpRuntimeModel.ts` keeps the agent's own `title` in `data`, since
  a later update's presentation says "Tool"). A title names an MCP tool only WHOLE, by the rule the
  crew's gate reads it by (`mcpToolTitle.ts`: `mcp__server__tool`, `server: tool`, `server/tool`,
  a bare name, after `Running `); a title that merely mentions `zerops_import.yaml` names nothing.
  A call of a native kind is that kind's (`read`, `edit`, `execute`, `search` — `websearch` when
  it asks for words with nowhere to look — ...) unless its title says for certain it is an MCP tool
  (the `mcp__` spelling, a `zerops_*`/`crew_*` name) or its `rawInput` names `{server, toolName}`.
  The arguments are `rawInput`, the result the MCP result in `rawOutput` first (the call's own
  `content` is cut to its 8 000-character tail), else `content`. An ACP call sends no
  `item.started`: a consumer that waits for a start (the stand-up relay) begins at its first
  `item.updated`. Golden: `fixtures/cursor/mcp-calls` (synthetic, from the ACP spec's shapes).

`ActivityPayloadProjection.ts` gives the client one form for all of them — `data.toolName` (an MCP
tool as `mcp__<server>__<tool>`, so it is never taken for a native tool of its name), the
input in Claude's keys at `data.input`, `data.files`, `data.imagePath` and a Zerops call's
`data.zerops` — by the same shape-sniff (`sniffToolCallShape`, the activity's summary as an ACP
call's title).

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
- **`usageLimitsSupport.ts`** — `codexPlanLabel`, `codexRateLimitsToLimits`, `claudeUsageResponseToLimits`, `makeUnavailableUsageLimits`; wraps `provider/Layers/{CodexProvider,codexUsageLimits,claudeUsageLimits}.ts` + `provider/providerUsageLimits.ts` for `usage/cliproxyApi.ts` (the CLIProxyAPI hub reader and reset-credit redeemer, which replaced `usage/cliproxyUsageLimits.ts` with upstream `0a89364f1`). Test: `usageLimitsSupport.test.ts`.

`ProviderRegistryTest.ts`/`ProviderInstanceTest.ts` are not capabilities — owned test-only fakes so
a test outside `spi/**` never has to import driver internals to satisfy those tags.
`claudeAdapterHarness.ts` is likewise test-only: it builds the real Claude adapter through
`createQuery` with a fixed environment and catalog and records what reaches the SDK (§1a).

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
(`replayClaude`/`replayCodex` for the two JSONL drivers — `replayClaude` takes an optional
`ClaudeReplayPolicy` for a crew fixture; `recordCursorBaseline`/
`recordGrokBaseline`/`recordOpenCodeBaseline` for the three live ones), applies `applyToolCall`
(goldens pin the enriched bus shape, not the driver's raw output), redacts, then diffs against the
checked-in `<name>.expected.json` via `checkOrUpdateGolden`. Set `SPI_UPDATE_GOLDENS=1` to rewrite
every golden instead of comparing — state the reason in the commit message; nothing enforces that
except review.

**Redaction** (`redact.ts`, pure over an already-produced event list): `eventId` → `evt-<index>`;
`createdAt` → the fixed `REDACTED_CREATED_AT` placeholder; every value of a `turnId`/
`providerTurnId`, `itemId`/`providerItemId`, or `requestId`/`providerRequestId` field is rewritten
**by value**, wherever it occurs (nested in `payload`/`raw` too), to a stable
`turn-<n>`/`item-<n>`/`req-<n>` so two events sharing a real id keep sharing their placeholder.
Paths are deliberately not masked: a golden's paths come from wherever it was recorded, and masking
them with the comparing host's cwd/home/tmpdir made the result depend on where the test ran.

**Hook lines** (Claude): a `{"kind":"control","name":"hook","args":{"event","input","toolUseID?"},
"answer":<hook output>}` line calls the adapter's own callback for that hook event; its answer must
deep-equal the recorded one, or the replay stops naming the line. Hooks exist only under a profile,
so a fixture with hook lines replays with a `ClaudeReplayPolicy` (`replay/crewReplayPolicy.ts`).

Fixture provenance lives in each `fixtures/<driver>/*.meta.json`: it names the captured CLI/SDK,
model, origin and any anonymization, or marks authored evidence `synthetic: true`. The current
Codex recording includes native output, a read-only Zerops result and a helper finishing before
its parent. `replayCodex` pins the adapter mapper at each notification's own thread/turn identity;
it does not certify the session runtime's child-registration or synthesized helper events.
Historical wait-call shapes remain in the synthetic `helper-wait` fixture. The no-crew option
snapshots (`fixtures/claude-options/no-crew.expected.json`,
`fixtures/codex-options/no-crew.expected.json`, §1a) are not replay goldens.

## 8. Porting checklist

1. **Import the wire packages** — regenerate `imported.lock` from the new upstream ref: `imported-lock --write --upstream <ref>` (`scripts/imported-lock.ts`); it refuses to write if HEAD has diverged from the ref for either imported path (an import must stay byte-identical).
2. **Port the driver commits** behind the SPI, minimally — the ported zone (`provider/**`, `packages/effect-codex-app-server/**`, `packages/effect-acp/**`) must still import nothing matching `zerops`.
3. **Run the goldens** (`replay/goldens.test.ts`) **+ the no-crew snapshots and the SPI contract tests** (`claudeNoCrewSnapshot.test.ts`, `threadToolPolicy.contract.test.ts`, `codexNoCrewSnapshot.test.ts`, `codexThreadProfile.contract.test.ts`, §1a) **+ the zone test** (`scripts/mate-zone-architecture.test.ts`) **+ package typecheck**.
4. If a golden diverges: fix `toolCall.ts`'s readers or the typed capabilities (§6) to match the new driver shape — **never edit `apps/server/src/zerops/**`to chase a driver change**; that tree only ever reads`event.toolCall`, never `payload.data`.
5. Add a `compat.md` row for the new port.
6. Bump `PROVIDER_RUNTIME_SPI_VERSION` (§2) only when the change alters what owned code may depend on — not for every port.

## 9. Known gaps

- `orchestration/Layers/ProviderRuntimeIngestion.ts` and `CheckpointReactor.ts` read `ProviderService.streamEvents` directly (`ProviderRuntimeIngestion.ts:32,896,2071`) — **by design, not a gap**: orchestration is owned core, the service tags are its sanctioned seam (`fork.md` §3), durable ingestion must sit on the raw lossless stream before any observational fan-out, and it needs no `toolCall`. The bus + enrichment are the owned-product boundary (`zerops/**`), which is exactly what the zone test scans. Revisit only if orchestration ever needs the enriched view.
- Codex's collab-agent synthesis (`CodexSessionRuntime`'s child-registration step) is not replayed — `replay/codexReplay.ts` addresses each captured notification at its own wire `threadId` directly rather than through that synthesis path (covered elsewhere by `CodexCollabWire.test.ts`/`CodexCollabRuntime.integration.test.ts`).
- Claude's `onUserDialog` control line is not replayed — `replay/claudeReplay.ts` implements `canUseTool` and `hook` lines only; a fixture with an `onUserDialog` line throws naming the gap.
- `recording/record-claude.mjs` records no hook callbacks, so the crew fixture is hand-authored until a live crew turn is recorded.
- Codex's own `commandExecution` and `fileChange` items resolve `notATool` deliberately — its shell and patch tools, never an MCP call, and nothing downstream reads them, so a Codex crewmate's commands raise no enrichment warning. Its other non-MCP tool items (`collabAgentToolCall`, `webSearch`, ...) stay `unrecognized` by design — the Codex reader only decodes the `mcpToolCall` item variant.
- `openCodeRuntimeCapability`'s Effect keeps the driver's own `OpenCodeRuntime.OpenCodeRuntime` Context.Service tag identity rather than declaring an owned tag — the narrowing is in the returned shape, not the dependency it resolves through.
