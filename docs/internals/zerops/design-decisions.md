# Design decisions — the dated log

Moved out of `design-system.md` §6 on 2026-09-30: the working spec stays short, the log only
grows. Newest entries last; grep by date or by a surface's name.

Decisions the plan did not foresee, taken by the orchestrator from the plan's rules and noted
here (the owner decides only what the orchestrator brief §6 lists).

- **2026-08-30** — Exception ledgers live in `oxlint-plugin-t3code/exceptions/*.json`, one file per
  rule, plus `phases.json`; the CSS check scripts read the same files.
  - _Why:_ one loader, one reconcile, one place a reviewer looks; the plugin package already owns
    the rules
- **2026-08-30** — The clean-checkout diagnostic for untracked package shells (`packages/ssh`,
  `packages/tailscale`) is one CI step in the `check` job, delivered inside the R3 slice (its own
  commit) rather than a slice of its own.
  - _Why:_ trivial, and R3 already edits `ci.yml`; a separate slice would only add a serial merge on
    the same file
- **2026-08-30** — W1-D-PR is one full-stack slice, not a server half now and a client half later:
  the server's RPC handler layer is typed against the contract's PR RPC group (handlers must be
  total), so contracts + server go together and the client consumers go first; commits are top-down
  (web+mobile → client-runtime → contracts+server), each green for every package.
  - _Why:_ the catalogue's split could not keep every commit compiling
- **2026-08-30** — DN1b default holds: a pull request linked to a thread stays a static external
  reference (number + url from `thread.linkedPullRequest`, no live state on web or mobile, excluded
  from auto-settle keying); the checkout's own `status.pr` keeps its real state.
  - _Why:_ no owner answer arrived; a fabricated `state:"open"` would feed auto-settle
- **2026-08-30** — W1-D-STAGE is its own deletion slice: `SidebarStageBackdrop` is the visual half
  of the `environmentIdentificationMode` setting (contract field, settings control, hook chain, 145
  CSS custom properties, a user-doc section), deleted whole; `APP_STAGE_LABEL` stays for the window
  title.
  - _Why:_ the plan's F4 row already deletes the Appearance artwork row; deleting the feature now
    spares F4 the seam
- **2026-08-30** — Exception reconciliation is a multiset: one ledger entry consumes exactly one
  occurrence (identical entries repeated, adjacent), candidates matched specificity-first (exact
  path, longer suffix, shorter suffix; active before expired) so the result is order-independent;
  rule-time suppression stays a membership test (a rule sees one finding at a time).
  - _Why:_ one entry was suppressing every identical occurrence in a file (19 R6 entries covered 23;
    95 R4 entries covered 110)
- **2026-08-30** — R3: the named status consumers (`Sidebar.tsx`, `Sidebar.logic.ts`,
  `ThreadStatusIndicators.tsx`, `AgentActivity.tsx`, `threadListV2.ts`, `thread-list-v2-items.tsx`)
  are widened sinks — every palette/appearance/raw-colour literal there is a finding — carried as an
  `F3` baseline, not zero tolerance; the widget's inline hex tints stay until F4/F5. On
  `apps/mobile/src` an appearance variant in any literal is a finding; on web the class-like
  predicate applies.
  - _Why:_ the sinks alone missed 79 status-table literals; the widget's `"widget"` serialization
    forbids tokens before the projector exists
- **2026-08-30** — R4: persisted identifiers that spell a legacy name (the desktop
  `legacyUserDataDirName`) are ledgered `never` with a migration reason, never excluded from the
  predicate; the sink list stays closed (attribute names as object-property keys, JSX
  expression-container children, static string composition added); the 27 uncovered inventory rows
  (alert arguments, returns, arrays, unlisted keys) are a recorded gap.
  - _Why:_ renaming an on-disk profile directory strands existing profiles; a closed predicate is
    auditable
- **2026-08-30** — R6: a keyframe passes only when every non-terminal stop's effective timing (stop
  ?? animation shorthand/longhand ?? `ease`; implicit `0%`/`100%` stops synthesized) is `steps(k ≤
8)` and the duration is ≥ 1 s — no reduced-motion exemption; comma-separated animation lists
  validate per item; `withRepeat(x, -1 | Infinity)`, `Animated.loop`from`react-native`, inline
  `animationIterationCount`/`animation … infinite`in style objects and`animate-[…_infinite]`are
  findings;`ActivityIndicator` is not guarded (no mobile protected roots yet); CSS fingerprints keep
  the immediate header only.
  - _Why:_ the first predicate was gameable by one stepped stop and missed the common infinite forms
- **2026-08-30** — F3-MOVE: 14 modules move to `packages/client-runtime/src/zerops/`
  (`containerHealth` unchanged, `firstPrompt` pure half; the synchronous storage half stays web as
  `firstPromptStorage.ts`); `feeds.ts` and `commands.ts` stay in web as the runtime binding layer;
  each moved module has its own subpath export and the `./zerops` barrel stays the forbidden
  platform-client subpath; zone rule 6 follows every `@t3tools/client-runtime/*` subpath through the
  exports map (an unmapped subpath is a violation); R1's rule names exactly `window`, `document`,
  `localStorage`, `fetch`, property keys exempt (`globalThis.fetch.bind(globalThis)` stays the
  sanctioned default), day-one baseline zero.
  - _Why:_ an async storage adapter would ripple into the route caller; the walker silently dropped
    moved modules; the plan's L3 places the feed/command factories in web
- **2026-08-30** — F3-STATUS: `ThreadStatusKind` = approval
  - _Why:_ input | working | connecting | failed | planReady | monitoring | woke | done | idle,
    resolved in that priority (failed counts a turn error; working counts a running turn; `woke`
    outranks `done`); tone ids `attention | input | active | danger | plan | success | neutral`; one
    label set (`Approval`, `Input`, `Failed`, `Connecting`, `Working`, `Plan Ready`, `Monitoring`,
    `Done`, `Woke`) — the pill's long forms die and it gains `Failed`; mobile gains
    `Connecting`/`Plan Ready`/`Monitoring`; the wire phase is unchanged with a total bridge where
    `running`means a live session or turn only and background liveness maps to`completed`; `stale`
    is a presentation-edge value (`Waiting`); the widget's inline tables are proven by the vector
    test, not banned; one `isLatestTurnSettled` (`packages/shared/src/orchestrationTiming.ts`). |
    five vocabularies disagreed; the first bridge flipped finished relay states back to active; the
    first order hid the Woke dismiss button
- **2026-08-30** — F4-THEME (brief): ZEROPS_THEME = R5's 57 roles with computed corrections
  (`updateForeground` light `#006b61`, `secondaryLabel` light `#5b656d`, `placeholder` light
  `#616161`, `sidebarMutedForeground` light `#373f45`; `errorSurface`/`warningSurface` dark from the
  concept; flattened alphas recomputed exactly); `placeholder` dark stays `#5e6e69` as a documented
  R7 exclusion; `zerops` is the first built-in and the mobile default id (`t3-code` special case
  removed); web default `theme: "zerops"` (appearance still follows the OS); the editor seed and
  preview copies derive from the theme; `brand.ts` (`./brand`) carries service-status tones,
  identity, chips, mint panel `#e8f7ec`, mark path data, icon-map placeholder, radii/type — not
  thread-status tone colours nor the copy glossary.
  - _Why:_ R5's values fail WCAG in five pairs; the web default was not a theme at all; hand copies
    of the default look drift
- **2026-08-30** — Zone rule 6 follows `@t3tools/client-runtime/*` subpaths through the exports map
  (an unmapped subpath is a violation, type-only or not) and applies every sweep to
  `packages/client-runtime/src/zerops/**` targets and every web file; the client-runtime CORE
  (`state/runtime.ts`, `rpc/client.ts`, …) is exempt from the forbidden-binding and `WS_METHODS`
  sweeps by an explicit gate — the roots reach it only for subscriptions, and it defines the
  forbidden bindings itself; the host-literal and dynamic-import sweeps still apply there.
  - _Why:_ the roots legitimately reach ~40 core files carrying 97 `WS_METHODS.*` tokens; sweeping
    them would need allow-lists that restate the core
- **2026-08-30** — R3: the dynamic raw-colour check (`` `#${x}` ``, `` `rgb(${…})` ``) applies only
  inside a semantic sink — a PR number template in a widened status file is not a colour and is not
  ledgered; `white`/`black` (+ opacity) after every colour-property prefix (`ring-`, `fill-`,
  `stroke-`, `shadow-`, `divide-`, `outline-`, `accent-`, `caret-`, `decoration-`, `placeholder-`,
  gradient stops, directional borders) are complete palette tokens, while `current` and
  `transparent` are legal because they have no semantic-token migration target; variants split only
  at bracket depth zero; inside an arbitrary value `_`, `,`, `(`, `[`, `:` are colour boundaries and
  `_` may follow a complete hex or named palette colour; leading `[property:value]` forms scan the
  value; `url(...)` plus quoted substrings are stripped first; the closing `]` may only be followed
  by opacity/important modifiers.
  - _Why:_ a `never` entry asserts a correct-by-design colour; `current` follows the parent token
    and `transparent` has no theme role; Tailwind separates arbitrary values with `_`, URL fragments
    and quoted content are not colours, and malformed composite candidates emit no utility
- **2026-08-30** — F3-STATUS bridge tail: a thread with background liveness but neither a session
  nor a latest turn publishes awareness phase `null` (the old server answer); background liveness
  alone is not an awareness state — the kind may still be `working` for the sidebar.
  - _Why:_ ruling 1's rationale was "a lingering liveness must not flip a finished state back to
    active", not "liveness alone is a state"
- **2026-08-30** — W3-F5c-DOOR is re-scoped: nothing in the client reads `bootstrapMethods` to
  choose a door today (the door is `isHostedStaticApp()` + `/api/auth/session`), so the slice
  introduces one pure `resolveDoor(gate, { pathname, environmentCount })` over a named four-way gate
  state, consumed at all seven gate sites plus a new gate on `/zerops`, folding
  `resolveChatIndexView` in; `bootstrapMethods` becomes a door input only for the manual-link copy
  (`zerops-identity` branch); the hosted-static short-circuit stays first (desktop boots on
  `t3code://`); widening the same-origin door, `platform.ts`'s connection source, the `/mate`
  constant and favicons stay F6.
  - _Why:_ the descriptor is not a door input yet; desktop would crash on a descriptor fetch before
    the short-circuit; R4 owns the copy module
- **2026-08-30** — W3-F5a is re-scoped: scenes live in `packages/shared/src/showcaseScenes/` (every
  package depends on shared; zone rule 4 forbids the `payload.data` literal under
  `apps/server/src/zerops/**`); ONE shared `ZeropsActivityResult` schema is pinned against the
  server producer and the client reader while the wire `payload` stays `Schema.Unknown`; scene ids
  are the manifest's reserved `web:<kebab>` capture ids; a checked-in `scenes.lock` +
  `scripts/showcase-scenes.ts --check` in CI guards contract drift; fixture feeds reproduce
  `ZeropsLayerLive`'s exact shape (one `provideMerge`, login over auth), are selected inside
  `zeropsFeedsLayer.ts` by `T3CODE_ZEROPS_FIXTURES` and never forge `T3CODE_ZEROPS_PROJECT_ID`; the
  subscription test rides `RpcClient`'s automatic acks (no hand-rolled non-acking probe); contract
  fixtures have one real consumer (web) — mobile has no Zerops adapters until S5-3 and the relay's
  adapter is thread-status-shaped; the web showcase drives Electron (`playwright-core` ships no
  browser).
  - _Why:_ no package imports web + mobile + relay together; the plan's assumptions about
    playwright, `provideMerge` and the activity schema did not hold
- **2026-08-30** — CSS scanners walk tracked source only (or skip build/ignored directories) and
  treat an unreadable entry as a warning, never a failure.
  - _Why:_ `check-css-motion.ts` died on a dangling symlink under the gitignored
    `apps/mobile/ios/Pods/` on a developer clone while CI passed
- **2026-08-30** — R4's seven banned-vocabulary patterns live once in
  `packages/shared/src/legacyVocabulary.ts` (subpath `./legacyVocabulary`); the lint plugin
  `@t3tools/oxlint-plugin-t3code` therefore depends on `@t3tools/shared` (a `workspace:*` link —
  both packages private, no new third-party surface) and the manual-link copy test reads the same
  table.
  - _Why:_ the rule and the copy test had two hand-copied tables; oxlint's plugin loader resolves
    the shared source subpath at lint time (proven: 130 diagnostics with the ledgered report)
- **2026-08-30** — Zone rule 7 (R5) scans string literals, template quasis, JSX text and two-literal
  `+` composition in the seven named status consumers; `apps/mobile/src/widgets/AgentActivity.tsx`
  is the documented structural exemption (its `"widget"` serialization forbids module-scope
  references). Known hazard for mobile code: `apps/mobile` resolves DOM globals (`lib.dom` in its
  tsconfig `lib`), so a deleted local named `status`/`name`/`event`/`origin` silently rebinds to the
  DOM global and typechecks — a `no-restricted-globals`-style rule or dropping `dom` from mobile's
  lib is backlog, not this programme.
  - _Why:_ a substring scan was gameable; the dangling-`status` bug in `thread-list-v2-items.tsx`
    typechecked silently
- **2026-08-30** — A hunk the brief's own acceptance grep forces is not scope widening:
  W3-F5c-CHAT's `AgentsPanel` optional-ref cleanup stays (brief defect, disclosed by the
  implementer); the fix is the brief, not the slice.
- **2026-08-30** — `ZeropsChatChrome.panel` (available/unavailable/unknown) is produced by the chat
  chrome resolver for W3-F5c-PANEL's launcher adapter (`zeropsPanel` input); until PANEL lands its
  only reader is `launcher`. Declared, not orphaned.
- **2026-08-30** — The chat chrome hands the Zerops panel the agent-auth SNAPSHOT it owns
  (`agentAuthCard: snapshot | null`), never a boolean: ownership of the card is unforgeable — a
  surface renders only what the resolver produced.
- **2026-08-30** — Timeline folds: a settled Zerops milestone escapes every collapse path — turn
  fold, partitioned tool summary, overflow, AND the active-turn `work-live` group (a research gap:
  the inventory said three). Membership is by entry identity, never by id (duplicate ids exist). An
  escaped card is a standalone row (keeps its section wrapper).
- **2026-08-30** — The door resolver reproduces HEAD exactly: pathname normalised the way the router
  matches (`/pair/`, `/Pair`), the `/connect` carve-out is a SHELL rule only, `/pair` renders the
  redirect it resolves to (no phrase-less null), the shell reads a named `gate` field (no synthetic
  second call), matrix expectations are hand-written literals, an empty bootstrap-method set is a
  phrased state without a form, `/usage` is gated like every other app route, `AuthGateState` lives
  with the producer.
- **2026-08-30** — Desktop smoke test = a real capture: the hosted-static web bundle is staged
  before launch (one `stage-desktop-web` entry shared with the artifact build), the kill cap
  escalates to SIGKILL, and a fatal startup under the smoke env prints + exits instead of a dialog.
  Captures are CI artifacts (7 days), never a pixel gate.
- **2026-08-30** — Showcase scenes: `loadShowcaseScene` decodes a fresh graph per call (feeds
  publish into Refs), import never decodes (a bad scene fails at load, named), one shared canonical
  hash + id pattern, agent-login keys derive from `ZeropsAgentId`, timed `steps` are part of v1. The
  client-runtime reader's two normalisations (`resultText` non-string, `truncated:false` →
  `{toolName}`) are documented permissiveness, not the shared boundary.
- **2026-08-30** — Renaming (F2): shipped THEME names ("T3 Code" theme) and persisted legacy
  migration identities stay `never`; display copy everywhere else says Zerops Mate incl. the dev
  launcher bundle/helper names and DMG artwork. Backlog: R4's guard scope omits
  `apps/desktop/scripts` + `resources` and has no bare `T3 ` pattern; `.mjs`/`.svg` are outside the
  acceptance grep.
- **2026-08-30** — Plugin rule tests never pin production ledger entries: each rule reads its ledger
  directory from a rule-specific env override (`T3CODE_<RULE>_LEDGER_DIRECTORY`) and the suppression
  row writes a scoped fixture ledger.
- **2026-08-30** — R3 predicate family, closed over nine rounds: the raw-colour scan covers
  arbitrary values AND arbitrary-property tokens with their `!`/opacity modifiers and Tailwind type
  hints, colours before an `_` separator, colours behind arbitrary variants incl. `::`
  pseudo-elements; it ignores `url()`, `var()`, quoted content, `current`/`transparent`, and any
  token that is not a Tailwind utility (empty variant segment, a second utility glued after the
  closing bracket). Rulings are pinned by rows, and the ledger stays one entry per occurrence.
- **2026-08-30** — Report fidelity is reviewed but not landed on alone: once L2 and L3 agree the
  behaviour is right and the `Expected`/`Received` values are verbatim, missing runner banners do
  not hold a slice (DOOR round 3 override).
- **2026-08-30** — A slice that moves a decision must keep HEAD's default until a phrase exists for
  the new state: the right-panel adapter is tri-state, but Diff stays optimistic while the git
  answer is in flight; only Zerops — whose answer arrives late over a subscription — reaches
  `unknown` in production. Copy that moves modules must move the R4 registration with it.
- **2026-08-30** — Presentation rules have one owner in `client-runtime/zerops`; a contract test
  imports the rule, never re-implements it, and a render row observes it through a data attribute,
  not a class string. A degraded scene carries a failed and a transient service so every tone is
  reached by a base scene.
- **2026-08-30** — Fixture feeds publish exactly the wire shape the live feeds publish: a snapshot
  compared in a test is compared through the wire codec, and an optional field absent in the scene
  is absent on the wire (no explicit `undefined`).
- **2026-08-30** — A protected root (R2) cannot value-import `@t3tools/client-runtime/zerops`; a
  value it needs from a presentation rule rides on the view model the adapter builds (the service
  tone on `ZeropsServiceRow`), never on a runtime import in the component.
- **2026-08-30** — `attention.light` text is AA: `#a26000` (4.58 on its surface) replaced the
  deliberate 3.89 indicator pair when the F5b primitives made the tone a LABEL colour — a tone used
  as running text never relies on indicator-only contrast.
- **2026-08-30** — Where `SERVICE_STATUS_TONES` deliberately withholds a `text` value (`busy.light`,
  `failed.light`, `off.light`, `off.dark`), no `-text` variable is emitted on any platform and
  labels fall back to the theme's neutral foreground; the equality tests assert the ABSENCE. The
  durable fix — a fixed neutral text in the brand so user themes cannot pair their own text with a
  fixed brand surface — is open.
- **2026-08-30** — Phase F5b is complete (`phases.json`): all four continuous-motion exceptions
  retired — the web strip spinner and `status-ping` on stepped animations, the two mobile
  `withRepeat(-1)` pulses on the repeating stepped duty cycle — so an F5b-expiring motion exception
  can no longer be minted.
- **2026-09-03** — Chat output: a recognized Zerops call is one anchor row in the transcript (its
  `tool.started` row's id/time, never merged away) and one card per **operation** reduced from the
  call stream (`client-runtime/zerops/model`, domain keys `op:<toolCallId>` per call /
  `bootstrap:<founderCallId>` per session, identity the provider's own `toolCallId` — superseded
  2026-09-05, see below); hidden calls (`ToolSearch`, `Skill`, workflow
  `status`/`list`/`close-mode`, the route-menu `start`, `mount status`) are consumed by the reducer
  and never render; every Zerops exemption in the fold/group/overflow paths is deleted — an
  `operation` entry is exempt by kind. The platform is read as **observation** (three states:
  observing · stale · off), progress never verdict, and the observed steps stay as the operation's
  history after the result; the build log tails the log backend by `zbuilder@<appVersionId>` on the
  build container's stack. Concept: `../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md`.
- **2026-09-05** — Session model: identity is the provider's own `toolCallId`, never a transcript
  accident; `ZeropsOperation.key` is `op:<toolCallId>` per call, `bootstrap:<founderCallId>` per
  session, never re-keyed once a session id decodes; the timeline row id is `zerops:<key>`. Phases
  add `interrupted` (an orphaned call — client turn-based form of R10) and `reset` (a bootstrap
  session's own closure, R7) alongside running · done · failed · declined · stopped. N consecutive
  failed retries of one tool+target in one turn fold into one card (`ZeropsOperation.attempts`),
  rendered as a muted `attemptWord` ("attempt N") next to the status dot (R8/R9).
  `deriveZeropsThreadModel` is the one function: `collectZeropsCalls` (R1-R4),
  `reduceZeropsOperations` (R5-R9, one `phaseFor`), `composeSession` — strip, map and every card
  read its single `ZeropsThreadModel`, never their own derivation. Concept:
  `../../../../zcp/plans/mate-session-model-2026-09-05.md`.
- **2026-09-05** — **Superseded 2026-10-03 in part by "In UI copy an HQ application is a project"
  below: the layer above is a "project", never a "group".**
  In the group model (spec §10) a Zerops project is an **environment** and the tag
  layer above it is a **group**; user-facing copy says "environment" for the former (menu rows,
  "Creating the environment", "No environment has Mate yet") and "group" for the latter. The
  glossary's `environment → project` row is about T3's connected-server sense and does not apply to
  these surfaces; R4 does not flag the word.
  - _Why:_ the user's "project" (the CRM) is the group, and calling a Zerops project "project" too
    would make one word mean two things on the same screen
- **2026-09-05** — Row actions on `/zerops` use the primary pill only for verbs that change state
  (Connect, Enable Zerops Mate, Set up Mate, Wait for it); navigation (Open) is the secondary pill.
  Blue acts; a screen of six identical blue Open pills says nothing.
  - _Why:_ six connected rows each carried a primary blue pill and the one state-changing verb was
    indistinguishable from navigation
- **2026-09-05** — The roster says `Idle` for a connected environment with nothing running and
  `Connecting` while a registered socket comes up; the dot keeps the connected tone (teal). The
  socket is the client's business; the row answers what the agent is up to.
  - _Why:_ "Connected" on every row answered a question nobody on the roster was asking
- **2026-09-05** — The creation form is a dialog with three fields (name, agent on/off + name,
  application as radio cards) and one primary action named for what it does ("Add stage to Acme
  Docs"); the radio card for the application carries a one-line detail (the services it brings).
  - _Why:_ the previous one-click creation gave no choice and imported the wrong application for
    every live group
- **2026-09-05** — The product's name is set once, by the lockup: the still mark beside the "mate"
  wordmark from identity v1 §06 (Sora SemiBold, lowercase, −0.015 em, outlined into `MATE_WORDMARK`
  so no page waits on a webfont; x-height three eighths of the mark's height, its band centred on
  the mark, the ink half the mark's height right of it — the owner's two corrections of 2026-09-05,
  superseding identity v1's window-height word and 2 s gap). No surface repeats "Zerops" or "Zerops
  Mate" as a text, eyebrow or breadcrumb beside it. Inside a link that names itself the lockup is
  `decorative` (aria-hidden) so the name is announced once. The boot splash shows the still open
  mark — the favicon's — so the frame before React and the first frame after it agree.
  - _Why:_ the first screen a person saw had "Zerops" three times (header, eyebrow, copy) and no
    product mark; a Zerops logo flashed before the Mate mark on every reload
- **2026-09-05** — Every Zerops page stands in `ZeropsHostedFrame`: one top bar, one content width
  (`wide`). Standing alone (bare shell, account gate) the bar carries the lockup as the way home,
  then the page's breadcrumb; inside the app shell the sidebar carries the lockup and the bar holds
  only the breadcrumb. The right side is the scope: the organization switcher once one is chosen,
  then the account (email + Sign out) whenever someone is signed in — leaving never depends on first
  choosing an organization.
  - _Why:_ the sign-in shell, the picker, the list, the wizard and the callback each drew their own
    header; the way out lived only in Settings
- **2026-09-05** — Choosing an organization is a page (`h1`, one sentence, a 1/2/3-column grid of
  cards), not a section under an "Environments" title that does not apply yet. The chosen
  organization is a control in the bar, with no "Organization" label of its own.
  - _Why:_ the picker sat under a page title and a micro-label for a page that had not started; a
    `max-w-3xl` grid left a third of the frame empty
- **2026-09-05** — Rows on `/zerops` have fixed cells: status `w-40`, action `w-44`, menu `w-8`, row
  `min-h` 50 px; the action and menu cells are reserved on every row once any row can act, so a pill
  arriving with a health answer moves nothing. Tools come last: account-level, they belong to no
  group and no dev/stage/production axis.
  - _Why:_ rows grew and re-flowed as health answered row by row; an empty Tools section headed the
    list
- **2026-09-05** — The creating action sits in the title row ("New environment", a primary pill
  beside "Environments"), never under the list. The wizard is "New environment" with the breadcrumb
  "Environments / New environment" and a one-line description; the form's first field is "Name".
  - _Why:_ a "New project" outline button sat below a 19-row list, and the wizard said "New project"
    three times before the form
- **2026-09-05** — In the bar and the sidebar the lockup is 24 px tall (`h-6`) — identity v1's
  minimum — since the word reads small beside the mark (the 18 px `h-4.5` of the first cut was a fix
  for the old proportion, in which a 24 px lockup read as a 29 px wordmark). The bar's content sits
  in the page's own column (`workspacePageWidthClass`), so the lockup shares the title's left edge
  and the account the title-row action's right edge at every width.
  - _Why:_ at 1786 px the 24 px lockup and the far-right account read as a different page from the
    centred content
- **2026-09-05** — On a list, blue is for the one verb that reaches an agent right now (`Connect`)
  and for the page's own action (`New environment`); a setup chore (`Enable Zerops Mate`, `Set up
Mate`, `Wait for it`) is the grey `secondary` pill; `Open` is `outline`. Row pills are the `sm`
  size (32 px). Supersedes the 2026-09-05 row that made every state-changing verb primary.
  - _Why:_ nineteen rows produced a wall of twelve 36 px blue pills; nothing stood out, least of all
    the one row that was ready
- **2026-09-05** — While a row's probe is out, its action cell holds a pill-shaped `Skeleton`; the
  verb then fades into that place (`animate-zerops-appear`, 220 ms, once). Nothing appears from
  nothing. The status cell is left-aligned so the dots form a column; rows are separated by a
  hairline; "Ungrouped" is drawn only when there is a group to be distinct from.
  - _Why:_ the verb popped into an empty cell after the probe, which reads as a shift even when
    nothing around it moves; right-aligned statuses left a ragged edge of dots
- **2026-09-05** — A bucket reason is phrased by `zeropsReasonSentence` before a row shows it:
  platform status tokens become words ("The container is stopped."), a trailing parenthesis goes,
  "container" gets its article, the line ends as a sentence. `candidates.ts` keeps writing reasons
  for the log.
  - _Why:_ "container is STOPPED" sat under "The container is not answering." on the same list
- **2026-09-05** — The account in the bar is the person, the way Zerops shows them: their picture
  (`avatar.smallAvatarUrl`, then the external one, then the large) or their initials, and their
  first name, as one menu trigger. The menu holds the full name, the email and `Sign out`; a failed
  sign-out is said in the menu item, which stays open for it (`closeOnClick={false}`). `GET
/user/info` carries `fullName`, `firstName`, `lastName` and
  `avatar.{small,large,external}AvatarUrl`; every URL may be null, so initials are the floor.
  Settings › Zerops shows the same line.
  - _Why:_ the bar carried a 26-character email and a ghost button; an address is for a form, not
    for a bar, and the platform already knows the person's name and face
- **2026-09-05** — The pairing pages — the token form, the hosted pairing states, the pending link —
  stand in `ZeropsLandingShell`: the lockup in the bar, the live mark, a title, one sentence, a card
  with one full-width action; the supporting note and `Reload app` are one small line under the
  form. `AuthSurfaceShell` is deleted.
  - _Why:_ the one-time-link page was the last surface drawing its own header: `ZEROPS MATE (DEV)`
    in tracked uppercase over a `shadow-2xl` card on emerald and sky gradients
- **2026-09-05** — A draft names its Zerops project the way a thread does: `ChatView` demands the
  project's topology (`useProjectTopology`, derived from the account's runtime) keyed on the
  environment, not the thread, and `resolveZeropsChatChrome` reads the project name off the topology
  whenever it has answered. The draft headline prefers the caller's resolved name over the logical
  group's.
  - _Why:_ a draft in `acme-docs-dev` read `www / New thread` and "What should we build in www?" —
    the workspace folder, the same on every container — because only the open panel mounted the
    writer, so the panel's own default-open never fired either
- **2026-09-05** — Settings › Zerops says "Zerops" once, in the breadcrumb and the title; its rows
  are `Account` ("Signed in on this browser.", then the person and their email) and `Organization`
  ("Environments and permissions come from the organization you pick."). Search still finds them
  under "Zerops account" / "Zerops organizations".
  - _Why:_ the page said Zerops six times and "Projects" where the product says environments
- **2026-09-05** — The sign-in card shows one way in at a time: closed, `Continue with Zerops`, "No
  account yet? Create one on Zerops" and "Sign in with a password instead"; open, the email/password
  form with `Sign in`, "No Zerops account? Create one" and "Use the Zerops sign-in instead". One
  primary action and one sign-up link in either state; the hairline between the two link lines goes.
  - _Why:_ with the form open the card carried two primary buttons and two "create one" links, split
    by a rule between two lines of the same small text
- **2026-09-05** — On `/zerops` the word is environment, and the organization is said once, in the
  bar: "Every environment in the account, the agent in each one, and what it needs next.", "6
  environments", "Reading your environments…".
  - _Why:_ the sentence under "Environments" said "project", and the count line repeated the
    organization the switcher above it already named
- **2026-09-05** — While the stored Zerops session is checked (under a second on a reload), the
  account gate shows the frame, the live mark and a spinner — no title, no sentence; "Checking your
  Zerops session…" is read to assistive technology only (`role="status"`). Nothing is written that
  the next frame replaces.
  - _Why:_ every reload flashed an `h1` reading "Zerops Mate" and a sentence for ~600 ms before the
    list took the page — the product's name as text, against the lockup decision, and words that
    only ever flashed
- **2026-09-05** — The draft headline's project picker names each entry by its environment's Zerops
  project (`acme-docs-dev`, `beviro-crm-stage`, …), read from `zeropsEnvironmentNamesAtom` — derived
  from the candidate listing atom, read by `useZeropsEnvironmentNames` without loading anything. The
  logical group's name is the fallback for environments Zerops does not know.
  - _Why:_ the picker listed "www" six times — the workspace folder is the same in every container,
    so the list said nothing
- **2026-09-05** — A draft in a Zerops environment never asks a person to "choose a project above":
  one environment is one project (spec §9.3), so a draft whose project the environment no longer
  lists re-attaches to the environment's only project, and the repaired ref is written back to the
  draft. The composer's project question stays for environments that really hold several projects.
  - _Why:_ a persisted draft came back from a reload pointing at a project that did not exist, and
    the page asked a question the product has no business asking
- **2026-09-06** — The service map is the Zerops dashboard's service card compressed for a side
  panel — and compressed means two lines. On the surface only what a glance needs: name + port, the
  public route as a glyph (the one thing reached for without hovering), the status word, and the
  three resources as figure + inline graph of the last day's use (`POST
/stats-history/group-by-search`, 24 hourly buckets, the dashboard's own default range). Everything
  the dashboard card shows around those waits in a hover pop: the dashboard-page link, what the
  service is and how it was deployed, the routes as hosts, used / allocated with a fill. The graph
  is scaled to use, never to the allocation — the figure already says the allocation, and against it
  an idle service's line is a sliver and the ceiling an artifact. Nothing boxed inside a card; the
  platform's status token is a word; a settled-but-not-running state takes the off tone; a service
  holding nothing is one line.
  - _Why:_ three passes were rejected in a row: boxed tiles of the autoscaling envelope ("heavy,
    junior"), a strip of live figures with hairlines ("almost none of this needs to be visible … the
    card shows history"), figure-over-graph columns ("unnecessarily huge"). The Zerops card is graph
    and chips; Mate's side panel has a third of its width, so the chips go behind hover and the
    graph goes inline
- **2026-09-06** — The lockup is drawn as two boxes at one height — the mark's (`0 0 44 52`) and the
  word's (`MATE_LOCKUP.word.viewBox`, which starts at the mark's right edge and carries the gap) —
  so the sidebar's lockup can hand the mark to `MateMark` and be live: it looks about, blinks, turns
  toward the pointer and falls asleep as the Zerops mark while the letters hold still. The sign-in
  bar keeps the still one.
  - _Why:_ the owner: "the main mate logo should be interactive and the name a bit closer"
- **2026-09-06** — A Mate has a colour and a face. Eight tints (`MATE_TINTS`, none the brand teal —
  teal identifies the product, a Mate is somebody in it), assigned from the name by
  `assignCandidateMateTints` account-wide so the left menu and the projects screen agree; the face
  (`MateFace`) is the eyes on a disc of that colour, on the mark's own grid, posed from
  `MATE_MARK_LIDS` per state — idle, working (narrowed, dropped), needs you (wide, the "o"), done
  (happy arcs, the smile), asleep (shut, for a container that is not connected). Still by design: a
  menu of faces must not blink. Which face a thread status wears is `mateMarkStateForThreadStatus`,
  beside the resolver (R5): approval · input · plan · woke · failed → needs; connecting · working ·
  monitoring → working; done → done; idle → idle.
  - _Why:_ the owner asked for every state the mark has, "the eyes in a dot with the colour",
    instead of a plain status dot
- **2026-09-06** — The projects screen is **Projects**: no sentence under the title, New project and
  a Refresh glyph in the title row, and one table per project with a row per environment in role
  order. The **seat** leads a row: a Mate's face and name where one lives (a connected Mate's row is
  the way into its conversation — the name stretches over the row, the controls sit above it), "+
  Set up Mate" on a dev environment without one, a dash where a Mate is not for. Then the tag, the
  environment's name, its **public access as one chip per service** (the developer's name for it;
  the host is a tooltip, several ports a menu — never a hostname column, never one Open pill), and
  **activity** as one phrase: the status word · what the Mate is on · the one verb, in the acting
  colour ("Ready · Connect"). The columns are fixed page-wide (`ZEROPS_ENVIRONMENT_GRID`), every
  table names them once, rows are 40 px, menus show on hover. Tools are the same table with "Tool"
  in the seat's column.
  - _Why:_ the owner rejected two cuts — two registers (Mate cards, environment rows) with different
    geometries — as "clunky, junior… no visual hierarchy, the widths, the alignments, the layout
    shifts", and pointed out that inline hostnames cannot carry many services
- **2026-09-06** — An environment is one row, never two: a Mate's environment is its Mate's row.
  Stage and production are never offered a Mate (`mateSetupOffered`: dev, dev/stage and untagged
  only) — they get their code from dev, not from an agent typing into them. The row verbs are text
  in the acting colour, not pills: this supersedes the 2026-09-05 pill-tone rule (blue Connect ·
  grey chore · outlined Open); Open is the row itself.
  - _Why:_ the owner: "environments shouldn't include those that have mates", "stage and prod
    shouldn't even have setup mate button"
- **2026-09-06** — What each Mate is doing is one derivation both surfaces read (`agentActivity.ts`,
  `useZeropsAgentActivity`): the environment's one conversation through the one resolver and the one
  phrase producer, plus its face and its **subject** — the running plan step when the server reports
  one, else the conversation's title, absent when idle. The left menu shows it as a second line
  under the Mate while it is on something; the projects screen after the status word. Idle has no
  phrase of its own and the rows say "Idle" themselves.
  - _Why:_ the owner: "each mate should in both places show what it's working on"
- **2026-09-06** — The left menu lists Mates — face-dot (14 px), name, tag, one word — and folds the
  environments under each project ("3 environments", a chevron): a row each, role and name, and one
  glyph that opens the public route or offers them. A project appears when somebody lives in it.
  - _Why:_ the owner: "the left column should also reflect… primarily mates, but expandable show
    environments with some quick way to show public routings, mates here just as color dots"
- **2026-09-06** — **A Mate is declared, not inferred.** The bare `mate` tag on a Zerops project
  says a Mate lives there (`MATE_MARKER_TAG`, `readZeropsGroupTags().mate`, `withZeropsMateTag`):
  written at birth by the wizard and by an agent-bearing "Add", by "Set up Mate" through naming the
  agent, kept across regroups and leaves, visible in the Zerops GUI. Membership (`hasMate`) reads
  the tag, falls back to a Mate container for projects from before it, and **never counts stage or
  production** — a container found there is a platform fact, not a Mate, and the row is an
  environment's. A declared Mate whose container is gone keeps its card, asleep, with "No container
  · Set up Mate" on it.
  - _Why:_ the owner: "use tag mate where there is mate", "production and stage can never have a
    mate", "fix the source" — the account was fixed to match, see `verified.md`
- **2026-09-06** — **The projects screen is Mate cards and an environment list** — this supersedes
  the one-table row above. A project is its name (15 px semibold, its menu at the far end on hover),
  then its Mates as cards (`ZeropsMateCard`, 320 × 64: the 28 px face in the Mate's colour wearing
  the conversation's state, the name, one line — status word · what it is on · the one verb in the
  acting colour; nothing about the environment, whose name and tag are not what a Mate is about),
  then its other environments as a list (`ZeropsEnvironmentRow`, 36 px hairline-divided rows: the
  name, its tag as a pill trailing it — `ZeropsRoleTag`, the tag's own spelling `dev` · `stage` ·
  `prod` in the one `MicroLabel` — and at the far end only what is worth saying: a `StatusDot` when
  the project is not simply there, "Set up Mate" on a dev box without one, the menu). No table, no
  header row, no count line, no dash for an absent thing. The card does what its line says: opens a
  connected Mate's conversation, connects to a ready one. Tools are the same rows without a pill
  under a heading that already says Tools.
  - _Why:_ the owner rejected the one table — "when you mix two things and each has half of the
    columns not filled, it means you are doing something wrong… I stand by the cards, just the env
    table needed to be done more smartly"
- **2026-09-06** — **Public access lives in the menu.** Every `…` on the screen (a Mate's, an
  environment's, a tool's) opens with a _Public access_ group: one item per route — the service as
  the developer names it, its port when one service answers on several, the host in a muted hand, a
  click that opens it (`ZeropsRouteMenuItems`, `routeMenuEntries`) — then a separator and the quiet
  actions. Known-empty says "None yet"; unknown (services unread) leaves the group out. Many routes
  are many items in a menu that scrolls, never chips in a row and never a hostname column. The left
  menu's fold keeps its one glyph.
  - _Why:_ the owner: "public access can easily be hidden in more menu, where it can be handled
    properly"
- **2026-09-06** — **The left menu's Mates are cards under project names written as names** — this
  supersedes the left-menu row above. A project's name is a small heading (12 px semibold, the
  sidebar's foreground, sentence case), never an uppercase label; "Ungrouped" is the same in the
  muted hand. A Mate is a card (`bg-card` on the sidebar's surface, a hairline border that darkens
  on hover, `active:scale-[0.99]`, 36 px, 52 px while it is on something): the 20 px face, the name
  at 13 px, the one word, the subject on a second line. No tag on a Mate. The fold counts the
  _other_ environments only — a Mate's own is the Mate — and its rows carry the tag as a pill after
  the name.
  - _Why:_ the owner: "bots on the left should be more clickable", "project group names on the left
    should not be uppercase and should be more visible", "tags should be like a trailing pill after
    name, not a column", "mate doesn't need a tag listed"
- **2026-09-06** — **A Mate's state is its face; no word repeats it.** On every surface a Mate's
  face (`MateFace`) wears the conversation's state — open eyes idle, narrowed working, wide with the
  "o" when it needs you, happy when done, shut when its socket is down — and nothing beside it says
  "Idle", "Working" or "Ready" (`ZeropsMateWord` is gone). What is written beside the name is the
  **subject** — what the Mate is on, or was last on: the running plan step while it works, else the
  conversation's title, which stays up while idle (`agentActivitySubject`); a conversation nobody
  has spoken into (`latestUserMessageAt === null`) has a placeholder for a title, not a subject, so
  the line is left out.
  - _Why:_ the owner: "the 'idle' 'working' etc state can be reflected by the eyes state, no need to
    have it by word", "the menu should keep showing the desc of what the agent last worked on"
- **2026-09-06** — **A Mate's row quotes the last thing said.** Under the name (with the time at the
  right) and what the Mate is on, a third line in the muted hand: the conversation's last completed
  user or assistant message, as a messenger's row quotes it — the Mate's words plain, the person's
  prefixed "You:" (`agentActivitySnippet`). The words come from the thread shell's **server-kept
  preview** (`OrchestrationThreadShell.latestMessagePreview`: role, text, when —
  `projection_threads.latest_message_preview_json`, folded in per completed message like
  `latestUserMessageAt`, refreshed with the summary, backfilled by migration 045), quoted by
  `@t3tools/shared/messagePreview` (markdown marks dropped, one line, cut at a word within 160
  characters), so a menu of conversations never loads a message. Absent until something has been
  said, and on a server from before the preview.
  - _Why:_ the owner: "maybe it should show summary of the last task + snippet of last message and
    date?"
- **2026-09-06** — **A reload paints nothing the next frame replaces, and a conversation catching up
  moves nothing.** Who lives where is known from the project's tags and the container's registered
  origin — not its socket — derived by `zeropsMatesAtom` from the candidate listing, so the header
  names the Mate as soon as the list reaches its environment; an environment no read row reaches is
  unknown (one whose server runs outside Zerops holds nobody), and a surface that looks different
  for a Mate waits on that rather than guess: the git toolbar (`BranchToolbar`) renders only for an
  environment known not to be a Mate's, the left menu's roster says nothing on its first read
  instead of "No Zerops projects yet", and T3's project tree hides every environment until it is
  known which are Zerops. The composer's joined glass exists only for a strip
  (`:has(.chat-composer-context-strip)`), so a shell told to expect one whose toolbar has nothing to
  say keeps the plain 22 px glass. **Syncing is a small spinner in the header's sync slot**
  (`threadSyncSlot.ts`: 16 × 16, always there, the phrase on hover), never a drawer above the
  composer.
  - _Why:_ the owner: "even when you refresh page there is some intermittent state with the shit at
    the bottom then the 'syncing' at the top… both causing layout shift… syncing should be some
    small spinner fixed somewhere decently", "some transparent things at bottom right and left
    corners"
- **2026-09-06** — **A Mate's subject is the last task as the person put it, never the first.** With
  one conversation per environment the conversation's title names the first task forever, so the
  row's second line and the header's crumb after the Mate read the shell's **preview of the person's
  last message** (`latestUserMessagePreview`, kept beside `latestMessagePreview`, migration 046) —
  the running plan step over it while the server reports one; the title only on a server that keeps
  no preview. The third line quotes the Mate's last words and is left out while the person's message
  is the last thing said, since the line above already says it.
  - _Why:_ the owner: "I set it out on a new task and it's still 'create todo app'", "simply to know
    what's being worked on / last worked on… either as summary, last messages or both… definitely
    not the first"
- **2026-09-06** — **A banner over the composer floats; it never moves the conversation.**
  `ComposerBannerStack` renders from a zero-height anchor above the composer and paints upward over
  the bottom of the timeline (`absolute inset-x-0 bottom-0`, the drawer's overlap tucked under the
  composer), so an environment reconnecting, a version notice or a branch change comes and goes
  without the history or the composer moving.
  - _Why:_ the owner: "'reconnect' and status is still popping up from the top of the chat bar and
    it's still causing layout shift of the chat history… can it at least not be like absolutely
    positioned or something?"
- **2026-09-06** — **The left menu's Mates are the menu's own rows** — this supersedes the cards row
  above. A Mate is the surface every thread row in the menu has (`rounded-md`, transparent,
  `hover:bg-sidebar-row-hover`, `bg-sidebar-row-active` when it is the open one), the whole row the
  button, laid out the way a messenger lists people: the 20 px face, the name at 14 px medium with
  when the Mate last did something at the right edge (`agentActivityAt`: the last turn's end, its
  start while it works, else the last message; `compactSidebarTimeLabel` over
  `formatRelativeTimeLabel` — "3h", "2d", "now"), the subject under it at 12 px in the muted hand;
  36 px without a subject, 52 px with one. A snippet of the last message is not shown: the thread
  shell carries no message preview, and reading every Mate's messages for a row is not the left
  menu's business — a preview field on the shell is the next step. No border, no card — "more
  clickable" meant a bigger area, not a box.
  - _Why:_ the owner: "the background border in menu sucks, more clickable meant giving it bigger
    area, not making it shit"
- **2026-09-06** — **Environment rows say what they hold, and the page reads at reading width** —
  this refines the cards-and-list row above. The projects screen is the frame's `readable` width
  (`max-w-4xl`, 848 px of content at 1786), Mate cards are a two-column grid (`grid gap-3
sm:grid-cols-2`, 60 px tall, the name alone when there is nothing to say), and every environment
  row is one grid of three places page-wide — the name with its pill, what the environment holds,
  the end — so every `…` on the page sits in one column 848 px from the names, not at the far edge
  of a 976 px void. What an environment holds is one muted line: the developer's services by
  hostname and when code last landed (`summarizeEnvironmentServices` in client-runtime over the same
  service list the routes come from; `environmentSummaryLine` phrases it: `app, db · deployed 2h
ago`, `No services yet`); the platform's core, build runtimes and the Mate's container are left
  out. Tools are the same row. On a phone the summary drops under the name.
  - _Why:_ the owner: "there is no info in the table and the more menu is five kms away"
- **2026-09-06** — **A conversation is headed by its Mate.** Where a Mate lives, the thread header's
  leading crumb is the Mate — its 20 px face wearing the conversation's state and its name — not a
  folder and a container name; the thread's title follows only once somebody has spoken into the
  conversation (`latestUserMessageAt`), so "New thread" is never a crumb. The context strip under
  the composer (`BranchToolbar`: the environment tab, the branch, the worktree mode) is not rendered
  for a Mate's environment at all — the conversation runs in the Mate's own container on whatever
  the agent checks out — and elsewhere it renders nothing rather than an empty tab. Who lives where
  is `zeropsMateIdentities` — name (`botDisplayName`), colour (`assignCandidateMateTints`), project
  (the label tag) per connected environment — derived as `zeropsMatesAtom` and read with
  `useZeropsMates`, so no conversation surface loads anything.
  - _Why:_ the owner: "it should have the mate name and avatar + there are no threads now, just
    start of the conversation", "this feels useless" (the composer tab)
- **2026-09-06** — **An empty conversation is the Mate's opening, and asks for the sign-in there.**
  With nothing said yet, the timeline shows `ZeropsMateEmptyState`: the live mark (`MateMark`) in
  the Mate's colour (`tint`: the slab, the band and the side wall take `--zerops-mate-tint-*`), the
  question "What should Fen do on Acme Docs?" (`mateQuestion`), and — when no coding agent is
  authorized (`zeropsAgentSignInRequired`) — one sentence and the agent rows (`ZeropsAgentAuthRows`,
  the card's rows without its header) with the same sign-in dialog and login hooks the map's card
  uses. A draft's headline asks the same question with the Mate's mark in its colour and the project
  as the picker. The lifecycle band is retired: `ZeropsLifecycleStrip` renders only the sign-in
  request, only over a conversation the agent has worked in (a lifecycle exists) with the map
  closed, as one quiet line in the timeline's column; "Task complete", "developing …" and "waiting
  for you" are the cards' and the map's to say.
  - _Why:_ the owner: "this 'coding agent' empty / non-authorized state could be done properly as an
    empty state at the 'Send a message to start the conversation.' place", "I still don't understand
    what this is useful for" (the band)
- **2026-09-06** — **One environment is one conversation, everywhere you enter.** Landing on the
  index opens the environment's one conversation when it has one (`resolvePrimaryConversation`),
  else a draft in the project — for the named environment and for the most recently active one
  alike; a request for a new thread in a Mate's project (`useNewThreadHandler`: the draft's project
  picker, any new-thread surface) opens the Mate's conversation instead of creating a second one,
  typed content following when the caller carries it. zcp's introduction is composed into the
  conversation's composer when nobody has spoken there yet (`composeZeropsFirstPrompt` takes any
  composer target), as it was into a fresh draft.
  - _Why:_ the owner: "the functionality should be that it will send the message to the existing
    thread as if it was written there + redirect to the thread"
- **2026-09-06** — **The control plane's card is the Mate's home, and the coding agents grow out of
  it.** Under the zcp card's resources: the Mate's 20 px face in its colour wearing the
  conversation's state and `Fen lives here` — the same identity and face the header reads
  (`useZeropsMates`, `useZeropsAgentActivity`), handed to the map as `mate` (R2: the map renders
  what the panel resolved). The coding agents' card is handed to the map too (`agents`) and is
  slotted into the mint panel's bottom edge — pulled 12 px up over the mint, inset 12 px — so it
  reads as growing out of the container it signs in to; the hover pop's trigger is the mint's text
  alone, so a hand on the agents card opens nothing. The _Coding agents_ section of its own remains
  only while the map has no control plane to hang it from.
  - _Why:_ the owner: "this should say 'Fen lives here' in the card somewhere somehow and imo the
    agents card should be visually connected with it, like it's growing out of the zcp card"
- **2026-09-06** — **The card reads as the dashboard's, and the pop states the envelope.** The
  status word sits above the name (the dashboard's own order), the name line says what the service
  is beside the port (`db :5432, :6432 PostgreSQL 16` — the platform's name and the major version,
  the exact version stays in the pop), and a public route is a real button at the card's right, one
  per route, never a glyph in the text. The pop's figures each carry the effective autoscaling range
  at the right (`currentAutoscaling` from the service-stack read — the profile resolved, not the
  overrides), the cores' with the CPU mode; a service holding nothing yet shows the envelope alone.
  - _Why:_ the owner: "this has space so it should show the autoscaling configuration range as
    well + the row should have hostname port + type", "I'd add state like this [the dashboard's ●
    ACTIVE over the name] … and use the right position for the external link, as button, better
    clickable"
- **2026-09-06** — **The panel carries its own controls, and the mark holds the corner either way.**
  Open, the sidebar's header is the lockup alone at the panel's own glyph column
  (`max(var(--workspace-controls-left),1rem)` — 16 px, the column the search icon and the footer's
  controls stand on; macOS traffic lights push it right) and the collapse control is the last item
  of the footer's utility row, at its right edge, drawn as the row's other icons are. Closed, the
  mark keeps the top-left corner — a link home, live, centred in a titlebar-control box so it lands
  on the same pixel the lockup started from (15.84 vs 16.0, top 14 in both) — and the expand control
  takes the box the Settings icon had at the panel's foot (8, 960 → 40, 992 at 1000 px tall). The
  titlebar carries no toggle.
  - _Why:_ the owner: "I'd move the logo to the left and put the compaction to the right side of
    this bottom row", "leave the logo with just the icon on top left even when the panel is closed",
    "the expand should be visible at bottom left when its closed", "logo shouldn't work as expand,
    it should link to / as the expanded does"
- **2026-09-06** — **The wordmark reads smaller and closer** — this supersedes the proportion in the
  2026-09-05 lockup row. `MATE_WORDMARK` is the same shaping (Sora SemiBold, −0.015 em, outlined) at
  x-height 0.35 of the mark's height (18.2 of 52, baseline 35.1) with the first stem's ink two
  fifths of it (20.8) right of the mark's edge — the 2026-09-05 cut scaled by 14/15 about the
  baseline at that stem, which is the layout `scripts/brand/wordmark.py` re-derives from its
  constants. The lockup's box follows the ink: `0 0 148 52`, the word's `44 0 104 52`.
  - _Why:_ the owner: "can we make the 'mate' a little smaller and little close to the logo?"
- **2026-09-06** — **A Mate's conversation opens in Zerops, not in an editor.** Where a Mate lives,
  the header's editor picker is gone (`shouldShowOpenInPicker`, `mateLivesHere`): a zcp container is
  nobody's SSH host, so the picker either sat disabled or handed the OS a
  `vscode://vscode-remote/ssh-remote+…` deep link to a machine the person cannot reach. Its place is
  taken by one outline button of the same size, the Zerops loop (`ZeropsMark`) with `Open in Zerops`
  beside it — the label from `@3xl/header-actions` up, the mark alone below, as the row's other
  actions collapse — linking to the Mate's project on the dashboard in a new tab
  (`zeropsProjectUrl`, the one place that URL is shaped, riding on `ZeropsMateIdentity.projectUrl`).
  - _Why:_ the owner, on the VS Code split button: "this should basically be open in zerops",
    "zerops logo instead of the cloud lol"
- **2026-09-06** — **A Mate sleeps until its container is connected, on every surface.**
  `mateFaceFor(connected, activity)` is the one rule — asleep when the container is not connected,
  the conversation's face when it is, idle as that rule's floor — and the roster, the projects
  screen, the conversation's header and the Mate's home on the map all call it. It matters because a
  Mate is known before its socket is up: from its project's tags and its container's origin
  (`registeredOrigins`), which is why `ZeropsMateIdentity` carries `connected`.
  - _Why:_ the owner: "are these at all occurrences reflecting the eye state properly? think about
    it"
- **2026-09-07** — **Both halves of a dev/stage pair are services, and read alike.** The folded
  stage carries its own status word above its name, its `:port`, its route buttons and its own three
  resources with graphs (`stageMetrics`, `stageTrends`, `stagePortLabel`); one `ServiceHeader`
  renders the dev half and the stage half so they cannot drift apart again.
  - _Why:_ as a bare status line the stage rendered identically to a service holding nothing — the
    card's other one-line state — so a running stage read as never deployed; the owner: "why is the
    pair without its graphs?", then "why is the active on different place and there is no link to
    the appstage?"
- **2026-09-07** — **A project holds as many Mates and stages as its people want, and exactly one
  production.** "New project" creates the project _and_ its first Mate, so the account-level action
  keeps that name on every surface (sidebar, title row, wizard, first run); every Mate after the
  first is added from inside the project — "Add Mate" in the Mate grid, "Add stage"/"Add production"
  under the table. `creatableRoles` caps production only.
  - _Why:_ naming the account action "New Mate" made one word mean the group on one screen and its
    first member on the next, and capping all three roles left a complete project offering nothing
    at all
- **2026-09-07** — **A created environment opens on its job, and that one prompt mate sends
  itself.** A creation writes down what the environment is, where its application came from and
  which services the clone could not build (`creationHandoff.ts`), keyed on the project; the connect
  moves it onto the environment id; the compose says it instead of the fixed onboarding line. It is
  sent, not left in the composer — but only once a coding agent is signed in, because until then
  there is nothing to run it. MC-8 is unchanged: the onboarding prompt is still composed and never
  sent, and a handoff is spent on first use, so a reconnect or a second tab says nothing.
  - _Why:_ "Introduce yourself, tell me what is running here" asks a Mate that was created for a
    reason to guess what that reason was, and leaves the person who waited two minutes for the
    environment to work out the next step themselves
- **2026-09-09** — **The version-skew banner is gone; one quiet line and one verb replace it.** The
  upstream "Server versions differ" banner, `versionSkew.ts` and its localStorage dismissals encoded
  "client and server ship in one box", which this product does not — the client compares versions in
  exactly one place, the sign-in floor. Everywhere else, `mateUpdateLine` reads the descriptor's
  `update` field only: the installed version alone, or "0.8.0 · 0.8.1 available" with the glossary's
  update role (`--zerops-update-role`, teal) on the "· x.y.z available" clause alone, never the
  whole line. `ZeropsMateUpdateControl` renders the line and, only with `capabilities.mateUpdate`
  and `update.available` both true, the Update verb: idle → confirm ("Running threads stop. Update
  now?") → updating → updated/already-current, settling to idle on its own; a failure shows inline,
  never a toast. Same control on the Mate card and the thread header, next to "Open in Zerops"
  (spec-mate.md §2.9, MU-1/MU-2/MU-3).
  - _Why:_ spec-mate.md §2.9; superseded the S1-era restart banner once `zerops.mate.update` existed
    to do the same job without a container restart
- **2026-09-10** — **A Zerops RPC is sent only where the descriptor advertises it; a Mate that lacks
  the feature says so, with the update line beside it.** `capabilities.dataConsole` gates the Data
  surface: absent, the panel renders one muted line ("This Mate doesn't include the data console
  yet.") and `ZeropsMateUpdateControl`'s line and verb, and never issues `zerops.dataConsole.call` —
  never a generic "Something went wrong." from an older server's unknown request tag. The Mate menu
  always offers "Check for updates" wherever `capabilities.mateUpdate` is true ("Checking…" while it
  runs, disabled); it calls `zerops.mate.checkUpdate`, the descriptor's `update` re-read with the
  manifest cache bypassed, and the answer repaints the same line and verb — the client still
  compares nothing.
  - _Why:_ spec-mate.md §2.9 steps 5–6; a release stayed invisible for up to two hours behind two
    caches, and an older server answered the Data panel with a defect
- **2026-09-10** — **Every listing has one explicit, total order; nothing is left to the order the
  API returned.** The comparator is `compareZeropsHostnames` (locale-aware, case-insensitive,
  numeric-aware: `db` < `db2` < `db10`). Service map: sections Runtimes → Data → Infrastructure;
  inside a section the control plane first, then hostname, then `serviceId`; a stage row is nested
  under its dev partner. Projects screen and left menu: groups by name then `groupId`; environments
  in a group by role, name, `project.id`; the ungrouped list by tier
  (`rankZeropsCandidateForListing`: a Mate that is connected or ready, then provisioning, then an
  ACTIVE project without a reachable Mate, then a stopped project) and by name within a tier — a
  tier changes only on the user's own action (Start, Enable), so the list never reshuffles on its
  own. Rows keep what they knew while a read is in flight: a health verdict survives a probe refresh
  and a resolved service list survives a transient re-projection miss, so a refresh never blanks a
  row and brings it back.
  - _Why:_ The listings flickered and reordered on every refresh;
    `packages/client-runtime/src/zerops/listingOrder.ts`, `environments/containerStore.ts` (a
    re-probe never moves a level on its own), `ZeropsInventoryProvider.carryForwardServiceOutcome`
- **2026-09-17** — **Superseded 2026-10-02 in part by the HQ row below: a change is a Mate's, kept
  in HQ without checks, and `#N title` is the way to its page, not into Gitea.**
  **The left menu draws each project as a timeline, the way its code travels**
  (D26): the Mates as the menu's own rows; under each Mate its open pull requests — `#4 title` as
  the way into Gitea, the checks as a dot with the word as its title (`StatusDot dotOnly`), _Merge_
  where Gitea says it merges — folded behind "N pull requests" past three (`pullRequestsFolded`); a
  person's own pull requests after the Mates; then the other environments unfolded, stage before
  production, each `name [PILL] ● ⧉` with the last deploy as a dot and _Release_ on the production
  when there is something to release. The "N environments" fold is gone. Whose a pull request is, is
  `projectFlow.ts` (zcp's branch `mate/{login}`, else the bot that opened it), so the projects
  screen agrees.
  - _Why:_ the owner: "in the menu I imagine each group as a timeline: mates, their open PRs, stage,
    production"
- **2026-09-17** — **Superseded 2026-10-02 in part by the HQ row below: the Git tab reads the Mate's
  change from HQ, with no checks and no sign-in line, and a project's changes and environments come
  down HQ's stream (`hqChangesAtom`, `hqEnvironmentsAtom`).**
  **The Git tab is the Mate's own leg; the projects screen carries the project's
  flow** (D26). The right-panel Git tab keeps only the Mate's repositories — branch, pull request,
  checks, one verb — and the sign-in line; no environments, releases or recipe changes. The projects
  screen's list under the Mate cards reads: the Mates' open pull requests (`ZeropsPullRequestRow`,
  tag `pr`, the title a link, `appdev #4 · Vera`, the checks' dot, _Merge_), the environments with
  what they follow and run, one muted line with the release gate's reason when a production is
  declared and _Release_ is not offered, the releases (`v0.1.0 [RELEASE] · app 0db51c0 · Approved`,
  _Roll back to this_ on an earlier approved one), then the recipe changes. _Release_ is the
  production row's verb. One provider (`ZeropsProjectFlowProvider`) reads the whole account once a
  minute, so the menu, the screen and the tab never disagree.
  - _Why:_ the owner: "this seems like git for the whole project, shouldn't it be git for this Mate
    and have project git somewhere else"
- **2026-09-17** — **Superseded 2026-10-02 by the HQ row below: _Git_ opens `/git`, every
  application's repositories and the changes open on them as HQ holds them (`gitOverview.ts`).**
  **The footer's Gitea button opens the Gitea overview** (`/gitea`,
  `GitPullRequestIcon`, lit like the Zerops button on its page): one section per owner (a project's
  org), a row per repository — its name the way into Gitea, "2 open pull requests" as its line — and
  the pull requests under it, newest first, the title the way to the pull request's page. The page
  changes nothing; _Open Gitea_ in the title row. Every line is `giteaOverview.ts`'s.
  - _Why:_ the owner: "at the bar down I imagine a 'gitea' button, where I'll see overview of all
    repos I have access to and their open PR"
- **2026-09-19** — **A state's word is written the way `client-runtime` wrote it.** `deployWord`
  answers "Deployed" and `changeState` capitalises its first letter on purpose; drawn through the
  `MicroLabel` that was a `StatusDot`'s only form, the projects screen and the Git page said NEEDS A
  REBASE where the left menu and the project's own page said "Needs a rebase". The list row now sets
  the hand for its status column (`ZeropsEnvironmentRow`, `ZeropsPullRequestRow`: 12 px, muted), so
  no caller carries a size; the `MicroLabel` form stays for a state's name over a card.
  - _Why:_ the owner, 2026-09-19: "all pages are unified in how they look work feel have ux and
    abilities"
- **2026-09-23** — **Every surface draws a project as its flow, and a project has one next step**
  (spec-mate D29). The order is the one the code travels — Mates (each with its _Preview_) → pull
  requests → `main` → production — and a group stage is one line under `main` — `↳ ● Deployed
e014b0e` on the page, `↳ {name} · follows main` in the left menu — drawn only where one exists.
  What each step holds and the next step are `groupFlow`'s (client-runtime); the projects page
  (`ZeropsProjectsFlow`, `projectsView.logic.ts`), the left menu (`SidebarZeropsTree`) and a Mate's
  conversation (`useZeropsMateNextStep`) only lay it out. The projects screen is `expanded` width
  and has two views, _Next step first_ the default order: **Overview** — a _Next steps_ strip, each
  item a project's step in words that jump to its row and, at the item's end, the row's own verb
  (_Merge_, _Release v0.1.0_, _+ Add production_); a step with no verb to press is not listed. Then
  one row per project with the four steps as columns (`Mates`, `Pull requests`, `main`, `Production`
  — no arrows, no "· preview"), at most two lines to a cell, and one verb to a row, at the end of
  the cell it acts on; a row opening to the Mate cards, the pull requests, the environments and the
  project's rows; a project with only a Mate nobody has spoken to is a tile that opens the Mate as a
  whole, with no _Open_ button; the containers no project holds are one line with _Try again (N)_;
  tools are one quiet line at the end. **Projects** — every project as a card, the next step named
  in its header without its verb, its steps side by side with the verb in its step, a "+" beside the
  `Mates` label adding a Mate, and no footer links. An empty step is its word in the muted hand at a
  filled step's height (`None open`, `Nothing merged`, `Not set up`) — never a dashed place, never a
  row that says "not set up yet". A Mate opens its conversation from wherever it is drawn: its chip
  in a row, the whole tile, its card. _Release_ is the next step's verb in the production cell, and
  beside a failed production when a release is offered; _Add production_ is the next step's verb,
  "Production is added here, not by the Mate." its tooltip, and a menu item while the role is
  creatable; _Add stage — optional_ is a menu item and nothing else. In the left menu production
  comes before the stage, and the stage is one muted line with no pill, menu or verb; a project's
  heading carries a dot only where its next step waits on somebody — never for a first task or where
  nothing is left. A Mate's conversation offers, in the composer banner, its own merge (since
  2026-09-29 its own change as _Review_ at the composer's top: it opens the review, whose _Merge_ is
  the one way to merge it), then the release with its confirm dialog, then _Add production_ as a
  link to the project's card (`/zerops?view=projects&group=`). **Supersedes:** of the 2026-09-06
  _Mate cards and an environment list_ row, the project laid out as Mate cards over an environment
  list — Mate cards stay, inside the Mates step and an opened row, and environment rows stay for
  what is not a step; of the 2026-09-06 _reading width_ row, the `readable` width and "tools are the
  same row"; of the 2026-09-07 row, "Add stage"/"Add production" under the table; of the 2026-09-17
  left-menu row, "stage before production, each `name [PILL] ● ⧉`" — production still is, the stage
  is not; of the 2026-09-17 projects-screen row, the pull requests as list rows under the Mate cards
  and _Release_ as the production row's verb. Everything else in those rows stands.
  - _Why:_ the owner, 2026-09-23, after a walk of the page on which 9 of 10 groups said "Nothing
    needs you here." and the one merge and one release waiting sat ~4000 px down, the menu and the
    page disagreed about what a production ran, and "+ Add stage" read as a step before production:
    "these are extremely important findings the whole UI should be built around"; then, 2026-09-24,
    of a strip that named steps without their verbs: "why is it there when I can't click it?"
- **2026-09-24** — **Superseded 2026-10-02 in part by the HQ row below: the signer is the one the
  Mate's server recorded, as HQ relays it, not a `mate:signer` tag (`mateOwnerRecords`).**
  **In the left menu a Mate wears the card's face, and its owner rides on the
  corner.** The Mate row's `MateFace` is `md` (28 px) in the spine's unchanged 20 px column — the
  face overhangs it, so the spine keeps its x and the row's gap widens to `gap-3.5`. The Mate's
  owner — its project's `OWNER` entry where there is one, else whoever signed its agent in
  (`mate:signer`), resolved by `resolveMateOwner` against `GET /client/{org}/user/list`, whose rows
  carry `user.avatar` like `/user/info`, is an `Avatar size="xs"` (14 px) pinned bottom-right, cut
  out by a ring of the sidebar's ground: their picture as the account bar picks it, else their
  initials; a tooltip and a screen-reader line say "Jan's Mate". An owner the member list cannot
  name gets no badge.
  - _Why:_ a teammate: the face was too small to read as the project's anchor, and the menu never
    said whose Mate a row is
- **2026-09-24** — **An empty conversation opens on an empty composer.** Nothing writes into a
  Zerops environment's composer on its own: a creation leaves no opening job on its birth
  (`birthStore.ts` keeps births only, and reads an older build's `handoff` and `jobs` as nothing),
  and neither the landing, the left menu nor a new-thread request composes an introduction.
  **Supersedes:** the 2026-09-07 row whole, and of the 2026-09-06 _one environment is one
  conversation_ row the sentence that composes zcp's introduction into an unspoken conversation.
  Everything else in that row stands.
  - _Why:_ the owner, 2026-09-24: "When I enter an empty conversation there must be no prefilled
    text in the composer" — the hand-off ("You were just created as …") sat in front of whatever the
    person typed
- **2026-09-24** — **A projects listing never moves on its own, and what the person started is drawn
  from the click.** The projects page and the left menu share one order, the tree's (_Newest first_
  or _Name_, `useProjectOrderPreference`); what waits on somebody is the _Next steps_ strip's to
  lift, never the rows' order. A group moves between a row and an _Only a Mate so far_ tile only on
  settled facts — its flow read, and every Mate's talk known (a Mate not connected is unknown, not
  untalked); unsettled, it keeps where it was last drawn (`groupPlacementMemory.ts`). A creation is
  drawn from its birth (`BirthRecord.placement`) the moment the platform accepts it, in its group,
  before the listing holds it — a Mate being created after the listed ones, a sleeping slate face
  that opens nothing, its line "Coming up. A few minutes."; a production being created reads
  _Setting up production…_ and offers no _Add production_; a stage being created is `↳ Setting up a
stage…`; a new project's group is placed by the birth's start — and the listed project takes its
  place by id, never drawn twice. A production the platform is building reads _Deploying…_ (busy),
  never green. An in-flight word — _Setting up…_, _Deploying…_, _Releasing vX…_ — is production's
  line 1, so a narrow row keeps it. A pressed verb stays in flight until the flow read shows its
  effect, not only while its request runs: _Merging…_ until the forge lists the pull request closed,
  _Releasing…_ until the tag is read back, _Redeploying…_ until the new run is read (each capped at
  30 s for a read that never answers); a refused verb is said on the page's error line.
  **Supersedes:** of the 2026-09-23 _flow_ row, "_Next step first_ the default order". Everything
  else in that row stands.
  - _Why:_ the owner, 2026-09-24, of the projects page: an added Mate did not show, the order "se
    různě přehazuje" as a project was added, and after _Add production_ nothing showed that anything
    was happening; `projectOrderPreference.ts`, `projectsView.logic.ts`, `groups.ts` (`pending`),
    `groupFlow.ts` (`creating`, `deploying`), `ZeropsProjectFlowProvider.tsx`
- **2026-09-25** — **Superseded 2026-10-02 in part by the HQ row below: Core tags and records
  releases (T9a), and the client reads them from HQ and rolls back there (T9b); what each release
  carried and a repository's history are HQ's comparisons (`carriedReads`, `useZeropsHistory`),
  where `useZeropsRepositoriesCommits` and its 30-commit read of Gitea are gone.**
  **A stop's page says what the stop runs in one sentence, in the words the left
  menu and the projects page use, and lists everything else in one card.** The detail pages
  (project, stop, change) stand in `ZeropsHostedFrame` `expanded` with the /zerops bar: the
  breadcrumb in the bar, the organization switcher and the account on its right; the header and
  every block after it — the verdict, the card, a section — are spaced by the frame's one page gap,
  as on /zerops, with no margin of their own. The header is the h1 (`environmentNameUnderGroup`),
  the `ZeropsRoleTag`, one muted meta line (`stopMetaLine`: _Moves on release · 2 services_,
  _Follows main_, _Nothing yet_ — the count is the code services') and the shared `ZeropsStopMenu` —
  the same menu the left menu opens for that stop, and no other header verb. The page opens with
  `VerdictPanel`: one sentence from `stopVerdict` (client-runtime `flow/stopDetail.ts`), its tone,
  its muted detail inside the panel after the sentence (on a phone on its own line, set in under the
  sentence's text), and at most one outline verb (_Release vX_ on a production behind, or on an
  empty one main has something for; _Run again_ on a failed deploy whose job is known). Its states:
  _Checking what runs here…_; _Nothing deployed yet._ (a stage adds _The next merge to main deploys
  here._); _Deploying…_ and _Releasing vX…_; _The deploy of vX failed on {service}._ with _{label}
  still runs · {age}_; _N changes not live._ with _Production runs {label}_; _Production already
  runs what is merged._ with _{label} · released {age}_; _Stage runs the head of main._ or _Stage
  runs {label}._ with _{short sha} · {age}_, or _{age}_ alone where the sentence already names the
  commit. The grey "Nothing needs you here." and the `AttentionPanel` are gone from the stop page.
  Below it one `FlatCard` holds `MicroLabel` groups, each group's rows on one grid of their own, so
  a group's status dots form one column, the first group 12 px under the card's edge and each later
  one 24 px under the hairline over it: _Waiting for release · N_; _Services · N_ — the stop's code
  services only, those a tier builds from a repository, so a database, cache or bucket has no row
  and is not counted — each row its chevron opening that service's own build, the short commit it
  runs and _deployed with {name}_, else _head of main_ on a stage whose commit is main's head (while
  a build runs, what ran before it, never what the build deploys, and no commit while nothing states
  what ran before), its word and age — none where it runs nothing, which its commit's place says
  once as _Nothing deployed yet_ — and its address, the _Open to the internet_ offer, or _Not public
  yet_; under it HQ's newest job of the service where that is not what runs (`jobOf`): _{sha}
  queued_, _Submitting {sha}_, _Building {sha}_, _{sha} failed 1h ago_, _HQ refused {sha} 1h ago_
  or _HQ skipped {sha} 1h ago_ — nothing is tried twice — HQ's reason under the line unless the
  verdict already says it; where the service runs a version HQ did not put there while no job of
  HQ's is under way (`driftOf`), _{service} runs “{name}”, which HQ did not deploy_ in the
  attention tone, with _Deploy {sha} again_ — HQ's live commit, to whoever may _Run again_, while
  the service's newest job is of that commit — and _Open in Zerops_: HQ never overwrites it by
  itself (the deploy-jobs design, 2026-10-03); after the services, each one the stop's tier
  declares and its project lacks (`notInZerops`, audit D2): _{service} · declared in the recipe,
  not in Zerops_, with _Add {service}_ to whoever may _Run again_ — HQ never adds one by itself.
  A verb pressed here, and a merge's or a release's review once pressed, says under its verdict
  where HQ answered the deploys it asked for stand, by environment (`deployAnswerSaid`): _api
  b21d904 building · web 5c3ea18 queued behind api b21d904_; "Tagged by" is dropped; _Releases · N_ on a production; _Deploys · N_ on a stage, muted _on
  main_, the running commit marked _Running here_ and a release tag drawn as the role-tag pill. A
  group with nothing in it says _None yet_. Releases are drawn by the shared `ZeropsReleaseRows`,
  the rows /zerops draws: the release production runs reads `Live`, one whose deploy failed reads
  `Deploy failed`, and _Roll back to this_ is offered on an earlier approved release only — never on
  one listing exactly the commits production runs (the live one, or an older tag a roll-back left
  listing the same); the first five, then _Show N earlier releases_. On a production's page each
  release row says what it carried, worded by `releaseDescription` (client-runtime
  `releaseCarried.ts`): line 1 is the chevron, the tag and its _RELEASE_ pill in a column of one
  width on every row (a longer tag truncates), then the subject of the newest commit it carried in
  the row's flexible middle, truncated only at that column's end — per service it moved, the service
  named only where more than one moved, _, +N more_ for the commits after the first; line 2, muted
  12 px under the tag, is the author, the age and the per-service shas (_Lena · 1h · titan
  96985a7_). The status and the verb stand in two columns of one fixed width on every release row,
  the status left-aligned and the verb right-aligned, so the descriptions, the dots and the verbs
  each run down one column — the `Live` row's dot is where the others' are, its verb column empty;
  on a phone the description, its byline and the verb drop under the tag. A release is measured per
  service against the nearest older release that is not refused (a refused release never deployed)
  and lists that service (a tag that could not be read lists nothing and is passed over); a service
  no older release lists is measured on its repository's older commit — the older release's commit
  of another service built from the same repository — so a service added to a group carries only
  what its repository did, not the whole branch; a roll back carried nothing new. The rows are
  measured over the whole list, so the fifth row shown is against the sixth release, and the oldest
  carries what the 30-commit read holds. A leading chevron opens what it carried: each moved
  service's commits on its repository's default branch after the older commit, up to its own, drawn
  by `ZeropsHistoryView` with each commit's files, beside the note of each repository still being
  read or whose read failed. A release with no description — its commits unread or failed, nothing
  new carried, or a refused one, whose broker reason stays its line — stands on the same columns as
  the described rows: tag and pill, its line — the shas, or the broker's reason — muted in the
  description's column with no byline, its chevron saying the history's note. The reads are
  `useZeropsRepositoriesCommits` — one `listCommits` per code repository, when the page opens, never
  polled. /zerops keeps that row, the shas alone: its card view mounts every group's rows, so
  reading each group's repositories there would be unbounded. A stop running several releases is
  named — in the menu, the verdict and the /zerops cell — by the newest release whose every listed
  commit its services run (`releaseRunBy`), else by its first labelled service. A state has one word
  everywhere (`stopView`): `Deploying…`, `Deployed`, `Nothing deployed yet`. On /zerops the
  production cell, the `↳` stage line and the stop names in an opened project link to the stop
  (`/group/$groupId/$projectId`) and say _Open production_ or _Open stage_ on hover
  (`openStopLabel`). **Supersedes:** of the 2026-09-05 _hosted frame_ row, "one content width
  (`wide`)" — the detail pages are `expanded`, as the projects screen is; of the 2026-09-17
  projects-screen row, "_Roll back to this_ on an earlier approved one" where that release is the
  one production runs. Everything else in those rows stands.
  - _Why:_ the owner approved the concept boards on 2026-09-25, after a walk of the stop page on
    which the page's own tone disagreed with the stop's menu, "Tagged by" named the broker instead
    of a person, Beviro's production read v0.1.9 while nextstore ran v0.1.13 (medusa, its first
    service, had not moved since v0.1.9), and the build shown under the page was the first service's
    whatever service was opened; then, the same day, a live walk on which Beviro's production listed
    db, redis and storage as services with nothing deployed, a service being released lost the
    version it ran, and the verdict's detail sat under its panel; `ZeropsGroupDetail.tsx`
    (`ZeropsStopPane`, `DetailShell`), `primitives/VerdictPanel.tsx`, `ZeropsStopMenu.tsx`,
    `ZeropsReleaseRows.tsx`, `releaseCarried.ts`, `useZeropsRepositoryCommits.ts`,
    `flow/stopDetail.ts`, `flow/deployment.ts` (`stopView`), `release.ts` (`releaseRunBy`,
    `releaseRow`), `ZeropsProjectsPage.tsx`
- **2026-09-25** — **A card is correct at every instant of a live turn, and reads the same after a
  reload.** Nothing on a card moves, shrinks or is merged away because something newer arrived: a
  same-turn retry is its own card (the R8 fold is gone); an attempt number appears only once it can
  no longer change — never while the thread's older turns are unloaded, never while an earlier call
  of its kind has not named its target; a deploy's five slots come from the reducer, so a reload, a
  second tab or a virtualized remount draws them too. A card that names one service reads, in one
  header row, a kind glyph, the verb as a `MicroLabel` carried by its `StatusDot`, and the hostname
  in a neutral chip, with the attempt and the duration at the right; a browser check's thumbnail
  sits at the left of that row and its figures under it. A platform process status has one reading,
  `platformStatus` in the phrase producer, spelled British like the pipeline: Queued · Running ·
  Rolling back · Cancelling · Done · Failed · Cancelled — a cancelled process is off, not failed.
  The turn tally appends a fact once it settles, in the operations' own status words, with the
  card's own `operationTone`.
  - _Why:_ a live page and a reload must agree, and an older card changing under the reader is the
    one thing the conversation must never do; three spellings of one process status broke R5
- **2026-09-25** — **In the left menu every stop is one row that answers where the newest change is,
  measured against `main`.** The order is Mates (their pull requests as forks) → other people's pull
  requests → every stage (listed, then being created) → production (listed, or being created), and
  the rail ends on the last stop; `main` is not a row but the reference each stop measures itself
  against. A stage and a production are the same one-line row (see the _one text column_ row below),
  ending in the shared `ZeropsStopMenu`. In sync with `main` and healthy, it says only what the stop
  runs; otherwise a state word leads, first match wins — _Failed on_ · _Setting up…_ · _Deploying
  vX_ / _Releasing vX…_ · _Nothing deployed yet_ on both tiers · _Checking_ — and while a word shows
  the distance is hidden. The distance means one thing on every stop: changes on `main` this stop
  does not run yet, so a stage with none and a production at `+3` say all three have run on the
  stage; a stage whose source is not exactly `main` shows its source in front (`feat/cart ·
3f9c1b2`) and no distance, and a distance that cannot be known is not shown, never guessed. The
  distance is a `+N` chip (`aria-expanded`, named and tooltipped "N changes on main not here yet",
  closed by default, closing itself when the distance goes to 0 or unknown) that lists those changes
  under the stop, newest first by commit subject; under production each carries where it stands on
  the main-following stage — `on stage` ✓, `deploying on stage` ↑, `failed on stage` ▲, or no mark.
  A stop is named by its version, else its commit — the same on both tiers
  (`DeployedVersion.label`); a change's title never names a stop, since a stage deploys whatever is
  pushed to the branch its trigger watches and is not any Mate's. A verb only where a person can
  act: production keeps _Release_ and its confirm; a stage has none. A failed stage is a failed
  stop, so `fix-deploy` names it after production's own failure. A project folds as the sidebar's
  usual gesture, one level: its title toggles it (`aria-expanded`, a small muted
  `ChevronRight`/`ChevronDown` after the title text, shown on hover and focus and always while
  collapsed), _Open project_ is the heading's ⋯ item, a collapsed project is its heading and
  next-step dot alone, the state is kept per group in the browser, and opening a Mate's conversation
  expands its project once. **Supersedes:** the stops fold kept only in the menu's code — "a full
  row becomes one line" (the owner, 2026-09-19) and its 2026-09-24 rule leaving the stage outside it
  — with `collapsedStops.ts` and its storage key, unmigrated; of the 2026-09-23 _flow_ row, "in the
  left menu production comes before the stage, and the stage is one muted line with no pill, menu or
  verb" and `↳ {name} · follows main`; of the 2026-09-24 _projects listing_ row, "a stage being
  created is `↳ Setting up a stage…`"; the list of what a release carries as the _Release_ verb's
  hover card and the stop menu's waiting group, on the left menu and the stop's page alike — the
  opened distance is now the one place the changes are listed. **Stands:** D28 (a release never
  waits on a stage), D29 (one next step per project, the heading's dot), and _Add stage — optional_
  as a menu item only; everything else in those rows stands.
  - _Why:_ the owner, 2026-09-25, approving page v3 of the _Stage row redesign_ canvas: the stage
    drawn as one muted line said nothing about whether it ran what `main` holds, and a fold inside
    the project was a second design of the same row; `SidebarZeropsTree.tsx`, `stopDistance.ts`
    (client-runtime: the distance, the stage marks, the name of what runs), `collapsedProjects.ts`,
    `groupFlow.ts` (a failed stage in `fix-deploy`)
- **2026-09-25** — **Cards carry no attempt number.** A repeated deploy, verify or browser check on
  one target is a card of its own with nothing counting it: `ZeropsOperation.attempts`,
  `attemptWord` and the whole-thread gate (`historyComplete`) are gone. **Supersedes:** of the
  2026-09-25 _card is correct at every instant_ row, "an attempt number appears only once it can no
  longer change …" and "with the attempt and the duration at the right" (the duration stays); of the
  2026-09-05 row, the `attemptWord` ("attempt N") rendering.
  - _Why:_ the owner, 2026-09-25: "attempt N" on a card was more confusing than useful
- **2026-09-25** — **The left menu has one text column, and a stop is one line.** Nodes — a Mate's
  face, a stop's badge — sit centred on the rail; every row's text starts at the Mate's column, one
  `gap-3.5` after the 20 px rail cell: Mates, stops listed and being created, and the changes an
  opened distance lists (their stage mark trails the title). A project heading's title starts at the
  rail cell's left edge. Pull-request forks keep their own branch indent. Every stop — stage or
  production — is one `h-7` line, with no second design and no switch: the badge on the rail; the
  role as a pill (`ZeropsRoleTag`: `stage`, `prod`) and the stop's own name after it only where the
  name says more than the role (`qa`, `stage 2`, `eu-west`; never `production` beside `prod`) — the
  pill and name are the button that opens the stop; what runs (the version's tag, else its short
  commit, the state word in front where something differs); the distance as a `+N` chip right after
  it; then at the row's end _Release_ (no count — the chip carries it; the tag and what it carries
  are its accessible name and its confirm) and two 20 px slots that are always there, the globe and
  ⋯ — the shared `ZeropsStopMenu`, the menu the stop's page header opens, with no second menu in the
  left menu. The globe slot keeps its width without routes, so globes stand in one column across
  stops; one route is the globe alone, several put a count bubble on the globe's corner (adding no
  width) and open the menu of every domain. ⋯ is invisible at rest, fading in on row hover and
  focus-within (its slot's opacity, not the menu's), always in the tab order; it changes only its
  opacity, so nothing moves on hover. What runs truncates first; the state word only after it; the
  pill, the chip, the verb and the two slots never give way. A stop being created is its badge, its
  pill (and name, by the same rule) and its word. Mates, headings, pull-request rows and the
  distance list keep their own designs. **Supersedes:** the two-line stop row of the row above; the
  role pill dropped where the name says the role (`environmentRoleTagIsRedundant`, deleted); the
  globe's `1` beside it; _Deploying vX…_ with an ellipsis.
  - _Why:_ the owner, 2026-09-25, reviewing the stop rows live: the heading title at x 37, Mate text
    at 53 and stop text at 49 — "everything jumps around differently" — then a stop as one line with
    the role as its pill, and "the globe jumping because of the dots is exactly the problematic
    detail to solve properly"; `SidebarZeropsTree.tsx`, `SidebarZeropsTree.logic.ts`
    (`stopNameSaysOnlyRole`), `ZeropsPublicRoutes.tsx` (the globe and its bubble),
    `ZeropsStopMenu.tsx` (⋯), `stopDistance.ts` (the deploying word)
- **2026-09-26** — The conversation reads as the person's messages, one work line per stretch of
  work, the answer and one outcome card; the turn header card and the fold of a settled turn are
  gone.
  - _Why:_ the owner: "the design of the chat actually sucks"; 430 screenshots of two real threads
    showed the timeline drawing the agent's log, not the conversation — and the owner's conditions:
    nothing seen merged away, no update above the last message, no layout shift
- **2026-09-26** — Operation cards fold into the outcome: a settled operation is one line in its
  stretch's log and a row of the outcome card; a failure keeps its full card where it failed; a
  running pipeline lives in the dock; browser checks are one strip per stretch; a service that
  stopped answering is one incident line. Supersedes "every call is a card of its own".
  - _Why:_ fourteen cards for one deploy round read as one grey block; the card design stays for
    what needs it — a failure, and the log
- **2026-09-26** — Thinking is hidden in an opened log, behind one Show thinking switch on the
  opened line; "› Thought (×N)" rows are gone.
  - _Why:_ "Thought" rows alternated with notes for screens; the switch lives on the line so its
    arrival never pushes the log
- **2026-09-26** — No "Done" on the work line: the face carries the state (✓ · ! · ⏸ · ■), the line
  keeps the last note the person saw.
  - _Why:_ "Done" covered a success, an abort and a usage limit alike
- **2026-09-26** — The server version and its Update leave the conversation header; they live in the
  right panel's Zerops view, beside the Mate's body.
  - _Why:_ the header is the Mate — face, name, the last task as the person put it
- **2026-09-26** — A dock above the composer holds what changes size while the Mate works: running
  pipelines, helpers, the task list, a pause countdown.
  - _Why:_ a helper starting or a deploy stepping on must never move a message; the task list had no
    home at all
- **2026-09-26** — _Your move_ stays the next-step banner above the composer, read from the
  project's flow — not a row of the outcome card.
  - _Why:_ a live action frozen into a turn's history goes stale; the banner already answers from
    the flow, not from what the agent said
- **2026-09-26** — **A Mate's conversation offers only its own merge.** The composer banner is the
  merge of this Mate's own mergeable code pull request, read from the flow's open changes
  (`mateNextStep`), and nothing else: a release carries every Mate's merges and a production is the
  project's, so _Release_ and _Add production_ stay with the project on the left menu and the
  projects page. **Supersedes:** of the 2026-09-23 _flow_ row, "a Mate's conversation offers … then
  the release with its confirm dialog, then _Add production_".
  - _Why:_ the owner, 2026-09-26, of "Release v0.1.34 to production" above Cleo's composer: "merges
    could be coming from different mates, let's keep it on the left"
- **2026-09-26** — One clock (today "9:14 PM", "Yesterday 9:14 PM", "Sep 24 9:14 PM") and one
  duration format ("42s", "1m 12s", "13m", "2h 6m" — seconds only under ten minutes, nothing under a
  second).
  - _Why:_ timestamps switched between three shapes and durations between four
- **2026-09-26** — The content contract (answer first; the person's move in one `[!IMPORTANT]`
  callout or nowhere; corrections `[!WARNING]`, risks `[!CAUTION]`; say what changed; the person's
  names, never internal ones; structure only for length; an aside into the task list with a line
  that answers it) lives in the Mate's runtime instructions (`apps/server/src/contentContract.ts`,
  appended by `provider/RuntimeInstructions.ts`), not in zcp's guidance.
  - _Why:_ it is about how the Mate's chat renders; zcp's AGENTS.md is not caller-aware
- **2026-09-26** — After a usage limit the thread resumes by itself at the reset, on by default,
  with a per-thread switch on the pause; background results that arrive while the window is closed
  are held instead of opening a turn each.
  - _Why:_ 11 of 17 limit turns in Lena's thread were opened by background results and ended at once
    as "Done · 1 ms"
- **2026-09-26** — The Mate at work is one component under its line — its face, its latest words in
  a bubble rising in, a pill per thing running, a failure marked in place, the browser while it
  checks. The dock above the composer is gone. Supersedes the dock row above.
  - _Why:_ the owner, looking at the first pass live: "every single thing that pops out of the
    working is completely disjointed, without context" — a red "Re-run type checks" box, deploy rows
    over the composer
- **2026-09-26** — A settled turn's working group becomes its report, made of the same pills, before
  the answer; the outcome card is gone.
  - _Why:_ the owner: "in the end this working group turns into a 'report' made of similar
    components"
- **2026-09-26** — No face on a line or beside the person's messages; a settled line is one quiet
  phrase and a chevron — no preview, no count; a read message carries no mark. Supersedes the "face
  carries the state" row above.
  - _Why:_ eight identical faces on one screen and a column of truncated previews: "spilled rice"
- **2026-09-26** — The Mate's words the person answered stay, in full, beside its face; a stretch
  that ends in its answer has none.
  - _Why:_ the replies the person reacted to were cut to "…" inside the line
- **2026-09-26** — Opening a line shows everything it did, thinking included. Supersedes the Show
  thinking row above.
  - _Why:_ "Thought for 16s" opened onto a switch: a double disclosure
- **2026-09-26** — Only what stopped the turn stands outside the log: a background task that failed
  and a failed operation are steps on the way, and the report says what the turn came to.
  - _Why:_ a type check re-run while fixing types stood as a red box with its label twice
- **2026-09-26** — The browser is a stage in the frame of the device it checks on, its takes listed
  beside it; the report keeps every take as a thumbnail.
  - _Why:_ the owner: the strip "doesn't utilize space well" — "live browser for effect could play a
    prime, also with the different devices it will use"
- **2026-09-26** — The person's answer to the Mate's question is their bubble under what was asked.
  - _Why:_ the answer went nowhere visible, and the live line spelled out the question tool's
    arguments
- **2026-09-26** — The Mate at work is a panel: its words stream as bubbles beside its face — the
  newest popping in, older ones pushed up and fading out through the top, a failed step as a red
  bubble that turns amber once it came back — a status bar per thing that runs, and the browser
  sliding out from under it as a drawer. Supersedes the one-bubble working component row above.
  - _Why:_ the owner: "chat bubble come up and go, pop a browser below, mark errors encountered in
    some bubbles" — "I want it to look like a Tesla panel: neat, but powerful, playful"
- **2026-09-26** — Its report is the same parts settled: pills on one small tray, each led by the
  disc its status bar wore. Supersedes the pills-without-a-surface report row above.
  - _Why:_ the report has to read as what the panel turned into, not as something new that appeared
- **2026-09-26** — Work that outlives the turn stays in the conversation: the panel, smaller, at its
  bottom with Stop until the work ends; the background banner above the composer is gone; a running
  turn's background tasks are a status bar like any other.
  - _Why:_ the owner: "will background tasks be integrated as well somehow? where does it belong" —
    the banner was the last thing popping out without context
- **2026-09-26** — While the person follows the live edge, the timeline follows any growth at its
  end (LegendList's threshold is a whole viewport); every gesture that moves away switches following
  off.
  - _Why:_ the browser drawer opened a few hundred pixels in a few frames, past LegendList's tenth
    of a viewport, and slid out under the composer
- **2026-09-26** — A Mate's version and its Update live on its home card, under its name and outside
  the hover pop, with the same control the project page's menus read.
  - _Why:_ the conversation header's version line was removed in 0.11.46 on the claim that the right
    panel carried it; it did not, and Update was reachable only from the project page's menu — the
    owner: "is it just me or the update button disappeared?"
- **2026-09-26** — **What the Mate is on is said once, beside its face.** The live line keeps its
  clock and its chevron; the words for the call running now — in words, never its arguments — stand
  under the newest bubble, and a deploy's bar or the browser's drawer says its own.
  - _Why:_ the owner, of Cleo's live panel: "there are still some states that are duplicating, not
    clear who is doing what" — "Deploying appdev" stood in the line, in the bubble and in the bar at
    once, and the question tool's JSON leaked into the line
- **2026-09-26** — **The stream keeps what the stretch said, to scroll back through.** Following the
  newest is left only by a gesture; the window easing to a new height never reads as reading back.
  - _Why:_ the owner: "shouldn't we be able to scroll through the old messages in this context?"
- **2026-09-26** — **A question stays in the words of whoever said it.** Waiting, it is the Mate's
  newest bubble with amber "Waiting for your answer" beside the face; answered, the question stands
  beside the Mate's face and the answer in the person's bubble. Supersedes the
  answer-under-what-was-asked row above.
  - _Why:_ the settled conversation kept only the question's short header, inside the person's
    bubble, so it read as the person's words
- **2026-09-26** — **A batch deploy is a bar and a pill per service**, each in the state its own
  step reached; the report no longer skips a batch. A check that failed and then passed on the same
  page is a retry, never a failure, and a service's front page is "/".
  - _Why:_ the owner: the batch bar read "medusastage, … medusastage"; a device name the browser did
    not know made the report say "1 failed" under an answer that said every page rendered
- **2026-09-26** — **Background work that finished says so**, counted by task ("Background task
  finished", "3 background tasks finished · 1 failed"), and the turn it woke is live from its first
  words, before the session names it.
  - _Why:_ a watch that reported twice counted as two tasks, a failed task fell out of the line, and
    the woken turn's first words drew as its answer for a moment
- **2026-09-26** — **An opened log has one text edge**: thinking, runs of calls and operations hang
  their marks in a column before it and notes stand on it; the words the person answered are said
  once — in the opened log, else beside the face.
  - _Why:_ notes started at 406 px, thinking at 430, calls at 432; the last note stood twice when a
    line was opened
- **2026-09-26** — **The composer before and while a session starts**: a Mate's conversation invites
  with one sentence whether or not its session runs; the send button keeps its spinner until the
  turn runs and turns into Stop; the context meter is a pie, never a ring that reads as a spinner
  beside Send; the empty conversation's heading keeps clear of the banners; _New session_ says
  "Started a new session".
  - _Why:_ the empty state's banner covered the heading, "send follow-ups" invited follow-ups to
    nothing, the arrow came back for 1.5 s between Sending and Stop, and the toast said "Thread
    archived"
- **2026-09-26** — **An update is asked in the app's confirm dialog and said on the Mate's card.**
  Wherever _Update_ is pressed — a Mate's menu on the projects page or its project's page, the home
  card's line — the app's confirm dialog asks "Update Nova to 0.11.49?" and says that running work
  stops and the conversations stay; a check that finds a newer version asks the same at once. While
  it runs and for a moment after, the Mate's card and row say it over the subject ("Checking for
  updates…", "Updating to 0.11.49…", "Updated to 0.11.49", "Up to date", a failure in the failed
  tone). The confirm drawn on the update line is gone.
  - _Why:_ the owner, 2026-09-26: "I pressed that update button on all of them, there is no
    indication and nothing seems to be happening" — the menus' _Update to x.y.z_ armed a confirm
    drawn only on the update line, which no menu surface draws, so no update ever started
- **2026-09-26** — **The conversation is one column.** Every box sits on the composer's edges, every
  line of text on its text edge (its 1 px frame and 16 px padding); a mark leads its words on that
  edge.
  - _Why:_ the owner, of Juno's live thread: the panel "has space on the left side, none on the
    right"; the compaction line, the work line, the panel and the composer stood at four left edges
    (measured 367, 371, 387, 387)
- **2026-09-26** — **One prose size**, `--text-prose` 14/22.75: the person's words, the Mate's
  answer, its questions and the answers to them.
  - _Why:_ "size in my bubble and the response differs"; then "14px everywhere was better"
- **2026-09-26** — **A run of the Mate is one card**, from its first message to its answer: its
  line, its log, what the person wrote into the run where it arrived — under the Mate's words just
  before it — the Mate at work with its bars and browser, the report; the answer after it.
  Supersedes one work line per stretch and the words the person answered beside the Mate's face.
  - _Why:_ "why isn't the Working and its expansion directly inside the mate thing"; "'worked' who
    where?"; a message queued mid-run split it into "Juno worked for 1m 4s" and a reply — "it needs
    to be handled properly"
- **2026-09-26** — **The Mate talks to the person in one hand**: its answer, and the last words of a
  run that ended without one, are prose on the text edge, with no bubble and no face; inside a card
  its words and its thinking are bubbles.
  - _Why:_ "why all of the sudden the mate reply has an avatar and background bubble?"
- **2026-09-26** — **The Mate at work thinks aloud**, a light bubble per paragraph of its thinking;
  **its answer streams once, in place**, under the card.
  - _Why:_ "why aren't there thoughts reflected in the chat?"; "the last message ... first starts
    rendering in the working panel, then it all turns into the result"
- **2026-09-26** — **Only what arrives live animates**; a conversation opened onto the Mate at work
  lands at its very end.
  - _Why:_ "retriggering animation of existing items"; "when opening the page it doesn't properly
    scroll to the very bottom" (measured: 18 px short, a window easing to heights re-measured as
    text settled)
- **2026-09-26** — **The opened log is a record to scan**: thinking as muted paragraphs on one
  hairline, three lines each until clicked; notes as the panel's bubbles; runs of calls and
  operations as quiet lines, tools named, their chevron on hover. Supersedes the one text edge with
  marks hung before it.
  - _Why:_ "these open full thinking design are pure shit"
- **2026-09-26** — **A check with no screenshot is a structure check**: a structure glyph,
  "structure", what it found; no empty frame; the report shows only screenshots.
  - _Why:_ "what is it good for then?" — "when there is no screenshot it means its checking just the
    structure right? we could somehow reflect as well"
- **2026-09-26** — **The build log opens in a dialog**, never by itself; under the build step, a
  running build's two newest lines and the link.
  - _Why:_ "log here is unscrollable and weird + it shows at wrong places ... it should be opened in
    like a live dialog ... or ... under the actual step"
- **2026-09-26** — **The Mate's copy and time sit on a reserved line under its prose**, shown on
  hover.
  - _Why:_ "placement of this utterly sucks + its even cut of overflow"
- **2026-09-26** — **A take reads how it ended, as the heading counts it**: running, passed,
  retried, failed. A failure a later take of the same page passed is a retry — an amber frame, a
  turning arrow, "retried" among its words, the refusal in its label; only an unrecovered failure is
  red. A failed take says what it could not do ("couldn't set device iPhone 13"), never the tool's
  class of error.
  - _Why:_ "3 checks · all passed" over a take in a red frame with a ✗ (Nova: the phone refused
    iPhone 13, retaken on another); "set device iPhone 13: Other" in red under the frame
- **2026-09-26** — **A mostly empty take is cropped to its content**: its height filling the frame,
  a line wider than that cut at the right, never narrower than a quarter of the page; a page with
  content across it is shown whole, the live frame never cropped.
  - _Why:_ `/api/time`'s JSON at 126 × 78 was a white box with a smudge along its top
- **2026-09-26** — **A run's time and its ending never change after the fact.** Settled, a run ends
  where the Mate's own entries did — a helper's or a background task's reports are the task's time —
  and one that ended on a step or a thought says "stopped after", whichever run is the latest; a
  plan it proposed or a compaction ends a run by design, and a row that only tells — a question
  waiting on the person, a warning — is no step it stopped on. Its clock, live and settled, leaves
  out the time its questions and approvals waited on the person — live, it stands still while one
  waits — and the tooltip keeps the run's whole span.
  - _Why:_ "stopped after 40s" read "worked for 40s" once the next run began; "1m 16s" read "1m
    20s"; "worked for 21s" grew to "2m 19s" while only the helper worked; "worked for 7m 5s" counted
    three minutes of the question waiting on the person
- **2026-09-26** — **A run nobody wrote to start opens with what woke it**: "Helper finished" or
  "Background task finished" and the task, where the person's message would stand, its result one
  click away — what finished after the run before it ended and before it began, a helper by its last
  report; a row gathering several helpers is left out, and work no turn owns keeps its own line.
  - _Why:_ a helper's review came back and the run it woke began with no word of why; named by where
    it stood, a task done ten minutes into the run before was said to wake a run the harness started
    (Juno)
- **2026-09-26** — **A command never opens a run another message started**: a /compact the harness
  ran without a turn stands alone as its event line, done once nothing runs, and what the person
  sent while it ran is drawn as its own run.
  - _Why:_ Juno: every message and all the work after a /compact vanished from the log while the
    title and the sidebar showed them
- **2026-09-26** — **The Mate's question is the one ask while it waits**: the next-step banner steps
  aside while a question or an approval waits and comes back once it is answered; the composer says
  "Waiting for you" in sentence case in the attention colour, not as a `MicroLabel`; the question
  tool's call is never a line of its own. Answered, the Mate at work streams on under the answer in
  a panel of its own.
  - _Why:_ "Nova is waiting on you to merge #2" stood over the question panel; "WAITING FOR YOU" in
    capitals under the panel's own amber "Waiting for your answer"; "Used AskUserQuestion" over the
    question it asked; thoughts from before the question streamed on below the person's reply
- **2026-09-26** — **The Mate thinks in its own hand.** In the panel a thought is no bubble: text on
  a hairline (drawn, 1 px `border`, the text's height) in the muted ink and in italics, in a note's
  box to the pixel; its words to the person stay the bubble, its corner toward the face, filled in
  `secondary`, which the dark card shows, and the composing dots take the same fill. The opened
  log's thinking takes the italics too. Aging only dims and shrinks, and the letterforms outlast it.
  `ConversationWorking.test.tsx` pins each kind's hand at every age and the shared box.
  - _Why:_ a light thought bubble read as an aged note, and an aged note as a thought; in the Zerops
    dark palette `muted` sat 0.008 lightness from the card, so a note showed no bubble there at all
- **2026-09-26** — **No words stream in one place and move to another.** The live run's last words,
  while they stream with nothing after them and not reading as its answer, are drawn nowhere — in
  the panel or an opened log — while the panel shows the writing dots: a note pops in whole once
  written out or once the Mate moves on (a background task reporting in is not the Mate moving on);
  the answer streams under the card from the moment it reads as one, or stands there whole when the
  run ends. A live run with nothing in its log is drawn as it will settle once its answer is known.
  - _Why:_ every recorded answer (56 of 56) streamed first in the panel and jumped under the card at
    its first paragraph break, a median 133 characters in; no length threshold removes it, a lower
    one only drags more notes under the card and back; a run answered in one breath flashed a card
    for a frame; held until a step came after them, a Codex note stood hidden for a whole build, for
    Codex says nothing of a command until it completes
- **2026-09-27** — **The person's words stand on the page; the run's card is the Mate's.** What the
  person and the Mate say to each other while a run goes on stands on the page in the order it was
  said — each message sent into the run under the Mate's words just before it, beside its face in
  its bubble, each answer under its question — and the run's card follows: its line with its live
  panel, later with its report; the answer follows the card. The live card stays whole under the
  last message and moves down with a message sent into the run; opening the log changes nothing
  above its line, and the log marks where each message reached the Mate with its words, one line, on
  the person's side.
  - _Why:_ "what exactly is this white wrapping?" — a run the person wrote into seven times was a
    white card around their own messages, the first of them outside it, the Mate's words before each
    reading as its replies
- **2026-09-27** — **The Mate's words and its thinking are told apart at a glance** (supersedes "The
  Mate thinks in its own hand"). Its words to the person are a chat bubble, its corner toward the
  face, in `MATE_BUBBLE_FILL` — 8 % of the ink over whatever it sits on — in the panel, the opened
  log and on the page alike, their words in full ink as the answer's are; its thinking is no bubble
  and no line, 13 px muted italics. Thinking dots stand bare; words on their way are the dots in a
  bubble. Age dims a thought faster than a note: what it said stays readable, what it thought
  passes. `ConversationWorking.test.tsx` pins each hand at every age.
  - _Why:_ "almost no distinction between messages that are thoughts and notes in the working
    group"; `secondary` sat 0.03 lightness off the light card, so a note was bare text there and a
    bubble only in the dark theme, and age dimmed both to the same pale text
- **2026-09-27** — **A run folds into what it settles as, and nothing after it jumps.** At the
  settle what takes the panel's place starts at the panel's height and eases to its own — the
  report's band of the card, or room at the top of the Mate's last word under a run that settles
  into its line alone; a report that comes a moment later grows in from nothing while that room
  eases on. Only a panel the page drew a moment ago folds; one scrolled out of the list's window, or
  never seen, is simply gone. It never folds before the settle: words that read as an answer mid-run
  are a note once the Mate goes on. A running turn's last words wait a moment once finished
  (`LAST_WORDS_GRACE_MS`, on the client's clock) before they are placed, so a short answer goes
  straight under the card.
  - _Why:_ at the settle a tall panel — words, four deploy bars, the browser — became a short report
    at once and the streamed answer jumped 470 px (Nova); 13 of 56 recorded short answers popped
    into the panel as a note and then moved; a review found a panel folded early coming back at full
    height at the next step
- **2026-09-27** — **The rows of a card meet exactly.** The list sizes a row to an eighth of a pixel
  on the web as on native (the LegendList patch), so a card's white bands abut with no seam.
  - _Why:_ whole-pixel sizing left up to half a pixel between a card's bands: a hairline across
    Juno's card on a 2× screen
- **2026-09-27** — **The message that began a run reads as read** once the server has begun the run;
  one sent into a running turn keeps the clock until the Mate's next step.
  - _Why:_ "says it didn't read when this message was the trigger": minutes of Juno thinking under
    its opener, marked "Not read yet"
- **2026-09-27** — **A settled card names a change that landed once**, in the report's pill; live,
  its line stands in the card until the report takes it, and an opened log keeps it where it
  happened. **Starting a helper is work** in a run's line ("Started 1 helper"). **The background
  card wears a run card's frame**, its bars in the panel's padding.
  - _Why:_ "shop #36 landed" over the report's "shop #36"; "Nova thought for 8s" for a run that
    launched a helper; the background card's bars hung 16 px out of its frame under a ring and a
    shadow
- **2026-09-27** — **A git push reads as a push.** A `zerops_deploy` with the git-push strategy says
  "Pushing" under a commit glyph with its one push step, then "Pushed" (to its pull request or
  branch), "Up to date", or "Deployed" when zcp watched the build it triggered to ACTIVE; the report
  says nothing of a service a push only pushed, and a push that failed is something the run could
  not do; its card reads no build pipeline.
  - _Why:_ four bars all named "appdev" — "Done 1s", "Deployed", "Done 2s", "Deployed" — the pushes
    told as deploys with build steps ticked off that never ran
- **2026-09-27** — **A Mate's subject is the ask that started its latest run.** The server's thread
  preview is no longer overwritten by a message steered into a running turn, so the header and the
  Mate's row keep the task; a message sent while the Mate is idle, or during a compaction, is the
  next task. Takes effect as each Mate's server updates.
  - _Why:_ the header read "and make the heading green too" — a follow-up — and the owner's "btw …"
    asides each became the Mate's headline
- **2026-09-27** — **The chat's pieces share their fills, edges, sizes and clocks**: fills that
  vanished on the dark card take a share of the ink; live is busy blue, never the failure red; no
  shadow outside a popover; the report's takes and a pause's parts stand on their text edges; the
  strip heading, a pause's head and the report pills read at `text-line`; an operation card's
  durations read as the conversation's ("42s", "1m 12s"); a /compact that runs for minutes shows its
  clock; text actions stay in the link ink markdown uses. A run whose only work was an operation
  says it worked.
  - _Why:_ an audit found the same roles drawn several ways — contrast 1.018 fills, a red Live dot,
    "0:42" under "42s", 53/55 and 56/60 px near-miss edges; "Nova thought for 8s" over "1 page · 1
    check"
- **2026-09-27** — **The run's card is the Mate's work record at three zooms**: live, its tail —
  what it said, thought and did, each call a `WorkStep` line once it returned, the one it is taking
  under its face; settled, its report; opened, all of it — each call a step in its own words with
  its command, each stretch of thinking one line, the person's words marked where they reached it. A
  task that tracks a command is that command's step, never a row or a bar. The server passes a
  call's own description and target (`data.input`: description, file_path, path, pattern, glob, url,
  query; past runs too, as it projects stored rows when read).
  - _Why:_ "why isn't the chat showing even the commands it runs? it shows them when it's doing it,
    but not in the log" and "what's the diff in the expanded group and our actual chat?": the panel
    said "Running cd", the log folded every call into "Ran 1 command" between walls of thinking, and
    the only readable account of the work was the Background bar — 27 of 27 of its "background
    tasks" on one run were commands the Mate waited on
- **2026-09-27** — **On the page the Mate speaks in prose** (supersedes the page half of "The
  person's words stand on the page"): the note the person answered and the question it asked stand
  in the answer's hand, never a bubble beside its face; bubbles are the card's.
  - _Why:_ "this Q/A style is out of place, when it's the only place where the AI gets its own chat
    item bubble"
- **2026-09-27** — **A deploy reads one word, one time and one set of marks, and offers its build
  log once there is one**: the card's step lists share `StepGlyph`, sentences at 13 px, times `4s` /
  `1m 12s`; the header says "Deploying" / "Deployed" / "Failed" and how long; the log's link waits
  for the build's first line; under its bar or its log line the card is its body alone. A bar in the
  Mate at work stands for what runs: a finished one leaves, a failed one stays.
  - _Why:_ "you shouldn't be able to open build log when the container is not even running" and
    "font sizes, indicators etc. are pretty poorly done": "● Running · Running for 12s" beside a
    rocket, a check, a pale dot and an empty ring at 16 px next to 14 px words, a clock, a play
    button and "4 s" in the same card, and the pipeline's header repeated under its own bar
- **2026-09-27** — **A call that failed on the way is no outcome**: the report's "not done" lists
  what the run set out to do and did not; a failed Zerops call the Mate went past (the "error" kind)
  stays in the log and the live stream. An image the Mate shows in its words loads from its home or
  `/tmp` as well as its workspace (images only, symlinks resolved, `media-file-exact`).
  - _Why:_ a finished deploy's report said "Workflow failed.: scope contains unknown … hostnames" in
    red; Juno's answer embedded two screenshots from its home and both read "Image unavailable"
- **2026-09-27** — **A run's card is one record, the same while it works and after it** (supersedes
  the panel's stream of bubbles, the stream kept to scroll back through, the opened log in all its
  forms, and the work record at three zooms): its heading, then one scroll of lines in the order
  things happened — thoughts, notes, each call once it returned, operations once settled, a launch
  of helpers, tasks where they finished, where the person's words reached the Mate — each line a dot
  in its state's tone, its words, a detail and its time on the card's one time column; the scroll
  follows its end, holds while the person reads back, never grows shorter while live and never moves
  sideways, and stays on the page after the run with the same scroll. What the Mate is on now stands
  at the scroll's end beside its face and nowhere else, and joins the record once it ends.
  - _Why:_ the owner: the opened log "literally duplicates what's the mate bubbles", yet "never said
    that it started the subagent at the start"; "merge all these, make it as working as it was the
    expansion ... remove the expanding part fully"; "after the work is done I'd leave it on the page
    (with the same inner scroll it has while working)"; "no horizontal scroll"
- **2026-09-27** — **Rows and bars**: the record's rows say what the Mate did; what runs in parallel
  — a deploy, the to-do list, the helpers, background tasks, a service in trouble — is a status bar
  under the record while the run goes on, its name, its bar, its words and its figure on the time
  column, no icon; the browser opens under the bars, the whole run's checks however often the person
  wrote into it. Settled, the bars become the result, and the checks and a service in trouble join
  the record where they happened.
  - _Why:_ the owner chose "rows and bars" and "beside what's happening" in the run card study;
    "clean, scanable, no unnecessary icons, make the use obvious from the component"; a replay of a
    real thread moved a run's checks into its record's middle when the person wrote into it
- **2026-09-27** — **Nothing about a run opens in place.** A line, a bar or a pill with more behind
  it opens it in one modal (`RunDetail`): a step's command, output, files and pictures; a thought in
  full; a deploy's pipeline and build log; the helpers; a task's report; a whole error; the to-do
  list; what a pill counts. A pill that opens wears no chevron.
  - _Why:_ the owner: "remove the expanding part fully"; an opened line moved the conversation under
    the reader
- **2026-09-27** — **The result counts what the calls came to, as pills** — "Edited 7 files", "Ran 5
  commands", "Read 4 files", "Started 11 helpers" — each opening what it counts; the edit pill steps
  aside where the files pill counts the diff; a Zerops tool without a card of its own is a pill of
  its own ("Checked the workflow"). The heading says only who worked and how long.
  - _Why:_ the owner: "why isn't 'Kai worked for 5m 3s · edited 7 files · ran 5 commands · started
    11 helpers' in the 'result' style?"
- **2026-09-27** — **A picture in the Mate's words opens in the image viewer**, the message's other
  pictures beside it; a step's pictures are drawn in its modal.
  - _Why:_ the owner, of a picture in an answer: "why aren't these opening in modal?"
- **2026-09-27** — **A helper's report is a line where it finished**: one that finished after its
  run ended is what woke the next run, never a line of the record that started it; what woke a run
  is said only when that run shows something.
  - _Why:_ a helper's review stood in the record of the run that started it, at its spawn, and again
    as what woke the next run; a lone "Background task finished" over nothing: "why does it say
    here?"
- **2026-09-27** — **A check with no picture draws what it read, in the frame** (supersedes "A check
  with no screenshot is a structure check"): the page as the check last read it — its accessibility
  tree, else its text — as a wireframe scaled as its picture would be; else each thing it asked of
  the page with the answer ("main h3" · "6 found"); else what its errors, console and requests came
  to. The frame never collapses and never says "structure"; the client keeps what a check read from
  its steps' own results (`BrowserRead`).
  - _Why:_ the owner, of Juno's "Desktop · /cz · structure" over an empty card: "why not like show
    the structure output or mock in the space where the window would have been"; Juno's check had
    only counted things on the page
- **2026-09-27** — **The right panel opens only when the person opens it.** The one-time Zerops
  default on a conversation's first visit, and each browser's record of it, are gone; its buttons,
  the lifecycle strip, an agent's Authorize, the browser strip and a link still open it.
  - _Why:_ the owner: "this right panel keeps being opened on zerops by default (like when I add a
    new mate etc..) I don't think its necessary"
- **2026-09-27** — **The card breaks where the person spoke into the run.** A message sent into a
  running turn, or an answer to the Mate's question, stands on the page where it was given; the card
  stops above it and carries on under it — the same run, one heading and one clock on its first
  part, what runs now, the bars and the result on its last. Nothing of the person's stands inside
  the record.
  - _Why:_ the owner, of a message sent mid-run: "I still find this state completely confusing"; of
    the two ways the run card study drew it, they chose "the card breaks around it"
- **2026-09-27** — **One jump box finds what the left menu holds and writes to a Mate without
  opening it** (`JumpBox`). It extends the app's palette: ⌘K keeps its one binding and `/` joins it
  wherever nothing is being typed — the conversation's type-to-focus leaves `/` to it, and a slash
  command starts in the focused composer; signed in, the palette's root is the jump box, `>` hands
  over to its commands and taking the `>` away hands back; files and contents keep their own modes.
  What it finds is what the menu draws: the tree publishes its Mates, projects, changes and stops in
  its own order and scope, collapsed projects included, data only, and the box reads each Mate's
  conversation afresh over it; a conversation's words are what its row says, then the server's
  thread search, which covers whole histories. A stop is revealed in the menu, not opened: its row
  carries what runs, the distance, _Release_, the routes and its menu, and its page is ↵ away from
  the focused row. A Mate's change focuses its Mate and pins its peek on that change, flashing the
  change's row. A phone's menu steps aside for the box and comes back to show a find
  (`SidebarRevealBridge`); on the settings pages a find opens its page. `@` never offers a Mate
  another member signed in (D6). A send carries the conversation's model and modes and the notes of
  changes that landed since the Mate last spoke; a question it waits on takes the words as its
  answer (several, or options only: ↵ opens it); a first message goes through the composer's
  send-on-open; a message during a run is steered in at once — the composer's
  hold-until-the-next-step queue is there to edit a message before it goes, and the box has no
  composer. The composer's `formatOutgoingPrompt` reduces to the trimmed words here: a
  prompt-injected effort lives in the prompt's own text, never in the conversation's model options.
  The hints: "Nova reads it now", "Nova is working — it reads this at its next step", "Nova is
  waiting for your answer — this answers it", and in the same voice an approval, a plan, a pause and
  a first message. The match is the search's bold, not the prototype's amber, which is the attention
  colour.
  - _Why:_ the owner approved the jump box in the integrated sidebar prototype (feature 4: "One jump
    box"); the palette already owned ⌘K, a second listener would have raced it, and a Mate the
    person may not write to has no composer in its own conversation either
- **2026-09-27** — **The left menu is where a Mate is acted on, not only opened**: the Mates waiting
  on you as faces in its header (`WaitingFaces`), a peek (`MatePeek`) that answers, approves and
  stops, a menu on every Mate (`MateMenu`), rows that say more without a word (`MateRow`), a long
  menu kept scannable — quiet Mates fold, _Mine_ / _Everyone_, keys — and projects in the viewer's
  order. Nothing adds a status word or moves a row: the header's slot is reserved, the peek and the
  menu float, the clock, the ring and the pause take the time slot and the face that were there, and
  a draft only stands where the last words stood. One thing floats at a time: a Mate's menu opening
  puts its peek away, which stood in the same place and covered the menu's first items. The member
  list that names the owners is read again when a remount put its read away unanswered, so a face
  keeps its owner and _Mine_ keeps meaning mine. The owner's answers (2026-09-27): health on a
  production stop and mute on every device wait for now; nobody writes to a colleague's Mate (D6
  stands, and `@` leaves those Mates out); a Mate is quiet after a week, and _Mine_ keeps the Mates
  whose owner is unknown.
  - _Why:_ the owner took every item of the menu review but snooze and pin, and added projects
    ordered by name, by creation or by hand; built in the design harness, then read live signed in
    at 1786 and 390, light and dark
- **2026-09-27** — **A preview never quotes a credential** (`maskSecrets`, `messagePreview.ts`).
  What people paste into a conversation — a password, a token, an API key — showed in plain text
  wherever a conversation is quoted: a Mate's row and its peek, the conversation's header, the jump
  box and its search hits, a toast and a desktop notification. Each now masks what is a credential
  by its shape (a GitHub, GitLab, Slack, AWS, Stripe, OpenAI or Anthropic token, a Google key, a
  JSON web token, a private key, a bearer's token, a password in a URL) and every value that follows
  a credential's name — after `=` or `:`, after a name like `SHOP_API_PASSWORD` or `apiKey`, or in a
  sentence ("the password is …", "heslo je …") — as `••••••`, keeping the name. A server stores its
  previews masked and masks a search hit before cutting it, so no cut parts a credential from its
  name; the client masks what an older server stored. The conversation itself shows what was
  written.
  - _Why:_ the owner, on the finding that the menu showed a colleague's pasted admin password: "yes"
- **2026-09-27** — **Superseded 2026-10-02 in part: a project's change rows stand until HQ answers,
  not Gitea (`changesKnown`), and a stop's line reads its releases from HQ (T9b).**
  **A reload paints the left menu as it stood** (`menuMemory.ts`). Measured on a
  live account, a reload painted each Mate as its name alone and grew the rows to three lines as
  each socket connected — 74 moves in 9 seconds — change rows arrived with Gitea ten seconds in, a
  production was named twice (the platform's version, then its release), and _Mine_ painted every
  Mate before the members were read. The menu remembers what it drew, per account in this browser,
  and each piece stands until its own read replaces it: a Mate's row (what was asked, its last
  words, when, unread) at rest — no clock, ring or _Stop_ from memory, its face asleep until its
  socket opens; a project's change rows until Gitea answers (the flow's `changesKnown`), titles
  only; a stop's line until the platform and Gitea have both answered; the organization's members.
  It quotes conversations, masked, so it is forgotten when the account closes. The same reload moves
  no row, with _Everyone_ and with _Mine_.
  - _Why:_ the owner: "yes" to remembering each row's last task and last words on the device; layout
    shift is the cardinal sin
- **2026-09-27** — **A run reads as a chat, in its card** (`RunChat`; supersedes the record of lines
  and `RunDetail`). The card keeps its heading, its own scroll and the bars under it; inside the
  scroll, everything the Mate said and did is a bubble in the order it happened, its kind in its
  look — its words in its fill, its thinking in a hairline in italics, each call in one lighter fill
  with its code whole — the face beside the newest while it works. A bubble folds as the person's
  messages do, never while it is the newest and only once out of sight; every thought is a bubble,
  however short; nothing opens a dialog — what a bubble, a bar or a result pill holds opens in
  place, under it. A long run's chat opens at its newest 40 bubbles.
  - _Why:_ the owner, of the record: "what I wanted was to have the whole thing look like a chat,
    treat it like my messages, when it's too long do the 'show full message', it would just have
    different font style / bubble color / special components depending on what kind of call it is",
    "the current message being written should absolutely be visible in full before it moves up", "I
    still want it wrapped in the card, just within that card have the convo" and "the bottom part
    with live background and builds etc was so much better expandable inline"; measured on Nova,
    1,000+ samples through two live runs, no bubble moved in sight; a two-hour run drawn whole froze
    its conversation's opening for 0.7 s
- **2026-09-28** — **The run's chat is written in three hands, its status at its foot** (`RunChat`,
  `StatusLine`; supersedes the heading over the card in "A run of the Mate is one card" and the
  spine of bubbles in "A run reads as a chat, in its card"). What the Mate said is the one filled,
  round bubble; what it did an outlined box led by its kind's mark — a command its purpose over its
  code; what it thought small, faint italics on a hairline. A command shows four lines and "Show all
  N lines" from its first frame; a thought past eight lines scrolls inside itself while it is
  thought and folds to "Show more" at the same height once it ends. The Mate's face, what it is
  doing and its clock are the chat's last line — the "is typing" line of a chat — and the run ending
  changes only its words; the typing, writing and waiting bubbles are gone. A run with no chat keeps
  its line (`WorkLine`).
  - _Why:_ the owner: "command looks exactly like responses, thinking is hugely prominent which it
    should be suppressed", "I see 100s of LoC printed directly", "a clever placement of the Juno is
    working 9m, because it doesn't need to be at the top", "the long thinking blocks needs to start
    inner scrolling with fade at the same cutoff then sent version will break it into show more"
- **2026-09-28** — **A run is one card under what the person said into it** (supersedes "The card
  breaks where the person spoke into the run"). A message sent into a running turn, or an answer to
  the Mate's question, stands on the page above the run's card, in the order it was given, and the
  card stays whole under it as a typing indicator stays under the last message; the chat marks, in
  one line in the person's bubble on their side, where it reached the Mate.
  - _Why:_ the owner: "what we already had, which shown the user message in short inside the working
    group, printed it in the chat at the same time and moved the working group below was imo better
    … these split working groups have no chance to stay like this when the work is done"
- **2026-09-28** — **A project without production waits on nobody.** Production is not required: a
  project whose main has code and no production wears no dot in the left menu and no step in the
  projects page's strip; adding one stays its row's own offer on the projects page.
  - _Why:_ the owner, of "main has code, no production yet": "production not required, this
    shouldn't be there"
- **2026-09-28** — **The left menu breathes.** A Mate's row is 80 px — its words on taller lines
  with room between the name and the rest; a change, a stop and the quiet Mates' fold are 32 px
  rows; a project's heading is 36 px and stands off its first row; projects stand 24 px apart. The
  account menu is the approved prototype's: Show and Order as switches (the menu's own radio items
  on one track, the chosen one raised, the menu open while they change), the viewer's role under
  their name ("Owner of …"), and a check on the organization the list shows.
  - _Why:_ the owner: "the left menu needs to be more airy, more spaces, whitespaces, line-heights,
    it's extremely crammed together"; of the account menu: "much more shit … I asked you to improve
    upon the artifact"
- **2026-09-28** — **Calls are one card; the menu's headings stand on their rows** (`CallGroup`,
  `RailGap`; supersedes each call's own box in "The run's chat is written in three hands" and the
  row sizes and gaps in "The left menu breathes"). A run of calls, one after another, is one
  outlined card: each call a row, a hairline between them, its time and a chevron on the card's one
  right edge; a call opens as one thing, its whole code and what it printed in a well on the code's
  own edge; 16 px between the chat's lines. In the left menu a heading is 28 px and stands on its
  first row; each block of a project — a Mate with its changes, the quiet fold, the stops — stands 8
  px from the next with the spine carried through the gap; a Mate's row is 76 px; a full 36 px above
  a project, 4 px between collapsed ones, which close up into a list of their names.
  - _Why:_ the owner: "the gap between project name and under project is the same", "there is no
    spacing between items, no spacing between items in the chat itself", "the way result is shown
    with the expand / collapse suck as well"
- **2026-09-28** — **A browser check is its row of the chat, from its start** (supersedes the
  browser drawer under the run's chat). While a run is live, a check is "Checking /health" with a
  busy clock, the takes so far, and the page as the browser streams it in the frame its picture will
  stand in, so the row keeps its height when the picture comes; checks one after another share the
  row, on one clock from the first, a check after other work starts its own; the row opens the stage
  with every take. The live chat and the settled one draw the checks alike, where they happened.
  - _Why:_ measured on Nova: the drawer held a stale picture of a check under the chat for the
    minute and a half the Mate then deployed, the status line in the card's middle, and the check
    reached the chat only once the run was over
- **2026-09-28** — **The chat's hands keep their weights.** A command's code is how, under what it
  was for: the muted ink, failed too. Inside a thought, code and file names are mono in the
  thought's own faint ink, no chip; a file name still opens its file.
  - _Why:_ a command's code stood as dark as its headline; in the quietest hand, every code span and
    file name was a bordered or bold chip, the loudest thing in it
- **2026-09-28** — **A Mate's row holds its last line for words still to come.** From the message
  sent to the first words back — the second before the run starts included — the line under the task
  is three still dots, the messenger's "is typing" (`agentActivityAwaitsWords`), and the menu's
  memory keeps it, so a reload mid-run paints the row at its height.
  - _Why:_ measured on Nova: every message sent made the row lose that line and grow it back, 76 →
    58 → 76 px, moving every row under it twice
- **2026-09-28** — **A stop's globe stands on the menu's right edge; its route count is a soft
  chip.** The stop's menu slot comes first and the globe last, in the column every time, Merge and
  project dot end in; the menu still shows beside it on hover, in a kept slot. The count is a chip
  in the row's hover grey, not the menu's full ink.
  - _Why:_ the globes stood a slot, 20 px, short of that column; after, at 435 px, times, globes and
    Merge all end at 416 px; a black count read as unread notifications and outshouted the dots of
    what waits on the person
- **2026-09-28** — **An empty run card stands its face in its middle; a narrow card gives the face's
  column to the chat.** Before anything is in the chat, it keeps 12 px, so the face has 20 px above
  and 20 below. Under 28 rem (a phone) the chat's lines drop the face's column.
  - _Why:_ the empty list's room stood the face 31 px under the card's top and 22 px over its foot,
    the first thing seen after every message; at 390 px the column took 38 of the card's 318 px of
    text
- **2026-09-28** — **A run one of several helpers woke says which.** Helpers one launch started
  together share its row, which keeps one finish; the helpers panel's finishes (`helperFinishesOf`)
  are taken, in the order they finished, by the runs nothing else woke.
  - _Why:_ Nova's two helpers each woke a run, and both cards began with no word of why — the gap
    the woke line was made for on 2026-09-26
- **2026-09-28** — **Words say what things came to.** A pick the Mate marked "(Recommended)" is the
  person's words without the mark; a dev server's line says "Dev server running on appdev", as its
  pill does, never "Running appdev" under a finished bar.
  - _Why:_ the mark was the Mate's advice, standing in the person's bubble; "Running appdev" read as
    work still going on
- **2026-09-28** — **A task list the Mate wrote reads as steps, not a form.** In the Mate's
  markdown, a read-only step is a ring and a done one the to-do list's green dot; a list the person
  may tick keeps its checkboxes.
  - _Why:_ disabled checkboxes looked pressable and never were (Nova's plan of nine)
- **2026-09-28** — **A Mate stopped on an error is said as one, in the failure red.** Its face waits
  as a question's does, but the flow gives it its own step (`fix-mate`): "Wren stopped on an error",
  opening the Mate, after a Mate waiting on an answer and before a failed deploy; the heading's dot
  and the project page's list wear the failure red.
  - _Why:_ the approved menu draws a failed Mate's dot red; it was the attention amber, saying "is
    waiting on an answer" of a Mate that asks nothing
- **2026-09-28** — **An unsent draft takes the line kept for a Mate's words to come**, led by
  _Draft:_, as it takes the last words' line.
  - _Why:_ a draft written to a working Mate showed nowhere in the menu ("Draft shows only with last
    words")
- **2026-09-28** — **A row of checks names its two pages** ("Checked / and /health") when they are
  one host's; more than two, or pages of two hosts, keep their count.
  - _Why:_ "Checked 2 pages · 2 checks passed" said a count twice; a path names a page on one host
    only — "/" on another port is not the app's front page
- **2026-09-28** — **A call seen before its run was named belongs to that run.** A turnless entry
  takes the turn of its call's other report (`toolCallId`), so it is one step of that run, never
  background work of its own.
  - _Why:_ a command's start arrived before the session named its run and was drawn as "Command run
    finished · in the background" over the run it began
- **2026-09-28** — **A failed check keeps its frame among the takes.** A check that failed and took
  no picture stands in its row's takes outlined red, with an x and what went wrong; a phone's frame
  keeps the mark alone.
  - _Why:_ a row saying "1 check failed" showed only the picture of the page that passed
- **2026-09-28** — **A change's title starts on the menu's one text column.** Its cell — the spine,
  its branch and dot — is 28 px, so its gap is 6: every name, title and pill starts 34 px into its
  row.
  - _Why:_ a change's title stood 4 px right of the Mates' names and the stops' pills (57 against 53
    px)
- **2026-09-28** — **Work left running in the background counts up as a run does.** A Mate wearing
  the working face for a watch loop or a background task counts its time up in the busy blue, from
  the run that left it running.
  - _Why:_ its slot said a grey age beside a working face and a Stop; the approved menu counts every
    working face up
- **2026-09-28** — **Loading earlier turns keeps the row being read in place.** The first row of the
  conversation in sight, never a day's seam, is taken back to where it stood as the earlier turns
  are laid out above it, before each paint; a gesture hands the page back at once.
  - _Why:_ the list kept the day's seam in place, which moves to the top of what loads: the
    conversation under it was thrown 3,300 px down
- **2026-09-28** — **Every element of a run's chat is one bubble.** One shape (16 px round, 14 px
  in, 10 px down, as wide as the Mate's column); only the surface tells them apart: its words the
  fullest fill, a thought half of it in faint italics, what it did the card's white in a hairline, a
  failure the failed surface. Each wears its mark in the Mate's column beside it (a call's kind, a
  thought's brain, the face at the foot), so every bubble's words start on one edge; the column
  stays on a phone's card, 8 px off the bubbles.
  - _Why:_ the owner, of 0.11.58: "the alignment sucks … everything starts somewhere else … thinking
    doesn't look like a bubble … the design of every element has to be largely the same, differences
    subtle but obvious"; one card's words started at four x positions
- **2026-09-28** — **The chat has two sizes.** 14 px for everything said or done; 13 px for what is
  about it: a time, a caption, the way to more, and code in mono, as tall as the words at 14. One
  plain "Show more" in the quiet size, on the bubble's text edge, for a thought, a command and a
  message alike.
  - _Why:_ thoughts and code were 12 px, calls 13, the Mate's words 14; the toggles were kit buttons
    at three offsets
- **2026-09-28** — **A callout is the chat's bubble with its label run in.** A faint tint of its
  tone, 16 px round, its words 20 px in on the edge an answer's list items start on, the label its
  word alone in the tone's ink at the text's size; no edge bar, no glyph heading.
  - _Why:_ the owner: "it looks like some default card of some basic docs software"
- **2026-09-28** — **The page's lines start where an answer's list items do.** Events, a turn-ending
  error, the usage pause, background work and the older work rows keep a 20 px mark column and start
  their words 20 px past the prose edge; the person's bubble keeps the chat's 14 px padding.
  - _Why:_ their words started 22, 24 and 26 px in, a callout's 14
- **2026-09-29** — **The preview says once that sign-ins and carts need a new tab.** One muted line
  under the address, its cookie glyph in the globe's column so its words start where the address
  does, and one verb, _Got it_, that hides it for this browser (`useLocalStorage`,
  `mate:zerops:preview-cookie-note-read`). It names the header's _Open in new tab_ rather than
  repeating the control.
  - _Why:_ Unlike the removed "Page not showing?" footer, which was wrong almost every time it
    showed, this is true of every preview: a framed `*.zerops.app` page is cross-site wherever Mate
    runs, and browsers keep out the cookies it sets without `SameSite=None` (verified.md,
    2026-09-29)
- **2026-09-29** — **Each Mate wears its own shape as well as its colour.** Eight silhouettes
  (`MATE_SHAPES`: squircle, gem, hexagon, pentagon, clover, flower, seal, pick), each the same area
  of its box, each holding every eye pose and the mouth, one per tint (`MATE_SHAPE_OF_TINT`), so the
  account's first eight Mates, which never share a tint, never share a shape (past eight both
  repeat, as the palette does). Hues that sit close are apart in silhouette: the blues a pick, a
  squircle and a gem; the warm four a pentagon, a hexagon, a flower and a seal; the green the
  clover. No plain disc.
  - _Why:_ eight discs that differ only in hue read as copies at 28 px (sky beside slate, amber
    beside sand) and as one face to anybody who does not see the hue; a silhouette is read before
    either
- **2026-09-29** — **A Mate's face moves with its state.** Every pose is one drawing, so a change of
  state morphs (the eyes narrow into work, the o opens) rather than swapping pictures. At work the
  shape turns a notch at a time on a spring, by its own symmetry and about its own centre, and the
  eyes glance; as it starts to need you it hops three times, the first at once, then waits (a person
  can be away for hours); done after work or a question while you watch, it pops once
  (`mateFaceArrival`: never marking a Mate unread, never on a first paint or a remount, never from a
  pose that stood in until the Mate's state was read, `known`); idle and asleep it is still. Each
  Mate keeps its own beat, offset inside each loop's rest so work starts still; reduced motion
  leaves only the morph. A Mate's menu row turns its face's eyes up at the pointer, and its face
  gives under the press (92 %, back on a spring). Only the menu row and the run's status line greet
  (`greets`); a face reused across Mates or drawn asleep until its Mate connects does not. Its own
  motion is transform and opacity, the morph easing the eyes' and mouth's geometry; the turn and the
  glance are R6 exceptions.
  - _Why:_ the owner, 2026-09-29: "give each mate a different shape, more expressive current state";
    a still face said working and idle apart only by its eyelids
- **2026-09-29** — **The run's status line moves with what the Mate does.** Its face looks up and
  aside while the Mate thinks and down along its line while it writes (`gaze`); the line's words
  rise into place from just below, out of a 2 px blur, when they change (never on a first paint,
  `useChangedSinceShown`); the composing dots rise and brighten in a wave.
  - _Why:_ "is thinking" becoming "is working" cut in one frame, a flicker on the most watched line
    of a run; the stepped dots read as blinking
- **2026-09-29** — **Code in a sentence is marked, not caged.** Inline code is a 7 % tint of the ink
  behind it, 5 px round, no rule; paragraphs, list items and quotes wrap `pretty` once their words
  stop streaming.
  - _Why:_ with a border every token drew four lines, and a sentence naming five files read as a row
    of buttons
- **2026-09-29** — **Stop wears the run's ink.** The composer's Stop is the foreground's disc, not
  the alarm's red; it and send press in (`scale-95`).
  - _Why:_ red is what a failure wears, and it was the loudest thing on screen through every run
- **2026-09-29** — **A run's card has no seam where its slices meet.** A slice with another under it
  keeps layout and style containment, not paint, and lays a 3 px strip of its ground and its sides
  across the joint.
  - _Why:_ the list clips each row to its box on eighth-of-a-pixel positions; each clip snapped away
    from the joint and the page showed through as a hairline under every settled run's status line
- **2026-09-29** — **The page scrolls on past a run's chat.** The chat and an opened output no
  longer contain their overscroll; a gesture begun inside stays inside. The chat's top and foot
  fades ease in and out.
  - _Why:_ a wheel over a long run stopped dead at the chat's top and the page stood still under the
    pointer until it left the card
- **2026-09-29** — **The way back to the end is a round button.** 32 px, an arrow on the popover's
  ground with a soft shadow, always drawn and eased in from 6 px below; hidden, it is inert.
  - _Why:_ a faint glass pill that popped in and out between the chat and the banners
- **2026-09-29** — **A run's chat opens on the Mate's work.** A person mark before anything the Mate
  did is dropped; one after its first call still says where the words came.
  - _Why:_ an answer to the Mate's question stood on the page and again as the card's first bubble,
    70 px lower
- **2026-09-29** — **What a call returned eases down out of its header.** An opened output, check,
  helper's words, task or error comes in over 220 ms, opacity and 4 px only; its room opens at once,
  so the chat still brings its end into sight.
  - _Why:_ the detail appeared in one frame
- **2026-09-29** — **A Mate's newest words rise into its menu row.** The snippet and the subject
  rise into place when they change, as the status line's do; never on a first paint, never as
  remembered words give way to read ones, and never a draft, which changes with every key (the words
  keep their node under it).
  - _Why:_ a reply landing swapped the row's last line in one frame
- **2026-09-29** — **The Mate's question stands clear of the person's words.** A question's row
  after the person's own message takes a change of speaker's room (`block`, 19 px of air).
  - _Why:_ it took the 4 px meant for two messages of the person's and hung under their bubble as if
    they had asked it
- **2026-09-29** — **Superseded the same day by the one-line conversation top below.** **The header
  reads as the Mate, then what it is on.** Under a Mate the task follows its name in the muted voice
  at the body's weight, and comes up under the pointer.
  - _Why:_ a long prompt as the person typed it read as a second heading as loud as the Mate's name
- **2026-09-29** — **An answer's pictures hold their room before they load.** A workspace picture's
  first sight holds 16:9 across the text, its opener as wide as that room (a width in percent inside
  a button that shrinks to its content is none); once seen, a picture's shape is remembered by where
  it came from (256 kept) and it takes the width it will stand at, `min(its width, 30rem, 30rem ×
its ratio)`, its size attributes giving its height before a byte has come; a picture from an
  address of its own, as often a badge, holds no 16:9 place; only a first sight fades in.
  - _Why:_ a picture took no room until its bytes came: opening a conversation, pictures grew one by
    one and everything in sight jumped
- **2026-09-29** — **A conversation fades in once the list has put it in place.** The timeline
  list's reveal (`timeline-legend-list`; no picker list) eases in over 140 ms; hiding stays instant.
  - _Why:_ every switch between Mates was a cut from nothing to the whole conversation
- **2026-09-29** — **A conversation slow to come shows its Mate at work meanwhile.** Its face works
  in the middle of the pane, shown only once the wait passes 400 ms (opacity alone, so the hold
  stands under reduced motion too); never in a new draft's pane.
  - _Why:_ opening a Mate for the first time the pane stood blank for a second
- **2026-09-29** — **A light sweeps across the words of the call a Mate runs now.** A band of full
  opacity crosses its words left to right over resting 70 % until it returns: a mask, not a colour,
  so the verb stays muted and the file name full; as a rule one call, and a command still running
  beside it sweeps too; an R6 exception.
  - _Why:_ a running call was drawn as it would be once done, its time counting in blue the only
    sign of it
- **2026-09-29** — **The run's clock ends on the calls' time column.** The status line's clock keeps
  the bubble's 14 px and the chevron's 20 px slot, so every time in the card ends on one edge.
  - _Why:_ it stood under the calls' chevrons, 34 px right of the times it sums
- **2026-09-29** — **A table's copy stands on its corner.** Over the end of its header, shown while
  the table is under the pointer or holds the focus, while its menu is open, and always on a touch
  screen; the last column's cells keep 36 px at their end, clear of it.
  - _Why:_ every table ended in a row of its own holding one copy icon
- **2026-09-29** — **A message that arrives while the person watches rises into place.** Once: the
  person's words from their side (`bubble-in`), the Mate's up from just below (`rise-in`, 300 ms, 8
  px). The baseline is the newest message's time once the conversation is read, on the server's
  clock (`arrivedAfter`, following the newest message while `syncing`), so a cached copy painting
  first and history landing after it never rise in; a message risen once stays put when the list
  redraws its row.
  - _Why:_ the person's message on send and the answer at a run's end cut in whole in one frame
- **2026-09-29** — **One type scale: 16, 14, 13 and 12 px** (pass 16, S1). 16/600 a project's
  heading; 14/500 names and titles; 14/400 everything anyone wrote; 13/400 secondary lines, times
  and code; 12/500 small labels — counts, keys, the production chip. 11, 10, 9 and 7 px leave the
  menu, the run's card, the composer and the review, and every time and count is tabular; weight and
  colour carry rank, and size changes only between kinds. A mark is no text: the owner's 9 px
  initial inside its 16 px disc stays. `composerTypeScale.test.ts` keeps nine composer files off the
  sizes that went.
  - _Why:_ the menu used eight sizes in a 435 px column (16, 14, 13, 12, 11, 10, 9 and 7 px), which
    read as noise rather than rank
- **2026-09-29** — **Two text edges per surface, and one right edge** (S2). In the menu every mark —
  a face, a glyph — stands at 16 px and every word at 56; in the run's card the marks keep a 28 px
  column, the words start one column in, and times, chevrons and actions end on one right edge.
  - _Why:_ one settled card had five text edges (384, 395, 398, 422 and 436 px); where a line starts
    should say what kind of thing it is
- **2026-09-29** — **One meaning per colour** (S3). A Mate's tint says who; blue says something to
  click, and unread; amber says it needs you or did not go through; red says it is broken; green
  says healthy or passed. Everything else is neutral: the person's bubble, a running clock, the
  composer's top. **Supersedes:** the busy-blue count of the 2026-09-28 _work left running in the
  background_ row: a running clock counts in ink. A live dot and a running segment of a status bar
  keep the busy tone.
  - _Why:_ blue meant the person, links, buttons, running clocks and the waiting strip at once,
    while the menu said the same wait in amber
- **2026-09-29** — **Corners run parallel** (S4). A container's radius is its child's plus the room
  between them: the run's card is 30 px round with 12 px of room around its 18 px bubbles.
  - _Why:_ 22 px around 18 px bubbles at 16 px of padding bulged at every inner corner
- **2026-09-29** — **Brightness follows importance; the composer is the one white surface** (S5).
  The canvas is the ground; the person's words one step darker; the run's card one small step
  lighter with a hairline edge; the composer, where the person acts, white — opaque, no blur, a 12 %
  ink ring and its own shadow — its question and approval drawers on the same ground. Floating
  banners keep their raised glass.
  - _Why:_ the run's card, the machinery, was the brightest thing on screen, pure white on the grey
    canvas
- **2026-09-29** — **Every problem offers its fix** (S6). Wherever something shows broken —
  production down, a release that failed, a service a run left that stopped since, a change that
  cannot merge — "Ask Nova to fix it" opens the Mate's conversation with the problem written into
  its composer, not sent: what failed, when, the error, the log's last lines where the client has
  them (30 at most), and the ask. Only the person's own Mates, and only ones the app is connected to
  — one whose owner nobody can name counts as theirs, as _Mine_ keeps it — the one used last in that
  project first, a chevron for another; none of theirs, no action (`fixRequest.ts`, `fixMates.ts`).
  - _Why:_ a failure the person could see but not act on sent them to find the Mate, the log and the
    words themselves; nobody writes to a colleague's Mate
- **2026-09-29** — **Production is one chip on its project's heading** (the owner's D1). It says
  that a production exists, which release it serves, whether it is healthy and what waits to go out;
  it stays on the heading while the project is folded; it changes itself when production is in
  trouble; a press opens its menu, the fix in it while production is in trouble. Production's and
  the stages' rows leave the list, and with them `stopDistance`. **Supersedes:** the stops of the
  2026-09-17 _left menu draws each project as a timeline_ row, the 2026-09-25 _every stop is one
  row_ and _one text column_ rows, and the 2026-09-28 _stop's globe_ row.
  - _Why:_ a production row spoke another language than the Mates around it (a badge, a 10 px
    uppercase tag at 45 %, a version, a globe with a 9 px count), read as one of the Mates, and
    vanished with a folded project
- **2026-09-29** — **Whose Mate it is stands before its name** (the owner's D2): the owner's
  picture, 16 px round, left of the name on every row, off the face; their initial on a hue of their
  own where there is no picture — the hue read off their name, the same on every row and every
  reload, since an owner carries no id — and a plain disc where nobody can name them, so every name
  starts on one edge and nothing moves when the owner is read. **Supersedes:** the owner on the
  face's corner of the 2026-09-24 _Mate wears the card's face_ row.
  - _Why:_ the owner's photo covered a quarter of every face with 7 px initials, hiding the shapes
    the faces had just been given; a face recognised before a name answers "whose" fastest
- **2026-09-29** — **A run the person comes back to opens folded, keeping what it said** (the
  owner's D3). Its worked line on top; then everything it said to them, its questions and their
  answers, what they said into the run, anything it could not do, a change that landed; only its
  thoughts and calls fold, behind "Show work". A run the person watched stays open until they leave
  the conversation.
  - _Why:_ coming back meant scrolling past every command of every run to find what each run said
- **2026-09-29** — **Superseded 2026-10-02 in part: past 2,000 lines a diff says how many lines it
  leaves out, and links to no Gitea (`ZeropsReview.logic.ts`).**
  **No scroll inside the run's card, and nothing out of reach** (the owner's D4:
  "everything to always be available one way or other"). The conversation is the one scroll, and
  every fold opens: a long run's earlier lines behind "Show N earlier", a command past four lines
  and an output past twelve behind "Show all N lines", a clamped thought on a click, a folded run
  behind "Show work", a long diff behind "Show all N lines" and then Gitea. Nothing is cut without a
  control to see the rest. **Supersedes:** the chat's own scroll of the 2026-09-27 _run reads as a
  chat_ row and the 2026-09-29 _page scrolls on past a run's chat_ row.
  - _Why:_ two scrollbars in one view is where most of the earlier passes' scroll bugs lived
- **2026-09-29** — **A working Mate's row says the step it is on** (the owner's D5). The Mate server
  relays each running thread's current step on its shell, and the row's third line reads what the
  card's now line reads — "Build the app", "Reading `index.ts`", "Checking /status in the browser",
  "Running 2 commands", "Thinking" — under a sweep of light, changing at most twice a second; until a
  Mate's server carries it, the dots. A command reads as its words, never with its code after them
  (the owner, 2026-10-05, of "Download every product page · mkdir -p prod && pytho…"); one that says
  nothing of itself — every command of an agent that writes no descriptions — reads as its code.
  - _Why:_ "is working" said nothing the turning face did not; the step is what a glance at the menu
    wants
- **2026-09-29** — **A row that needs you shows the question itself** (the owner's D6), in ink on
  its third line — the oldest open question's first words, one line, credentials masked, as the
  thread's shell carries them. An approval waiting keeps the row's last words.
  - _Why:_ a question is content, not a status word, and all the person needs to decide whether to
    answer now
- **2026-09-29** — **The menu opens 304 px wide** (the owner's D7); a width the person set stays
  theirs.
  - _Why:_ at 256 px both lines of a row cut at about 25 characters
- **2026-09-29** — **_Review_ on every change row, as a blue word** (the owner's D8): shown whether
  the pointer is on the row or not, on every open change, a change drawn from memory included.
  - _Why:_ the outlined pill repeated on every change as the menu's only outlined control; a verb
    shown only on hover is found by accident
- **2026-09-29** — **Composer pictures in this pass** (the owner's D9), after the composer's top and
  its one control: a picture sits in the text where it is pasted, takes notes and a crop, goes
  fitted, and is sent as placed (P1–P5).
  - _Why:_ the approved prototype had waited for a yes that was never asked for again, and a 5.46 MB
    paste had just failed a Mate's turn
- **2026-09-29** — **The person's bubble is neutral grey** (the owner's D10): one step darker than
  the canvas in light (`oklch(0.918 0.006 255.5)`), one step lighter in dark (`oklch(0.26 0.009
178)`), the same shape and size; the phone's bubble follows the generated tokens.
  - _Why:_ in AI chat the person's bubble is a neutral grey and the assistant has none; blue for
    "me" is a messenger's, set against a grey "them" — here the Mate's words have no bubble, so blue
    contrasted with nothing and borrowed the colour that means "click me"
- **2026-09-29** — **_New project_ is the list's last row, and one of ⌘K's finds** (the owner's
  D11): a row like the others, a + in the faces' column and the words at 56, and the last item of
  the palette's projects.
  - _Why:_ beside the jump row, ⌘K read as the new-project button's shortcut; a + in the logo row
    would bring that back
- **2026-09-29** — **_Review_ opens as a dialog over the conversation** (the owner's D12), grown
  from what was pressed; the right panel stays the app's preview and its diff.
  - _Why:_ a decision deserves focus; the panel is better for long diffs and weaker as a moment of
    decision
- **2026-09-29** — **The menu has no spine** (M1). No line joins a project's Mates, its changes and
  its production; a project is grouped by its heading and the air around it. `RailCell`, `RailFork`,
  `RailGap` and `RailCap` go; the history views keep their own timelines (`rail.ts`).
  **Supersedes:** the rail of the 2026-09-17 _timeline_, the 2026-09-25 _one text column_ and the
  2026-09-28 _calls are one card; the menu's headings stand on their rows_ and _change's title
  starts on the menu's one text column_ rows.
  - _Why:_ a line from face to face says "this leads to that"; Mates work side by side, and neither
    leads to production
- **2026-09-29** — **A Mate's row is a messenger's row with one even leading** (M4–M6, M16). The
  face stands on the name's line in every row, 28 px at 16 px from the menu's edge, every word at
  56; the name 14/20, the ask 13/18 in the second ink, the answer 13/18 muted, no gaps; a row is as
  tall as what it says — 76 px with three lines, 58 with an ask and no answer, 48 never asked — and
  while words are coming the dots keep the third line. 30 px from one Mate's words to the next's, 58
  from a project's last row to the next heading. **Supersedes:** the 80 px row, the 36 px heading
  and the 24 px between projects of the 2026-09-28 _left menu breathes_ row.
  - _Why:_ the face sat beside the question in a three-line row, beside the name in a one-line row
    and between them in a two-line one, and the name floated on a 22 px line over a paragraph on 18
- **2026-09-29** — **A row's state lives in its right slot and its third line, never in a word**
  (M7). Idle: its age, its last words muted. Working: the run's clock in ink, the step. Needs you:
  an amber dot, the question in ink. Finished unseen: a blue dot, the name at 600, its words in the
  second ink (the approved mock's, where the plan's table said ink). Stopped on an error: a red dot
  and the error's first line in red, the face still. Paused at a usage limit: the pause and when it
  picks up, the face asleep — a limit's failed turn never reads as an error. The dot is 8 px and no
  `StatusDot`: the row's own words say the state; it scales in only when it arrives while the person
  watches (T6). The second line is always the person's last ask, never the plan's step.
  - _Why:_ the face, a dot and the content already say the state; the question, the error and the
    step are what the person acts on
- **2026-09-29** — **A working Mate's face wears no ring.** The plan drawn as a ring of segments
  round the face goes, with the activity's `progress`, its only reader; the third line's step says
  where the Mate is. One commit, `cf210626b`, brings it back.
  - _Why:_ its busy blue broke S3, the approved mock draws none, the room above it was the spine's,
    and the live step says the same thing in words
- **2026-09-29** — **Superseded 2026-10-02 in part: a change has no checks, so its mark is muted or
  amber, and one drawn from memory stays untinted until HQ answers (`changeMarkTone`).**
  **A change row says _Review_ and merges nothing** (M8). Under its Mate, 28 px:
  the pull-request mark in the faces' column — muted, red where its checks fail, amber where it fell
  behind `main` — `#N title` at 56, the way to its page, and _Review_ in blue on the right edge. No
  _Merge_, no _Ask_, no check dot: the verdict is the review's. A change drawn from memory stays
  untinted until Gitea says it again, and keeps its _Review_, so nothing appears when Gitea answers.
  - _Why:_ merging happens in the review, where the change can be read first (R1); a dot on the row
    said the verdict without its reason
- **2026-09-29** — **A heading never moves when it is pressed** (M9, T3). The room between projects
  belongs to the end of an open project — 44 px, 16 at the list's end, none while folded — so a
  project's rows and their room unfold below its heading over 220 ms as they fade in, and fold into
  it in 160 ms, turning round from wherever they stand when pressed again; a paint nobody asked for
  never animates, and reduced motion fades in and folds at once. Folding the list's last project
  keeps its room until the person scrolls, so the heading stays under the pointer. Measured every
  frame for 400 ms on five projects: 0 px.
  - _Why:_ the room above a heading depended on its own project's state (4 px folded, 36 open), so
    opening one dropped its heading 32 px under the pointer (166 → 198)
- **2026-09-29** — **A project's heading is its name, one chevron and two verbs.** 32 px, the name
  at 16/600 on the marks' edge with −0.2 px tracking, the whole heading its toggle; one chevron
  after the name that turns a quarter (220 ms) and shows on hover, on focus and always while
  folded; + and ⋯ as 28 px buttons in a slot that is always there, muted until pointed at. Under a
  300 px heading the + gives its room to the name, and _Add a Mate_ is in ⋯ too.
  - _Why:_ a verb that appears must not move the name, and a narrow menu should keep "Imperial
    Titan" whole before it keeps a +
- **2026-09-29** — **The peek is gone** (M10). `SidebarMatePeek`, its live part and `sidebarPeek.ts`
  are deleted. A reveal — the waiting faces, the jump box — focuses its row and flashes it once, and
  a change's reveal lands on its _Review_; a finger held on a row opens the Mate's menu, which a
  phone reached only through the peek; the Mate's menu loses _Peek_, and Space presses the row.
  **Supersedes:** the peek of the 2026-09-27 _left menu is where a Mate is acted on_ row.
  - _Why:_ it repeated the row and the conversation and covered what the person was reading;
    answering and merging are on the row and in the conversation
- **2026-09-29** — **One selected band slides to the Mate opened** (M11, T2). A single surface in
  the list, the row's inset and 12 px corners, placed by transform and height after every draw;
  opening another Mate slides it there on a spring over 300 ms, a reflow it follows at once, and
  rows paint no fill of their own for being open. Measured: 0 px off its row on every frame through
  an 86 px reflow.
  - _Why:_ one row going dark and another lighting up loses the eye; a band that travels says where
    it went
- **2026-09-29** — **Search is one ⌕ ⌘K control in the logo row, and the jump row goes** (M12). 28
  px, the key inside the control, at the row's end after the waiting faces — which give way first
  where the row is narrow (a 304 px menu keeps three faces and a count, a 256 px one a single face)
  so the lockup and the search stay whole. The list starts 6 px under the row.
  - _Why:_ _Jump to_ and ⌘K beside the new-project button read as that button's shortcut, and the
    row of height belongs to the list
- **2026-09-29** — **A crew is one line under its Mate** (M14). The crew's mark in the faces'
  column, every crewmate's face whole at 20 px — the lead first, each opening its chat and wearing
  its state — then one fact, who needs you before how many tasks wait for _Land_, and _Review_ in
  blue while a task waits. A crewmate needs you when its face says so or the crew's _Waiting on you_
  names it for anything but a task ready to land. In a narrow menu the faces keep their place and
  the fact gives way to its tooltip and _Review_'s name.
  - _Why:_ a crew hung outside its row as overlapping slivers of faces with a "+1", narrowing both
    of the row's lines to about 30 characters
- **2026-09-29** — **A folded project shows who is busy in it; the heading's dot goes** (M15). After
  the folded name, up to three of its Mates that need you, stopped on an error, finished unseen or
  work — most urgent first — each its row's face and pose at 18 px with a 7 px dot for what is not
  work. **Supersedes:** the heading's dot of the 2026-09-23 _flow_ row and of the 2026-09-28 _Mate
  stopped on an error_ row.
  - _Why:_ a lone amber dot said "something here needs you" without saying what, and beside a globe
    it read as production in trouble
- **2026-09-29** — **A reload paints the rows, crews and chips it will keep.** The menu's memory
  keeps a row's third line whatever held it — an error's line, a question, a step, the dots — a
  crew's faces, drawn at rest until the crew's feed answers, and each project's production chip in
  place of the stops it kept (an older memory reads as nothing, once). Neither the live step nor the
  question is remembered: both are only true now.
  - _Why:_ a row stopped before any words, and a crew line, grew on every reload as their reads
    answered
- **2026-09-29** — **Superseded the same day by the two chips below.** **The production chip reads
  worst first, and each colour says one thing.** Setting up, a spinner; down, red "prod down", and
  stopped, a hollow dot "prod stopped" — from the platform alone and at once, a release on its way
  or changes waiting beside them, since those are true too; a release on its way, a spinner stepping
  eight times a second and `v1.2.0 → v1.2.1`; a release that failed, amber "· release failed", the
  old one still serving; not released yet; changes waiting, green with "· 1 waiting", since nothing
  is wrong; healthy, a green dot and the version. Stage is the chip only where there is no
  production, its branch where the version stands; otherwise the stages live in the chip's menu,
  since the Mates' runs report the stage themselves.
  - _Why:_ trouble lives where the release is, loudest when production is down; amber for "waiting"
    beside amber for "failed" would say two things
- **2026-09-29** — **Production is down or stopped by what serves its routes.** Down: a runtime
  behind its public routes (every runtime where none is public) whose platform status carries FAIL;
  stopped: the project stopped, or every serving runtime stopped. A database whose upgrade failed,
  or a worker no route reaches, takes no page down. The chip's note says only what the client knows
  ("Down: app failed on the platform. v2.3.0 was the last release."): no container health, no time
  it went down and no production runtime log are read.
  - _Why:_ the plan's note ("down since 09:12, both containers stopped, exit 137") needs reads the
    client does not make
- **2026-09-29** — **Superseded 2026-10-02 in part by the HQ row below: releases are Core's (T9a),
  and the chip reads them from HQ (T9b); it waits while HQ's releases are coming, never on Gitea.
  Superseded 2026-10-05 in part: with HQ mandatory, `releasesComing` and the chip settling on the
  platform's facts alone are gone — until HQ's releases are read the chip is only partial
  (`asReleasesStand`, `SidebarProductionChip.logic.ts`).**
  **A chip is drawn only once what decides it is read.** Until then the menu draws
  the chip it remembers, else — while only Gitea's answer is missing — what the platform alone says,
  never remembered, else nothing; down and stopped settle at once, and without a Gitea session the
  chip settles on the platform's facts. Its menu dates the stages as of the moment it opens.
  - _Why:_ a reload paints nothing it takes back
- **2026-09-29** — **Superseded the same day by the two chips below.** **The chip's words drop
  before the project's name does.** Under a 340 px heading the chip keeps its dot, `prod` and the
  version; under 260 only the dot and `prod`, or "prod down".
  - _Why:_ at 256 px a long project name beside the whole chip cut to four letters
- **2026-09-29** — **Superseded 2026-10-02 in part by the HQ row below: releases are Core's (T9a),
  and a failed release is HQ's record, said in HQ's words (T9b).**
  **What the stops' rows held lives in the chip's menu.** Production's row, which
  opens the environment's page; a note of what went wrong; "Ask Nova to fix it" while in trouble,
  whose first press shows what will be written and whose second opens the conversation; the public
  links; the stages and how long ago each was deployed; "N changes wait for production" with
  _Review_; _Open in Zerops_, now the project's own page there. A release promotes the stage's
  artifact and the menu reads no production process, so production's fix request carries what
  failed, when, the broker's words and the ask, but no build log. The jump box lists a stop only
  where its chip is drawn, and a stop it finds opens that chip's menu, leaving the project folded.
  - _Why:_ the stop rows left the list with the chip; nothing they offered may leave with them
- **2026-09-29** — **The run's card is a quiet tray** (K11, K2). One small step above the canvas
  (`--run-tray`), a 1 px edge of 7 % ink, 30 px corners with 12 px of room around 18 px bubbles;
  calls are outlined at 9 % ink, never filled white. A run's line with nothing under it keeps the
  tray's geometry in a frame nobody sees, so the tray drawn around it later never moves its words.
  - _Why:_ the machinery was the brightest surface on screen (S5), and its corners bulged (S4)
- **2026-09-29** — **One grid for everything in the card** (K1). A 28 px column of marks, the words
  8 px after it, and one right edge 26 px in for times, chevrons, the clock and the result's
  actions; a call row pads 12 px on the left and 14 on the right so its chevron stands on that edge,
  and a call that opens nothing wears no chevron.
  - _Why:_ calls, thoughts, words, bars and pills each had their own edges
- **2026-09-29** — **Five weights in the card, strongest first** (K14, K13). The now line (500, the
  face, the clock); the Mate's words and the person's, 14 px bubbles at full ink — the Mate's in its
  tint at 17 % with its face as their mark, a crewmate's in its own; calls as compact 13 px rows,
  file names in mono at full ink with no chip; thoughts the quietest, 13 px faint italics on a 3 %
  fill, two lines that open on a click. A question and its answer stand 6 px apart; everything
  else 12.
  - _Why:_ with the person's bubble neutral, the Mate's words must differ from theirs at a glance,
    and its tint already means who; the machinery must not outweigh the words
- **2026-09-29** — **The card's foot says what is happening, with one clock** (K10, K3). The now
  line carries the step itself while it runs (its own time after 30 s dropped 2026-09-30: the run's is the one clock), several at once
  counted by kind with a line each; a step that ends lands in the chat above (a 320 ms rise) and the
  line's words change in place (260 ms). Each running thing ticks in one place — the run on the now
  line, m:ss in ink, a deploy in its bar — and a call still running says "Running" where its time
  will stand. An approval waiting reads "Waiting for your approval" with the waiting face, as a
  question reads "Waiting for your answer", the clock still for both. The line opens to the whole of
  what runs without moving its face, first words or clock, and a screen reader hears its words
  through one status span. **Supersedes:** the status line of the 2026-09-28 _three hands_ row and
  the 2026-09-29 _run's clock ends on the calls' time column_ row.
  - _Why:_ "Nova is working" said nothing the moving face did not, while the step sat higher up with
    its own blue clock: two clocks ticked, three on a busy run
- **2026-09-29** — **A command's title says what it runs** (K4). With no description (Codex never
  writes one) the command itself is the title, in mono, out of its shell wrapper — unwrapped only
  where the quoted command is the whole call — and `cd … &&` dropped; the full string opens under
  it. A Codex command is the Mate's step from its start, not only once it returns, and a code search
  in a folder reads as a search, never an edit.
  - _Why:_ "Ran a command" titled every Codex command, each over its `zsh -lc "…"` wrapper
- **2026-09-29** — **A fold the person opens keeps what they pressed still.** A long run opens at
  its newest 40 lines; "Show N earlier" draws 200 more at a time above itself and stays where it was
  until all are drawn; "Show less" closes back under the pressed button, the focus going to what
  stands; any opening stops the conversation following its end.
  - _Why:_ every line must be reachable (D4), and reaching it must not move what the person is
    reading
- **2026-09-29** — **"Show work" opens a folded run under its line, and nothing above it moves**
  (K7, K12). On a run the person comes back to, its worked line stands on top with "Show work" and
  "Hide work" on its right edge, and the work eases open or shut under it over 220 ms — measured,
  the line moved 0 px while the work grew 154 → 509 px. A run the person watched keeps its worked
  line at its foot with no "Hide work" — folding the work above a line at the foot would move it —
  and folds as its conversation leaves the page, after the switch has taken its picture, so it is
  folded from the first frame of the return.
  - _Why:_ a fold the person asks for animates and keeps their line still; one they did not ask for
    never happens under their eyes
- **2026-09-29** — **A failure is a red mark while it is still broken** (K9). A failed call wears a
  red triangle and "Failed" by its time; once a later step undid it — the same command or the same
  words passing, a deploy of the same service going through — it turns quiet. No pink row anywhere;
  what stopped the Mate keeps its colour in its mark. **Supersedes:** the failed surface of the
  2026-09-28 _every element of a run's chat is one bubble_ row.
  - _Why:_ an expected failure flooded its row pink, and a fixed failure is no result: red always
    means still broken
- **2026-09-29** — **The Mate's question and the person's answer stand in its card.** The question
  in its tint beside its face, the answer whole in the person's neutral bubble 6 px under it; the
  answer stands nowhere else, and the timeline's `answer` row is gone. A message sent into a running
  run stands on the page above the card and in the card as one line where it reached the Mate.
  **Supersedes:** the answer on the page of the 2026-09-28 _run is one card under what the person
  said into it_ row, and the question in prose of the 2026-09-27 _on the page the Mate speaks in
  prose_ row.
  - _Why:_ a question and its answer are one exchange of the run; split between the card and the
    page they read as two
- **2026-09-29** — **A check in the browser is the now line's while it runs.** "Checking /status in
  the browser" on the now line; the take lands in the chat as its row when it is taken — "Checked
  /status in the browser", no "passed" on a lone pass — joining the row before it where nothing came
  between. **Supersedes:** the live frame of the 2026-09-28 _browser check is its row of the chat_
  row.
  - _Why:_ the present stands in one place: the now line
- **2026-09-29** — **A run's result is live rows, not pills** (K5). Under its worked line, in the
  card's grid, most important first: anything still broken, then what waits for the person, then
  what runs because of the run with its checks attached. Each row follows the real thing — a change
  merged leaves, and the worked line says "merged as #2"; a service a later run deployed, started,
  stopped or removed, a pull request it pushed to again, a page it checked again is that run's; a
  service the platform says stopped or failed since turns red with its fix. A failure recovered
  from, a retry and the counts are the work's; the run's change is the pull request its last git
  push names. **Supersedes:** the pills of the 2026-09-26 _its report is the same parts settled_ and
  the 2026-09-27 _result counts what the calls came to_ rows.
  - _Why:_ a 1 h 31 m run's result was nine identical pills with its change fourth, and a failure
    the Mate came back from read as a result
- **2026-09-29** — **The effort is one quiet line after the worked words** (K6). "Nova worked 1m 20s
  · 2 commands · 1 file read": commands, files read, searches, the workflow checked, helpers; edits
  count only where the run left no change, and "merged as #54" leads once its change merged.
  - _Why:_ edits and checks are rows already; counted again they were said twice
- **2026-09-29** — **A result row offers the one act the person can take there.** A broken row is a
  red ▲ and its fix, never a link to what is down, and no _Start_ on a stopped service; unpushed
  edits are counted, not a row; a change's line is "3 files · +45 −3" and _Review_ says the rest;
  "Since 23:10" is the service's last update, since a process's exit code is not the client's to
  read; a dev server the run stopped on purpose leaves no row. A run's own failure stands over what
  the platform says since: the platform's word applies only to a service the run left running.
  - _Why:_ the plan's _Start_ and exit code need reads and rights the client does not have; a first
    deploy that failed read as "nothing deployed" and lost its three type errors
- **2026-09-29** — **A result rises in once** (T5). When a watched run finishes, its rows rise 6 px
  over 320 ms, 40 ms apart; a row that turns up or moves later — a service stopping tonight — never
  rises or replays, and a reload draws the rows in place. Only the person's own words answer what a
  run left waiting: a later turn they opened takes a "not done" off the result, a slash command or a
  usage limit's resume does not.
  - _Why:_ the result arriving is the moment worth seeing; a replay is noise, and a resume nobody
    typed answers nothing
- **2026-09-29** — **A turn is one group: 24 px inside, 64 between** (C1). Ink to ink, the person's
  words, the card and the answer stand 24 px apart, and turns 64 px apart; the answer's room is the
  same whatever the card ends on, so it stands still as the card settles; a run of the person's
  messages stays close; only a background line that woke a run opens one, and a loose one hugs the
  turn it came from. Measured live: 24.0, 24.0 and about 65 px.
  - _Why:_ turns barely separated: 12 px from the message to the card, 19 to the answer, 24 to the
    next message
- **2026-09-29** — **A time line only where an hour passed** (C2). The conversation is dated at its
  top; after that a line stands only after an hour's quiet — the day line where a new day began,
  else the time — and midnight between two messages minutes apart draws nothing. **Supersedes:** the
  30-minute gap line of the _Seams_ vocabulary row.
  - _Why:_ a line between two messages three minutes apart split one conversation into pieces
- **2026-09-29** — **One button style in the header; starting over lives in its menu** (C5).
  Borderless 28 px buttons with the row's hover, 4 px apart; the pencil goes, and its act is spelled
  "Archive and start fresh" at the end of the ⋯ menu, with the undo toast as before; the slash
  between the Mate's name and its task goes, weight and ink separating them. _Open in Zerops_ keeps
  the kit's 9 px padding where the mock drew 6.
  - _Why:_ three button styles, and an unlabelled pencil that archived the whole conversation beside
    the + that starts a chat
- **2026-09-29** — **The page's small parts** (C6–C8). The conversation fades out fully before the
  header — transparent for the band's first 30 %, opaque at its end; inline code hugs its
  punctuation, 2 px by 3 of padding, no margin, 4 px round; an empty conversation shows its Mate's
  own face in the brand mark's 64 px box (72 on wider screens), so the question under it never moves
  as the Mate becomes known. **Supersedes:** the 5 px padding and corners of the 2026-09-29 _code in
  a sentence is marked_ row.
  - _Why:_ text scrolled half visible under the header; commas stood apart from the code before
    them; the brand mark said nothing of who lives there
- **2026-09-29** — **Superseded 2026-10-02 in part: HQ, not Gitea, says whether the change merges,
  and the strip waits on HQ's answer (`changesKnown`).**
  **The Mate's own change waits at the composer's top, as _Review_** (C3, R1). The
  strip is the composer's first section, on its edges and corners: the Mate's face asking, "Nova is
  waiting for your review of #2", the change's title, and _Review_, its one blue button, which opens
  the review — nothing merges from here. It keeps the old rule (this Mate's own code change that
  Gitea says merges; one that conflicts or is still checked waits on the Mate or on Gitea and gets
  none), steps aside while a question or an approval waits, and has no entrance of its own.
  **Supersedes:** the merge of the 2026-09-26 _Mate's conversation offers only its own merge_ row.
  - _Why:_ a blue banner, inset 22 px from the composer, merged on one click and said in blue what
    the menu said in amber
- **2026-09-29** — **Superseded 2026-10-02 in part: HQ's answer, not Gitea's, confirms the
  remembered strip.**
  **A reload paints the composer's top it will keep.** Each conversation's strip is
  remembered in this browser, per account (`composerTopMemory.ts`, 64 conversations), and painted in
  the first frame; Gitea's answer confirms it, changes its words or takes it away.
  - _Why:_ measured live: the strip arrived with Gitea's answer 8.6 s after a reload, and the
    composer's 61 px growth moved the conversation
- **2026-09-29** — **One quiet control for the model and its effort** (C4). "Sonnet 5 · High" at 13
  px opens one menu, the models on the left and a radio list per choice with _Access_ on the right —
  radio lists, since six efforts do not fit a segmented row; picking an effort keeps it open.
  _Access_ stands in the toolbar only while it is not the usual setting, and whenever the one
  control cannot open. Send, disabled, is a grey disc, never a faded blue; 32 px, 36 on a phone for
  the finger.
  - _Why:_ three 14 px dropdowns at 500 were louder than the conversation's own words
- **2026-09-29** — **A picture sits where it is pasted** (P1). At the caret, a thumbnail on a line
  of its own in the text, 80 px tall; a file dropped on the text lands under the pointer; a drag
  moves it; Backspace removes it like a character. It is one character of the prompt, `￻` from the
  Specials block — the terminal contexts own `￼`, and a private-use character risks a glyph pasted
  from a terminal font. The old tray over the text goes.
  - _Why:_ the Mate reads words and pictures in the order they were placed
- **2026-09-29** — **Notes and a crop on the picture** (P2, P3). A click pins a numbered note, a
  drag boxes an area, C crops; the marks are drawn into the copy the Mate sees, one drawing for
  copy, thumbnail and view. No flash on insert or close: the picture landing where the caret was is
  its feedback. A reload keeps the copy, its notes and its edits but not the pasted file (the
  browser's storage cannot hold it), so after one the notes still edit and the marks and crop stand
  as they were.
  - _Why:_ a picture with no marks tells the Mate nothing about which part is wrong
- **2026-09-29** — **The copy the Mate sees is fitted; the original goes only when kept** (P4). At
  most 2000 px a side and 3,932,160 bytes, which is 5 MB once base64: as pasted where it is
  unmarked, whole and within both, else PNG, then JPEG from .92 down to .68 on white, then smaller.
  _Keep original_ sends the untouched file beside it as a file whose path the agent is told, never
  as a second picture to look at.
  - _Why:_ a 5.46 MB paste had failed a Mate's turn with an image error
- **2026-09-29** — **A message shows each picture where it was put** (P5): words and pictures in
  their order, a picture at most 300 px tall, its notes under it at 14 px with 12 px badges — the
  prototype's 13 and 10.5 px, brought onto the type scale — and "Original kept · 4.4 MB".
  - _Why:_ the person should see what the Mate read, in the order it read it
- **2026-09-29** — **The server fits what the client did not, before any agent sees it.** A picture
  over the limits — from the phone, an older client, a pasted data URL — is fitted in the message's
  normalisation for every provider, on a worker thread and one picture at a time across the server;
  one over 25 MP is refused before it is decoded, and an interlaced PNG is inflated only as far as
  its header says. Claude reads each picture right after its label, while a message whose last words
  are a slash command or a skill, or that ends on a picture, keeps the images-first layout. An image
  error names the picture, its size and what to do. The phone shrinks a photo to the same 2000 px.
  - _Why:_ a fit takes up to a second and hundreds of megabytes, and on the server's own thread it
    held every other request up; the Claude CLI runs a command from a message's last text
- **2026-09-29** — **Codex keeps its image order.** It takes pictures by path after one text item,
  and its adapter is ported code that stays upstream's, so the labels alone tie each picture to its
  place there; the server's fit covers its limits.
  - _Why:_ a diverged port is an expensive port next time, and Codex reads no base64 limit
- **2026-09-29** — **Every merge, landing, release and roll back goes through one _Review_** (R1).
  Every door says _Review_ — the pages say _Review release_ for a release — and opens the same
  dialog; nothing merges, lands, releases or rolls back from a row, a banner or a page. The merge
  dialog and the release dialog are deleted.
  - _Why:_ the same act had five doors that behaved differently — two asked first, three merged on
    one click, a roll back asked nothing — and nowhere could a pull request's diff be read before it
    merged
- **2026-09-29** — **Superseded 2026-10-02 in part: a change has no checks; merging waits only until
  HQ knows the change merges cleanly (`reviewVerdict.ts`).**
  **The verdict comes first, and blocks where it must** (R2). One line under the
  title says whether it is safe and why ("Ready to merge · checks passed · no conflicts with main"),
  in its tone, red where checks fail — a failure is red (S3) where the plan drew amber. Failing
  checks block even where Gitea would merge, and so do checks still running and Gitea still
  checking; a change nothing checked is grey, not green, and its review shows no checks section.
  - _Why:_ the button must be off exactly when the verdict can say why
- **2026-09-29** — **"Behind main" is amber, and _Merge_ stays on.** A change that still merges
  cleanly though changes landed on `main` since it branched says so and offers "Ask Nova to update
  it", its consequence naming what it was not checked with. One that no longer merges is blocked:
  "Conflicts with main in index.ts", and the change on `main` that touched the file, found from
  where `main`'s head stands.
  - _Why:_ blocking it would make every merge force the other Mates to rebase
- **2026-09-29** — **Superseded 2026-10-02 in part: HQ answers a change's files, diffs and commits
  in one read (`changeReadout.ts`), a diff past 2,000 lines links nowhere, and there are no checks
  to list.**
  **The change can be read** (R3, R4). What it does, in two to four sentences of
  the Mate's newest answer that links this change, and a link to that run. Its files with a letter
  and +/− each, a file's diff opening in place, read from Gitea only when a file first opens and
  never past 2 MiB; 400 lines, then "Show all N lines" up to 2,000, past that a link to the rest on
  Gitea. Its checks by name with their words; _Try it_ opens the stage half's preview first, since
  it runs the change's head, else the dev service. No pictures in the checks — a commit status
  carries none — and no "about 3 minutes", which nothing reads yet.
  - _Why:_ the person starts from the intent, not the files, and a pull request's diff could be read
    nowhere before it merged
- **2026-09-29** — **Superseded 2026-10-02 in part: HQ, not Gitea, refuses a merge whose head moved
  (`head_moved`).**
  **_Merge_ takes only the head the review showed.** It stays off while the head's
  files are read, its keys and its sentence kept in place; it sends that head, and Gitea refuses one
  pushed since. A change closed without merging reviews as closed, with nothing to press.
  - _Why:_ Gitea cannot pin a pull request's files or diff to a commit, but a merge's head can be
    pinned
- **2026-09-29** — **The button says what will happen; production's buttons take a deliberate
  press** (R5). Its consequence stands beside it ("Squash-merges 1 commit into main. Production
  isn't touched until you release."). The focus lands on it, and ⌘↵ presses it, only while it is
  safe; _Release_ and _Roll back_ never are — no focus, no ⌘↵ — and a key held down presses once.
  - _Why:_ a release or a roll back reaches production and must never happen on a stray Enter
- **2026-09-29** — **After the press, the next step, in place** (R6, R7). The review stays: "Merged
  into main", then "1 change now waits for production" with _Review release_, which hands over
  without closing; a release shows its progress with a clock and ends "Released" or with the failure
  and its fix; a roll back names the version it goes back to and the tag it makes, and says "Rolled
  back" once production runs it. It grows from what was pressed in 200 ms and closes in about 150,
  gives the focus back, and while it is open nothing typed reaches what is behind it.
  - _Why:_ a decision's outcome belongs where the decision was made
- **2026-09-29** — **A fix request joins an unsent draft.** Written into a composer that holds the
  person's words, the request goes after them, a blank line apart, the caret where it continues; the
  same request twice changes nothing. A change's fix goes only to the Mate that wrote it, which
  alone can push its branch; a run's only to the run's own Mate, whose services it found the problem
  in (2026-09-29: "'ask lena to fix' when im at iris"); a failed release's to the person's own Mate
  they used last in the project.
  - _Why:_ a request must never take the person's own words away
- **2026-09-29** — **A crew task lands from its review.** The board's task, the lead's plan, the
  crew section's _Waiting on you_ and a crew task's result row say _Review_; the review's button is
  _Land_ (_Land now_ while the task is still worked on), and it says "Landed" only once the task has
  landed.
  - _Why:_ landing is a merge into the person's tree and deserves the same reading
- **2026-09-29** — **The server relays the live step, in memory, and the client paces it.** A
  running thread's shell carries its step — thinking, writing, or the calls running — only while its
  session runs a turn, cleared however the turn ends; nothing is persisted, there is no migration,
  and no push is added, since the shell stream already re-reads a thread for the event that changed
  its step. The client phrases it with the card's own rules, skips a call the card draws nothing for
  yet, and changes a row's step at most once per 500 ms; a step is bounded to about 19.5 KB. An
  older server sends neither a step nor a question, and the row keeps its dots or its last words.
  - _Why:_ a pace on the server would need an event per step, and the menu and the card must never
    say different words
- **2026-09-29** — **Switching Mates never shows an empty pane** (T1; superseded 2026-09-30: a
  switch is at once). The conversation being left
  stays as a still picture over the pane until the next one stands where it stays, then fades over
  150 ms (at once under reduced motion); a Mate opened before paints where it was left. The picture
  is a copy of the page's conversation with its scroll, shadow roots, canvases and animations put
  back — not a second live list — and inert, so a gesture reaches the new conversation. Only the
  conversation holds; the header, the composer's top and the composer switch at once.
  - _Why:_ an empty frame reads as a crash and a late scroll as a glitch: measured, about 320 ms
    empty on a first open and a 96 px scroll one frame after a return
- **2026-09-29** — **The picture holds at most 600 ms** (superseded 2026-09-30). A conversation slower than that gives way
  to its own pane, its Mate at work (from 400 ms), held the same way while its rows are placed; a
  working Mate's conversation still on its way shows that pane, never a run made up from its status.
  - _Why:_ a picture of the wrong conversation under the new header for seconds would mislead
- **2026-09-29** — **Where the person was is kept by row, not by pixels.** A conversation remembers
  the row in sight, how far into it, its height and its run; back, it lands on the same line of the
  same row, on its run's line below the header's fade where that run folded since, or at its end
  where it was left there. It is placed once per mount, out of sight and in at most 350 ms, whatever
  streams meanwhile.
  - _Why:_ a pixel offset points elsewhere once a run above it folds, and a streaming Mate's list
    never stood still long enough to be placed
- **2026-09-29** — **Closed, a run's card is its summary line; open, it is one scroll with every
  event** (the owner, on 0.11.63: "the only way this makes sense is when open with scroll and all
  events and when close just the summary -> expand open the scroll with everything"). A run the
  person comes back to shows its worked line alone, and its result under it; "Show work" opens one
  scroll under the line holding everything the run said and did, thoughts and calls included. A live
  run is the same scroll over its now line. The scroll is 440 px at most, opens at its foot, follows
  what arrives only while it stands there, and draws a long run's earlier lines as the person nears
  them. **Supersedes:** the 2026-09-29 _opens folded, keeping what it said_ row (D3 stands: closed
  when come back to, open while watched), the 2026-09-29 _No scroll inside the run's card_ row, and
  the _"Show N earlier"_ part of the _fold the person opens keeps what they pressed still_ row.
  - _Why:_ a 25-minute run opened "folded" to sixteen of the Mate's bubbles, each with its face: a
    wall, not a summary
- **2026-09-29** — **Superseded the same day by the one-line conversation top below.** **The top of
  a conversation is one line** (the owner, of the crew strip on 0.11.63: "this whole design of the
  crew above is pretty poor"). With a crew or a second chat, the strip takes the header's line: the
  Mate's face and name are its first entry, on the menu's band colour while its chat is open, then
  its other chats with a quiet "+", then the crew 16 px apart, each a 20 px face and a 14/500 name —
  the crewmate's display name, never its `@handle`. Faces carry state and no status words stand
  beside them; a name is in ink when its chat is open, needs the person or finished unseen, else
  muted. The lead is first in the crew, named the lead on hover when its name does not say so; the
  compass mark is gone. What the chat is about — the task, or a crewmate's job led by its `@handle`
  — is the line under it, at 13/400 on the names' edge. Folding measures each entry, and the open
  chat never folds. **Supersedes:** for a Mate with a strip, the _conversation is headed by its
  Mate_ row's crumb — the Mate is the strip's first entry.
  - _Why:_ the Mate stood twice (the header and the strip's pill), names were cut to six characters
    behind status words, "+ New chat" was the loudest thing on the line, and a compass meant nothing
- **2026-09-29** — **_New project_ stands at the menu's foot, over the account** (the owner: "not
  sure if this shouldn't be stuck to the bottom somehow"). It is drawn after the menu's scroll and
  above the account row, in the same place however long the list: a + in the faces' column, its
  words at 56 px. While the list is scrolled under it, the list fades out above it and a hairline
  shows; at the list's end, neither. It is there from the first paint, and still one of ⌘K's finds.
  **Supersedes:** the 2026-09-29 _New project is the list's last row_ row (D11's place; ⌘K stays).
  - _Why:_ at the list's end it floated wherever the last project ended, with empty menu under it
- **2026-09-29** — **Folded projects stand 40 px apart and light under the pointer** (the owner:
  "increase the spacing between a little + maybe very slight grey bg on the hover"). A folded
  project keeps 8 px under its heading; the 58 px after an open project stays, and a pressed heading
  still moves 0 px (M9). A heading that folds lights at 3.5 % of the ink on hover, lighter than a
  Mate row's, in a band with 16 px corners; its chip and buttons keep their own, stronger hover.
  - _Why:_ folded headings stood 32 px apart, touching, and a heading gave no sign it could be
    pressed
- **2026-09-29** — **Superseded 2026-10-02 in part by the HQ row below: the signer is the one the
  Mate's server recorded, as HQ relays it, not a `mate:signer` tag.**
  **A Mate nobody owns sits on an empty seat, and a Mate nobody signed in says so**
  (the owner: "mate without auth / owner should have the state specially handled"). Two facts the
  menu reads from the first paint: the project's `OWNER` entry and the `mate:signer` tag written
  when someone signs its agent in (`mateOwnerRecords`, `mateOwnerView`). No owner: a dashed 16 px
  ring in the owner's place, "No owner yet. Whoever signs in its coding agent owns it." on hover. No
  signer: a never-asked row's second line says "Nobody has signed in yet" — pressing the row opens
  the Mate, where its sign-in is (2026-09-29: the row's own _Sign in_ did nothing and stood on the
  row's edge; removed). Not read yet, or not in the member list: the neutral disc, as before.
  **Supersedes:** the plain disc for an owner nobody could name, where the data says nobody.
  - _Why:_ a grey disc read as a person without a picture, and a Mate that could not work looked
    like any other
- **2026-09-29** — **A popover opens at its own height** (the owner, of the model menu: "this
  brutally overshots height on open before the scrollbar takes effect"). Kit popovers no longer sit
  in Base UI's Viewport part, which exists to morph one popup between several triggers and measured
  a capped popup uncapped: its content is a plain box capped by the room in CSS, and it enters by
  scale and fade only. The model menu's wheel scrolls its choices column: the page stays still
  behind an open menu, except inside the popup.
  - _Why:_ the model menu drew 644 px tall for its whole entrance, then snapped to 450; an unseen
    194 px box over the conversation took clicks; the choices column never scrolled by wheel
- **2026-09-29** — **Superseded 2026-09-30 by the lone card below.** **A line with nothing under it
  is no card** (the owner, of a closed run with nothing below: "shape of this with no items below is
  pretty weird"). A settled run whose card would hold its line alone — no result under it, what it
  ran being said on the line itself (`outcomeDraws`) — draws its line bare while closed, in the
  card's geometry, and opening its work draws the card around it without moving the line
  (`cardAlone`, `.run-tray-alone`).
  - _Why:_ a box around one line read as an odd shape; the line kept its place in both states,
    measured at 0 px on open and close
- **2026-09-29** — **A change's page is its review** (the owner: "shouldn't we unify what we have in
  the dialog with this page? and while we are at it improve the design and ux and loading states of
  both?"). One review in two frames — the dialog, with _Open as page_, and the change's page, the
  same sections in the same order and words in the conversation's column under its breadcrumb,
  nothing over it, its foot a card pinned to the view's bottom. The description leads (the pull
  request's body, its pictures in it); the conversation and the commits close it; _Try it_ is gone,
  since nothing records which version a stage runs and it could run anything but the change ("this
  could very much be stale"); a read that fails says so and offers _Try again_ in place, and what
  was read stays while the rest arrives.
  - _Why:_ the dialog and the page had drifted into two designs of one thing; the title, the
    verdict, the section headings and _Merge_ measured 0 px from the first frame to the settled one
    in both frames; nothing wider than its column with a 400-character diff line open
- **2026-09-29** — **The menu's end edge stands 16 px in, as its start edge** (the owner: "padding
  around this whole column feels a little inconsistent"). ⌘K, each production chip and a Mate row's
  time end 16 px short of the divider, as every start edge stands 16 px in from the window; before,
  ⌘K and the chips ended at 12.
  - _Why:_ two end edges read as a ragged column
- **2026-09-29** — **A Mate and its crew light as one** (the owner: "why isn't crew included in the
  hover?"). Hover, an open menu and the selected band cover the Mate's row and its crew line as one
  rounded shape; the change rows under them keep their own. A Mate without a crew is unchanged to
  the pixel, and a crew line read after a reload is taken into the band without a slide.
  - _Why:_ the crew line stood outside its own Mate's band
- **2026-09-29** — **Each tile of a run's strip takes its picture's own shape** (the owner: "why
  these has different ration than the result?"). One height, 96 px; the width follows the picture, a
  phone's screenshot whole and narrow, a desktop's whole and wide, clamped to 0.45–2.4; the shape is
  known before the bytes wherever the check or the asset read says it. **Supersedes** the six 16:10
  tiles.
  - _Why:_ a phone's screen was cut to a landscape box
- **2026-09-29** — **A conversation's top is one line, its descriptions on hover** (the owner, of
  the crew strip and two proposals: "horrible no matter which state, absolutely unclear and
  unreadable", "second row is straight up retarded"; approved on the "Mate Conversation Top" board).
  The Mate leads it — face 24, name 16/600, on the band while its own chat is open, the chat's
  subject its tooltip, right-click its thread menu, double-click renaming it; a 1 px divider; then
  the crew as faces, each a tooltip ("Game systems, one of Fen's crew" and its job as the person's
  line), the crewmate on screen a pill with its name and a ⌄. Nothing stands under the line: no
  subject line, no crewmate header, no lane or lead bar, no version chip, no handles. A Mate with no
  crew is its face and name. No _New chat_ anywhere; a Mate's older chats are listed from a ⌄ after
  its name. **Supersedes** the strip, the subject line, the lane bar and the lead's bar.
  - _Why:_ every mechanic of crew mode stood in the header in the engine's words
- **2026-09-29** — **A crewmate's menu says what each thing does** (the owner: "still no idea
  whatsoever what any of these functionalities will do"). Its job's first sentence as the person's
  line ("You own Game systems: how life…" reads "How life…"), then _Try its work_ — "Opens its copy
  of the app. Nothing is in <Mate>'s code yet." (its app, run first while stopped; at the Mate's dev
  address when it cannot run on its own) — _Stop its app_ while it runs, _Change its job_ — "What
  it's responsible for." — and _Clear its conversation_ — "It keeps its job and its work."; the
  lead's: _Change the brief_ — "What the whole crew works toward." A crew task ready to land offers
  _Try it_ before _Review_ on its result row. A crewmate's chat that has not started opens on the
  crewmate, without the job saves dated before its first message.
  - _Why:_ a menu of engine nouns meant nothing to the person it was for
- **2026-09-29** — **The Crew tab is the crew's one home** (the owner: "shouldn't we put the 'setup
  crew' screen from the zerops tab to the 'crew' tab? and allow setting up crew from more menu in
  the left col?"). For a Mate without a crew it offers _Set up a crew_; a crew is its section above
  its board in one column. The Zerops tab keeps the map and the coding agents' card, and no crew
  section. A Mate's own menu offers _Set up a crew_ or _Crew_ on the viewer's own Mate with crew
  mode on.
  - _Why:_ setting up a crew lived on the project map's tab
- **2026-09-29** — **A project's heading wears two chips, `stage` and `prod`, each its word alone**
  (the owner, of the production chip: "I'm not sure version here is needed, not sure the status icon
  is needed either, the whole tag shuld get like reddish when something is wrong.. so you'd have two
  badges one for prod, one for stage(s)"). The stages' chip first, production's on the end edge,
  each only where the project has it, open or folded; several stages are one chip in the worst state
  any of them is in — down, then a failed deploy, then one deploying. No version, no dot, no extra
  words: the chip's whole ground and ink say what is wrong (S3) — amber while the last release or
  deploy did not go through and the old one still serves, red while it is down, a hollow ring while
  it is stopped on purpose, neutral otherwise. Every tone keeps one 20 px box and a change
  cross-fades in 150 ms, so the heading never moves, and a long name truncates before either chip;
  the accessible name still says the whole state, the version with it. Production's menu keeps what
  it held, less the stages; the stages' menu says each stage as production's says production — its
  state, version and when it was deployed, what broke and the fix naming the stage, its links, its
  own _Open in Zerops_ among several — then what waits to go to production. A find in the jump box
  lands on its stop's chip, with the dot that chip's menu gives it, and the menu's memory keeps both
  chips per project (one kept when a project wore one chip reads as none, once). **Supersedes:** the
  one chip, its version and the stages in its menu of the 2026-09-29 _Production is one chip_, _What
  the stops' rows held_ and _A reload paints the rows, crews and chips_ rows.
  - _Why:_ the version and the dot said what the menu says, and where a project had a production its
    stages had no place on the heading, even while down
- **2026-09-29** — **A chip in trouble takes a strong ground; a chip whose release runs shows
  nothing.** Amber is a 34 % ground of the status colour and red a 26 % one, each ink leaning toward
  the foreground, so the word reads at 4.9:1 and 4.7:1 in light and 6.1:1 and 5.6:1 in dark; the
  neutral and hollow chips are as they were. A release or a deploy on its way leaves its chip
  neutral — its menu says "Releasing v1.2.1" or "Deploying…" — and the tone cross-fades to amber or
  red only if it did not go through. Amber rather than red for a release that failed while the old
  one serves, the hollow ring for a production stopped on purpose, and nothing on the chip while a
  release runs were put to the owner, who kept them (2026-09-29: "just use your recommendation").
  - _Why:_ on their first grounds amber's and red's words fell under 4.5:1 in light (3.8 and 3.9); a
    spinner or a shimmer on a chip drawn only once its state is read would say it is still loading,
    S3 keeps work in progress neutral, and what the heading owes the person is the outcome
- **2026-09-29** — **A heading's band stands 10 px from either side, and everything in it 6 px in**
  (the owner, of the menu at 435 px: "it's too squeezed on left, the tag no properly aligned on the
  left with border radius looking bad"). The title keeps the menu's mark edge (x = 16); the chips
  end on the band's end edge, 16 px short of the divider with ⌘K and the rows' times, 6 px from its
  top and bottom, 20 px pills of radius 10, so the band's 16 px corners run parallel to theirs (S4).
  The heading stays 32 px tall: the band moved, not the title or the chips. A Mate row's band keeps
  the list's 9 and 8 px.
  - _Why:_ the band stood 9 px from the window and 8 from the divider around a 24 px chip 8 px from
    its end and 4 from its top: two gaps, and two radii that could not run parallel
- **2026-09-29** — **In the _Custom_ order the grip leads the heading's verbs.** A 28 px verb
  before + and ⋯, in their slot and shown whenever they are — under the pointer, on focus, while a
  menu of the heading's is open, always to a finger — inside the band (the owner's "handle out of
  hover bg" holds) and clear of its rounded ends; a drag starts from it and the arrow keys move the
  project from it, as before. The name keeps the mark edge in either order, so nothing moves when
  the grip shows.
  - _Why:_ in the 7 px between the band's start and the name, the grip sat squeezed into the band's
    rounded end, which reached 8 px past the menu's inset to hold it
- **2026-09-29** — **The logo stands as far from the top as from the left, and the projects clear of
  it** (the owner: "visually logo has smaller padding on top than on the left", "first project is
  too close to logo"). On the web the logo row is 65 px, so the 33 px mark, centred in it, stands 16
  px from the top as from the left, and ⌘K and the waiting faces share its centre; beside a
  desktop's traffic lights the row stays the title bar's, centred on them. The list starts 16 px
  under the row, the first project's name 43 px under the mark's foot. **Supersedes:** "the list
  starts 6 px under the row" of the 2026-09-29 _Search is one ⌕ ⌘K control_ row.
  - _Why:_ the mark stood 16.3 px from the left and 9.8 from the top in the 52 px title-bar row, and
    the first name started 26 px under it, closer than one folded heading stood to the next (29 px)
- **2026-09-29** — **The list steps 20, 30 and 50 px from one text to the next** (the owner, of the
  menu at 435 px: "slightly decrease the space between open project and next project", "slightly
  increase the space between project title and first mate", "slightly increase the space between
  closed projects"). One rule, from one text's foot to the next text's head (`projectRoom`): a
  heading's words stand 20 from the next words under it — its first Mate's name, or while it is
  folded the next project's — Mates follow one another at 30 as before, and an open project's last
  words stand 50 from the next heading's, the folded 20 and one Mate's 30. So a heading takes 6 px
  before its first row (was 2), a folded project keeps 12 under it (was 8) and an open one 36 (was
  44); a pressed heading still stays put while the next one glides to where a fresh layout puts it.
  **Supersedes:** the 44 px of the 2026-09-29 _heading never moves when it is pressed_ row, the 58
  px of the _Mate's row is a messenger's row_ row, and the 8 px and 40 px of the _Folded projects
  stand 40 px apart_ row.
  - _Why:_ a heading stood 16 from its first Mate's name and 16 from the next folded one, and an
    open project's last words 58 from the next heading: three steps in no order; now heading to
    row < row to row < project to project
- **2026-09-29** — **Superseded 2026-10-02 in part by the HQ row below: a Mate's name and face are
  HQ's, their only writer, not project tags (`groups.ts`).**
  **A Mate's face is picked at its birth and rides on its project as
  `mate:face:<tint>:<shape>`.** The person who adds a Mate picks its colour and its shape apart, and
  the pair is one project tag, written at birth beside the agent's name on whichever call creates
  the project; every other tag write keeps it — a move, a leave, a role change, a rename, a signer —
  since the face is the Mate's, not its group's. It is read permissively: a tint or a shape this
  client does not know is left out and the derived one stands in for that part, and parts past the
  shape are ignored. Every surface that draws a Mate draws that face — the menu's rows and folded
  headings, the waiting faces, the chips' menus, the jump box, the conversation's line, card and
  empty state, the composer's top, whose memory keeps the shape, the projects page, the map and a
  review, where a Mate's remark now wears its face rather than its name's tint. A Mate nobody picked
  a face for keeps the one it had, its name's tint and that tint's shape; crewmates keep their
  tint's shape, and the mobile app draws no Mate faces. `@t3tools/shared/brand` joins the pure
  shared modules a pure zone may import (zone rule 3, `6fc64532a`): `groups.ts` reads the tag
  against the brand's tint and shape ids, and the module imports nothing and runs nothing.
  **Supersedes:** "one per tint" of the 2026-09-29 _Each Mate wears its own shape_ row and, for a
  Mate whose face was picked, the name's tint of the 2026-09-06 _A Mate has a colour and a face_
  row.
  - _Why:_ picked apart, a colour and a shape must live where every client reads them, with the
    Mate's name on its project
- **2026-09-29** — **A picked tint recolours nobody.** A Mate that picked its tint wears it; the
  rest share the tints their names give them among themselves alone, exactly as before any Mate
  could pick, so two Mates may wear one tint and their shapes tell them apart. The New Mate dialog
  offers a name its own tint walking past every tint a Mate already wears (`newMateTint`), so a Mate
  added with the offer changes no other face either.
  - _Why:_ adding one Mate in a live trial turned four others' faces: picked tints were reserved
    before the rest were derived, so a pick of the tint another Mate wore by its name pushed that
    Mate along, and the walk recoloured Mates across the account
- **2026-09-29** — **_New Mate_ asks who the Mate is — a name, a colour, a shape — and always
  deploys the recipe** (the owner: the dialog "basically doesn't need anything other than input for
  mate's name, its color and shape, it should always deploy the recipe"). The name, focused with the
  proposed one selected so a key replaces it, beside the face the three make at 112 px; under it a
  row of the eight colours and a row of the eight shapes, 36 px buttons ending on the field's edges,
  each a radio in a named radiogroup — one Tab stop per row, the arrows walking and picking — the
  picked one ringed 2 px in its tint a gap out, so nothing changes size. Until its person picks, the
  face follows the name as typed — the tint offered for it and that tint's shape — and a pick
  sticks; a change cross-fades the face in its cell (the new one settling from 92 % in 220 ms, the
  old fading in 160; a fade alone under reduced motion). What the old form asked is decided: the
  Mate runs its agent, gets the project's recipe (the tier on the group repo's `main`) and is called
  what the project calls its Mates ("Acme Docs - Quinn"). The description says what happens ("It
  gets its own copy of Acme Docs with the recipe deployed. It takes a couple of minutes."), or,
  where `main` has no recipe, that it sets the application up itself, in the same room; it names no
  Mate, so typing never reflows it; the button reads "Add Quinn to Acme Docs". A press while the
  repo is read waits and goes the moment the recipe arrives, the quiet line beside the button saying
  so; a project read as having none waits for a second press rather than getting an empty Mate it
  was not asked for; a refused name is said on that line ("Another Mate already has that name.").
  573 px tall before, 323 after. Stage and production keep their form. **Supersedes:** for a Mate,
  the 2026-09-05 _creation form_ row — the environment's name, the agent switch and the
  application's radio cards.
  - _Why:_ the form asked what nobody adding a Mate decides — the environment's name, whether it
    runs an agent, which application — and nothing of who the Mate is
- **2026-09-29** — **Superseded 2026-10-02 in part by the HQ row below: the ask is HQ's birth record
  (`standupRequestedBy`), not a `mate:standup:` tag, and the Mate's server sends the stand-up once
  its asker has signed in (`ZeropsSetup.ts`).**
  **A new Mate stands development up once its person has signed in.** _Add a Mate_
  writes `mate:standup:<userId>` on the Mate's project, naming who pressed it (read permissively,
  kept through every other tag write, cleared by its own patch). The moment that person has signed
  an agent in, their own client sends "Stand up development of the project." as them, through the
  composer's own send, into the Mate's main conversation, and clears the tag once the conversation
  holds it. Exactly once: only into a conversation read live from its Mate and found empty — a
  cached copy is never read as empty — once per environment in a session, and every client of the
  person sends the identical command, its ids derived from the conversation and the attempt, which
  the server takes once. A send seen leaving that left the conversation empty, or never seen leaving
  within 8 s, did not go through: "The message to Quinn didn't go through." with _Try again_, the
  next attempt under new ids; nothing is sent again on its own. A colleague, another of the Mate's
  chats and a Mate nobody asked it of keep the question; a tab closed before the send loses nothing,
  since the next open of the conversation sends it. **Supersedes:** for the person who added a Mate,
  "nothing writes into a Zerops environment's composer on its own" of the 2026-09-24 _empty
  conversation opens on an empty composer_ row: the stand-up goes through it, sent, never left
  there.
  - _Why:_ a Mate added to a project arrives with its services empty, and the owner's call of
    2026-09-18 is that a new Mate fetches and runs its code itself rather than asking the person to
    send the bootstrap message; it is sent from the person's own client because only their session
    may start a turn on the agent they signed in (D6), and a Mate's own key cannot write its
    project's tags
- **2026-09-29** — **While the stand-up waits on its person, the conversation is one sentence and
  the buttons to authorize** (the owner, on its first live run: "textarea should be hidden, the only
  message here is 'Quinn will stand up development on [the project] after you authorize your
  agent'"). To the person who added the Mate, its empty conversation says "Quinn will stand up
  development on Acme Docs after you authorize your agent." over one _Authorize_ button per agent
  that offers a sign-in, and the composer gives way — kept in its place, since it sends the
  stand-up, but unseen and out of reach — until the stand-up has gone or did not go through, then
  fades back in 180 ms. Signed in, "Quinn is standing up development on Acme Docs…" until the
  message appears; not through, the failure with _Try again_ 12 px under it. The phases share one
  box, the tallest's, and cross-fade in place (180 ms, 4 px of travel; a fade alone under reduced
  motion); the headline breaks between its clauses, never inside a name. Every empty conversation's
  face now stands a third of the way down the pane, so neither a sign-in arriving nor a Mate
  switched to moves it. **Supersedes:** for that person, the question and the sign-in rows of the
  2026-09-06 _empty conversation is the Mate's opening_ row.
  - _Why:_ under the headline the sign-in rows said "ACTION REQUIRED" with an amber dot, what the
    headline had just said, and an open composer invited the person to type what the stand-up was
    about to send for them
- **2026-09-29** — **Switching between a Mate and its crew moves the conversation's line as one**
  (the owner: "why isn't the transition between these ten time more smooth, animated, beautiful?").
  The band travels from the seat left to the seat opened — three pieces, its round ends moving and
  the run between them stretching, so its corners stay round on every frame; the seats between slide
  to where they now stand (FLIP); the name left folds back into its face and the one opened opens
  out of its own, clipped at the face's edge, its ⌄ riding at the words' edge. One clock for all of
  it: 240 ms on `cubic-bezier(0.19, 0.06, 0.24, 1)`, a critically damped spring from rest, no
  overshoot, never more than 16 % of the way in one 60 Hz frame. Only transform and opacity move, on
  the compositor, so the line keeps moving while the conversation below is placed, and a second
  press retargets from wherever everything stands. Each crewmate keeps one seat, so a working face
  no longer restarts its turn on a switch, and the focus follows the pressed face to its pill. Only
  a switch the person made moves: a first paint, a reload, the crew arriving and a crewmate added or
  removed are placed, and another Mate's line is drawn anew; under reduced motion the band and the
  opened name cross-fade over 120 ms. At rest the line draws as it did, within 2/255 a channel.
  - _Why:_ the line swapped in one frame, the faces between snapping sideways; the strong ease-out
    took 29 % of the way in its first frame, and the ease-in-out held still for four frames and then
    took 28 % in one: both read as the same jump
- **2026-09-29** — **A Mate with no crew writes its chat's subject on its line** (the owner: "with a
  single mate it doesnt have to be in tooltip"). After its name, past the line's own 1 px divider,
  at 14/400 muted; the name never shrinks, the subject is cut with an ellipsis first and is the
  name's hover only while it is cut. A subject that arrives after the line is painted fades in over
  180 ms where it stays, the name's box the same on every frame. With a crew the faces need the
  room, and the subject stays the name's hover. **Supersedes:** for a Mate with no crew, the subject
  as its tooltip and "A Mate with no crew is its face and name" of the 2026-09-29 _conversation's
  top is one line, its descriptions on hover_ row.
  - _Why:_ a Mate alone has the line to itself, and a subject behind a hover says nothing to someone
    not pointing at it
- **2026-09-29** — **A run watched to its end folds its work into its summary line** (the owner, on
  a run they watched finish: "why didn't this autocollapse at the end? in this state it looks
  stupid"). As the run settles, the scroll over its line eases shut into it — 360 ms on the drawer's
  curve (`cubic-bezier(0.32, 0.72, 0, 1)`), the newest lines and the hairline the last to go, fading
  as it closes — while the line keeps its place and becomes the summary with _Show work_, the result
  arriving under it. The scroll that folds is the one the person watched, and the fold starts from
  where the line stood, so nothing jumps at either end. A person reading the work as it settles —
  scrolled up in it, or something in it opened — keeps it open, as it was, until they leave or it is
  drawn again; a run that settled out of sight is simply folded, and so is every run under reduced
  motion. **Supersedes:** a watched run keeping its line at its foot until its conversation leaves
  the page, of the 2026-09-29 _"Show work" opens a folded run under its line_ row, and "open while
  watched" of the _Closed, a run's card is its summary line_ row.
  - _Why:_ a finished run stood open, every event above its summary and its result, as if it still
    ran
- **2026-09-29** — **A fold at the end keeps its line in place in the list.** The list moves its
  rows a frame after a row changes height, so as the work shut frame by frame the line rode up by
  each step and back down by the last one's. The fold now steps by hand: each step waits on a resize
  observer made after the list's, so it runs once the list has moved the rows for the last one, and
  the card's row is carried as far as the step takes, for the frame until the list moves it
  (`foldAway`). Anything else the list moves — the answer arriving as the run settles — stays the
  list's, and the fold waits three frames for the settle's own rows first. Only in a conversation
  that follows its end (`data-timeline-follows-end`), where a fold takes from above. Sampled in the
  real list: the line moves at most 1.2 px a frame through the fold, the answer under it 1.9.
  - _Why:_ the line rode ±45 px on a real run's fold while the answer under it stood still
- **2026-09-29** — **The run's card has room inside its edge, and its line stands centred** (the
  owner, on a finished run: "some spacing, especially at the top is pretty poor", "alignmen of the
  bot row is pretty stupid"). The tray holds its bubbles 16 px inside its edge, 15 inside its 1 px
  ring, and its corners are 34 px, parallel with the bubbles' 18 (S4). The line's words stand 20 px
  from the hairline over them and 20 px from what is under them, whether it sits at the foot of the
  live card or heads the closed one, where it has no hairline and its words stand 20 px under the
  top edge. The band's hairline sits 16 px under the line, as the line's sits 16 px under the chat,
  and _Show work_'s scroll opens under a hairline as far away. The line's face is the chat's 20 px,
  centred in the 28 px column over the glyphs and marks below it. **Supersedes:** the 30 px corners
  and 12 px of room of the 2026-09-29 _run's card is a quiet tray_ row.
  - _Why:_ the first row stood about 9 px under the card's top edge inside its 30 px corner while
    rows stood 18 px apart; the line's face and words sat about 4 px above its band's middle, and
    its 28 px face stood out of the column of marks under it
- **2026-09-29** — **A run's card keeps straight sides where its slices meet, at any pixel ratio.**
  The strip laid across each joint hangs off the slice's row, whose box is the tray's border box, so
  the strip and the tray share one origin; the middle slices and the joint strips take a radius
  nobody can see (0.05 px, above the layout unit), so every side is drawn along its corners' path,
  as the rounded slices' are. Measured at 1.58×, a joint reads within three grey levels; 1× and 2×
  are unchanged.
  - _Why:_ at the owner's 1.58× the strip, hung a pixel outside the tray's padding box, snapped to
    another device pixel than the tray's sides, and a square slice's side took two device columns
    where a rounded one's took one: the side jogged at every joint, a notch under the run's line
- **2026-09-29** — **A Mate can be deleted from its menus, its name typed to confirm.** _Delete
  {name}…_ stands last in a Mate's menus — the left menu's, its card's on the projects screen and a
  project's page — in red, after _Stop the run_, where the viewer's role on the Mate's project is
  OWNER or ADMIN: its own person, who made it, or an org owner or admin; with the viewer's role
  unread, no _Delete_. Only on a Mate — never a stage, a production, the account's Gitea project or
  a creation the platform failed, whose row keeps its own _Remove_ — and never on one already going.
  The dialog, 448 px as _Rename_ and _Move_ are, says what goes in one paragraph: "The environment
  Acme Docs - Quinn goes from Zerops with its 3 services and everything in them, and Quinn's
  conversations go with it. Anything Quinn hasn't pushed is lost. This can't be undone.", a
  colleague's Mate first named as theirs ("Quinn is Ada's Mate."), and no number it cannot back
  while the services are unread. "Type Quinn to confirm": _Delete Quinn_ opens only when the typed
  name matches exactly, as spelled, and Enter only then. Pressed, it says "Deleting…", both buttons
  and the field hold, and nothing closes the dialog until the platform answers; a refusal stands
  under the field on a line always kept for it, and the button opens again. Nothing in the dialog
  moves between its states.
  - _Why:_ a Mate is its environment — a Zerops project, its services and everything in them, its
    conversations — so deleting one takes all of that for good; the gate is the one the app keeps
    for writes to the project itself
- **2026-09-29** — **A Mate on its way off Zerops reads "Deleting…" and opens nothing.** Once the
  platform takes the delete, its row keeps its height and says "Deleting…" for its last line, its
  face asleep, with no time, no dot and no menu, and neither a press nor the jump box opens it; the
  platform's own `DELETING` or `DELETED` reads the same, so another tab's or a colleague's delete
  shows too. Its remembered row and crew leave the menu's memory, and a viewer in its conversation
  is taken to the next Mate of its project they may open, else to the projects. Sampled in the
  harness as it turns: 62 frames, no row moving.
  - _Why:_ a Mate going away must not look ready, nor hand the person a conversation that is about
    to go
- **2026-09-29** — **The top bar stands 65 px beside the menu, one line with its logo row** (the
  owner took the recommendation: the whole top bar on the logo row's line). The height is the
  workspace's one top-bar token, `--workspace-topbar-height`: from md up on the web it is 65 px, in
  rem (4.0625) as the logo row's own height was, so both scale with the interface's font size, and
  the logo row reads it like every other top row. The conversation's header — the Mate's line or its
  crew, its actions and the panel toggles — every page's header, the right panel's tab bar and the
  closed menu's corner mark share the logo's centre (32.5 px) and its bottom edge; what stands under
  a header — the timeline and its top fade, the minimap, the toasts at the top — moves down with it
  by the same 13 px, and a conversation held at its end stays there. On a phone, where the menu is a
  sheet over the page, and in a desktop window at every width the bar keeps 52: the title bar the
  desktop centres macOS's traffic lights on, the overlay's own on Windows. **Supersedes:** the 65 px
  as the logo row's alone, of the 2026-09-29 _logo stands as far from the top as from the left_ row,
  and "top 14 in both" of the 2026-09-06 _panel carries its own controls, and the mark holds the
  corner either way_ row: the closed menu's mark now centres on 32.5 with the open one's.
  - _Why:_ the conversation's line stood 6.5 px above the logo and ⌘K, and the two rows' bottom
    edges 13 px apart
- **2026-09-29** — **A Mate's session that reached its end reads as reconnecting, never as a
  refusal.** A Mate ends a session after a day and the door mints the next by itself, so nothing is
  wrong: the conversation's banner waits out its 2 s grace and then says only "Reconnecting to
  Fen…", and a query on that Mate keeps its last answer, as through a backoff, instead of failing.
  Every other refusal still reads "Couldn't connect to Fen" and "Fen refused the connection." Under
  it, the client never presents a session within 30 s of its deadline or one its Mate refused, and a
  link blocked on one waits for the door's new session rather than trying again on every wake
  (`account-lifecycle.md`).
  - _Why:_ at a session's day boundary the banner said "Couldn't connect to Fen. Fen refused the
    connection." until the door minted the next, and a tab left open presented its ended sessions to
    every Mate at once on each wake
- **2026-09-30** — **_Add a Mate_ opens its dialog over the view on screen, and lands on the new
  Mate** (the owner, trying the flow: the + on a project's heading "leaves the conversation"). Every
  _Add a Mate_ — the heading's +, its ⋯, the projects page, a project's own page — asks one host
  above every view (`ZeropsNewMateHost`), and nothing navigates. _Add_ stays in the dialog, busy,
  until the platform has taken the Mate's project, about a second: the quiet line says "Adding
  Quinn…", the name reads and the picks hold, _Cancel_ and Esc wait, and a refusal is said beside
  the button, only a refused name marking the field. Then the dialog closes and the person lands on
  the new Mate's own view (`/mate/$projectId`), its row lit in the menu. The view is its empty
  conversation before the conversation exists — the header line with its face and name, the face
  asleep a third of the way down, "Quinn is coming up on Acme Docs." over the projects page's own
  birth line, its step in words, its time and its meter. Once the Mate is up the view hands over in
  place — the face wakes, the headline cross-fades into the stand-up's (180 ms, 4 px), the progress
  leaves and the _Authorize_ buttons fade in — and 220 ms later the conversation takes the route
  with that same frame, its thread and its sign-in kept read across the change. A step past its cap
  offers _Keep waiting_; a creation the platform refused, or a step that failed after it took the
  project, says so with _Remove_. Sampled in the harness through the hand-over: the face and the
  headline in one place over 37 frames.
  - _Why:_ the + went to the projects page to show the dialog, and the person stayed there after
    _Add_ while the new Mate came up somewhere else
- **2026-09-30** — **A Mate in its first minutes says so in its row and opens its own view** (the
  owner, of a new Mate the menu drew as an ordinary row while the projects page said "Almost
  there.": "on the left it looks like its ready to be opened, but it's not"). One reading of a
  Mate's first minutes (`mateComing`) speaks for its row, its view and the projects page, in the
  projects page's words: "Coming up. A few minutes.", "Almost there." once its Mate is waited on,
  "Taking longer than usual." past a step's cap, "Could not be created." in red. The row is asleep
  in the face its person picked, under the Mate's own name, the owner's seat empty and no menu;
  drawn from the birth before the listing holds the project, it is the same row as the listed one —
  face, name, seat, words and height — so nothing changes as the listing catches up. Pressed, or
  found by the jump box, it opens its own view. Sampled in the harness from the birth to its first
  job: 115 frames, its top and its face in one place. **Supersedes:** "a sleeping slate face that
  opens nothing" of the 2026-09-24 _projects listing never moves on its own_ row and, for a Mate
  coming up, "Nobody has signed in yet" of the 2026-09-29 _Mate nobody owns sits on an empty seat_
  row.
  - _Why:_ a row that looked ready and did nothing when pressed, beside a page saying it was almost
    there, told the person two things
- **2026-09-30** — **A Mate's face and its words in the menu come from one reading.** The row read
  its words from this browser's memory whenever its socket was not connected that instant — three
  dots, a reply on its way — and its face from that instant, asleep, so a socket that blinked, or a
  listing re-read, left "Working on a reply" under a sleeping face while the Mate worked. Both now
  come from one reading (`mateRowReading`): its conversation's while its socket is up or only
  reconnecting — found by the project its server says it runs — else memory, at rest: a line held
  for words still to come keeps its room, empty, never dots under an asleep face. The folded
  heading's faces read the same.
  - _Why:_ in the live trial a working Mate's face slept in the menu under "Working on a reply"
- **2026-09-30** — **A Mate's face can be changed after its birth: _Change face…_, where _Rename_
  is** (the owner, 2026-09-29: "just use your recommendation"). The verb stands right after _Rename_
  in every Mate menu — the left menu's, the projects screen's and a project's page — offered where
  _Rename_ is (the viewer's effective role on the project OWNER or ADMIN) and only on a Mate. Its
  dialog is New Mate's picker, shared, not copied (`MateFacePicker`): "Change Fen's face", "Everyone
  sees Fen with this face.", opened on the face the Mate wears, a colour and a shape picked apart —
  the shape no longer follows the colour here — the big face cross-fading per pick. _Save_ writes
  nothing when the face is the one worn; else one patch through the tag writer, inside the project's
  lock, every other tag kept, and the read that confirms it is what every surface redraws from — the
  menu, the conversation and the projects page change together, and a reload reads the tag. While
  the platform answers, the button says "Saving…" in its own room and nothing can be pressed or
  picked; a refusal stands beside the buttons on a line always kept for it, the pick still picked.
  Taken, the dialog closes the way a dialog does, kept mounted and fading with its backdrop over 200
  ms, and the rows take the new face under the backdrop's veil, revealed by the fade. Nothing in the
  dialog moves between its states. **Supersedes:** birth as the only moment a face is picked, of the
  2026-09-29 _Mate's face is picked at its birth_ row.
  - _Why:_ a face picked in a hurry could not be changed, and a Mate born before the picker kept the
    face its name gave it
- **2026-09-30** — **A face changed after birth recolours nobody either**
  (`mate:face:<tint>:<shape>:named`). A Mate nobody picked a face for wears its name's tint, shared
  out over every such name in name order; changing its face took its name out of that sharing, and
  every name that had walked past it walked back — over a ten-Mate account, up to seven others
  recoloured. So a Mate that wore its name's tint keeps its name in the sharing when its face is
  changed: its tag says so (`:named`), it wears its pick, and the tint its name held stays held. A
  Mate whose face was picked at its birth never had a place there and takes none now. Older clients
  ignore the third part and read the face as a plain pick. **Supersedes:** for a Mate whose face is
  changed after birth, "the rest share the tints their names give them among themselves alone" of
  the 2026-09-29 _picked tint recolours nobody_ row: its name stays among them.
  - _Why:_ the rule that a pick recolours nobody would have broken on the first face changed live
- **2026-09-30** — **Superseded 2026-10-02 in part by the HQ row below: the name, the face and the
  stand-up ask are HQ's birth record, not project tags.**
  **_New project_ asks who its first Mate is, and that Mate stands development up
  after its sign-in.** Under the project's name the wizard asks for its _First Mate_ as New Mate
  does, in the same picker: the name, proposed free on the account and selected so a key replaces
  it, beside the face the name, a colour and a shape make, the face following the name until a pick
  sticks. Its line: "Name it and its first Mate. The Mate is up in a few minutes, with Git hosting
  alongside." A name that will not do is said beside _Create project_ once it is pressed, and while
  the account's Mates are read the button waits, saying "Checking which names are taken…". The Mate
  is born as New Mate makes one, through one birth for both paths (`withZeropsMateAtBirth`): the
  marker, the name, the face on its project and `mate:standup:<userId>` — so its empty conversation
  shows the stand-up, and its person's first sign-in sends "Stand up development of the project."
  once.
  - _Why:_ the wizard called its first Mate by a random name nobody saw, in the face that name gave
    it, moving every Mate its name walked past, and its person's first sign-in sent nothing
- **2026-09-30** — **The stand-up's _Authorize_ buttons stand bare under its headline.** The layer
  that holds them had wrapped them in the sign-in rows' white card; in the stand-up it only ever
  shows the buttons, so they stand on the page as they are.
  - _Why:_ seen live on a new Mate in the test org: a white bar behind two blue pills
- **2026-09-30** — **A Mate opened from elsewhere stands in view in the menu.** Whenever the open
  Mate changes during the session — _Add_ landing on it, a link, a page — its row is scrolled to the
  menu's nearest edge once it is drawn, smoothly unless motion is reduced; never the one open at
  mount, so a reload leaves the menu where it was.
  - _Why:_ seen live: a new Mate opened at once, its row selected but drawn below the menu's fold,
    1025 px down a 1000 px window
- **2026-09-30** — **The Crew tab is one column in the person's words, as the approved "Mate Crew
  Tab" board draws it** (the owner, 2026-09-29: "im fine with the crew tab design"). Its head is the
  crew's goal and one line saying how the crew works right now, with one press; then one composer
  that gives the crew something to do; a row per crewmate, saying what it is on and what it needs
  from you, with the presses that answer it in place; and _In Fen's code_, what went in. The board
  with its five columns and its sheets, the caps labels, the lead's chip, the version chips,
  handles, task numbers and attempts, and the footer's engine lines go: each crewmate's row says
  what it is on now and next, and a list with nothing in it is not drawn. **Supersedes:** "a crew is
  its section above its board in one column" of the 2026-09-29 _Crew tab is the crew's one home_
  row.
  - _Why:_ the section spoke the engine — "CREW" and "LEAD" labels, `@handles`, "V3 AT NEXT TURN",
    "Paused · time limit reached" — and the owner found it "not clear how it works at all"
- **2026-09-30** — **How the crew works is one line with one press: one _Stop_, and _Keep going…_
  when a limit stopped it.** "Works when you give it something to do"; "Working with you · finished
  work waits for your review" with _Let it work on its own…_; "Working on its own · $6.40 of $20 · 1
  h 12 m of 8 h" with _Stop_ — everyone stops where they are, and their work is kept; "Stopped
  working on its own: it spent its $20" with _Keep going…_, which sets apart the limit that stopped
  it and asks for more money or more time, added to what it spent or worked — never a new figure —
  and for its time only while something is left to do; a refused turn, _Try again_; "Wrapping up".
  Pause is not offered. _Let it work on its own_ asks, in plain words, how much it may spend and for
  how long, the stop before 80 % of the Claude plan's limit, what happens to a finished piece of
  work (wait for my review, add it once the lead approves it, or once its checks pass), whether the
  lead may start its own tasks, and whether crewmates may show their work at Fen's dev address. The
  line's words change in place, fading in, and nothing under it moves.
  - _Why:_ _Start run_, _Pause_ beside _Stop_ and _Resume_ were four controls for one question — is
    the crew working on its own — and a figure typed on resuming could be under what the crew had
    already spent
- **2026-09-30** — **A crewmate's row says what it is on and what it needs from you, and answers in
  place.** As the menu's Mate row: its face wearing its state, its name and a time; what it is on,
  as you or the lead put it, or its job, muted; its step while it works (the thread's live step,
  D5), else where its task stands ("Done · the lead is checking it", "Done, in its own copy · not in
  Fen's code yet"); then what it needs, a line each in ink — red only for something broken — its
  face asking and an amber dot, with the presses that settle it: a question and _Answer_, whose box
  unfolds in the row (a 220 ms clip, the rows below sliding to their places, a fade under reduced
  motion); finished work and _Review_, _Try it_; "Stopped mid-way when the $20 ran out." and
  _Continue_, _Review what it has_, _Drop it_; "The lead sent it back: …" and _Ask it to rework_,
  _Drop it_; a clash with Fen's code and _Ask it to sort it out_; failing checks and _Ask it to fix
  them_; "Wants to show its work at Fen's dev address." and _Let it_, _Not now_; "Waits for Season
  clock, which was dropped." and _Start it anyway_, _Drop it_; then "Next" and what waits. Rows
  never reorder.
  - _Why:_ a crewmate's state was spread over a board's five columns, a _Waiting on you_ list and a
    sheet, each naming the task by its number
- **2026-09-30** — **The lead's plan stands in the lead's row, and its _Start_ lets the crew work on
  its own, going on first where it stopped.** A line per task — whose it is, what it is, what it
  waits for ("after Season clock") — then "Start lets the crew work on its own: up to $20, for up to
  8 hours." with _Change_, and _Start_ and _Drop the plan_ ("Nobody starts on it."); while it waits,
  the composer reads "Tell the lead what to change…". _Start_ takes the plan into the work of a crew
  working on its own; with none, it starts that on the last limits, the first time through the
  dialog; a crew that stopped goes on first, through the dialog where a limit stopped it, since it
  goes on only with more.
  - _Why:_ a plan accepted while the crew was paused waited unseen: the lead's tasks start only
    while the crew works on its own
- **2026-09-30** — **Finished work goes into Fen's code from its review, and _In Fen's code_ lists
  what went in.** The review's button is _Add to Fen's code_ — "Adds Bo's work to Fen's code as one
  commit. Nothing is shipped until Fen ships it." — or _Add what it has_ while it is still worked
  on; once in, the review says "In Fen's code" and "Fen ships it with its own work". The tab's list:
  newest first, the crewmate's face at 20 px, what the work was and when it went in (`landedAt`),
  the last three and _Show all N_; a line opens that work's review; while some is unshipped, "Fen
  hasn't shipped these yet · Ask Fen to ship them", which asks Fen to ship what the crew added, like
  its own work. The left menu's crew line says whose work is ready ("Bo's work is ready", "2 pieces
  of work are ready"). **Supersedes:** _Land_, _Land now_ and "Landed" of the 2026-09-29 _crew task
  lands from its review_ row, and "how many tasks wait for _Land_" of the _crew is one line under
  its Mate_ row.
  - _Why:_ "land", "your tree" and "deliver" were the engine's words for the Mate's code and for
    shipping it
- **2026-09-30** — **Setup, the crew's goal and a crewmate's job are views in the tab's place, each
  with one Save.** A view takes the column's place — "‹ Crew" back, a heading, its fields, and a
  footer in reach with one line and its presses — sliding 24 px in from the right and back from the
  left over 220 ms, never on a first paint, a fade under reduced motion. Setup asks the goal first,
  then who's on it: _Let Fen suggest a crew_ (Fen reads the goal and proposes who does what; its
  draft arrives by itself, "Click anyone to change them."), _Start with a lead and two builders_, or
  _Add someone yourself_; each drafted row is the tab's own, and _Start the crew_ gives each builder
  its own copy of Fen's code, each row saying how that goes until the crew stands and the view
  becomes the tab. The goal is four plain fields: Title, What it's for, Rules every crewmate
  follows, Done when. A job is what it's responsible for, what it does — _Builds_, in its own copy
  of Fen's code, or _Reviews_, changing nothing — and under _More_ its name and face, what it runs
  on, its service and its commands; the handle is never shown. Each saves once, saying what follows:
  "It picks up its new job with its next message, in a fresh conversation. Its work stays."
  - _Why:_ three editors in sheets, each with three ways to save, a handle and two restart switches,
    asked the person to run the engine
- **2026-09-30** — **The crew speaks the person's words; no engine noun is a control or a label.**
  The glossary's crew rows (§2): add to Fen's code and in Fen's code for land and landed, the goal
  for the brief, Fen's code for your tree, ship for deliver, working on its own for a run, Clear its
  conversation for starting fresh, Drop it for discard, Let it for allow, Back to Fen's, Stopped for
  parked, and Builds, Reviews and Plans for writer, reader and lead. A task stopped mid-way says
  when, with the limit's own figure — "Stopped mid-way when the $20 ran out.", "when the 8 hours ran
  out", "when it neared 80 % of your Claude plan's limit", "when you stopped it" — and a new
  conversation's seam line says what changed, never a version: "Its job changed", "The crew's goal
  changed — from its next message", "You cleared its conversation", "A fresh conversation: the last
  one grew too long". **Supersedes:** _Change the brief_ of the 2026-09-29 _crewmate's menu says
  what each thing does_ row, now _Change the goal_.
  - _Why:_ briefs, versions, runs, landing and trees meant nothing to the person the crew works for
- **2026-09-30** — **A crew's time limit counts only the time it works.** Its clock runs while the
  crew works on its own and one of its turns runs, and stands, keeping what it counted, while none
  does: a crew sitting idle, waiting on you or with nothing to do never uses up its time, and "1 h
  12 m of 8 h" is working time. A Mate server from before still counts wall time, so its crew can
  read "Stopped working on its own: its 8 hours are up. It spent $0.00." until the Mate updates.
  - _Why:_ the owner's crew spent its 8 hours at $0.00, and the owner approved the board with idle
    time not counting
- **2026-09-30** — **A card holding nothing but its line is the composer's rounded rectangle, and it
  keeps its box closed** (the owner: "why the collapsed state has no bg at all?", then of the live
  card at its first thought: "the state of border radiuses in the initial thinking with no other
  content around sucks"). Live at its first thought or closed with nothing under its line, the card
  is one 60 px box drawn by its line's row, its corners the composer's 20 px (`--composer-radius`),
  never a full-width pill; its words and face 20 px from both edges. As rows arrive, or Show work
  opens, the corners ease to the full card's 34 over 220 ms (the fold's own 360 ms curve when it
  folds). What ran alongside the live line gives its room back when it ends, stepped after the
  list's layout. **Supersedes** "a line with nothing under it is no card".
  - _Why:_ a bare line floated between bubbles; the pill read as a stadium; a leftover 75 px stood
    under the live line
- **2026-09-30** — **A colleague's Mate wears its owner's picture on its face's corner; your own
  wear nothing** (the owner, of the picture before each name: "it looks like the avatar person is
  named cleo / wren"; option A of the board they chose from). The picture is a badge cut out of
  the 28 px face's corner (`.menu-face-cut`, `ownerBadge`) — 16 px since the entry below; a Mate
  nobody has signed in wears the empty seat there; a Mate whose owner is not named yet wears nothing
  until the badge arrives in its box, so nothing moves. Nothing stands before a Mate's name.
  - _Why:_ "(face) Cleo" read as a person named Cleo, and the viewer's own face repeated on every
    Mate
- **2026-09-30** — **The crew is as closed as the conversation to a viewer who may not run it** (the
  owner: "its not guarded against use by non authed people"). The crew's door on the server refuses
  what runs or changes the crew for whoever admission would refuse on the logins it reaches; the
  client offers only what the door would take — the Crew tab's composer slot says whose it is and
  offers the sign-in, in the composer's 48 px. Any member may stop or pause a running crew (D6: a
  colleague can stop what they cannot start).
  - _Why:_ the Crew tab took work for someone else's agent
- **2026-09-30** — **A crewmate's empty conversation says whose it is, its job and its work** (the
  owner: "the empty state shoud look much better, it should still probably show a small Fen, the
  desc must be better and obvious that this is the crew's member desc"). Its face stands where the
  Mate's own empty conversation puts its face; under its name, the Mate's small face and "Fen's lead
  · plans and reviews the crew's work"; a card headed _Its job_, as the job view heads it, with its
  job's first line in the person's words — never the sentences it says to the crewmate — its
  finished work under it, and _Change its job_ only where the crew's door would take it; a later
  conversation links the one before. Name and face stay empty until the crew is read.
  - _Why:_ a face in a void, a sentence that read as nobody's, and a fake "Message Lead…"
- **2026-09-30** — **Superseded 2026-10-02 in part by the HQ row below: the owner is named from the
  signer HQ relays, not a signer tag.**
  **A Mate that is not yours wears a 16 px badge on a paler face** (the owner, of
  the 12 px badge: "the not yours should have the avatar bigger and maybe some other small visual
  diff also"; option A of the board "Colleague's Mate badge", taken with "paler face won't work
  because it will simply look like a different shade of color, but I guess do it along the avatar
  of 16px"). A colleague's Mate and one nobody has signed in wear the badge at 16 px, centred 25 px
  across and 29 px down the face — level with the ask, since a bigger badge in the corner met the
  done face's smile — over a face at 55 % of its colour with its eyes and mouth in full ink
  (`mateNotYours`, `.menu-face-pale`). Your own Mates are unchanged. Whose a Mate is comes from the
  member list this browser remembers, or before it names the owner from the signer tag against the
  viewer's id, so the paler face is there from the first paint.
  - _Why:_ a 12 px picture was too small to say "not yours" down a menu of Mates
- **2026-09-30** — **A recipe change is never released** (the owner, of _Review release_ on a merged
  change to the group repo: "review release on the group doesn't make sense, the group repo are
  just the 'recipes' imports"). A change to the group repo's recipe offers no release, before or
  after its merge; its review says what its merge does, from the tiers its files touch and the
  environments made from them (`recipeReach`): the stage and production get any service added to
  their recipe, created empty, and keep the services they have; a recipe nothing in the project is
  made from changes no environment. Merged: "Merged into main · no environment changes" with only
  _Close_.
  - _Why:_ a merged recipe offered _Review release_ and said "the environments change to match" of
    a change no environment is made from
- **2026-09-30** — **A project whose Mates haven't written its recipe takes no other Mate** (the
  owner: "we need to deal with states where you are trying to add a second mate but the first
  haven't created the group's imports yet - shouldn't be possible with explanation"). A new Mate is
  made from `0 — AI Agent/import.yaml` on the group repo's `main`. A project with Mates and no
  recipe opens the New Mate dialog on the reason instead of the form (`newMateDoor`):
  - the recipe waiting in a change: _Review the change_;
  - none yet: _Open Cleo_, the Mate that writes it, or no action when several could;
  - unreadable: _Try again_, with Add off.

  A project with no Mates still takes its first. A failed read is never taken for "no recipe", so
  a quick Add no longer makes an empty Mate.
  - _Why:_ Add quietly made an empty Mate beside one that had set the project up

- **2026-09-30** — **New project lands on its first Mate** (the owner: "you should add the project
  and the first mate in the same step, then you should go to the mate detail and the only diff
  would be the progress, which would include the project creation as well"). Create goes straight
  to the first Mate's own view (`/mate/new/$birthId`, then `/mate/$projectId` once the platform
  takes the project). Its progress starts with the project's own steps: "Git hosting" only when the
  account has none, then the project. The Mate's six steps follow, and the menu draws both from the
  press.
  - _Why:_ Git hosting blocked the page and Create landed on the projects list, not the Mate

- **2026-09-30** — **A new project's first Mate gets no stand-up; its person says what to build.**
  _New project_ no longer writes `mate:standup:`, so its Mate's sign-in reads "Once it's signed
  in, Enzo writes and runs code on its own copy of Kestrel." and its first turn is the person's, as
  the dialog's "You sign Enzo in and tell it what to build" promised. It supersedes the stand-up
  half of "_New project_ asks who its first Mate is". A Mate added to a project with a recipe still
  stands it up.
  - _Why:_ on the live run (Kestrel, Enzo) the stand-up went to a project with no recipe and no
    code, and the Mate could only report that there was nothing to set up

- **2026-09-30** — **A switch between Mates is at once** (amended the same evening: a return shows
  the conversation as it stood, below) (the owner: "transition between mates
  suck, I'd do it immediately then start loading content … it feels like when there are two
  transparent texts transitioning over itself … the textarea element is transitioning from itself
  to itself"). The press shows the next Mate's pane — its header, its composer, its own list — and
  its rows come in as they are placed: out of sight until then, in over 140 ms, its Mate at work
  from 400 ms when slow to come. No picture of the conversation left is held, and nothing
  crossfades. The composer's frame takes no colour transition: its surface is painted by the frame
  or by the shell's layer as a drawer comes and goes, never faded between the two.
  - _Why:_ measured on the localhost pair, the conversation left stayed 250–600 ms after the press
    and faded over the next one for 150 ms, two texts at once; the composer's frame faded three
    times during one first open, showing the page through it

- **2026-09-30** — **A return shows the conversation as it stood** (the owner, on the switch at
  once: "the transition between chats still suck, sometimes the text area still flashed because
  old one is gone sooner than new one is in"). The pane keeps the last four conversations' lists
  mounted, hidden where the open one stands, so a return shows its rows in place in the press
  frame, with no fade and nothing moving after. Resting on a menu row for 100 ms, focusing it or
  touching it warms that conversation into the same keep. Only a cold open places its rows out of
  sight and brings them in over 140 ms. A run in a kept conversation folds when its list leaves the
  keep, not when the person leaves it.
  - _Why:_ measured, a return blanked the list 150–210 ms and a first open 270–500 ms before the
    rows faded in: the text went, nothing stood, and text came back
- **2026-09-30** — **The composer never leaves the screen across a switch.** A Mate's own view
  while it is reached, and a reload's stage before its conversation arrives, draw the composer
  standing where the conversation's will stand, and the conversation header's subject, ··· menu and
  panel toggles, inert until it connects. The stand-in takes typing into that conversation's
  draft, and the real composer takes the caret where the person left it. After the hand-over the
  list shows its Mate at work at once until its rows are placed.
  - _Why:_ a first open after a reload went 2.5–6 s with no composer at all, and the face, nothing,
    face, rows sequence read as flicker
- **2026-09-30** — **A Mate's link speaks with one voice** (the owner: "banners and snacks and
  weirdly aligned states all over the place"). Over a conversation that shows, only the banner
  above the composer speaks; where no conversation can show, the Mate's stage does — face, name,
  one line, centred on one axis. A state holds 1.5 s before it says anything. The words:
  "Opening Quinn…" on a slow first connect, "Reconnecting to Quinn…" (Try now) only after a link
  that was up drops, "Quinn is restarting." and "Quinn is updating." when the platform says so (a
  drop re-reads the platform once to learn it). The top pill and the "message not sent" toast are
  gone, and the sign-in's own surfaces say nothing about registering. A reload draws the stage from
  the Mate's name and face this browser remembers (per account, cleared on sign-out).
  - _Why:_ one restart stacked four surfaces saying overlapping things, a first load said
    "Reconnecting…" for 3.4 s though nothing was lost, and a reload showed a blank pane for 2–3 s
- **2026-09-30** — **A slow first connect lists what the platform is doing** (the owner: "why isnt
  this showing the processes or something?"). Past 1.5 s the stage's line is followed by the
  project's services as the arrival's chips — the zcp service first while a process runs on it —
  in the order first seen.
  - _Why:_ "Connecting…" said nothing while the platform knew exactly what was happening
- **2026-09-30** — **Superseded 2026-10-02 by the HQ row below: the Mate's server keeps one signer
  per login, replaced at each sign-in (`zeropsSignIns.ts`), so no record names two people.**
  **Two signer records for one login name nobody.** When a login carries signer
  tags for two people, the Mate reads as signed in, no ownership notice shows and no owner badge
  names anyone; the server still lets in anyone the tags name.
  - _Why:_ a restart showed "Signed in by another project member" to the person who signed it in;
    naming nobody is never wrong, naming the wrong person is
- **2026-09-30** — **The arrival says what each step waits on.** The copy step names its managed
  services from the press (the creation writes them on the birth record); the runtimes sit under
  the workspace, and while they come up after the sign-in shows, one quiet line under the sign-in
  names them ("appdev · webdev coming up") — its words fade when all are up, its height stays until
  the sign-in goes. Chips keep the order first seen. The steps are as wide as their words and
  centred on the sentence's axis. A step's clock counts from the earliest start it knows.
  - _Why:_ the copy step listed runtimes it did not wait for, chips reordered at 168 s, a clock ran
    0:12 → 0:08, and the runtimes left the page 100–150 s before they were up
- **2026-09-30** — **The stand-up's card shows its builds** (the owner: "what is even this state?
  it shows nothing"). A stand-up call docks a bar of the platform's builds for the services it
  deploys: a segment each, the one building's pipeline step or "3 building", "1 of 4", a failed one
  in red while the rest go on. The call's words come from zcp's result: "Stood development up ·
  apistage and webstage next", then "Stood stage up". One clock per run everywhere: no step keeps
  a clock of its own beside the run's.
  - _Why:_ zcp's progress notifications never reach the card — the Claude CLI drops them from its
    headless stream — while the platform's own processes already reach the client
- **2026-09-30** — **The stand-up answers once development is up** (zcp; the owner: "that's
  crazy … whether something couldn't have been run in parallel better?"). Every dev half deploys at
  once; a stage waits only for its dev half and the stages its build reads (the recipe's
  `${host_…}` build variables; the recipe writer sets priorities from the same reads). The first
  call returns with the stages queued; the Mate starts the dev servers, says so, and a second call
  builds the stages. Stages beside their dev halves stay out: their start-up migrations would race
  on the project's one database.
  - _Why:_ Beviro's 26 minutes were four builds in a row; the one real build-time edge is the
    storefront's stage reading its API's stage
- **2026-09-30** — **A link in an answer reads as part of its sentence** (the owner: "design of
  this is total shit oh my god, so painful"). Links take the sentence's ink with a quiet underline
  that fills on hover; a service the side panel opens leads with the panel's own globe, nothing
  fetched; nothing stands between a link's words and its full stop. External links drop their ↗.
  - _Why:_ a blurry fetched favicon, saturated blue and a glyph glued before the full stop
- **2026-09-30** — **The preview loads exactly the address it shows.** No cache-key query; a new
  deploy or Reload remounts the frame. A static page may show its previous copy after a deploy
  until the browser lets go of it; zcp tells static apps to send HTML with `Cache-Control:
no-cache`.
  - _Why:_ an app that routes on the exact address answered "Not found" to `/?_mate_preview=…`
- **2026-09-30** — **"Waits for your review" is one rule on every face.** A Mate whose own change
  waits for the person's review wears the needs face and the amber dot on its row, its folded
  heading, the waiting stack and the projects pages, by the rule the composer's card uses; a Mate
  at work still shows its work. "Waiting on an answer" stays the conversation's question.
  - _Why:_ the card showed the surprised face while the row kept the plain one, and folded
    headings lost the faces of Mates waiting on a review
- **2026-09-30** — **Data never vanishes because its source blinked.** The account's Gitea answer
  holds for 60 s within the same organisation while its project is missing from the inventory, so
  projects keep their reads; a project's pull requests and main show nothing until its changes are
  read, never "Nothing merged".
  - _Why:_ rows claimed "None yet" / "Nothing merged" for 11–28 s per project on a reload
- **2026-09-30** — **A menu verb opens what it names.** "Set up stage" and "Set up production" open
  the projects page's own form for that environment.
  - _Why:_ both only landed on the projects page
- **2026-09-30** — **A version is named for people** (the owner: "these crazy long version names").
  App versions read `main 7e2d4c1` (a stage, or a Mate's push), `v0.1.0 7e2d4c1` (a release),
  `HEAD 7e2d4c1`, `commit 7e2d4c1`; `-dirty` names no commit. Readers read old names too and resolve
  a short sha against the commits they know before comparing.
  - _Why:_ the name is the platform's evidence of what runs, and people read it in Zerops
- **2026-09-30** — **The Mate being opened connects first, and paints before its socket.** Other
  Mates' sockets wait until the route's is open (5 s at most); the Mate's descriptor names what
  the thread's snapshot needs, so the conversation paints over HTTP while the socket connects and
  the socket resumes from the snapshot.
  - _Why:_ the route's socket queued 4th–6th behind the others (one socket connects at a time to
    the one Zerops address); measured p50 9.8 s, worst 15 s to the conversation
- **2026-09-30** — **A project's release lives under its name (D′)** (the prod/stage board, picked
  by the owner). The pills say only whether each place serves: dashed before it serves anything, the
  stepped spinner inside it while it comes up, green for 4 s as it lands. The open heading's second
  line says one thing at a time, in this order: a release that didn't go out (amber, Review), a
  place that didn't come up (amber, Details), a place coming up ("Stage coming up · building the
  app"), a landing this tab watched ("v2.4.0 is live · just now", 4 s), a release on its way
  ("Releasing v2.4.0…"), changes waiting ("3 changes not released · all on stage"), each with its
  door at the line's end in the column of the pull requests' Review. A folded heading carries the
  release's mark after its faces. The line opens and folds as a 220 ms height reveal the Mates ride.
  Where the board is silent: "coming up" only within 15 minutes of the place being made; a
  production's first build is its first release; "all on stage" means the stage runs main's head.
  - _Why:_ a row after the Mates read as the last Mate's, and Heron's stage pill sat plain for the
    two minutes it took to come up
- **2026-09-30** — **An empty conversation keeps its row, and a draft shows on the person's line**
  (the owner: "empty conversation not showing draft and has weird position of the name without the
  questions and response under it"). Every Mate row is three lines tall; the second line is the
  person's — the sign-in, else _Draft:_ and the unsent words, else the ask, else "Nothing asked
  yet" once the conversations are read; a draft never covers the Mate's line.
  - _Why:_ a lone name floated mid-row, and the row grew 48 → 76 px when the first message landed
- **2026-09-30** — **Superseded 2026-10-02 in part by the HQ row below: a Mate is the viewer's when
  the signer HQ relays names them, not a signer tag (`mateIsViewers`).**
  **A colleague's Mate waits on its owner, not on the viewer** (the owner: "sana
  doesn't wait for me, it waits for karlos" / "but I can merge that's true"). The needs face, the
  amber dot, the stack, folded headings, the jump box, the crew line and the projects pages count
  only the viewer's own Mates — those whose signer tag names the viewer (`mateIsViewers`); another's
  waiting Mate rests with its question muted, and its change keeps its _Review_, since anyone with
  write can merge.
  - _Why:_ a colleague's Mate waited on the owner too
- **2026-09-30** — **The run card keeps one radius** (the owner: "I'd just keep one constant border
  raidus, the 'expansion' doesn't work with the stuff on bottom"). Every state wears
  `--composer-radius` (20 px), the background-work card too, and nothing eases between radii; the
  16 px edge slice takes corners 20 across by 16 down.
  - _Why:_ 34 px pill tops sat over 16 px bottoms once rows stood in the card, animated between
- **2026-09-30** — **A live line stands a second** (the owner: "stuff sometimes switches extremely
  fast, makes it look jittery"). The card's now line, the folded heading, the menu row and the
  header hold each step 1 s: the latest of a burst wins, the same words coming back drop what
  waited, a change after idle and the run's end show at once, and the clock never counts back. A
  change crossfades — out 140 ms, in 180 ms, 3 px, strong ease-out; a cut under reduced motion.
  - _Why:_ a burst every 150 ms changed the line about 40 times in 6 s; now 6
- **2026-09-30** — **A docked operation names itself and says its state once** (the owner: "this is
  pretty poorly designed"). Stand-up, import and deploy share one model: the label names the
  operation and never truncates ("Development", "Import · 2 services", "Deploy · appdev"); one
  segment per service, a single deploy keeping its pipeline's steps; the words say the state once
  ("2 building", "1 of 2 failed", "Imported"); opened, one plain line per service — mark, host,
  state or reason. A failed service's reason is the tool's note, else the platform process's own
  (`failReason`, else `error.code: message`).
  - _Why:_ "Import failed" stood as a bare word over tiles that never said why
- **2026-09-30** — **The dock shows a dev server only while it is down and the Mate has moved on**
  (the owner: "when does it actually make sense, if its up to date"). A service stands in the dock
  only while the latest thing done to it is a dev-server call that found it down — amber "not
  running" or "stopped answering (502)", red "start failed" — and a later row has followed; a later
  deploy, dev-server call, stand-up or restart, a call finding it running, or the platform working
  on it takes it down, and its bar never contradicts its words. Versions read `main 7e2d4c1`,
  `v0.1.0 7e2d4c1`, and a Mate's branch as its short sha alone; health reads "4 services healthy"
  or "1 of 4 services unhealthy".
  - _Why:_ "appdev · not running" stood long after the dev server ran again — the client learns a
    dev server's state only from zcp's dev-server call
- **2026-09-30** — **A result row carries its service's pictures** (the owner: "the final result is
  strange as well, showing only one of the images"). Pictures are kept per page and device; a
  service's row carries all of them in the order taken, 80 px like the open card's; a row is one
  line ("Deployed 227b804 · both checks passed"), the home page unnamed; "not running" followed by
  "running" goes quiet.
  - _Why:_ pictures were keyed per page, so the phone's take dropped the desktop's, and the strip
    stood under the last row
- **2026-09-30** — **A run watched to its end can be hidden** (the owner: "why is this uncloseable?
  because I saw it finish live?"). It stays open when it ends under the person's eyes and carries
  _Hide work_, folding as a settling run does; _Show work_ reopens it.
  - _Why:_ the toggle drew only for runs that ended unwatched
- **2026-09-30** — **The person's step names what they sign in with** (the owner: "should convey you
  sign in with your agent subscription … logos for brand recognition", "the 'next' is sloppy").
  "You sign Wren in with your Claude or ChatGPT subscription", each brand wearing its app's logo
  inline, wrapping at a phone's width; no "next" note; the subtitle drops "Then you sign it in." A
  coming-up Mate's header is its face and name; _Open in Zerops_ returns with the conversation.
  - _Why:_ the step read as signing a person in, and _Open in Zerops_ stood as a stray link on the
    arrival
- **2026-09-30** — **A project someone else makes is read at once** (a colleague's "Checking which names
  are taken…" without end; the owner's "Still reading…" for no reason, and Sana missing until a
  reload). The organization's project list hands a project the grant doesn't hold to the grant,
  which verifies it at once and reads it once the platform has answered for it; a Mate's name is
  judged from the project list alone, since names live on project tags; "Still reading…" speaks
  only of a list known in part, after 1.5 s, and over existing rows for 20 s at most.
  - _Why:_ a project created by someone else stayed out of the grant until its renewal, up to about
    12 minutes
- **2026-09-30** — **The release line has room and presence, and the folded tag says it** (the
  owner: "the release is too squeezed here and too blending with background", "there is no visual
  conneciton or tooltip here to connect it with the line below"). The line is 13/18 like the rows,
  13 px under the name and 33 px above the first Mate; the fact in ink, the rest muted, _Review_ in
  the change rows' blue. A release's line leads with the tag the folded heading's badge wears, and
  the badge's tooltip says the line's words.
  - _Why:_ at 12/16 in the muted ink, 10 px under the name, the line read as the heading's shadow,
    and the folded count had nothing tying it to the line
- **2026-09-30** — **A release's changes open inside its dialog** (the owner: "you should be able to
  clickthrough to those prs inside the dialog"). The whole row presses, a › at its end; the change's
  review shows merged — "✓ Merged" where the button stands, "← Release" in the kind line — and
  slides in over the release in 220 ms as the height eases; the first Esc steps back to the release
  where it was, the second closes, and ⌘↵ never reaches the release underneath.
  - _Why:_ the rows were plain text, so checking what a release carries meant leaving it
- **2026-09-30** — **A stand-up's bar is the whole environment** (the owner: "why doesnt this show
  dbs etc?"). Data services first, as the platform says, then utilities (development only), then
  the half's runtimes filling from their builds; the figure counts "5 of 7 up", and opened each
  says Up, its step, Queued, Failed or the platform's reason. A settled call keeps its list as it
  ended — all up when it succeeded; when it failed, the runtimes as its report says and the rest
  "not checked", counted only where known — never today's statuses, and nothing made after it.
  - _Why:_ the bar showed only the runtimes the call builds, so the databases looked forgotten
- **2026-09-30** — **The Mate being opened is never kept waiting by another** (supersedes the same
  day's "connects first"; the owner's Sana took 50 s to open, and Juno stuck while other Mates
  restarted). Whether an attempt is the route's is judged when it starts: a waiting Mate that
  becomes the route starts at once, and every other attempt still connecting gives way, the
  previous route's included; others connect one at a time, each given 8 s before it must give way while someone else waits (a
  lone attempt keeps its own 15 s), and the phone app, with no browser lock, never queues; a socket's turn covers only
  its opening, and its wait in line never counts against its setup or a replacement's; with no
  route named they still go one at a time, and a Mate coming up names itself the route. The route's Mate never waits out the five-minute cap — it stays on the ladder (≤ ~36 s),
  a capped Mate that becomes the route is tried at once, and a route that doesn't answer has its
  container read every 2 s and is tried the moment it answers.
  - _Why:_ Chrome connects one socket at a time per address, every Mate sits behind one address,
    and the balancer holds a restarting Mate's upgrade 3–5 s — so a Mate restarting elsewhere held
    the open Mate's socket, and a Mate back up waited out its ladder
- **2026-09-30** — **The sign-in's end says nothing** (the owner: "there still flashes the 'saving
  the auth to zerops' which layout shifts"). The server's own "being registered" status is hidden
  once the login is spent; every other provider status — an error, a disabled provider, a warning
  that can't verify the sign-in — still shows.
  - _Why:_ the status and the auth snapshot raced at the end of registration, so the banner came
    and went above the timeline
- **2026-09-30** — **Superseded 2026-10-02 in part by the HQ row below: the signer record is the
  Mate's server's own, written at the sign-in, so no tag is waited for; a turn waits up to 30 s only
  on a sign-in code still being checked (`SIGN_IN_CHECK_WAIT`).**
  **The first ask waits for its signer record** (Ada's first ask was refused as
  unrecorded a second before its tag landed). When this server's own login succeeded, was started
  by the same person and is under 30 minutes old, the turn gate re-reads the signer tags every 1 s
  for up to 15 s — over no record, another person's, or one that names two people — before it
  refuses; the earlier signer is refused on the new person's credential. The gate and the client that
  records the signer both go by the latest sign-in that succeeded, so an attempt cancelled or failed
  after it changes nothing. Every browser of one person sends the same command id per attempt, so one runs. A refused send's error stands until
  the person's own next turn.
  - _Why:_ the stand-up sends on the local signer the moment the sign-in succeeds, while the client
    writes the tag after it
- **2026-09-30** — **The account speaks from one line at the menu's foot** (the owner, of
  "Project access could not be verified. Try again Sign out": "at very least the placement is wrong
  … so is the copy"). A read failing while the grant still holds never covers or freezes the
  product: it is silent for 20 s, then "Zerops isn't answering. Trying again…" with _Try now_; a
  lapse speaks from the same line — "Checking your Zerops access…", then "Zerops isn't answering."
  with _Try now_ — with _Sign out_; only the organization on screen speaks, and the projects page
  shows what it has without repeating the line; the settings pages carry the same line.
  - _Why:_ one stalled read in any of the account's organizations covered the whole product and
    made it inert until a retry landed
- **2026-09-30** — **Stopping a run from its row takes a second press** (the owner: "this has
  confirm, right?"). ■ or x arms the row — a red "Stop?" crossfades in where the clock stood — and a
  second press within 3 s stops; the pointer leaving, Esc, the focus leaving, 3 s or the run ending
  puts it back. The ⋯ menu's _Stop the run_ stays one press, opening the menu being the first.
  - _Why:_ one press on a hover control cut a run short, with nothing to take it back
- **2026-09-30** — **A run's clock looks live** (the owner: "the timer here could have an extra
  icon, be bold, have some color in color of mate"). 600, tabular figures, the Mate's own hue mixed
  into the ink (5:1 or more on the menu and on the selected row, in both themes), after a 6 px dot
  of the same hue breathing slowly and still under reduced motion; when the run ends, the relative
  time fades in where it stood.
  - _Why:_ "0:50" read as a timestamp beside "4h" and "7m"
- **2026-10-01** — **A queued message whose send failed says why** (Milo's follow-up stayed queued
  after the turn ended). A send cut off — the link dropped, the command interrupted, the account's
  wait out — goes back unheld and is retried, at most three times, with the same message and
  command ids, so the engine's command receipt drops a second start. A refused send is held with its
  reason in the clock's place and ↑ becomes Retry (fresh ids); the ones behind it say "Waits for the
  message above"; while a question is open the next says "Waits for your answer above".
  - _Why:_ a held message never went again, blocked the queue and looked like a waiting one
- **2026-10-01** — **A Mate's changes name their repository when it has more than one** (the owner:
  two rows read "#1"). "appdev #1 …", "apidev #1 …" in the menu, the jump box and the project page;
  the composer's top lists every waiting change — one as before, two or three a line each with its
  own Review under "… of 2 changes", more as the newest three and "and N more". A change's review
  reads the change itself, by the group's slug, and spins only while a read is in flight.
  - _Why:_ the dialog waited for the group's whole flow (74 requests in 97 s for one group) and spun
    even when no request had gone out
- **2026-10-01** — **A row opens only when opening adds something** (a colleague: "you don't need an
  arrow if it doesn't show anything"). A docked operation's chevron shows only for its services'
  lines or a reason cut short; a cut-short reason opens whole, wrapped, in place.
  - _Why:_ a failed stand-up with no services opened to nothing
- **2026-10-01** — **A message echoed in the run card keeps its words** (the owner: it "swallows the
  text it had"). The echo stays one line (2026-09-28), now the first line of the words, never a
  picture label, with its pictures as a strip of thumbnails under it.
  - _Why:_ a message with a picture starts with its `[Picture 1]` line
- **2026-10-01** — **Superseded 2026-10-03 in part by "A Mate is connected while something holds it"
  below: the Mate on screen holds its own lease, and no ceiling is left to pass.**
  **A coming-up Mate hands over the moment it answers** (Vera's creating browser
  held "Almost there" for over an hour). A registered or connected Mate always wins over a leftover
  setup record; every recorded Mate's setup record ends on load; the Mate on screen connects past
  auto-connect's ceiling, and its connect is retried by the environment machine's ladder.
  - _Why:_ a leftover record, a 12-Mate ceiling and a single untried connect kept the page waiting
- **2026-10-01** — **One stalled subscription retries alone** ("Zerops isn't answering" kept coming
  back). While the org's socket is open, a subscription past its deadline retries on its own backoff
  and the rest keep observing; a socket is replaced only when it closes or misses a pong. The account
  line's Try now says "Trying…", then "Still not answering" if nothing answered; a second muted line
  names what isn't; one organization's trouble holds no other's screens.
  - _Why:_ one stall re-registered all ~60 of the org's subscriptions four at a time, and Try now
    looked like it did nothing
- **2026-10-02** — **A Mate's session outlives the load** (the owner, on the per-load throwaway: it
  "feels like it's making the system brittle"). The session a throwaway opened is kept per account
  and presented again on the next load, once the Mate's descriptor names the same project and
  environment and the Mate answers that it still holds it; it is never sent anywhere else. A kept
  session spends no mint and waits on no mint pace; signing out ends every kept session at its Mate.
  - _Why:_ memory-only sessions (2026-09-07) cost nothing while the door took the person's own
    token; once it took a throwaway (0.11.0) every load minted and deleted one per Mate — 38 of ~57
    Zerops calls on a Mate page — waited on the pace and the Zerops API to reach Mates that were up,
    and left each dropped session live on its Mate for a day, while the same storage keeps the
    Zerops token that can open every Mate
- **2026-10-02** — **Superseded 2026-10-03 by "A Mate is connected while something holds it" below.**
  **Every Mate in the menu connects on its own** (the owner, on a new Mate past the
  twelfth that sat asleep and empty until clicked: "that's stupid, no?"). Auto-connect wants every
  ready Mate the roster lists, up to a bound of 48 that no account comes near (the largest has 27).
  - _Why:_ the ceiling of 12 rationed a throwaway per Mate per load; with sessions kept across loads
    a reconnect mints nothing, and the first connect of the day waits on the door's mint pace
- **2026-10-01** — **Superseded 2026-10-02 in part by "A Mate's key reaches only its own project"
  below: the key holds no grant on its siblings, and the press gives no sibling reach.**
  **A new Mate's setup needs no browser after the press** (the owner: "never ever be
  tied to user having to have browser open"). Every step that needs the person's rights runs in the
  Add press, in the foreground: the project, the container with its own key (BASIC_USER on its
  project, READ_ONLY on its siblings, no delegation), close-off, the registry and sibling reach.
  zcp imports the runtimes itself once the project is closed off and its own deploy has finished,
  the Mate serves its setup at a public `/mate/setup.json`, and it starts the stand-up when the
  signer lands. _Finish setup_ repairs a half-made Mate from any browser.
  - _Why:_ the setup ran in the creating browser; a closed tab or a connect stranded it mid-way
- **2026-10-01** — **The Zerops data lives in one store the org sockets feed**, modelled on the
  legacy `zef` entity manager: streamed records by `clientId`, keyed cells for reads with no stream,
  and no fetch in a hook (a CI rule).
  - _Why:_ every view read on its own, and a cold open made 672 calls
- **2026-10-02** — **A sign-in lands once** (the owner: landing on the projects page and then
  jumping into some Mate "is very strange and disturbing"). It lands on the deep link it started
  from, else on the projects page; no route from an earlier visit is restored.
  - _Why:_ the return fell back to the last route the browser had open, usually an old Mate
- **2026-10-02** — **A group recipe gives a search engine room to reindex, and keeps what a Mate
  learns** (the owner: "while creating the recipe it should think about minimal viable resources
  (but not go overboard either)"). zcp writes Meilisearch, Elasticsearch and Typesense at no less
  than 2 GB with 0.5 GB free on every tier, every other service at the numbers it runs with, and
  carries the free-memory buffer and Valkey's profile overrides. A scale change that leaves the
  recipe behind says so, and one call proposes it as a recipe change for Review.
  - _Why:_ a new Mate's catalog import ran Meilisearch out of memory at the recipe's 1 GB, and the
    fix its agent made stopped at that one Mate
- **2026-10-02** — **HQ replaces Gitea and its broker** (the owner, 2026-10-02). Every organization
  has one HQ, and the app waits for it: an owner or an admin sees it born, anybody else is told whom
  to ask (`ZeropsHqGate`). The organization's structure — its applications, their Mates and
  environments — is HQ's and comes down its stream. A Mate's push opens a change in HQ; a person
  merges or closes it there, as themselves through HQ's own door, and HQ refuses a merge whose head
  moved since the review (`head_moved`). A change carries no checks. HQ keeps each environment and
  its deploy token: Core deploys each stage from the archive of the commit `main` moved to, and each
  production from the newest approved release (`apps/hq/src/deploys.ts`). Core tags and records a
  release, and a roll back is a new release (T9a, `apps/hq/src/releases.ts`); the client releases,
  rolls back and reads releases there (T9b). A Mate's birth is HQ's record — its name and face, who
  asked for its stand-up (`standupRequestedBy`) and that its project is closed off — and whose a
  login is stays the Mate's server's own record (`~/.mate/signed-in.json`), which HQ relays. The Git
  page is `/git`, every application's repositories and the changes open on them. An agent reaches
  past its own project only through HQ, later. **Supersedes:** the 2026-09-17 _footer's Gitea
  button_ and the 2026-09-30 _two signer records_ rows, and the Gitea, broker and tag parts of the
  rows marked above.
  - _Why:_ the owner's call: HQ is mandatory per organization and holds its structure, and an
    agent's reach past its project waits on it
- **2026-10-02** — **The old Gitea system stays as it is** (the owner, 2026-10-02). The Gitea
  project, its broker token, the `deploy-*` tokens and each Mate's `GITEA_TOKEN` stay where they
  are, and nothing writes to them. The client keeps a project tagged `mate:tool:gitea` out of the
  applications and never writes to it (`tools.ts`). Retiring it is a separate decision, later.
  - _Why:_ accounts that ran it still have it, and HQ replaces it without taking it down
- **2026-10-02** — **Superseded 2026-10-03 in part by "A Mate's key is lowered only when Finish
  setup adopts it" below: the projects page lowers no key on its read. Superseded 2026-10-05 in
  part: the harden keeps no other grant on a key HQ knows by the id the Mate enrolled with — it sets
  that key to its own project alone (`planMateKey`, `foundBy: "id"`), a widened key HQ tells by id
  (`keyWider`) included; only a key found by its name alone is never narrowed, and the grants by
  hand are that key's.**
  **A Mate's key reaches only its own project** (the owner, ADR 0003). The key a
  Mate's container holds is `NO_ACCESS` at the org and `BASIC_USER` on its own project, and nothing
  more: the mint grants its own project alone (`api.ts:1791`), the press gives no sibling reach, and
  the projects page only lowers a key minted `ADMIN` — for the Mates HQ places in an application —
  keeping any other grant a key already holds (`planMateKey`, `groupReach.ts:233`;
  `useZeropsMateKeys`). The `READ_ONLY` grants on siblings an earlier client gave are taken off by
  hand. An agent reaches its application's stage, production and other Mates only through HQ, later:
  a zcp tool that asks HQ, and HQ's rule over what the people who control the Mate may see.
  **Supersedes:** the sibling reach of the 2026-10-01 _setup needs no browser_ row.
  - _Why:_ a `READ_ONLY` grant on a production project reads its unmarked secrets — a database's
    connection string in clear — for anyone with the Mate's terminal, and grants are writes somebody
    must keep in step; HQ would need Admin rights to keep them
- **2026-10-03** — **A Mate's key is lowered only when Finish setup adopts it** (step A, A11: a load
  reads no token list). No page's read lowers a key; `useZeropsMateKeys` is gone. Finish setup
  lowers the key of a Mate it adopts — one HQ holds no record of — for whoever may adopt it, and
  the harden reads the key itself as it runs (`hardenMate`); a Mate HQ holds is never hardened. A
  key the adopter may not write stays as it was, and Finish setup says so ("The Mate's key couldn't
  be lowered: …; an owner can do it."). **Supersedes:** the projects page's lowering in the
  2026-10-02 _A Mate's key reaches only its own project_ row; the key's reach there stands.
  - _Why:_ the lowering read the organization's token list on every load, to find the keys only an
    adoption leaves `ADMIN`
- **2026-10-03** — **A Mate is connected while something holds it** (step A, A9). A load connects
  the route's Mate alone. A Mate is connected while the route names it, while it is on screen — its
  own view, its birth — while it is the one left last, for 5 minutes, while an action from outside
  its view holds it until the action answers, or while a Connect runs; with nothing holding it, it
  is parked: its socket closed, its registration, kept session and cached data kept, and unparked
  through no door. Rows, faces, notifications, the palette and the crew line read HQ's overview of
  a Mate this tab has not opened. A command on a parked Mate is sent once it connects, or after
  30 s regardless.
  **Supersedes:** the 2026-10-02 _Every Mate in the menu connects on its own_ row, and the
  auto-connect ceiling in the 2026-10-01 _A coming-up Mate hands over the moment it answers_ row.
  - _Why:_ a load of the 20-odd-Mate account opened a socket per Mate in every tab, each through a
    door, for surfaces HQ's overview now feeds
- **2026-10-03** — **In UI copy an HQ application is a project** (F29). The layer above Zerops
  projects — HQ's application, the code's _group_ or _app_ — is a "project" wherever the person
  reads it: "Move to project…", "New project", "No project", "Leave the project"; never _group_ or
  _application_. A Zerops project shown beside one, a Mate's or a stage's, is called by its name, as
  its row in the left menu draws it, and never "project" in the same dialog (glossary,
  `design-system.md` §2). **Supersedes:** the word "group" in the 2026-09-05 group-model row.
  - _Why:_ the menus that open the Move dialog already said "project", and the dialog spoke of
    groups and explained that a group is what you call the application
- **2026-10-02** — **Superseded 2026-10-05 in part: no `mate:by:` tag is written; who made a Mate
  is HQ's record of it (`madeBy`).** **A Mate names who made it** (the owner, on pass 34's open choices: "use
  recommended"; the entries below take the same answer). New project and Add a Mate tag a
  development Mate's project `mate:by:<userId>` at birth; the tag is never cleared and shows in the
  Zerops dashboard. The Mate's row reads "Waiting for your sign-in" to its maker and "Waiting for
  sign-in" to anyone else. Stage and production Mates name nobody and keep "Nobody has signed in
  yet"; Mates made before 0.11.87 are not backfilled. The maker of a half-made New-project Mate gets
  Finish setup on it, as Add a Mate already allowed.
  - _Why:_ the two flows made the same Mate and said two things about it; the service's
    `createdByUser` is on the REST record but not on the socket's, and a tag reaches every window
    through the store the sockets feed
- **2026-10-02** — **Superseded 2026-10-05: no window lists Gitea; a merge reaches every window on
  HQ's structure stream. The goal stands.** **A merge reaches the other window within 15 s.** While a group has an open pull
  request, each window lists that group's Gitea org every 15 s (`PULL_WATCH_MS`), one org a tick, at
  most +4 requests a minute per window; a pull request that hasn't moved for 30 min leaves the
  watch. Nothing runs while none is open or the page is hidden. The clock sits in the web forge hook
  beside the 60 s Gitea refresh; the rule lives in client-runtime.
  - _Why:_ a merge took 48 s to clear the Mate's "needs you" face in another window (run 4); run 5
    measured 10.0 s
- **2026-10-02** — **Superseded 2026-10-05: an environment is coming up while HQ's birth of it
  runs or the platform makes something of it; the 15 min bound and the inference from `main` are
  gone.** **A stage's first deploy counts as asked for once the stage is declared and `main` has
  code**, bounded at 15 min from the later of the stage's making and `main`'s last code
  landing; past the bound the line reads "Nothing deployed yet". No new request.
  - _Why:_ no reader held the broker's pending status on `main`, and the broker deploys exactly when
    a declaration lands on a `main` with code
- **2026-10-02** — **A release review holds the facts of its press.** From the press, or from the
  first look at a release already on its way, the dialog keeps what it showed ("replaces v0.1.0 · 1
  change" and its roll back) through the landing or the failure. A roll back that landed heads
  "replaces v0.1.1", the shape of a release's; a production that no single release runs in full
  reads "replaces what production runs", with the generic roll-back line.
  - _Why:_ read from the project, "production runs v0.1.1" turned false the moment the release
    landed, and the review turned to the next offer without saying how its own release ended
- **2026-10-02** — **Superseded 2026-10-05 in part: the 30 min cutoff is gone; a review ends when
  HQ ends the release's rollout (`ReleaseRollout.ended`, `releaseEnded`), never by a client
  clock.** **Every release review ends.** A tag with neither a landing nor a failure 30 min
  after it was tagged reads "v0.1.1 hasn't landed · Tagged … · production doesn't run it", its next
  step "find out why", and its clock stops. A newer tag above it reads "v0.1.2 was tagged after
  v0.1.1", and the project's line in the menu follows the newer one.
  - _Why:_ a release with no final state kept "Releasing" and its clock running for as long as the
    dialog was open
- **2026-10-02** — **Superseded 2026-10-05: no broker marks a version; a deploy's verdict is HQ's
  job for a build HQ made, the build's Zerops process otherwise.** **A failure on the version a stop
  runs still reads Failed.** Until the broker
  marks that version live, a rare Deployed → Failed → Deployed flicker stays; reading the failure on
  the version the broker tried is a new read, for later.
  - _Why:_ reading it as Deployed would switch off the failed deploy's next step (2026-09-25),
    production's deploy-failed state and the stage chip's failed state
- **2026-10-02** — **A reload during a Mate's arrival paints the asleep row.** A reload in the ~15 s
  between ACTIVE and the Mate's first answer shows the asleep row with its sign-in line; the arrival
  window stays 2 min from first seen ACTIVE. A Mate whose close-off is still pending arrives like
  any other: "Coming up", Finish setup hidden, until its server answers its first probe.
  - _Why:_ a reload paints nothing it takes back, and excluding a close-off-pending Mate would bring
    the asleep row back for a normal press
- **2026-10-03** — **Superseded 2026-10-05: no status on `main` is read; a first deploy fails by
  its owner's word — HQ's job, or the build's Zerops process — and the reads' schedule is gone.**
  **A stage's first deploy that fails says so** (run 5: a group workflow's own step
  failed, and both windows said "first deploy on its way" for 4.3 min). While a declared stage runs
  nothing, the group's deploy reader reads `main`'s head of each repository the stage builds from,
  and its statuses, and takes the newest status of each context. The broker's own
  `mate/deploy/<env>/<svc>` saying `failed: …` (the job's report) is failed, with its reason, and
  final. The same context saying `deploying` or success is not failed. The deploy workflow's own
  context failing, whenever it was posted, is failed until the broker says `deploying`: the
  broker's dispatched run leaves no status and runs the same workflow on the same commit. A refusal
  the broker retries is never failed. The menu reads "Stage didn't come up · its first deploy
  failed", the cell "First deploy failed"; a new head starts again. Reads: one a minute for 15 min
  after the later of the stage's making and the head's newest status, one every 5 min to 35 min,
  then none until a push; nothing for a deployed stage, production, or a group with no stage
  declared. This supersedes the 2026-10-02 entry's "no new request" for the failure.
  - _Why:_ the broker's pending status on the merge commit was the only thing read, and a job that
    fails before it asks the broker for its grant never touches it; the exact signal, the broker
    writing `failed: <step>` when the run it dispatched fails, is a gitea-mate change for later
- **2026-10-03** — **The live card shows the moment whole, then plops it into the history** (the
  owner: "always show the things that is happening in full, at least up to some height … when this
  thing is done, it would animatedly 'plop' to the history"; "question what we show in the 'live'
  field: sometimes it shows something that failed 4 iterations ago"). The one-line now line becomes
  the live slot: what the Mate is doing, drawn as the row it becomes, with the face, a sweep and the
  run's one clock. It holds the open calls of the newest batch, one model response (each of the
  Mate's own calls names the response it was written in; a call still open once a call of a newer
  response has started is stale and closes as "No result"; a provider that names none keeps the
  order of starts and returns); else its words; else what it waits on; else "Thinking", 300 ms late.
  An item plops once it has ended and stood 800 ms, landing exactly as it stood (the same toggles,
  cap and open state), and a burst rides along with the item that stands; history and slot share
  `min(560px, 60svh)` once full. The band holds only what runs without the Mate waiting on it, shows
  an ending for 800 ms, then leaves; a failure is told once, in the record. A control that opens is
  drawn only when it opens onto something not on screen. An approval puts what it asks to run in the
  slot; the controls stay in the composer.
  - _Why:_ the slot promises that this is happening now, and one stale line breaks the promise; the
    band kept a failed deploy until the turn ended, the line walked back to any call still marked
    open, and a stand-up whose call had returned took the line back between steps. The batch rule
    makes staleness follow from times alone. The board measured coalescing at 0.7 s of lag against
    4.7 s for a queue
- **2026-10-03** — **The live card keeps to its newest line; a scroll is the person's when its top
  moved up** (the owner: "sometimes stuff is faded at the bottom, there is no proper concept of
  keeping the 'working' card scrolled to the bottom"). While a card is live its history scroll
  follows its newest line, catching up in the frame it grows, before paint. Following stops when
  the top ends above where it last stood and is not at the foot (4 px), whatever moved it: wheel,
  keys, find, drag-select, focus; or when the person opens something in the card. It follows
  again only when the person brings it back: their move down onto the foot, or closing the last thing
  they opened if it followed as they opened it and they have not moved it up since. Growth, the
  card's own moves, a clamp from a shrinking scroll height and a re-read at the foot never change it. The foot and the fades come from where the lines end as laid out, so a row moving
  into place is never more content; a fade shows only at an edge with lines cut past it. The wheel
  chains from the card's edges to the conversation.
  - _Why:_ a time window after input read the card's own catch-up as the person's scroll and
    missed every scroll with no wheel or key; movement is what the person did.
- **2026-10-03** — **The conversation follows only a person's way back to its end** (the owner:
  "when I scroll up in the main chat and a new message is received it interrupts me and jumps to
  the bottom"). Follow holds while the person is at the end. A scroll of theirs that leaves it turns
  follow off at once, and nothing that arrives turns it on again; only their own scroll toward the
  end that reaches it, the jump to latest, their own send, or opening the thread does. A move the
  content change explains (rows growing push it down, content shrinking pulls it up) is never
  theirs; a queued message leaving by itself moves no one who reads above. One rule in
  client-runtime, read by web and mobile.
  - _Why:_ the turn-off landed a render late, after a jump to the end the list had already
    scheduled; and "at the end" re-armed follow on the first frame of a smooth scroll up.
- **2026-10-03** — **A running deploy shows its pipeline and build log in the live slot; a settled
  one reads them from the account store** (the owner: "the running builds, their logs etc all the
  more advanced details of async flows seems to be completely gone now"). In the slot a deploy reads
  the store from start to plop: its steps, the step it is on, the build's newest lines and the way
  to its whole log; a batch stands as one line, its card on the service the store says is building;
  only the newest running deploy stands open. A settled deploy reads its process once per open, by the ids its result named, so any
  window and any reload show the same details within the project's last 100 processes; with no id it
  shows what its call returned, never a guess by time and service. Only deploys read; a landed card keeps its height; a log dialog the person opened stays
  open through the plop.
  - _Why:_ 0.11.88 moved a running deploy from the band into the slot, whose row read only the
    call's placeholder steps; a page-held memory of the read would tie the details to one tab.
- **2026-10-03** — **A Mate on its way up wears its waking face; asleep is for a Mate at rest**
  (run 6: each coming-up Mate wore the asleep face in the other window until its sign-in; the owner
  left the call to the lead: "for my calls do whats best"). While a Mate arrives — from the press
  until it is signed in, at most 30 minutes from its creation (the existing bound past which a first
  build is not coming up) — it wears `waking`: closed eyes that breathe, a slow swell of the whole
  face as one composited box, still under reduced motion. Failed, deleting, or a container that is
  down: asleep, as before; past the window an unsigned Mate rests with its sign-in line and dot. One
  face function applies the rule for every surface (rows, ⌘K, the projects page and overview, the
  conversation header, the panel, the arrival page), reading one fact from the Mate's own records.
  - _Why:_ asleep also means a Mate at rest or going away, so a Mate on its way up read like one that
    stopped; a breath that never ended would make a menu of faces fidget.
- **2026-10-03** — **One screen for a Mate coming up** (the owner, run 6: "why are these two screens
  separate?"). Create and Add close their dialog at once and the person is on the Mate's coming-up
  page. The steps the browser runs with the person's session (registered, created, closed off, the
  Mate registered) are the first row's sub-steps there; "Keep this tab open for about half a minute"
  shows only while they run. They live in the account's creations store, so moving to another page
  stops nothing; a stop says its reason in its step's place without moving the rows above.
  - _Why:_ the dialog and the page showed one coming-up twice, and the dialog's own steps held the
    person on a modal for the half minute that needed them.
- **2026-10-03** — **Superseded 2026-10-05: the client lists no Gitea; HQ's structure stream
  carries the changes.** **One Gitea listing a minute for the whole account** (run 6: idle windows made 22
  and 20 requests a minute, 13.4 of them one repository list per group org). The forge reads tick
  together; at each tick one id-ordered listing of the person's repositories (`/repos/search` as the
  person, with Gitea's count) feeds every group's slice. A group the listing does not name yet, a
  listing Gitea's count does not confirm, or any failure but a 401 falls back to that group's own
  listing; the pull watch lists only its own group. 14 groups idle: 14 requests a minute → 1.
  - _Why:_ idle cost had grown with the account's groups; one listing carries the same repository
    objects in one response.
- **2026-10-03** — **A running build's log streams as the Zerops GUI asks for it** (the live look on
  0.11.89: a stream opened with a time as `from` stood through a 94-line build and delivered none).
  The stream asks with `limit=100`, `desc=0`, `projectId`, and a `from` only as the newest line's id;
  the backfill keeps its time. "Waiting for the build's first line…" shows only while the build step
  runs and the stream's handshake has stood.
- **2026-10-03** — **Superseded 2026-10-05 in part: a Mate's project is `<application> - <Mate>`,
  and under its application the client cuts that prefix.** **A Mate's name is its Zerops project's
  name** (D3, the owner: Zerops is the
  source of truth, HQ stores only what Zerops lacks, and a name's source is Zerops). A Mate is called
  what its project is, wherever it is drawn; HQ keeps no name of a Mate or of a Mate on its way
  (migration `0030`), only its face, its place and its birth. _Rename Mate_ renames the project
  (`renameProject`, by the TagWriter that puts back the tags a fresh read holds), offered where the
  platform takes it — effective `OWNER` or `ADMIN` there; a rename in Zerops reaches every surface by
  the project's own update. A new Mate's project is named as the Mate is, typed in one field;
  _Set up Mate_ derives only a face. A stage or a production is offered `<project> - stage` or
  `<project> - production`, numbered once taken, a suggestion nothing reads back; it has one name,
  and an agent in it goes by it. A stop's row, its page, its line in a history and its find in the
  jump box name it whole, as Zerops has it — no prefix is cut. An application's title stays HQ's.
  **Supersedes:** the 2026-09-29 _New Mate_ row's "called what the project calls its Mates ('Acme
  Docs - Quinn')", and the name in "A Mate's birth is HQ's record — its name and face" of the
  2026-10-02 HQ row.
  - _Why:_ HQ's name drew over the project's, so a rename in HQ left the project's, a rename in
    Zerops changed nothing on screen, and a moved Mate kept its old project's prefix; and a stop's
    name read back for its project's prefix cut `Shopper - stage` to `per - stage` under `Shop`

- **2026-10-03** — **The MCP servers a Mate's agents can call are a right-panel tab, and /mcp opens
  it** (the owner: "a proper mcp management dialog … or one of the right side tabs? it feels like
  mcp is quite like .. important"). The tab is labelled "MCP"; Zerops' own server stands first,
  marked "Built in", shown and reconnected, never turned off or removed; a repo `.mcp.json` server
  is shown and edited in the repo. A row's dot is the conversation's agent's state, a second line
  only for an error, a needed sign-in or a server turned off, and a third names which agent stands
  how when they differ. A server added there is written for every agent installed on the Mate, in
  each one's user-scope config — not the repo, so secrets stay out of git. /mcp is Mate's own
  command, like /model: it opens the tab and sends nothing. Signing in to an OAuth server waits
  for its own slice; mobile has no right panel, so no tab yet.
  - _Why:_ Claude Code's /mcp in a Mate answers with one line of text, Codex has none, and an MCP
    server a person adds is useful only if it reaches whichever agent the conversation runs on.

- **2026-10-04** — **Origin's load and agent readiness fixes use HQ's facts.** A ready agent outside
  Mate's personal sign-in flow is relayed in its overview's identity, alongside provider changes.
  HQ's placement joins it onto the Mate's record: the signer comes first, else the maker of a Mate
  with that ready agent. No `mate:runs:` tag is written. The server's stand-up reads its asker from
  HQ and still admits the turn through project access. Cold menus remember candidate rows only as
  a standing-in tree and join HQ's placement; unread detail pages say HQ's failure or an earned
  missing project, without a Gitea session or another account read.

- **2026-10-04** — **A Mate observes its application's stage and production through HQ**
  (parity 84, 260, 275; ADR 0003's boundary stands). `zerops_observe` uses the Mate's enrollment,
  never a sibling Zerops grant. HQ lists only environments of the Mate's current application that
  every active person able to operate that Mate may read. Permission facts are read for each call;
  an unavailable read refuses rather than taking stale permissions. Status and active-version
  metadata are projected from direct Zerops reads with the environment's checked deploy key;
  service logs are one bounded read, up to 100 entries of 4,096 characters each. Environment
  variables, raw platform records, deploy keys and signed log URLs stay in HQ. A failure ends the
  call and the agent asks again explicitly.
  - _Why:_ the removed sibling grants read unmarked secrets and need writes to keep them aligned.
    HQ now supplies the observation they previously enabled, without either property. A Mate's
    credential is shared by its terminal's operators, so it cannot inherit just one person's reach.
  - _Supersedes:_ only "later" in the 2026-10-02 HQ and own-project key rows. Their key scope and
    legacy-grant removal rules still stand.

- **2026-10-04** — **The projects page is one dense list, a row per project** (pass 39). A row's
  first line is the project's name and its Mates as faces with whole names (two named, then "+N"),
  with production's version only where production runs one. Its second line is the one thing that
  needs the person, as a sentence, with its one action at the row's right edge. Without that, it is
  a running Mate's step, a deploy or release on its way, or the newest fact. Nothing is drawn for
  "nothing" (no "None open", "Not set up", "Nothing waiting to release"). Preview, Rename, Add Mate,
  Add stage and Add production are in the row's ··· menu. Rows that need the person rise first,
  keeping the person's order within each group. A row holds the place it was last drawn while a
  Mate reconnects or a read is out (`rowRiseMemory.ts`). Where its changes are not known it says
  why: "HQ didn't answer", or "Needs Basic user access" where HQ's rule withholds them. Every row
  holds the reads of its stops (production and stages), opened or not; a stop whose read failed
  is named on the first line beside its one Again, and what HQ still holds of a project (a deletion
  under way, records left) stands beside its name. The page has one tab, and the containers
  outside a project are one folded group.
  **Supersedes:** of the 2026-09-24 _projects listing_ row, the _Next steps_ strip, the _Only a Mate
  so far_ tiles and `groupPlacementMemory.ts`. Creations drawn from their birth and the in-flight
  words stand.
  - _Why:_ the owner, 2026-10-04: "this projects page is insanely bad - ux, design, information
    density, everything". Names were cut to "Ru…" and "Experime…", every row repeated filler, and
    the strip repeated the rows' own actions.
- **2026-10-04** — **The home decides where it lands before it paints.** `homeDoor` answers
  _landing_, _wait_ or _projects_. The projects page shows when no Mate is counted and the Mates are
  settled, or when nothing will list them: no organization chosen, the grant failed, or the catalog
  failed. Once shown, it stays until a Mate is counted.
  - _Why:_ the owner: "when you go to mate.zerops.io it first redirect you to this page briefly for
    whatever reason then redirecting you elsewhere". A cold load painted the projects page from
    1.3 s to 2.7 s; it now never does.
- **2026-10-04** — **On a phone the composer is the screen's last thing; the menu opener stands in
  the top bar's corner,** below the status bar with the header. There is no edge swipe: it fights
  the system's back gesture in iOS Safari and on gesture-navigation Android.
  - _Why:_ the owner: "you can only open the left panel with something under the composer.. on
    mobile the composer should be the very last thing".
- **2026-10-04** — **A site opens only when the person asks.**
  - Picking Browser lists the Mate's sites (dev, stage, production, by role) above the agent's own
    browser.
  - The conversation's top bar lists them under _Sites_. A click opens a panel tab; the arrow, a
    middle click or a new-tab gesture opens a browser tab.
  - Diff opens on a Mate whose workspace is not one repository and shows its turns.
  - A snapshot skips untracked dependency trees (`node_modules`, `vendor`, `target`, virtualenvs).
  - _Why:_ the owner: "browser automatically opens all tabs, imo it shouldnt", "the diff tab hasn't
    been working / doing anything for ages". `node_modules` without a `.gitignore` blew the
    snapshot's path budget, so no turn was ever recorded.
- **2026-10-04** — **A helper is a run of its own.**
  - Each helper's calls reach the thread tagged with it: Claude's from its subagent snapshots,
    Codex's from a child's items. Other drivers keep the single row.
  - Its prompt and its whole report are kept.
  - A helper's row says what it does now and opens its own card in the right panel (its task, its
    run in the run card's own form, its report).
  - The Agents panel is a map: the Mate, its helpers, their helpers.
  - A helper's Zerops operations, background jobs and task list are its own, never the Mate's.
  - _Why:_ the owner: "there is no 'map' no hierarchy, no way to see inside (imo basically you should
    be able to open a 'working' card for each". The adapter had dropped every helper call, and a
    report was cut to 180 characters.
- **2026-10-04** — **A card keeps its work.**
  - A history page holds whole turns, as many as fit 1,000 of the Mate's rows.
  - Readings and updates that a later one supersedes don't count against the budget.
  - A helper's start rides with any page holding its later rows.
  - A fresh first page keeps the older turns the client holds when they connect to it.
  - The budgets read indexed columns (migration 057), never a payload.
  - _Why:_ in a 24-minute Bodhi run, 60% of 643 activities were readings and updates, so the
    500-row window held 19 minutes. 19 of 22 cards read "thought …" with no steps, and a settled card
    changed after the fact.
- **2026-10-04** — **The working card says what it does at a readable pace.**
  - Every state stands at least 1.2 s; a finished step holds its place until the next one;
    "Thinking" shows after a quiet.
  - The clock counts what the line shows; a wait on the person counts as a wait.
  - Steps read in words (`…/` for the agent's own temp folder, at most two lines of code).
  - A turn's background jobs live on the step that sent them, and its card ends with one line ("3
    background tasks: 1 running, 1 finished, 1 failed"), failures first. Counts only rise.
  - A job whose session is gone reads "didn't report back". After the turn, the band holds only jobs
    still running.
  - _Why:_ the owner: "the 'working' card is still not quite there", "the background tasks and their
    finishing", "expansions … with the same content repeated". Run 9 counted 285 line changes in 35
    min, a median 0.92 s each, and Bodhi's "N background tasks finished" row reached 68.
- **2026-10-04** — **A run card moves on one curve, and the conversation keeps its own end.**
  - **One curve:** everything the card moves on its own (heights, the run scroll's glide, a line's
    plop) takes 31% of what is left each frame. The speed is capped at 1.6 px/ms, and a late frame
    moves no further than an on-time one.
  - **Heights:** only the innermost box that changed eases its height.
  - **Arrivals:** rows enter one after another, 150 ms apart and down to 60 ms with a backlog. History
    drawn in above the reader enters at once.
  - **The end:** the conversation keeps its own end, judged from the scrolls it hears (LegendList's
    `maintainScrollAtEnd` is off), and leaves it only on a person's move up.
  - **Settles and openings:** a settle is one motion at a time: enter, glide, then fold. What a person
    opens glides into view above the composer.
  - **Snapping:** out of sight and under reduced motion, everything snaps.
  - _Why:_ the owner: "the agressive plop that's sometimes too much too fast to process, the
    non-animated height expansions, the sometimes weirdly acting scroll processes". Run 9 measured
    231 one-frame height changes and 83 unprovoked jumps; the desktop harness now shows 0 and 0–1.
    At 390 px a card still bounces when a tall step arrives (its 60svh cap), the first follow-up.
- **2026-10-04** — **0.13's rebuild keeps what 0.12.3 shipped (pass 40).** An audit checked 694 commits
  from 0.11.80 to 0.12.3 against 0.13.0, the release that replaced the Gitea backbone with HQ.
  - 534 kept every line. Of the other 160, most were kept or rebuilt on HQ; the Gitea plumbing went
    with Gitea.
  - Merge resolutions dropped two behaviours, and the rebuild reversed several on purpose. This pass
    restores both kinds on HQ, below.
  - Where 0.13 carries out an owner decision (D6, ADR 0003), the decision stands and only its fallout
    is fixed.
  - _Why:_ the owner: "we should fix everything, we have the knowhow of what we worked on".
- **2026-10-04** — **A Mate signed in once has arrived for good; one whose agent needs no sign-in has
  arrived once it is up** (`mateArrivingUntil`, `mateSignedInOnce`).
  - A sign-out, or HQ's saved signers before the live ones arrive, no longer brings back the waking
    face.
  - **Supersedes:** the current-signer-only arrival from the 0.12.2 port.
  - _Why:_ the waking face means "waiting on a first sign-in", and nothing else.
- **2026-10-04** — **A Mate's face follows one rule in the menu and on its project page**
  (`mateAwake`). It is awake when its container runs, its socket is up, or HQ has it online.
  - _Why:_ the port kept the rule in the menu only, so a running Mate looked asleep on its page
    whenever HQ's word wasn't live.
- **2026-10-04** — **`/` decides before it paints and lands nowhere dead** (`homeTarget`, `homeView`).
  - An empty organization, no chosen organization, and a failed catalog with no Mate named all land
    on the projects page, which offers the way on.
  - Only the organization in view lands. A cached registration whose socket is down never claims the
    landing.
  - A projects page once shown stays until the person acts.
  - **Supersedes:** upstream's "What should we work on?" hero as the empty-org home (deleted).
  - _Why:_ the hero's Add project led nowhere in Mate, and with no organization chosen `/` waited
    forever.
- **2026-10-04** — **A stopped Finish setup is said, then gone; nobody is let into a Mate before its
  project is closed off.**
  - On a Mate with its container, "Setup stopped" stands for 10 s. It never hides a connected Mate's
    sign-in line, amber dot or last message, and is still never retried on its own.
  - A Mate whose project HQ says is not closed off takes no lease and no Connect, even on screen,
    whatever its container's age. It reads "Closing off its project…" until HQ says it is closed
    off, with Finish setup in its menu — offered on HQ's word whenever its container's marker is not
    read absent, so a marker that cannot be read never leaves it without a way out. HQ's streamed word alone says closed off: no project tag,
    no clock (2026-10-05). While HQ says nothing, only this browser's own knowledge that its
    close-off has not happened holds it.
  - _Why:_ the stop hid a working Mate's state until reload, and leases had dropped 0.12.3's
    close-off gate, so an unisolated project could be used.
- **2026-10-04** — **Set up Mate is offered on an existing plain project, and a Mate's project keeps
  its owner's own tags.**
  - A project is plain on HQ's word alone (ADR 0002): HQ's structure is read and holds no record of
    it of any kind, no press of it either — running elsewhere or stopped — and the official HQ's
    anchor does not name it. Its tags and its age decide nothing. Set up Mate is offered where HQ
    offers writing its Mate's record (`create_mate_record`, streamed beside each project it holds
    nowhere), never on a client's own reading of the person's roles.
  - Set up Mate asks first, in the app's own dialog: what it adds, and that the project's services
    restart once while it is closed off.
  - Declaring a Mate adds `mate` beside the project's tags and drops only old `mate:*` ones; a rename
    puts every tag back.
  - **Supersedes:** "limit Mate setup to declared development environments", and "a project carries
    only the mate tag" (`project-metadata.md`).
  - _Why:_ an owner could no longer bring Mate into an existing project, and declaring or renaming a
    Mate wiped the project's own tags.
- **2026-10-04** — **Finish setup takes an old Mate key's sibling grants off; HQ says which keys still
  reach further.**
  - HQ records a key wider than its project at enrollment and on its credential (`keyWider`, HQ
    migration 0042). The Mate then offers Finish setup to whoever HQ offers its record
    (`edit_mate_record`). HQ tells them that key's id, and the harden sets the key to its own
    project alone by it (`planMateKey`, `foundBy: "id"`).
  - The client keeps no path for a Core older than that: the fleet's Cores are updated first, as
    an admin updates any Core from HQ's card (`ZeropsHqUpdate`).
  - `planMateKey` writes a Mate's key as exactly its own project at `BASIC_USER`. Found by its name,
    a key is a Mate's only with a single `ADMIN` or `BASIC_USER` grant on its own project and nothing
    else (`mateKeyReach`, shared by HQ and the client); any other `zcp-*` key is never narrowed, and a
    press mints a new one beside it (2026-10-05, the HQ-answers pass).
  - No load reads a token list.
  - **Supersedes in part:** the 2026-10-02 row's "taken off by hand", and the 2026-10-03 row's "a
    Mate HQ holds is never hardened", for widened keys only.
  - _Why:_ ADR 0003 (the owner). A `READ_ONLY` grant an earlier client left on production reads its
    secrets for anyone with the Mate's terminal.
- **2026-10-04** — **HQ's data reaches the client through its stream, and nothing is read while the
  tab is hidden.**
  - HQ's standing comes from the stream; its 30 s `/health` poll is gone. The stream also carries the
    recipe's Mate tier and HQ's own verdict on whether it could check Zerops.
  - `/health` is read only after a stream attempt failed, to say why: HQ down, a standby or an HQ
    that is not the official one, or one that cannot check Zerops right now. A stream that names no
    Core is an older Core: no health read stands in for it, and HQ's card, opened by an admin, reads
    the running Core from Zerops (its `hq` service's active app version) and offers the update on it
    (`ZeropsHqUpdate`).
  - While the stream is down, Add a Mate and the creation forms say the tier it said last and import
    none until it serves again; nothing reads the tier beside the stream.
  - A Mate's setup, and the day's re-read of a no-HQ verdict, wait for a shown tab.
  - _Why:_ the owner's rules: Zerops and HQ data through the store, never a fetch in a hook, no idle
    requests.
- **2026-10-04** — **Transient failures recover by themselves again, beside Try again** (the
  2026-10-05 rule below: "Automatic recovery is wanted; a clock standing in for an answer is not").
  - Covered: session checks, data cells, access grants, hydration (Retry-After on a 429), per-interest
    recovery, and metadata back-offs.
  - Retries are bounded in rate, not in count: each climbs one of the ladders `retryPolicy.ts` names
    and stays at its cap. They run only for what is held and pause while the tab is hidden.
  - A definitive refusal ends them with its manual again: a cell's decode, an access check's
    malformed answer, a 403/404.
  - **Supersedes:** "failed reads stay failed until the visible manual action"
    (`platform-data-architecture.md`).
  - _Why:_ a laptop waking before its Wi-Fi, or a 429, left pages failed until a click.
- **2026-10-04** — **Superseded 2026-10-05: nothing is carried over. A project's tags decide nothing
  (ADR 0002), and HQ already holds the signers its tag port moved off the tags, which zcp seeds an
  absent record from.** **An old Mate's signer is carried into its sign-in record once** (D6
  unchanged).
  - At the first start of this build, a login held then, and never named in `~/.mate/signed-in.json`,
    is recorded for the one person its `mate:signer:` tag or HQ's saved signer names.
  - It closes once both sources answer, and at the latest on the third start. A credential that
    appears later is never carried.
  - A credential already present at the update is taken to be the one its tag was written for: 0.12.3
    trusted the tag the same way.
  - _Why:_ 0.13 dropped the tag fallback, so a login made before the record began (v0.11.79) was
    refused for everyone, its signer too.
- **2026-10-04** — **A change's conversation holds its comments' room while it reads them** (HQ counts a
  change's comments), and **a stage HQ holds for a deploy key says that, never "coming up"**.
  - _Why:_ layout shift; and "coming up" for a stage nothing will bring up.
- **2026-10-04** — **Crew work carries on after a restart, from the stage it recorded.**
  - 0.13's operations persist their stage before each side effect. At boot the engine carries each
    interrupted one on from that stage:
    - a turn continues in its copy as its starter;
    - a checkpoint commits again;
    - a check merges and checks again;
    - a landing records the outcome its trailer already shows, or lands again as the person who
      pressed Land.
  - A waiting Allow goes out again at boot. A refused task starts again once a sign-in changes. In a
    run, a failed check goes back to its crewmate.
  - The boot sweeps the crew copies: a dirty copy is saved as a WIP commit, said in its crewmate's
    chat with its files, branch and commit (no side effect nobody sees, 2026-10-05), and a missing
    one comes back only when its branch, landings and tip prove nothing is lost.
  - Only an ambiguous resume waits for a person, with its reason: a rebuild a person chose, a task
    changed since, a resume admission refuses.
  - **Supersedes:** "crew work interrupted by a restart is shown and continued by a person, never
    repaired at boot".
  - _Why:_ a Mate update mid-run paused every crew until someone pressed Continue; the recorded
    stages make the resume safe.
- **2026-10-05** — **Automatic recovery is wanted; a clock standing in for an answer is not.**
  - **Wanted:** recovery with a clear logic — renewing a session, reconnecting, re-subscribing,
    re-reading, re-running an idempotent step after a transient failure (network, timeout, 5xx, the
    network coming back, a tab waking). Bounded in rate, not in count: a backoff up to a cap, then
    steady at the cap; visible ("reconnecting…" with "Try again now"); paused while nothing needs it.
    Only a definitive refusal ends it, visibly, with a manual "again".
  - **Not wanted:** a clock that stands in for the owner's answer ("30 minutes after a release, it has
    ended"; "20 s with nothing running, the deploy failed"); side effects nobody asked for and nobody
    sees (a timer that compares wanted with actual and quietly rewrites, deploys or deletes — what
    the Gitea backbone did); retrying a definitive refusal (rights, validation); repeating a
    non-idempotent side effect without first reading its own handle.
  - **Supersedes** the reading of 2026-10-03 that every automatic retry is wrong; passages that say
    "nothing retries" or "stays failed until the manual action" describe today's code, not the rule,
    and change with the code that restores a recovery.
  - _Why:_ the owner: "problém mám s automatickými opakováními jako třeba to, že se na FE nastavilo a
    čekalo, že něco proběhne do 30 min, nebo že se nějak magicky dělo historicky něco v Gitee. Ne to,
    že se něco automaticky opakuje a vyrovnává se stavem, který nějak vzniká, a je to jeho legitimní
    řešení, jako třeba že se automaticky obnoví session."
- **2026-10-05** — **HQ answers; the client draws** (the HQ-answers pass: what was left of the
  Gitea model — the client computing permissions and verdicts, structure in project tags, clocks
  standing in for answers — goes, each to the owner of its inputs).
  - **HQ answers what a person may do, in its stream.** `can` runs in HQ alone
    (`apps/hq/src/permissions.ts`); HQ streams a decision per verb beside the org, each application,
    environment and Mate (`offers.ts`, `hqOffers.ts`), over the target the write is enforced with.
    The client draws allowed, refused in HQ's words, unknown or unavailable, and decides nothing.
    _Why:_ one verdict has one owner. HQ holds the inputs — the org as it reads it, the target as it
    holds it — and enforces the write, so a client's copy could only offer what HQ then refused, and
    it read project access only to feed itself.
  - **A release ends with HQ's rollout.** On its way until HQ ends its rollout in every production;
    stalled only where HQ ended it without landing. _Why:_ the 30 min cutoff called a release over
    while HQ still followed its build, and offered _Release_ again.
  - **Coming up is HQ's birth of an environment**, or the platform making something of it — never
    its age. _Why:_ an environment's age says nothing about whether anyone is still bringing it up;
    HQ, which runs its first deploy, knows.
  - **A write that cannot be undone reads its roles fresh.** Merges, closes, releases, roll backs, a
    deploy asked again, a service added, deletions, a kept deploy token, moving, detaching and
    attaching are decided over roles read after they were asked; Zerops silent, HQ writes nothing
    and answers `zerops_unanswered`. _Why:_ a write nobody can take back must not stand on a view a
    lowered role has outdated.
  - **A Mate exists where HQ places it.** The bare `mate` tag is written for the Zerops GUI and read
    by nothing; a Mate's name is its project's. _Why:_ a marker on a project with no Mate made a
    Mate row, a _Set up Mate_ and a taken name.
  - **A press holds its project at HQ** while it runs, and a press that stopped keeps its record
    there. A press runs until Zerops accepted the container's import and the project is closed off;
    the minutes the container then takes to come up are the platform's, and another browser reads
    them from the container itself ("Coming up"), not from a hold. _Why:_ another browser could not
    tell a press still at work from one whose tab closed, and guessed by the project's age.
  - **A Mate update's outcome is the server it comes back as**, by version and boot id: another
    version is updated; the version it left on another boot did not take; the same boot is still
    updating. _Why:_ followed by version alone, a failed install waited for ever; followed by the
    container, it could say "Updated to" the version it left.
  - **No client clock stands in for an owner's answer**, by the 2026-10-05 recovery rule above. Gone
    with this pass: the first deploy's 20 s grace (HQ's job, or the build's Zerops process); a held
    verb's 30 s (HQ's answer, or HQ not answering); an update's 120 s verdict (its server; past the budget it only says it is taking longer); an address's
    2 min (its enable process); a first build's 30 min (its process); a deploy's 10 min cap (its
    build's end); a stand-up's quiet file (its zcp process by PID and start, and its turn); a Mate's
    retry cap kept across loads (the connection's own ladder, which a load starts over). Faces keep
    their own clocks: a pose is never a verdict.
- **2026-10-05** — **An application's environments are progressive: nothing, a stage, a production or
  both, in any order, and release exists only with a production.**
  - **Merge is a finished act.** It asks nothing further; an absent stage or production is never a
    dot, a count or a next step — a quiet slot with **Add** in the application's Environments section.
  - **Stage and production are peers.** "Add stage" and "Add production" everywhere, neither
    optional-labelled; a production needs no stage, a stage is never a gate.
  - **One question, once, at the moment of intent:** right after a person's own merge of the
    application's first code change (HQ's `firstCodeMerge`), when it has no production and the person
    may add an environment — "where should it run?" with the missing tiers and **Not now**. Never on
    reopen, never again.
  - **No production, no release:** no Review release, no waiting count, no rollback, no snapshot (the
    2026-10-04 snapshot exception is withdrawn; old snapshot rows stay as history). HQ refuses the
    verb for everyone.
  - **Adding a production is the intent to release:** it deploys nothing by itself — a production
    attached from now on follows only releases made after it (its release floor) — and the client
    hands over to the first release's review; the release is a person's press.
  - **Supersedes** the "matches main's broker" half of SPEC §3.3a's release rule (main let an org
    admin tag without a production): its "no release without production" half stands.
  - _Why:_ the owner: "kdyz ji nemam tak by to nic z toho delat nemelo dokud ji nepridam … snapshot by
    bez produkce nemel vzniknout"; "na poprve se zeptat jeslti chci tu produkci udelat … aby me to
    pokaze neotravovalo pri jakemkoliv mergi"; "mel bych umet pridat produkci bez stage … kdyz nic
    nemam tak bych mel mit moznost pridat bud stage, nebo rovnou produkci"; "UI a chovani ma byt
    nejak progresivni, umoznovat vsechny mozne situace, efektivne a jasne je resit a propisovat do
    ui".
- **2026-10-05** — **A merge ends its review, with a production too** (the owner, of _Review release_
  on a merged change: "after mergin, it directly opens release to prod (even when there is no
  prod).. and it shouldnt even when there is prod"). Completes "Merge is a finished act" above: with
  a production, a merged change still offered _Review release_ as its one button. It now says what it
  did and what waits for production, and offers nothing to press but the first merge's question; the
  release opens from its own doors — the menu row, the project's strip and page. This reverses the
  2026-09-29 hand-off (R6) for a change.
  - _Why:_ the button that merged turned, in the same place and under the same ⌘↵, into the way to
    production, so the second press of one gesture reached a different decision.
- **2026-10-05** — **The review's button never takes the focus.** The review opens with the focus on
  itself, and a button that turns safe later doesn't take it either; ⌘↵ presses the button while it
  is safe, as before. Replaces the focus half of the 2026-09-29 R5 rule ("The focus lands on it, and
  ⌘↵ presses it, only while it is safe"); decided by the lead under the owner's delegation ("take the
  best possible and the most recommended solution").
  - _Why:_ with the focus on a safe _Merge_, a plain Enter merged (found in pass 39, T6); ⌘↵ is the
    deliberate press, Enter is not.
- **2026-10-05** — **D10 (the owner): a new conversation starts on Extra High, wherever its model
  offers it.**
  - **Every new conversation:** a new Mate's first (the bootstrap thread and its stand-up) and every
    later one (a draft, a thread that never ran a turn), on the web and the phone. The drivers keep
    their own `isDefault` (Port zone untouched); the preference lives in `@t3tools/shared/zeropsEffort`.
  - **The rule:** the effort option (`effort`, `reasoningEffort`, `reasoning`, `variant`) takes
    `xhigh` by id; without it, the highest step below `max` on the ladder `none < minimal < low <
medium < high < xhigh` (a driver's own order does not rank: Grok reports its levels top first,
    OpenCode's come from an object's keys); no effort option, or nothing on the ladder, selects
    nothing; `max` never.
  - **What stays:** a conversation that has run keeps its effort, a person's own pick always wins,
    and crewmates keep their own rule (unset = the login's default).
  - **The remembered selection carries no effort** (the lead, under the owner's delegation): the
    last-used model and traits a new draft inherits drop the effort, since touching any trait
    remembers every value, the default effort included. A pick inside a draft or a conversation
    still wins there.
  - **The server applies it too:** a non-crew thread's first turn naming no effort (a phone task
    queued before the catalog arrived, the stand-up) runs on the preference, and the thread stores
    what its first turn ran on, so a reload reads it back.
  - _Why:_ the owner runs real work on Extra High — "at least extra high effort".
- **2026-10-05** — **HQ's standing is said in the menu's header, never above the list** (the owner,
  of "Last known · as of 8:35 PM · Updating…" above the Mates: "what is this layout shifting …
  here"). While HQ is read again or its stream reconnects, a spinner stands before the waiting
  faces, the whole line in its tooltip; once HQ does not answer, "HQ unavailable" stands there, with
  _Try again_ where it is offered. The boot menu drawn from memory says nothing of it. SPEC §6.2.3
  still holds: the menu says since when, and how old its rows are.
  - _Why:_ every reconnect and every reload pushed the whole menu down and back; syncing belongs in
    the header, and a reload paints nothing it takes back.
  - **2026-10-07 amendment (Mate 0.14.26):** During an outage after HQ has answered, the header says
    "HQ is not reachable — showing what it last said" and HQ facts are marked last-known, including
    the production chip's menu. The tooltip names when reachability was lost; _Try again_ remains
    where offered. Before any HQ answer the header says "HQ unavailable". A spinner alone cannot
    describe retained facts as current (`SidebarZeropsTree.tsx`, `SidebarProductionChip.logic.ts`).

- **2026-10-05** — **Every project of an application is named in full in Zerops; under its
  application the client shows a Mate or a stop by its own name** (the owner, of Aleš's report that
  a new Mate's project read only `Sage` in the organization's project list while older ones read
  `SPN - Rune`). A Mate's project is `<application> - <Mate>`, a stage's or a production's
  `<application> - stage` as before; New Mate, New project and _Rename Mate_ send the full name,
  the person types and sees only the Mate's own. Wherever a Mate or a stop is drawn with its
  application at hand, the exact `<application> - ` prefix is cut (`nameUnderApp`): a separator is
  required, so `Shopper - stage` under `Shop` stays whole, and a name without the prefix — a project
  renamed in Zerops, a moved Mate, a renamed application — is drawn whole. A Mate's name is unique
  and capped at 24 characters on its own part. The name's source stays Zerops; HQ still keeps none.
  Projects named before this were renamed once to the full form. **Supersedes** in the 2026-10-03
  D3 row: "a new Mate's project is named as the Mate is" and "no prefix is cut".
  - _Rule:_ renaming an application or moving a Mate renames its projects in Zerops. Each target is
    planned before anything is written, from the application's old name (`<old> - X` becomes
    `<new> - X`; a name without the old prefix is its own as a whole, so `Sage` becomes `<new> - Sage`),
    then HQ's write goes first — refused, nothing else happens — and the projects follow, the
    dialog or the move waiting for all of them. A project Zerops refuses is said with why and
    retried with the same targets, never planned again from the new name (`New - Old - Rune`).
    Leaving every application renames the project to the Mate's own name (`SPN - Rune` becomes
    `Rune`): in an application a project is `<application> - <Mate>`, outside any just `<Mate>`.
  - _Why:_ the organization's project list in Zerops is where the projects of every application
    stand side by side; without the prefix a Mate's project says nothing of whose it is.
- **2026-10-06** — **Every list of a Mate's changes reads D7 by one rule** (pass 43: the menu's rows
  hid a change's _Review_ while its Mate worked, the projects page did not). `changeShowsReview` —
  described at its head, and its Mate not working in any of its chats, a turn or helpers it
  started — is read by the menu's change rows, the projects page's change rows, the group's next
  step and the composer's top (`mateNextStep`; the composer gives way by its own hold, which keeps
  a dismissed strip remembered). A rule by HQ's `updatedAt` against the run's start was tried and
  dropped: a person's comment moves a change, a change the run will amend could be merged
  mid-edit, and two clocks would decide it.
  - _Why:_ 0fc8a2eca's D7 — "While the Mate works in any of its chats … its rows carry no Review,
    and the group's next step passes its changes by" — and the surfaces disagreed.
- **2026-10-06** — **A sign-in failure is the Mate's, said in its words** (F7: the reason read
  "Claude's sign-in has expired. Sign Claude in again, …" under Sage). Where a Mate is named, its
  sign-in failure reads "Sage is signed out of Claude. Sign in again to continue." — the Mate the
  subject, the agent only what the person signs in to; on the Mate's own menu row, under its name,
  "Signed out of Claude. Sign in again to continue." The driver's words stay the driver's
  (`apps/server/src/provider` is ported): the client recognises them (`signedOutAgent`: each agent
  driver's own sentence from its first word — Claude's "could not authenticate. For subscription
  login" and "'s sign-in has expired.", Antigravity's — and only the conversation's own driver's
  where it is known; Git's "could not authenticate with the remote" is no agent signed out) and
  says them (`mateErrorWords`) in the conversation's banner, the menu row and the jump box.
  - _Why:_ the adapter does not know the Mate's name, and the client does wherever it draws one.
- **2026-10-06** — **A helper is called what the Mate called it** (F6: the Mate's text said "the
  deep-sea builder", the card said the launch's task). Where a helper's launch gave it a name —
  Claude's Agent `name`, kept by the activity projection for an agent launch only — every place
  the card names that helper (its row, its band, the dock, its report's wake) reads the name;
  Codex's helpers were already named by their nickname or path. Where the launch named none, or
  aged out, the task's words stand as before. Cursor, Grok, Antigravity and OpenCode report no
  named helpers.
- **2026-10-07** — **Unavailable conversation images explain their failure and keep their place.**
  Supersedes N2's removal of missing result pictures. A missing workspace asset or attachment is
  unavailable immediately, with the owner's reason; a transient signing failure gets the bounded
  backoff schedule before becoming unavailable. Failed image requests or decoding also say
  "Image unavailable". The strip retains its tiles and count; an unavailable "+N" tile can still
  open later loaded pictures. Missing-file verdicts are no longer persisted in browser storage.
  Web and desktop share this behavior. Mobile already shows unavailable for signing and byte
  failures and has no run-result strip; no wire or provider contracts change. Workspace images
  remain references to their source files, including `/tmp`; this change cannot recover deleted bytes.
- **2026-10-06** — **A written or edited file's row opens onto what the agent wrote, and "Open in
  Files" shows a file it wrote outside the workspace as it wrote it** (D9, the owner: "Are these
  unclickable on purpose?", "Why can't this be opened in the Files tab?"). The row opens onto a
  write's content or an edit's new text, drawn from the call's own stored payload
  (`threads.fileWrites`): Claude Code's `Write` content and `Edit`/`MultiEdit` `new_string`s and
  `NotebookEdit` `new_source`, Codex's added files and the added lines of its updates, OpenCode's
  `write` content, `edit`/`multiedit` `newString`s and the added lines of its patches, and for an ACP agent (Cursor, Grok, Antigravity) the `new_string`, `newString` or `content` its call's raw input carries, else what its `diff` block adds over its old text, worked out on the server and cut to the characters that differ (`…db2…`): a line that stands unchanged in the old text is never shown as added, and a Codex or patch run that removes and adds the same line drops the pair. A change that only removes reads as a count ("Removed 3 lines"). The client's copy of a
  call carries only a mark that it wrote something; a call whose driver sent none keeps the row it
  had, and a running or failed write opens onto nothing. Each file's text stands in the card's own
  item box: in the log whole once opened, nothing scrolling inside (the 0.14.4 rule). "Open in
  Files" for a path inside the workspace opens the Files tab as before; for one outside, the
  read-only panel shows the thread's newest completed write of that path, labelled "As Sage wrote
  it at 01:23" (`threads.writtenFile`).
  - _Rule:_ what a reader sees is exactly what the agent wrote in its calls, from the thread's own
    record. Nothing is read from disk, and nothing the agent only read or found in a file is sent:
    never an edit's old text, a diff's removed or context lines, a patch's hunk headers, ACP's
    `oldText` or a deleted file's content.
    - Only a completed call wrote, as the server's own stored row says: a failed, declined or
      never-returned call counts for nothing.
    - The Files tab's path must equal exactly — untrimmed, in the form it was named — a path that a
      completed call of THIS thread wrote; another thread's writes count for nothing.
    - Both methods take `orchestration:read`, as `subscribeThread` does, and one answer carries at
      most 1 MiB of text.
  - _Why:_ a security review found that serving the file from disk cannot hold: an edit of one line
    of `~/.npmrc` or an outside `.env` would serve the token beside it, which the agent never wrote
    and readers never saw (a Read reaches them as an 84-character summary), and a renamed folder, a
    write through a shared mapping, a FUSE mount, a timing slack or another clock each put other
    content under the written name. The agent's own calls already reach every reader of the thread;
    showing those, and only those, discloses nothing new.
- **2026-10-07** — **A project's variables are its vault: Shared plus one per service, plain or
  sensitive, and who reads each is worked out from what is deployed** (the owner: "a single `vault`
  on both project and service level, with two sections … single add / edit, as well as multi edit
  … some clever way to then let mate know"; round 3 of the "Mate Vault Prototype", Quiet look and
  tools in the right panel taken as recommended). The Vault tab sits beside a Mate's conversation
  and a Vault column beside a stage or production page. Sensitive is write-only; a write always
  carries `sensitive`. Readers come from the deployed run entries (a deploy activates references, a
  restart values); a value nothing references reads "nothing reads it yet". The Mate hears the
  person's changes with the next message as a note of keys and what each needs, never a value; the
  composer shows a chip per change. Edit as text applies one write per value after a review.
  - _Why:_ "you need deploy to activate the zerops.yml reference / when the vault value changes,
    you need to restart the services … but you don't really know which reference it" — the
    platform does not know who reads a value, so Mate reads it off each service's deployed entries;
    and a value typed into the chat would reach the model, so a value goes only to the vault.
