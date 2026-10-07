# Design system — the working spec

Dated ledger file, one writer (the orchestrator of the UI foundations programme). It holds what
a client slice needs and no spec section states yet: the component vocabulary (anatomy · states
· phrase source), the copy glossary, the icon map, the machine-checked rules with their tests,
and the exception ledgers. A decision promotes to `../../../../zcp/docs/spec-mate.md` ("client
design system" section) when the programme lands; a measured fact goes to `verified.md`. This
file is the step between; the dated decisions it took live in `design-decisions.md`.

Started 2026-08-30 (F0). Nothing visual is decided here — a surface's anatomy lands in its entry
when the owner fixes its flow, through the surface-round loop. A field an entry leaves out is open.

## 1. Vocabulary

Fixed by the accepted principles (concept P1–P8): depth by tint, one `MicroLabel`, `StatusDot` +
word (never a bare dot), pills and chips, blue acts / teal identifies, native containers on
mobile. Everything else in a row is filled by the slice that builds it.

- **`StatusDot`** — web · mobile
  - _Anatomy (fixed part):_ one glyph in a status tone, never rendered without its word beside it;
    the word's hand is the word's own — a state's name in a card or a panel is a `MicroLabel`, a
    state a person is meant to read in a list row or a panel's verdict is `sentence`, and a row too
    narrow for either is `dotOnly` with the word as its accessible name; a surface never re-cases
    what `client-runtime` wrote (R5); in-flight = the stepped `status-pulse`, never an `infinite`
    opacity loop
  - _States:_ ok · busy (pulse) · attention · failed · off
  - _Phrase source:_ tone id from `brand.ts` status tones; the word from the consumer's phrase
    function
  - _Lands:_ F5b
- **`MicroLabel`** — web · mobile
  - _Anatomy (fixed part):_ 10 px / 600 / uppercase / .06em / 45 % (11 px on mobile)
  - _Lands:_ F5b
- **`Chip`** — web · mobile
  - _Anatomy (fixed part):_ 10 px text, tint from `brand.ts` chip tints, radius 10 (info-chip 8)
  - _Lands:_ F5b
- **`Pill`** — web · mobile
  - _Anatomy (fixed part):_ the CTA shape for primary/secondary buttons; ghost and icon buttons keep
    8 px
  - _Lands:_ F5b
- **`FlatCard`** — web · mobile
  - _Anatomy (fixed part):_ flat and borderless in light, 1 px `rgba(255,255,255,.06)` in dark;
    shadows only on popovers/dialogs
  - _Lands:_ F5b
- **`MintPanel`** — web · mobile
  - _Anatomy (fixed part):_ the zcp row under Infrastructure — the Mate's home: the service card's
    two lines, then `(face) Fen lives here` and, under the name, the Mate's `Server x.y.z · x.y.z
available` line with its Update — outside the hover pop; the coding agents' card grows out of
    its bottom edge
  - _Lands:_ F5b
- **`ProcessSteps`** — web · mobile
  - _Anatomy (fixed part):_ `default` (a process timeline — birth, creation, agent sign-in): `30px
1fr` grid, 17 px step glyphs in 2 px-bordered circles, the state on its own line as a
    `MicroLabel`; `compact` (results inside a card): the card's one mark per state (`StepGlyph`),
    the label at 13 px with the state after it in muted sentence case, the time `4s` / `1m 12s` at
    12 px, 4 px between rows
  - _States:_ queued · running · done · failed
  - _Lands:_ F5b
- **`KeyChip`** — web
  - _Anatomy (fixed part):_ key glyph, radius 3
  - _Lands:_ F5b
- **`LivenessLine`** — web · mobile
  - _Anatomy (fixed part):_ one line under a feed header
  - _States:_ live · recovering · doorbell down · last read failed · absent (renders nothing)
  - _Phrase source:_ topology availability (`serviceMap`), see spec-mate §5.1 tri-state
  - _Lands:_ F5b
- **`LifecycleBand`** — web · mobile
  - _Anatomy (fixed part):_ one quiet line in the timeline's column (`max-w-3xl`, 32 px), painting
    nothing across the page: a `StatusDot` in sentence form + "Coding agent sign-in required" + a
    chevron; shown only when no agent is authorized over a conversation the agent has worked in (a
    lifecycle exists) and the map is closed; the lifecycle phase itself is no longer written here —
    the timeline's cards and the map carry it
  - _States:_ an empty conversation asks in its own empty state (`ZeropsMateEmptyState`)
  - _Phrase source:_ `client-runtime/zerops/strip.ts`
  - _Lands:_ surface round
- **`ServiceRow`** — web · mobile
  - _Anatomy (fixed part):_ one small card per service, read as the dashboard's: `StatusDot` + word
    on top, then the name on a line of its own (ellipsis only when the card is narrower than it; the
    hover pop names it whole) and its ports + what it is on a wrapping line (`:3000, :3001 Node.js
22`, the service's own port first, `zeropsTypeShort`), one 28 px outline button per public route
    at the card's right (the host as its label) — beyond two routes, the main route's button and one
    **Open ▾** menu naming each route by port and whose app answers (`:3000 · the service's own`,
    `:3001 · Backend's app`); then the three resources — `CORES 1 ▁▂ · RAM 1 GB ▁▂ · DISK 1 GB ▁▂` —
    a `MicroLabel`, the allocation figure (12 px/500, unit muted), a 48 × 14 inline graph of the
    last day's use (monotone curve, fade fill, end dot, `--info`); `Skeleton`s hold the line until
    the reads answer, and a service holding nothing (not deployed, stopped) is one line; the whole
    card is a hover pop's trigger holding the dashboard link, the meta line, routes, used /
    allocated with the autoscaling range beside each figure (`1 – 3 · Shared`, `1 – 6 GB`, `stays at
1`; the envelope alone for a service holding nothing yet); a stage service folds under a
    hairline into its dev's card and reads exactly like it — the same status word over the name, its
    own `:port`, `stage` where the type would be, its route buttons and its own three resources; the
    zcp row is the `MintPanel` and the Mate's home — under its resources `(face, 20 px, the
conversation's state) Fen lives here` (`ZeropsMateOnMap`, from the panel), and the coding
    agents' card (`ZeropsAgentAuthCard`) is slotted into its bottom edge: the mint runs 12 px on
    under the card, the card is inset 12 px from its sides (`[data-zerops-agent-auth-tray]`), and it
    is outside the hover pop's trigger; without a control plane to grow from, the card stands alone
    under a _Coding agents_ label
  - _States:_ settled statuses + `transient`
  - _Phrase source:_ `brand.ts` status table (platform status → tone)
  - _Lands:_ surface round
- **`ZeropsCard`** — web · mobile
  - _Anatomy (fixed part):_ one shell per **operation** folded by `client-runtime/zerops/model`
    (identity = the provider's own `toolCallId`, never a transcript accident; key `op:<toolCallId>`
    per call, `bootstrap:<founderCallId>` per session, never re-keyed; the timeline row id is
    `zerops:<key>`): one quiet surface, no tinted band and no inner rules (2026-09-23, the owner:
    the three-zone card read as a wall of boxes). One header row, two forms: a card that names one
    service or page (deploy · verify · subdomain · browser · logs · delete · scale · manage · env ·
    devServer, `operation/subject.ts`) leads with a kind glyph, then `StatusDot` whose word is the
    verb as a `MicroLabel` (Checking/Checked · Deploying/Deployed · Starting/Running · Healthy …,
    the phrase producer's), then the subject — the hostname in a neutral chip (muted surface,
    foreground text; a service is inside the product, and teal identifies only the product) plus a
    browser page's path in mono, held at its height by a static placeholder until the input names
    the target; every other kind, a batch deploy among them, leads with the glyph and the voice line
    and, at its right, `StatusDot` + word in sentence form. The right end of either row carries the
    duration in tabular figures; the kicker is only the steps' accessible name. Padding 12/14 px, 8
    px between rows; under the line that names it — its status bar in the Mate at work, its step in
    an opened log — a card is its body alone (`headless`), under that line's words. The body is born
    in its final shape and only fills in: a deploy's pipeline reads the way the Zerops GUI reads it
    (`activity/pipelineReadout.ts`) — one row per step the pipeline really has — `StepGlyph`, the
    GUI's sentence ("Running build commands from zerops.yml") at 13 px, the running or failed one in
    the ink, a finished one muted, one to come fainter, and the step's duration — "Calculating steps
    from zerops.yml" before the platform knows them, the header carrying the deploy's own word
    ("Deploying", "Deployed", "Failed") and its time, the pipeline's own once it read one; an
    import's pipeline is one row of equal-width segments, its slots held from birth; a batch deploy
    one segment per target; a verify's checks one wrapping row of chips (✓/✗ in tone, the check's
    name and its result, "HTTP internal 200"), the failed ones listed under it; a result-line kind
    (devServer · manage · delete · scale · env) draws its step only when it failed; secondary
    platform processes as `Other activity` rows; the build log — nothing until the build wrote a
    line, then its newest two under the build step and "Build log · N lines" opening every line in a
    dialog — and a provenance line only while Zerops is not answering ("Zerops isn't answering ·
    last update 2m ago"); a quiet feed that still observes is current; a read card's body — log
    lines, event rows, process steps, discover cells — drawn empty while it runs. A browser check
    puts its thumbnail at the left (200 px, 168 px in a narrow card, stacked above the header only
    under 22rem), reserved at the viewport the call's commands set (16:9 until they name one), a
    static tint while empty, the live frame while it runs, the screenshot once settled — a click or
    Enter opens it large, an empty frame opens the Browser panel; at its right the header, one
    figures line (`1440×900 · 7 steps · 0 errors`, the error tone once there are errors or failed
    requests) and a `Show steps` link. What a result adds late appends below all of it: the
    explanation block (reason and the last six log lines, earlier ones behind a disclosure) of a
    failed or timed-out card; then one quiet row with the closing line (a passed verify and a
    browser check say none — their chips and figures do), the `Version` and the URL chips; only a
    failed card carries an edge, `--zerops-status-failed` at 35 %. Mobile still draws the tinted
    header
  - _States:_ kinds bootstrap · deploy · import · mount · verify · subdomain · delete · scale ·
    manage · env · devServer · browser · logs · events · process · discover · error; phases running
    · done · failed · declined · stopped · interrupted · reset · uncertain; every call is a card of
    its own — a same-turn retry never folds into the card it retries (R8 dropped 2026-09-25) —
    though where a card shows is the conversation's: a failure where it failed, the rest in the log
    and the outcome (2026-09-26); no card carries an attempt number (R9 dropped 2026-09-25); a read
    card (logs · events · process · discover) folds with its settled turn's work, an outcome card
    never does; an undecoded result keeps the shell with neutral words (its raw text was the
    agent's, and the Details disclosure is gone, 2026-09-26)
  - _Phrase source:_ the reducer's phrase producer (`operations/phrases.ts`); `voice` = the
    bootstrap session's `intent` verbatim, every other kind the phrase producer
  - _Lands:_ landed (`feat/session-model`, 2026-09-05) — strip, map and this card all read one
    `deriveZeropsThreadModel`; anatomy reconciled with the live-turn cards 2026-09-25
- **`QuestionCard`** — web · mobile
  - _Lands:_ surface round
- **`CredentialCard`** — web · mobile
  - _Lands:_ surface round
- **Conversation turn** — web
  - _Anatomy (fixed part):_ the person's messages, on the page in the order they were sent; the
    run's card, the Mate's own surface — what it said and did while it worked, the question it asked
    with the person's answer under it, what runs alongside while it works, its now line and, once it
    is over, its result — under the words that started the run; then the answer. A message the
    person sent into a running run stands on the page above the card, and in the card as one line
    where it reached the Mate. A message sent before the Mate did anything has the card follow under
    it. A message the person sent is never merged, moved or restyled; the page above the live part
    only grows at its bottom, and so does the card's chat — a line only ever joins at its end, and
    one folds only out of sight — and a settling run may re-form its card — a run that only composed
    gives way to its answer once the answer is known (a property test and a replay of three real
    threads hold it). A turn is one group: 24 px ink to ink between the person's words, the card and
    the answer, and 64 px between turns; the answer's room is the same whatever the card ends on, so
    it stands still as the card settles; a run of the person's messages stays close (`rowGap`:
    `part`, `part-words`, `turn`, `turn-after-words`, `tight`). `conversation.logic.ts` derives the
    structure, `MessagesTimeline.logic.ts` the rows and their rhythm
- **`RunLine`** — web
  - _Anatomy (fixed part):_ the line of a run with no chat to end on — one that only asked for a
    plan's approval, or paused before it did anything: the now line alone (`NowLine`), its face, and
    who worked for how long ("Juno thought 12s", "Juno stopped at the usage limit after 45s"). It
    keeps the tray's geometry in a frame nobody sees (`.run-tray-ghost`), so a tray drawn around it
    later never moves its words. A line with nothing under it is no card
- **`RunChat`** — web
  - _Anatomy (fixed part):_ a run's chat, the whole of its card, the same while it works and after
    it: a quiet tray one small step above the canvas (`--run-tray`) with a 1 px edge of 7 % ink, 34
    px round with 16 px of room around its 18 px bubbles, 15 inside its 1 px ring (S4) — never
    white: the composer keeps the only white (S5); one grid (K1): a 28 px column of marks, the words
    8 px after it, and times, chevrons and the clock on one right edge 26 px in. Its lines stand 12
    px apart in the order things happened, in five weights (K14), strongest first: the live slot at
    its foot while it runs (`LiveSlot`), the worked line once it is over (`NowLine`); what the Mate said, 14 px bubbles in its tint at 17 % (`.run-speech`, a
    crewmate in its own) with its face as their mark; what the person said, their neutral bubble on
    their side — an answer to its question whole, 6 px under the question, a message sent into the
    run one line; what it did, compact 13 px rows in a 9 % outline, a run of calls one card with
    hairlines between (`CallGroup`), each led by its kind's 16 px mark; what it thought, the
    quietest, 13 px faint italics on a 3 % fill, four lines read from its head and "Show full
    thought" past them. A control that opens is drawn only when what it opens shows something not
    already on screen (`opensOnto`, one table-driven test, a row per control): a read, a search for
    a pattern, a one-file edit, a command that printed nothing, one check with no picture, a helper
    whose report is its state word, a to-do list of the one step its line names, a picture whose
    file is gone — each is the whole of itself, no chevron. A failure wears a red mark and "Failed" while it is still
    broken and turns quiet once a later step undid it — the same command or the same words passing,
    a deploy of the same service going through (`recoveredFailures`) — never a pink row (K9); what
    merely happened (a context condensed, a change landed) is a caption between hairlines. Closed,
    the card is its summary line; open, one scroll holds every line (`RunScroll`, `.run-scroll`): at
    most 560 px or 60 % of the window — while the run goes on, the history and the live slot share
    that height once the card holds it, so its outer box stands still and a slot that grows takes
    its room from the history (`[data-run-live]`) — opening at its foot, following what arrives while it stands
    there and staying where the person scrolled or opened something once they leave it
    (`standsAtFoot`); a long run opens on its newest 40 lines and draws 200 more at a time as the
    scroll comes within 480 px of its top, the lines in view kept still (`reachesEarlier`); a 24 px
    fade at an edge says there is more past it. Inside it nothing is cut without a way to the rest
    (D4): a command folds at four lines and what it printed at twelve behind "Show all N lines", a
    thought past four lines opens on "Show full thought", a message of the Mate's past eight lines or
    600 characters folds behind "Show full message", live and in the history alike, so a plop never
    resizes a row; each opens in place under the control, which stays where it was pressed. A live
    run's scroll stands over its live slot, a hairline between. As the run settles the scroll folds shut into the line —
    360 ms on the drawer's curve, the newest lines and the hairline the last to go, fading as it
    closes — while the line keeps its place in the list and becomes the summary, the result arriving
    under it; a person reading the work right then (scrolled up in it, or something in it opened)
    keeps it open until they leave or it is drawn again, and a run that settled out of sight, or any
    run under reduced motion, is simply folded (`runFoldOf`). Folded, its worked line stands alone,
    "Show work" easing the scroll open under a hairline over 220 ms. Only what arrives while the
    person watches rises in
- **`LiveSlot`** — web
  - _Anatomy (fixed part):_ the run's card's foot while the run goes on (pass 35, replacing the
    one-line now line): what the Mate is doing this moment, drawn whole as the row it becomes in
    the history — the same bubble, inks and caps (a command's code at four lines, a thought at four,
    a message at eight) — 16 px of room and a hairline under the history, its rows 16 px under it.
    Three things differ from the row: the Mate's face stands in the 28 px column on the first row's
    first line (turning, looking up while it thinks and down while it writes, its "o" while it waits
    on the person); a call's words carry a sweep while it runs; the run's one clock stands on the
    first line's right edge, m:ss in ink (K3, S3), still while it waits on the person — a row gets
    its time when it lands, and the slot wears no chevron; a row it cuts draws "Show all N lines" or
    "Show full message" as the history does (a command that says nothing of itself stands open to
    its four-line cap), and what the person opened is kept by the line's key, so the row lands as it
    stood. What it holds is the newest batch's open calls, operations among them (`stretchBatch`,
    the batch rule over the whole run: a batch is one model response, named on each call's start
    (`responseId`); a call of a newer response puts an older response's open call behind it, stale,
    never shown, and closed as "No result" — never as done — when the run is over, even where the
    turn's end closed it (`unreturned`); the thread's provider says how a call that names no
    response reads: Claude's (an older server, a helper's call) never goes stale, a provider that
    never names one (Codex) keeps the timing rule — a call started after another returned opens the
    newer batch, and a call seen only as it ended opens none); else the Mate's words as they stream
    (a thought as the thought, its newest four lines with a fade at the top; its answer as
    "Writing"); else what it waits on from the person (a question in its own words, the answer
    rising in under it; for an approval, the call it asks to run, the controls staying in the
    composer); else "Thinking", muted, its word 300 ms late — never on the slot's first draw — so a
    quick gap never flashes it. Several at once are a row each, three at most, then "+N more
    running", counting what runs past the rows drawn. An operation stands here only while the call
    that started it is open: a stand-up whose call returned runs on in the band while its report
    says a service builds — counting only builds made before its call returned, read only while its
    turn runs, joining the band only once its project is read — until the store reads them done
    (`standupRunsOn`, `useStandupsDone`); a bootstrap session's line stays where it first returned,
    and the follow-up call it waits on stands in the slot as a line of its own. Two calls that fold
    into one line (edits in a row) fold only once the second lands: until then the slot draws it as
    it ended and the history the first alone. What a resync brings never rises in. What enters
    after the slot's first draw rises in, and the history glides as the slot grows; the face and
    the clock follow the first line only once placed. An item leaves as it ends once
    shown 800 ms (a question 800 ms after its answer), and plops into the history: a translate on
    the strong ease-out with a 1.5 px settle over 340 ms, its kind's mark fading in where the face
    stood, the history's lines in view gliding where it moved them; under reduced motion it fades
    in, in place. What starts and ends while an ended item stands never takes the slot: it joins
    the history in that item's plop, so the slot is never more than 800 ms behind the Mate (the
    board measured 0.7 s, against 4.7 s for a queue). What the record held when the slot was first
    drawn is history at once, and so is what a resync brings (`slotResync`): a reload never plops.
    A landing starts where things showed — a plop or a glide in flight is taken over from where it
    shows, a row that stays in the slot keeps its place in it, and one heard right after a draw
    starts from what was painted before it. Once full the card's outer box stands still; on a
    short page it holds the slot whole once the history has no room left. One status span tells a
    screen reader its
    words. Every state plays in the harness at `/design-live.html` (`?script=main|burst|stale|band|long`,
    `?at=<s>`, `?speed=<x>`, `?theme=dark`)
  - _States:_ a call · several calls · an operation it waits on · a thought streaming · a question
    waiting · an item that ended, standing its minimum · thinking · writing · waiting for an
    approval · condensing the context
  - _Phrase source:_ `runCard.logic.ts` (`slotModelOf`, `nowLineOf`, `nowLineWords`,
    `nowLineFace`); `liveSlot.logic.ts` (`slotOffer`, `slotSettle`, `slotHoldsIn`);
    `MessagesTimeline.logic.ts` (`stretchBatch`, `liveActivity`); `@t3tools/shared/liveBatch`
  - _Lands:_ pass 35
- **`NowLine`** — web
  - _Anatomy (fixed part):_ the card's foot once the run is over — the worked line — and the line
    of a run with no chat to end on (`RunLine`): 16 px and a hairline under the chat, a 44 px line
    whose words stand 20 px from the hairline and 20 px from whatever is under them, its face
    centred in the card's 28 px column, the words in 14 px. The worked line: the face as the run
    left it, "Nova worked 1m 20s" and what the effort came to ("· 2 commands · 1 file read",
    "merged as #2 · …") — heading the card once its work has folded, with "Show work" and "Hide
    work" on the right edge (drawn only when the work shows something), its words 20 px under the
    card's top edge and no hairline over them; at the foot of one a person keeps open to read. A run
    with no chat says "Thinking", "Waiting for your approval" or "Condensing the context" here, with
    the run's one clock; its words change in place, rising in over 180 ms. It never opens
  - _States:_ worked · thinking · waiting for an approval · condensing the context
  - _Phrase source:_ `runCard.logic.ts` (`nowLineOf`, `nowLineWords`, `nowLineFace`, `workedWords`,
    `formatClock`); `runResult.logic.ts` (`runEffortWords`)
  - _Lands:_ landed 2026-09-29 (pass 16); centred, its face 20 px, 2026-09-29 (pass 18); the live
    line became the live slot, pass 35
- **`ConversationWorking`** — web
  - _Anatomy (fixed part):_ the band: what runs because of the Mate without the Mate waiting on it,
    under its chat, on a hairline band in the card's grid — only what runs now (pass 35): a deploy,
    import or stand-up whose call returned and runs on (one the Mate waits on is the live slot's),
    helpers at work, background tasks, the to-do list in progress, a service in trouble. A bar that
    ends shows how it ended for 800 ms, then its room eases shut (`useEndingsHeld`); a failure is
    told once, as its row in the record, red until a later step undoes it, and the result lists
    what is still broken. A status bar per thing — a deploy (a segment per
    step of its pipeline, the running one said in the Zerops GUI's sentence), a service in trouble,
    the to-do list, the helpers, the background tasks (a command sent to the background; a task
    tracking a command the Mate waits on is that command's step, never a bar) — its name one column
    in, its bar in its state's tones, where it is in words, and a figure (a time, a count) on the
    card's right edge; no icon: its name says what it is. Each running thing ticks in one place: its
    bar, or the live slot's clock. A bar with more behind it opens it in place — the Background bar
    only past one task, a deploy only once its card has steps, a log or a reason (`opensOnto`) — under it (a deploy's card
    headless with its build log, the list, each helper, each task), a chevron after its figure;
    closing it gives the room back, and the bar pressed stays where it is; a bar that no longer opens
    closes with its chevron (`standsOpen`). A batch deploy is a bar per service
    (`splitBatchDeploy`). A check in the browser is no bar: while it runs it is the live slot's, and
    it lands in the chat as its row. Only what arrives after it was first drawn
    animates. It only grows while live; settling turns it into the result. After the turn, while
    work runs on (a helper, a background task, a watch loop), `ConversationAfterWork` keeps the bars
    at the conversation's bottom in a tray of the card's shape — a now line with its face and "Still
    working in the background" or "Watching in the background", and Stop. Every state stands side by
    side in the fixture harness at `/design-working.html` (`?theme=dark`)
- **`MateProse`** — web
  - _Anatomy (fixed part):_ the Mate's words on the page, in its answer's prose — never a bubble,
    never its face: its answer, and the last words of a run that ended without one. What it said
    during a run — a note, a question it asked — is the card's, a bubble in its tint beside its
    face, the person's answer under the question
- **`TurnReport`** — web
  - _Anatomy (fixed part):_ what a finished run left, as its result: inside the tray, a hairline 16
    px under the worked line and 6 px of room, then rows in the card's grid (`ResultRow`), most
    important first — anything still broken, then what waits for the person (its change to review, a
    crew task's work to add to the Mate's code, what did not go through, a step of its plan it
    left), then what runs because of the run with its checks attached (K5). Not pills and not a log:
    a failure it came back from, a retry, and what its calls came to are the work's, behind "Show
    work" (K6, K9). Each row follows the real thing: a change merged leaves, and the worked line
    says "merged as #2"; a service a later run deployed, started, stopped or removed, a change
    pushed to again or a page checked again is that run's row; a service the platform says stopped
    or failed since turns red with its fix; a row the person's next words answered leaves. A run
    that left nothing draws no band. The rows rise in once, 6 px over 320 ms and 40 ms apart, when
    the run finished while the person watched (T5); a row that turns up or moves later never rises,
    and a reload draws them in place
- **`ResultRow`** — web
  - _Anatomy (fixed part):_ one thing a run left, in the card's grid (28 px, the words, an end
    column; 8 px apart, 14 px short of the right edge): the mark in the 28 px column — an 8 px dot
    in its state's tone (green running or passed, amber waiting or not through), a red ▲ for still
    broken, the pull-request or crew glyph muted for a change or a task; the words one column in at
    14/20 — "appdev · Dev server running", "#2 Add a /status page", "Build failing · 3 type errors
    in session.ts" — and, under them where there is one, a 13/18 tabular line ("3 files · +45 −3",
    "Since 23:10", a version in mono); on the right edge one blue text action — _Review_ on a change
    or a crew task (R1), "Ask Nova to fix it" on a broken or not-done row, to the run's own Mate
    while it is the person's (S6) — or a 24 px way to open what it runs. Under the rows, 20 px down,
    the run's pictures in one strip — each page's last check and every picture the Mate looked at,
    at one height (96 px), each tile its picture's own shape (a phone narrow, a desktop wide;
    clamped to 0.45–2.4, showing its top past that), the shape known before its bytes (the
    screenshot's size, else the check's viewport or device, else the workspace file's size from the
    asset read), wrapping as the column needs, six at most, the sixth "+N", radius 12, a click
    opening them all in the viewer; a check with no address is no row. "3 files" opens this run's
    own diff. A broken row leads with its fix and carries no link to what is down. 34 px on one
    line, 53 on two
  - _States:_ broken (a build failing, a deploy failed, not healthy, a dev server not running,
    stopped or failed since, a check that stayed failed) · waiting (a change, a crew task's work
    ready to go in, not done, did not go through) · running (a service, its checks passed)
  - _Phrase source:_ `runResult.logic.ts` (`resultRows`, each broken row's problem);
    `runResultFacts.ts`; `fixMates.ts`
  - _Lands:_ landed 2026-09-29 (pass 16)
- **`StatusBar`** — web
  - _Anatomy (fixed part):_ a status bar per thing that runs alongside the Mate at work — a deploy's
    pipeline, a task list, the helpers, the background tasks: a segment per step, task, helper or
    background task, each in its state's tone, a running one stepped; a segment changes its colour
    in place as its step moves on, and the bar never moves
- **`WorkStep`** — web
  - _Anatomy (fixed part):_ one call of the Mate's, a row of the card of calls — drawn whole in the
    live slot while it runs, plopping into the history once it returned and stood its minimum: 13 px, its kind's 16 px mark in the card's column, its time
    and, where it opens something, a chevron on the right edge. A command says what it is for — the
    call's own description (Claude Code writes one for every command) — then the code in mono, its
    shell wrapper (only where the quoted command is the whole call), its `cd … &&` and `NAME=…;`
    preamble dropped, folded past its fourth line behind "Show all N lines"; a command with no
    description (every Codex command) is its code alone, as its title (K4). Anything else is one
    line said plainly in parts (`StepPhrase`: the verb in the muted ink, the names it took in mono
    at full ink with no chip — "Read `page.tsx`", "Edited `a.ts` and `b.ts`", "Searched the code for
    `…`", "Read `example.com/docs`"); a code search in a folder reads as a search, never an edit; a
    picture it looked at is the picture, opening the picture viewer. A failed call wears the red
    mark and "Failed" by its time while it is still broken, the muted mark once a later step undid
    it. What it printed or returned opens under it, folded past twelve lines behind "Show all N
    lines". It opens only onto more than its line says: a read, a search for a pattern alone, a
    one-file edit and a command that printed nothing are the whole of themselves (`stepOutput`); an
    edit of several files opens onto them, a search in a folder onto where it looked. A call that
    never returned — its completion lost, a newer batch started — joins the record where it went
    stale, with no time, in the past tense, and says "No result" once the run settles
    (`noResult`); a stale operation joins where it went stale too. A call still running never folds
    into the step before it. In the history a
    step still running says "Running" where its time will stand; the slot holds the one clock. A command the runtime tracks as a task is that step — the task lends it its words and its
    end and is no bubble or bar of its own; looks at pictures and edits one after another fold into
    one step ("4 edits")
- **`StepGlyph`** — web
  - _Anatomy (fixed part):_ a step's state as one 14 px mark wherever steps are listed — a deploy's
    pipeline, a card's compact steps, a batch's segments: a ring, what is inside it saying the state
    — empty waiting (`status-off`), a dot running (`status-busy`, stepping — the strongest), a check
    done (`status-ok`), a cross failed, a dash stopped
  - _States:_ waiting · running · done · failed · stopped
  - _Lands:_ landed 2026-09-27
- **`BrowserStrip`** — web
  - _Anatomy (fixed part):_ the browser as a stage, 288 px from its first check: the page in the
    frame of the device it was checked on (a window with the path in its address bar · a tablet · a
    phone — from the emulated device, the viewport, or the picture's own size), the take after;
    beside it what is checked on what and a row per take (a device-shaped thumbnail, the device, the
    page, how long, ✓/✗), a picked take taking the stage; a narrow column puts a caption over the
    frame; opened under its check's row in the chat, which carries the takes itself ("Checked
    /status in the browser" and the pictures), while the now line says a check that still runs
- **Service in trouble** — web
  - _Anatomy (fixed part):_ a service that stopped answering: a bar while the run goes on, a line of
    the chat where it happened (its mark in its tone, the host, its phases in order), and — while it
    still does not answer when the run ends — a broken row of the result with its fix; one that came
    back is the work's, never the result's
- **`PauseBlock`** — web
  - _Anatomy (fixed part):_ a usage limit, once per run of refusals: the attention surface while it
    holds ("Paused · Claude usage limit", the reset and the wait, the resume switch), the same block
    gone quiet at the same height once the Mate picked up ("picked up again yesterday at 10:25 PM");
    later refusals fold in as "N more attempts", and the server's own error row for the limit is the
    pause's to tell
- **`MessageReceipt`** — web
  - _Anatomy (fixed part):_ a clock beside the person's bubble while the Mate has not read the
    message; a read message carries nothing
- **Person's answer** — web
  - _Anatomy (fixed part):_ an answer to the Mate's question tool, in the run's card: the question
    as the Mate's bubble in its tint beside its face, and the person's answer whole in their neutral
    bubble on their side, 6 px under it — a pair; the answer stands nowhere else, and the request
    and the submission are no rows of their own
- **Turn map (the rail)** — web
  - _Anatomy (fixed part):_ one mark per message: its stretch's outcome in its tone, thicker past
    ten minutes and past an hour, a message sent into a running turn a dot; the preview falls back
    to the work line's words where no answer came
  - _Lands:_ landed 2026-09-26
- **Seams** — web
  - _Anatomy (fixed part):_ a day line (Today · Yesterday · weekday · date) at the conversation's
    top; after it a line only after an hour of quiet or more — the day line where a new day began,
    else the time — and midnight between two messages minutes apart draws nothing, the next line
    after an hour's quiet saying the new day; New since (the info tone — unread, one of blue's two
    meanings — once, at the first stretch after the last visit, read as the conversation opens)
  - _States:_ day · gap · new
  - _Lands:_ landed 2026-09-26; the hour 2026-09-29 (pass 16)
- **Conversation switch** — web
  - _Anatomy (fixed part):_ the conversation pane across a switch between Mates: at once — the
    header, the composer's top, the composer and the pane are the next Mate's from the press, and
    nothing of the conversation left stays or fades. Its list is out of sight until it stands where
    it stays — placed by the row the person was reading, not a pixel offset
    (`resolveTimelineRestoreTarget`: the same line of the same row, the run's line below the
    header's fade where that run folded since, the end where it was left at its end) — then eases
    in over 140 ms. A conversation slow to come shows its own pane, its Mate at work from 400 ms
  - _States:_ placing · slow (its Mate at work) · in
  - _Phrase source:_ `timelineScrollAnchoring.ts` (`judgeTimelinePlacing`)
  - _Lands:_ landed 2026-09-29 (pass 16); at once, the held picture gone, 2026-09-30
- **Composer's top** — web
  - _Anatomy (fixed part):_ the Mate's own change, waiting for the person's review, as the
    composer's first section (C3) — inside its white surface, on its edges and corners, a hairline
    under it: a 28 px column, the words and a button, 12 px apart — the Mate's face in its needs-you
    pose, "Nova is waiting for your review of #2" in ink over the change's title muted (13/18 each),
    and _Review_, the composer's one blue button (30 px, radius 9), which opens the change's review
    (R1); nothing merges from here. 61 px tall. Offered by the old rule: this Mate's own code
    change, not merged, that HQ says merges, the newest — one that conflicts or is still being
    checked waits on the Mate or on HQ, not on the person, and gets no strip. It gives way while a
    question or an approval waits and comes back once it is answered. It has no entrance: a reload
    paints the strip this conversation last showed, and HQ's answer confirms it, changes its words
    or takes it away
  - _States:_ review · unknown (the remembered strip, or nothing) · none · held (a question or an
    approval waits)
  - _Phrase source:_ client-runtime `mateNextStep.ts`; `ZeropsNextStepBanner.tsx`
    (`zeropsComposerTop`); `composerTopMemory.ts`
  - _Lands:_ landed 2026-09-29 (pass 16)
- **Model control** — web
  - _Anatomy (fixed part):_ the composer's one quiet control for what runs the next message (C4): 28
    px, 13/20, 500, muted — the agent's mark, the model without the agent's name and its effort
    ("Sonnet 5 · High"; "Ultrathink" where the prompt carries it), then only what is off its default
    ("Sonnet 5 · Max · 1M"), fast mode a bolt and never a word, and a chevron; the ink and an 8 %
    fill under the pointer and while open. It opens one menu, `min(28rem, available)` tall: the
    models on the left — the agents, search, favourites, the list — and on the right, 216 px on a
    muted fill behind a hairline, a radio list per choice the model offers (28 px rows at 13 px,
    headings 12/500, "Default" muted) and _Access_ with the chosen mode's sentence; picking a model
    closes it, picking an effort, a choice or an access keeps it open; the arrows move within a
    group; a narrow screen stacks the two columns. _Access_ stands in the toolbar on its own only
    while it is not the usual setting, and whenever the one control cannot open (no provider, the
    catalog still being read)
  - _States:_ the model and its effort · a choice off its default · fast · access unusual · no
    provider · reading the catalog
  - _Phrase source:_ `ComposerModelControl.logic.ts` (`composerModelControlLabel`,
    `showsAccessControl`); `TraitsPicker.tsx`
  - _Lands:_ landed 2026-09-29 (pass 16)
- **`ComposerPicture`** — web
  - _Anatomy (fixed part):_ a picture where it sits in the composer's text (P1): pasted or dropped
    at the caret — a file dropped on the text lands under the pointer — an 80 px tall thumbnail on a
    line of its own (10 px corners, a 14 % hairline, 8 px above and below) with its marks drawn in;
    a click opens it (`ComposerPictureView`), a drag moves it to another place in the text, its
    corner removes it, and Backspace or Delete removes it like a character. It is one character of
    the prompt (`￻`), matched by order to the draft's pictures, which follow the text's order as the
    person types, moves and deletes. Its copy for the Mate is made again 450 ms after the last edit,
    the latest winning (P4): as pasted where it is unmarked, whole and within the limits, else
    fitted to 2000 px a side and 5 MB of base64 — PNG first, then JPEG at falling quality on white,
    then smaller. When the message goes each picture becomes its label and its notes on lines of
    their own ("[Picture 1]", "Notes on picture 1:", the numbered notes), and the images go in the
    same order
  - _States:_ fitting · ready · upload failed (retry) · unsaved · after a reload (the copy alone:
    its notes still edit, its marks and crop do not)
  - _Phrase source:_ `@t3tools/shared/composerPictures` (the limits, the labels);
    `lib/composerPictures.ts`; `imageCompression.ts`
  - _Lands:_ landed 2026-09-29 (pass 16)
- **`ComposerPictureView`** — web
  - _Anatomy (fixed part):_ the open picture (P2, P3), over the app: the picture large on a dark
    stage, where a click pins a numbered note and a drag boxes an area, each mark in the note colour
    (`--picture-note`) with its note's chip beside it — the note in a popover, ↵ saving it, an empty
    one kept ("Marked, no note."), _Remove_; C crops (eight handles, a thirds grid, _Reset_; marks
    outside the crop go, and a toast counts them); Delete removes the selected mark, Tab moves
    between marks, Esc leaves the crop and then the view. A crop of up to 2000 px goes through at
    full sharpness. The bar says what the Mate receives — "Sends 2000 × 1320 · PNG, 1.7 MB" — and
    _Keep original_, which sends the untouched file beside it as a file whose path the agent is
    told, not a second picture to look at. One drawing makes the copy, the thumbnail and the view
    (`pictureDrawing.ts`)
  - _States:_ marking · a note open · cropping · after a reload (notes only)
  - _Phrase source:_ `useComposerPictures.tsx`; `lib/pictureDrawing.ts`
  - _Lands:_ landed 2026-09-29 (pass 16)
- **`MessagePictures`** — web
  - _Anatomy (fixed part):_ the person's message with pictures (P5): its words and pictures in the
    order they were written, each picture where it was put, at most 300 px tall, its notes under it
    at 14/20 with 18 px numbered badges (12/500) in the note colour, and "Original kept · 4.4 MB"
    (13/400) where the untouched file went along. A message that holds no labels (an older one, one
    from a phone) keeps its pictures above its words; the menu's last ask and a conversation's title
    read a picture's notes, never its label
  - _Phrase source:_ `messagePictures.logic.ts`; `@t3tools/shared/composerPictures`
    (`splitPictureText`, `pictureWords`)
  - _Lands:_ landed 2026-09-29 (pass 16)
- **Review** — web
  - _Anatomy (fixed part):_ one dialog for every merge, landing, release and roll back (R1, D12).
    Every door says _Review_ — a change's row in the menu, the composer's top, a result row, the
    crew line, the chips' menus, the projects page and a change's, a project's and a stop's pages
    (_Review release_ there), the Git tab, the release rows' _Roll back to this_, the Crew tab's
    rows and its _In Fen's code_, and a crew task's result row, where _Try it_ stands before it —
    and opens the same review over the conversation (`openReview`, one provider); two doors to one
    thing open one review. 768 px wide, the conversation's column (its text 720), radius 20, the
    card's ground in a 12 % ink ring with a deep shadow, over an 18 % backdrop (40 % in dark), hung
    from a fixed line near the top so what arrives grows it downward; in a short window only its
    body scrolls. Top to bottom: a kind line (13/500 muted, its glyph — "Review · change", "Review ·
    recipe change", "Release", "Roll back", "Crew task") with _Open as page_ and a 28 px × at its
    end, the title (16 px), a meta line ("(face) Nova · appdev → main · #2 · 1d", 13, tabular — the
    size stays in the Changes heading); the verdict first (R2), one 12 px-round box in its tone —
    green ready, amber attention, red failing, ink quiet, busy or done — saying whether it is safe
    and why, its fix in blue beside it ("Ask Nova to resolve it"); its description — the
    change's body as its author wrote it, in the chat's markdown, its pictures in it (one it cannot
    read settles on one line with its words) — else what the run that made it said, under
    "What it does", with a link to that run where one names the change (R3); its files with a letter
    and +/− each, a file's diff opening in place (12/19 mono, hunk headers, one number column; 400
    lines, then "Show all N lines" up to 2,000, past that a line saying the rest is too long to
    show here) (R4); its conversation — one box that grows as it is
    typed in ("Comment, or tell Nova what to change…") with _Comment_ and _Ask Nova_, the ask only
    to the person's own Mate and both only with words, the dialog showing the newest three comments;
    its commits, one line each with its age and hash on the column's right edge, more than 7 folded
    to 5 with "Show all N"; and a foot on a 2 % fill saying what the one button does beside it
    ("Squash-merges 1 commit into main. Production isn't touched until you release."), a change's
    _Close without merging…_ where HQ's rule offers it — the review then its one confirmation,
    "Close #2 without merging?" in the verdict and _Keep it open_ beside the button — _Cancel_ or
    _Close_, and the button (34 px, radius 10): _Merge_, _Add to Fen's code_, _Release v0.1.57_,
    _Roll back to v0.1.55_ (R5), none where HQ's rule does not offer it, the foot saying what it
    takes. After the press it stays and says what happened — "Merged into main", "1 change now
    waits for production", and nothing more to press: a merge ends its review, and the release opens
    from its own doors (2026-10-05); a release's progress with its clock, then "Released" or the
    failure and its fix (R6). It grows from what was pressed (200 ms: scale .98, 6 px of lift, a fade) and closes in
    about 150 ms; Esc or a press outside closes it and gives the focus back; the focus lands on the
    review, never on its button, and ⌘↵ presses the button only while it is safe — never for
    _Release_ or _Roll back_ (2026-10-05); reduced
    motion keeps only the fade; what is typed in it reaches nothing behind it (R7); a release's change rows press through to that
    change's review inside the dialog — the whole row presses, a › at its end, none on a commit no
    review carried — shown merged ("✓ Merged" where the button stands, "← Release" in the kind line),
    sliding in from the right in 220 ms as the release moves 30 % left and fades and the height
    eases; the first Esc steps back to the release where it was, the focus on the pressed row, the
    second closes, and ⌘↵ never reaches the release underneath (`ZeropsReleaseSteps.logic.ts`)
  - _States:_ a change: ready · HQ checking · behind main (amber, still merges) · conflicts
    with main · its files still read · not offered · merging · merged · refused · close asked ·
    closing · close refused · closed without merging; a release: ready · blocked · releasing · released ·
    failed; a roll back: ready · rolling back · rolled back · refused; a crew task: ready · add what
    it has · conflict · check failed · in Fen's code
  - A release offered to the person has a Version field after the verdict. It defaults to the
    next patch; a typed version updates the title, consequence and release button together. A
    root `VERSION` or `package.json` declaration from main is an optional suggestion, with its
    source. Invalid or existing versions explain the problem at the field and disable Release.
    The field leaves when the release starts; the reviewed changes and prior production version
    are captured at the press. Harness: `release-version`, `release-version-invalid`.
  - _Phrase source:_ client-runtime `reviewVerdict.ts` (`changeReview`, `releaseReview`,
    `rollbackReview`, `crewTaskReview`)
  - _Lands:_ landed 2026-09-29 (pass 16)
- **Ask to fix** — web
  - _Anatomy (fixed part):_ the fix every problem offers (S6): "Ask Nova to fix it" as a blue text
    action — on a broken or not-done row of a run's result, in a chip's menu while production or a
    stage is in trouble, in a review's verdict ("Ask Nova to resolve it", "… to update it") — with a
    chevron for another of the person's Mates. It opens the Mate's conversation with the problem
    written into its composer, not sent: what failed, when, the error, the log's last lines where
    the client has them (30 at most, in a code block), and the ask ("Find out why, fix it, and
    deploy it again."); a draft the person left there keeps its words, the request after them a
    blank line apart. Only the person's own Mates — one whose owner nobody can name counts as
    theirs, as _Mine_ keeps it — and only ones the app is connected to, the one they used last in
    that project first; a change's fix goes only to the Mate that wrote it, and a run's only to the
    run's own Mate (a colleague's run offers none). None of theirs, no action. In a chip's menu the
    first press shows what will be written, and the second opens the conversation
  - _States:_ offered · several Mates (a chevron) · none (no action)
  - _Phrase source:_ `fixRequest.ts` (`useAskMateToFix`, `fixRequestPrompt`); `fixMates.ts`
    (`fixMatesOf`); `useAskMate.ts`
  - _Lands:_ landed 2026-09-29 (pass 16)
- **`JumpBox`** — web
  - _Anatomy (fixed part):_ the way into it is one small control at the end of the menu's logo row
    (`SidebarJumpButton`, M12): 28 px, the search glyph and the palette's key inside it in 12 px
    mono, on a 5.5 % ink fill; it, ⌘K (the palette's own binding) and `/` wherever nothing is being
    typed open the box in the palette's own chrome; signed in, it is the palette's root, and `>`
    hands over to the commands. Nothing typed: the menu's first six Mates — face, name, "project ·
    subject" — then its projects, the last of them _New project_ (D11). Typed: Mates by name,
    projects and _New project_, changes ("#12 title"), stops ("Shop production" and
    what it runs, the dot its chip's menu gives it — only where its chip is drawn), in conversations
    (the task, the last words, then the server's search of whole histories), each group capped, the
    match in the search's bold. A Mate, or its words, opens its conversation; a project, a change or
    a stop is shown in the menu — its project opened, its row focused and flashed once, a change
    landing on its _Review_, a stop on its chip — production's, or the stages' — whose menu opens
    while the project stays folded — and opens its own page where the menu shows no tree (the
    settings); a phone's menu steps aside for the box and comes back to show a find. `@` lists the
    Mates the viewer may write to (D6) under _Free now_ and _Busy_; Tab or ↵ puts the Mate's chip
    (face and name) in the field, placeholder "Write to Nova", and a line under it says who reads it
    and when; ↵ sends without opening, then a toast "Sent to Nova" with _Open_; ⌫ on an empty field
    goes back to `@nova`; Esc drops the chip, then closes
  - _States:_ finding · writing (the list, the chip) · sending · not sent (the reason under the
    line, the words kept)
  - _Phrase source:_ `JumpBox.logic.ts` (`jumpGroups`, `jumpWritePlan`); the menu's index
    (`sidebarJump.ts`)
  - _Lands:_ landed 2026-09-27; its button in the logo row 2026-09-29
- **Project heading** — web
  - _Anatomy (fixed part):_ a project's heading in the left menu, 32 px tall, a band 10 px from
    either side of the menu with everything in it 6 px in, lit at 3.5 % of the ink under the pointer
    and while a menu of its is open: its name on the marks' edge (16 px in), 16/600 on 24 with −0.2
    px tracking — the menu's only 16 px words (S1) — the whole heading folding and unfolding the
    project; one chevron after the name that turns a quarter (220 ms) and shows on hover, on focus
    and always while folded; while folded, the faces of its busiest Mates after it (M15: three at
    most, 18 px, each its row's face and pose, a 7 px dot for what is not work — amber needs you,
    red stopped on an error, blue finished unseen — scaling in only when it arrives while
    watched); + (_Add a Mate_, its dialog over the view on screen) and ⋯ as 28 px buttons, muted
    until pointed at, in a slot that is always there (at rest on a coarse pointer), the grip before
    them in the _Custom_ order — under a 300 px heading the + gives its room to the name, and _Add a
    Mate_ is in ⋯ too; at its end its chips, `stage` then `prod` (D1), before which a long name
    truncates. An open heading's second line (D′) sits 13/18 under the name, 13 px letter to
    letter and 33 px above its first Mate, the band growing over it (32 → 56 px): the fact in ink, the
    rest muted, its door in the change rows' blue; a release's line leads with the tag the folded
    heading's badge wears, and the badge's tooltip says the line's words ("3 changes not released ·
    since v1.4.0"). ⋯ holds _Open project_, _Add a Mate_, _Move up_ and _Move down_, _Set up …_ for a
    tier it lacks, _All projects_. A heading never moves when pressed (M9, T3): the project's rows
    and the room after them — 36 px, 16 at the list's end; 6 px from the heading to its first row —
    unfold below it over 220 ms as they fade in and fold into it in 160 ms, turning round from
    wherever they stand when pressed again, a folded project keeping 12 px under its heading (none
    at the list's end); a paint nobody asked for never animates, and folding the list's last project
    keeps its room until the person scrolls. From one text to the next (M16): 20 px from a heading's
    words to its first Mate's name, or, folded, to the next heading's; 30 from one Mate's words to
    the next's; 50 from an open project's last words to the next heading's. The list starts 16 px
    under the logo row; _New project_ stands at the menu's foot, over the account (D11): a + in the
    faces' column, the words at 56; between them, only when the account has something to say, one line — 13/18
    muted words and quiet text buttons (`AccountVoiceLine`, `accountFootLine`): a lapse ("Checking
    your Zerops access…", then "Zerops isn't answering." with _Try now_, both with _Sign out_) or
    trouble lasting 20 s in the organization on screen ("Zerops isn't answering. Trying again…"
    with _Try now_); nothing ever covers the product
  - _States:_ open · folded (its busy faces) · unnamed (italic, muted) · the ungrouped heading (no
    toggle, no verbs)
  - _Phrase source:_ `SidebarProjects.logic.ts` (`projectRoom`, `headingFaces`, `slackForFold`);
    `SidebarProjectFold.tsx`
  - _Lands:_ landed 2026-09-29 (pass 16); its band, chips and rhythm 2026-09-29 (pass 18)
- **Prod and stage chips** — web
  - _Anatomy (fixed part):_ a project's production and its stages as up to two chips at its
    heading's end, open or folded (M2, D1): `stage` first and `prod` on the end edge, each only
    where the project has it, several stages one chip. A chip is its word alone — 20 px, radius 10,
    12/500, 6 px inside the heading's band, the muted ink on a 5.5 % ink fill (9 % under the pointer
    and while open) — and its whole ground and ink say what is wrong (S3): amber (a 34 % ground)
    while the last release or deploy did not go through and the old one still serves, red (26 %)
    while it is down, their inks leaning toward the foreground so the word reads at 4.7:1 or better
    in either theme; a hollow ring (a 1 px edge at 18 % ink, no fill) while it is stopped on
    purpose; neutral otherwise, a release or a deploy on its way included. Every tone keeps one box
    and a change cross-fades in 150 ms, so the heading never moves; a long name truncates before
    either chip. Its accessible name says the whole state, the version with it ("Production v2.3.0,
    the last release failed", "Stages: qa is down, stage is healthy"). A press opens its menu (330
    px, radius 14, grown from its corner in 160 ms; Esc or a press outside closes it): the project's
    name, then each stop as a group — its row, opening the environment's page: a dot, the name, the
    version and the state in words ("Healthy", "Releasing v1.2.1", "Release failed", "Deployed 40
    min ago", "Deploy failed", "Down", "Stopped", "Setting up…"); a note of what went wrong, as far
    as the platform and HQ's deploys and releases say; "Ask Nova to fix it"
    while it is in trouble, a stage's fix naming the stage (S6); the public links, each led by the
    service it reaches (`app`, `api:3000` where one service answers on several ports); among several
    stages, each its own _Open in Zerops_ — then "N changes wait for production" with _Review_, the
    release's review, where there is a production; a menu of one stop ends on _Open in Zerops_
  - _States:_ a chip: neutral (healthy, changes waiting, releasing or deploying, setting up, nothing
    released or deployed yet) · amber (the last release or deploy did not go through) · red (down) ·
    hollow (stopped on purpose) · unknown (the remembered chip, or what the platform alone says
    while HQ's releases are coming, or nothing) · unlit (production serves, but what a service
    runs cannot be told: "Production v0.1.44, can't tell what api runs" where it would say healthy,
    changes waiting or a release that did not go out) · none (no such tier); several
    stages wear the worst of them: down, then a failed deploy, then one deploying
  - _Phrase source:_ `SidebarProductionChip.logic.ts` (`projectChips`, `productionChip`,
    `stageChip`, `chipFace`, `productionMenu`, `stageMenu`, `stopServing`)
  - _Lands:_ landed 2026-09-29 (pass 16); two chips, each its word alone, 2026-09-29 (pass 18)
- **`MateRow`** — web
  - _Anatomy (fixed part):_ a Mate in the left menu, a messenger's row: a 28 px column for its face
    and the words 12 px after it — faces at 16 px from the menu's edge, every word at 56 — the face
    on the name's line however many lines follow (M4), whole: the card's face, nothing ringing it
    and nothing on its corner. The name's line: the owner's mark before the name (`MateOwnerMark`,
    16 px round — their picture, or their initial on a hue of their own read off their name; a plain
    disc where nobody can name them, so every name starts on one edge), the name 14/20, 600 while
    something it finished is unread, and on the right edge an 8 px dot — amber needs you (only on the viewer's own Mate, the one whose signer, as HQ relays it, names
    them: `mateIsViewers`; another's waiting Mate rests, its question muted, its change keeping its
    _Review_), blue finished unseen, red stopped on an error; no word, and no `StatusDot` — with when it last did
    something, or the run's clock counting up (600, tabular, in the Mate's own hue after a 6 px dot of it
    breathing; the time fades back in where it stood when the run ends), or a pause glyph and when a usage limit lets
    it go on. Under it the person's last ask, 13/18 in the second ink, then the third line (M7): its
    last words muted — in the second ink while unread; the question itself in ink while it needs you
    (D6); the error's first line in red where it stopped on one; while it works, the step it is on,
    in its words — a command's code only where it says nothing of itself — under a sweep of light
    (D5), or three still dots while words are to come; the
    second line is the person's — the sign-in, else _Draft:_ and the unsent words over the ask, else
    the ask, else "Nothing asked yet" once its conversations are read; a draft never covers the
    Mate's line. One even leading, no gaps (M5): every row three lines, 76 px, its third blank while
    nothing is said (M6); 30 px from one
    Mate's words to the next's (M16). A new ask or new words rise into their line, never on a first
    paint. On hover _Stop_ while it works — a first press turns it into a red "Stop?" in its place, a
    second within 3 s stops, and leaving, Esc or 3 s puts it back — and ⋯; a right-click or a finger held opens its menu; ⌥
    held puts each row's number in its time slot, and ⌥1–9 opens that Mate; j and k move between
    rows, x arms a stop and a second x stops, e marks it read or unread. A Mate resting for more than a week, with nothing
    unread and not open, folds into its project's "3 quiet Mates". Its face and its words come from
    one reading (`mateRowReading`): HQ's live overview of it, or its conversation's while its socket
    is up or only reconnecting, else this browser's memory, at rest (step A, A4) — a line held for
    words still to come stays empty, never dots under an asleep face. In its first minutes it says so in the projects page's words
    (`mateComing`), asleep in the face its person picked, the owner's seat empty, no menu, and a
    press opens its own view (`/mate/$projectId`)
  - _States:_ idle · working · needs you · finished, unread · stopped on an error (its face still) ·
    paused (a usage limit: asleep) · asleep (neither HQ nor a socket holds it live) · quiet (folded) ·
    remembered (a reload, until HQ's view or its socket answers: its lines as they stood, a reply to
    come held empty) · coming up
    ("Coming up. A few minutes.", "Almost there.", "Taking longer than usual.", or in red "Could not
    be created.") · deleting ("Deleting…" for its last line, asleep, no time, no dot, no menu; a
    press opens nothing)
  - _Phrase source:_ `SidebarMateRow.logic.ts` (`mateRowView`, `ownerMark`); `agentActivity.ts`;
    `SidebarZeropsTree.logic.ts`
  - _Lands:_ landed 2026-09-27; rebuilt 2026-09-29 (pass 16); deleting 2026-09-29 (pass 18); coming
    up 2026-09-30 (pass 19)
- **Change row** — web
  - _Anatomy (fixed part):_ one of a Mate's open changes, 2 px under its row (M8): 28 px tall,
    radius 10, 13/18 — the pull-request mark (14 px) in the faces' column, muted, and amber where it
    fell behind `main` (S3); `#N title` on the words' edge, the way
    to the change's page; _Review_ as a blue word on the right edge, the one door to merging it
    (R1, D8). No _Merge_, no _Ask_ and no check dot on the row: the verdict is the review's. Past
    three, a Mate's changes fold behind "N changes"
  - _States:_ open · behind main (amber mark) · remembered (a reload,
    until HQ answers: its title untinted, _Review_ already there)
  - _Phrase source:_ `SidebarMateRow.logic.ts` (`changeMarkTone`); client-runtime
    `sidebarChangeLabel`, `pullRequestsFolded`
  - _Lands:_ landed 2026-09-29 (pass 16)
- **Crew line** — web
  - _Anatomy (fixed part):_ a crew as one line under its Mate's row (M14), 2 px under it and 30 px
    tall, inside its Mate's band — hover, an open menu and the selected band light the row and the
    line as one: the crew's mark (14 px) in the faces' column; every crewmate's face whole at 20 px
    in a 24 px button, the lead first, each opening that crewmate's chat and wearing its state; then
    the crew's one most urgent fact in the second ink — who needs you ("Bo needs you", "Bo and Cy
    need you", "Bo and 2 others need you") before whose finished work waits for the person's review
    ("Bo's work is ready", "2 pieces of work are ready"), or nothing; and _Review_ in blue on the
    right edge while a task waits, opening the first ready task's review. The Mate's row keeps its
    full width above it. In a narrow menu the faces keep their place and the fact gives way, still
    in its tooltip and in _Review_'s name. A reload draws the faces this browser last read, at rest,
    with no fact and no _Review_ until the crew's feed answers
  - _States:_ needs you · work ready · nothing to say · remembered · no crew (no line)
  - _Phrase source:_ `SidebarCrewLine.logic.ts` (`crewLine`); `crew/phrases.ts`
    (`crewLineNeedsWord`, `crewLineReadyWord`)
  - _Lands:_ landed 2026-09-29 (pass 16); its words 2026-09-30 (pass 20)
- **Crew tab** — web
  - _Anatomy (fixed part):_ the crew's one home, in the right panel (`CrewPanel`), one column as the
    approved "Mate Crew Tab" board draws it. Its head: the goal's title — its first lines on hover,
    a click away from its view — and the tab's ··· (_Change the goal_, _Add a crewmate_, _Let it
    work on its own…_ while it is not working on its own), over the mode line, how the crew works
    right now with its one press: "Works when you give it something to do"; "Working with you ·
    finished work waits for your review" and _Let it work on its own…_; "Working on its own · $6.40
    of $20 · 1 h 12 m of 8 h" and _Stop_; "Stopped working on its own: it spent its $20" and _Keep
    going…_ (for its time only while something is left to do; a refused turn, _Try again_);
    "Wrapping up". Then one composer, "Give the crew something to do…", to the lead ("To Lead") —
    or, with none, to the faces picked, each getting a task of its own — its `@` finding the Mate's
    files; while a plan waits, "Tell the lead what to change…". Then a row per crewmate, as the
    menu's Mate row: its face wearing its state, its name and a time; what it is on, or its job,
    muted; its step while it works (the thread's live step, D5), else where its task stands ("Done ·
    the lead is checking it", "Done, in its own copy · not in Fen's code yet"); what it needs from
    you, a line each in ink — red only for something broken — with the presses that settle it, the
    face asking and an amber dot; "Next" and what waits, last. The lead's row carries its plan — a
    line per task: whose, what, after what — "Start lets the crew work on its own: up to $20, for up
    to 8 hours." with _Change_, then _Start_ and _Drop the plan_. A row opens its crewmate's
    conversation; its ··· holds _Try its work_, _Change its job_, _Clear its conversation_ and
    _Remove from the crew_. Last, _In Fen's code_: the newest three pieces of work that went in —
    the crewmate's face, what it was, when — and _Show all N_, a line opening its review, and while
    some is unshipped "Fen hasn't shipped these yet · Ask Fen to ship them"; nothing is drawn while
    nothing went in. Setup, the goal and a crewmate's job are views in the column's place
    (`CrewView`): "‹ Crew" back, a heading, their fields and a footer in reach with one line and one
    Save; a view slides 24 px in from the right and back from the left over 220 ms, never on a first
    paint. A need's _Answer_ unfolds its box in its row (a 220 ms clip) and the rows below slide to
    their places; under reduced motion both fade. At a phone's width the column tightens and its
    presses grow to a finger's size. No status word, version, handle, task number or engine noun
    anywhere
  - _States:_ no crew (_Set up a crew_) · setting up · works when asked · working with you · working
    on its own · stopped by a limit (_Keep going…_) · stopped, nothing left to do · refused (_Try
    again_) · wrapping up · a plan waiting · a need in a row
  - _Phrase source:_ client-runtime `crew/phrases.ts`; `CrewHead.logic.ts` (`crewModeLine`),
    `CrewRows.logic.ts`, `CrewLeadPlan.logic.ts`, `CrewRunDialog.logic.ts`
  - _Lands:_ landed 2026-09-30 (pass 20)
- **Selected band** — web
  - _Anatomy (fixed part):_ the menu's one selected band (M11): a single surface in the list
    (`--sidebar-row-active`, radius 12, the row's own inset) behind the open Mate's unit — its row
    and its crew line, one shape (`MateUnit`), the change rows outside it — placed by transform and
    height — never `top` — after every draw and whenever the list changes size, so it never lags its
    row. Opening another Mate slides it there on a spring over 300 ms (T2); a draw in the middle of
    a slide turns it smoothly to the new row; a reflow it follows at once. Clipped by its project's
    fold, it shrinks as the project folds and is gone once its row is; the first paint and a row
    coming back into view place it without a move; reduced motion only places it. A Mate opened from
    elsewhere during the session — _Add_ landing on it, a link, a page — has its row scrolled to the
    menu's nearest edge once it is drawn, smoothly unless motion is reduced; never the one open at
    mount, so a reload leaves the menu where it was. Rows paint no fill of their own for being open
  - _States:_ placed · sliding · folded away (none)
  - _Phrase source:_ `SidebarSelectedBand.logic.ts` (`bandPlacement`, `bandMove`)
  - _Lands:_ landed 2026-09-29 (pass 16); scrolled into view 2026-09-30 (pass 19)
- **`WaitingFaces`** — web
  - _Anatomy (fixed part):_ the Mates waiting on you — anything that wears the "needs you" face: a
    question, an approval, a plan, a failure — as up to four overlapping faces, then "+2", in the
    logo row's slot before ⌘K, which stays reserved while it is empty; where the row is narrow the
    faces give way first (`waitingFacesThatFit`: a 304 px menu keeps three and a count, a 256 px one
    a single face), so the lockup and ⌘K stay whole; its tooltip names them ("Kai and Juno wait on
    you"). A press, or ⌥↓, goes to the next one below the Mate in view: its project opens, its row
    takes the focus and flashes once, the question on its last line
  - _Phrase source:_ `sidebarReveal.ts` (`nextWaitingMate`); `SidebarWaitingStack.tsx`
    (`waitingFacesThatFit`)
  - _Lands:_ landed 2026-09-27; in the logo row 2026-09-29
- **`MateMenu`** — web
  - _Anatomy (fixed part):_ a Mate's own menu, from ⋯ on its row, a right-click, a finger held on
    the row, or Shift+F10: _Open_ ↵, then _Set up a crew_ or _Crew_ on the viewer's own Mate with
    crew mode on (its conversation on the Crew tab; for _Set up a crew_ its setup view), _Open app_,
    _Copy link_; _Mute notifications_ (this browser's), _Mark as unread_ E, _Rename_ (in place,
    where the name stands, never to nothing), _Change face…_ where _Rename_ is offered; _Restart_
    (_Start_ when stopped), _Register in …_, _Hand over…_, _Move to project…_; _Stop the run_ while
    it works; last, in red, _Delete {name}…_ where the viewer's role on the Mate's project is OWNER
    or ADMIN, on a Mate only. Space presses the row, as any button
  - _Phrase source:_ `SidebarMateMenu.tsx`; `useMateActions`
  - _Lands:_ landed 2026-09-27; _Delete_ 2026-09-29 (pass 18); _Change face…_ 2026-09-30 (pass 19)
- **Project order** — web
  - _Anatomy (fixed part):_ the account menu's _Show_ (_Mine_ · _Everyone_) and _Order_ (_Name_ ·
    _Creation date_ · _Custom_), radio items. _Custom_ starts from the order on screen: a project's
    grip — the first of its heading's verbs, a 28 px button before + and ⋯ inside the heading's
    band, shown whenever they are (at rest on a coarse pointer) — drags it with a drop line, or
    moves it with the arrow keys, announced ("Links moved to 3 of 5."); a new project comes after
    the arranged ones, newest first. Kept per account in this browser. _Mine_ keeps the Mates the
    viewer owns, the ones whose owner is unknown and the one open, and the jump box finds within it
  - _Phrase source:_ `SidebarProjectReorder.tsx`; `SidebarZeropsAccount.logic.ts`
  - _Lands:_ landed 2026-09-27; the grip among the verbs 2026-09-29 (pass 18)
- **HQ card** — web
  - _Anatomy (fixed part):_ the organization's HQ as the projects page's quiet end, a `FlatCard`
    in place of the old Tools line. Its header line: _HQ_ (for an owner or an admin a button with
    a chevron that opens the card), its state as a `StatusDot` in sentence form, then in the second
    ink, for an owner or an admin, the day of the Core it runs ("Core 2026-10-04") and its last
    backup ("Last backup today 14:00", "No backup yet"), then for everybody what HQ holds ("4
    projects · 9 Mates · 3 online", _online_ only while HQ's view of the Mates is live), then for
    an owner or an admin the update's offer (_Update available_ · _Up to date_, `ZeropsHqUpdate`).
    Under it, for an owner or an admin, what is wrong — a line each in the attention ink: its
    database, repositories it withholds, its backup, its key for deploy tokens, a service Zerops
    does not run, a failed update. Opened: `MicroLabel` rows _Core_ (the Core it runs whole, and
    where an update stands) and _Services_ (each of HQ's services as `StatusDot` + "hq · Active"),
    then _Open in Zerops_. Every fact comes from a read already made — HQ's structure stream, which
    says where HQ stands, the Core it runs and how its parts stand (an older Core's health read once
    per stream) — but HQ's services and builds, read from Zerops once each time the card is
    opened, as HQ's update reads them: the projects page draws none of HQ's stops, so its inventory
    holds none of HQ's services. A read that failed says so, and nothing is read again on its own
  - _States:_ unknown (_HQ_ alone, before its health is read) · healthy (_Healthy_ to an owner or
    an admin, _Running_ to anybody else) · degraded (_Needs attention_, or _Can't check Zerops
    right now_; an owner's or an admin's only) · down (_Unavailable since 14:02_) · updating
    (_Updating_, the stepped pulse; an owner's or an admin's only)
  - _Phrase source:_ `ZeropsHqCard.logic.ts` (`hqCardView`); `ZeropsHqUpdate.logic.ts`
    (`coreLabel`, `coreDayLabel`, `hqUpdateWords`, `hqUpdateTrigger`)
  - _Lands:_ landed 2026-10-04; its Core and backup on the header line, HQ's services read when
    opened 2026-10-04

## 2. Glossary — the words the UI uses

T3 word → Zerops word. User-facing copy only (R4 guards the sinks); identifiers, imports and
comments keep whatever name the code has. Crew mode's rows put the word its design used on the
left.

| T3 says                                                                                 | mate says                                                                                       |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| environment                                                                             | **project**                                                                                     |
| HQ's application, the layer above Zerops projects (the code's _group_, _app_)           | **project** — "Move to project…", "New project", "No project"; never _group_, _application_     |
| a Zerops project shown beside one (a Mate's, a stage's)                                 | **its name**, as its row in the left menu draws it; never _project_ in the same dialog          |
| pull request, PR                                                                        | **change** — "Change #4 waits for your merge", "2 open changes"; HQ's word for a Mate's work    |
| rebase (a change behind or in conflict with `main`)                                     | **merge `main` into it** — "Conflicts with main"; HQ takes a Mate's push only forward           |
| provider                                                                                | **coding agent**                                                                                |
| pairing, pairing code                                                                   | **Sign in with Zerops**; no pairing code or one-time link is offered                            |
| Connections                                                                             | **Devices**                                                                                     |
| worktree, Local checkout; a crewmate's worktree or lane                                 | gone — a crewmate's copy is "its own copy of Fen's code", in setup and under _Try its work_     |
| T3 Connect, Tailscale, T3 Code                                                          | gone                                                                                            |
| Open in editor                                                                          | **Cloud IDE**                                                                                   |
| the `zcp` service                                                                       | **Zerops Control Plane**, under Infrastructure                                                  |
| project env, project-level variables                                                    | **Shared** — the project's vault; never _project variables_                                     |
| env vars, environment variables, secrets                                                | **the vault**, its **values** — each _Plain_ or _Sensitive_                                     |
| commit & push                                                                           | zcp's pipeline, never the client's                                                              |
| "control plane" (self-description)                                                      | never — the product is Zerops Mate                                                              |
| stage half of a Mate's pair                                                             | **preview** — `appstage` beside `appdev`, runs a change before it is merged                     |
| a crewmate's commit deployed to another service by `sha=` (the crew design's _preview_) | **Deploy to `<host>`** — never _preview_, which is only the stage half                          |
| a group stage project                                                                   | **stage** — only that: optional, a side branch of `main`, never a gate                          |
| agent (one of a crew)                                                                   | **crewmate** — mostly just its name and face; _agent_ stays the coding agent                    |
| orchestrator                                                                            | **lead**                                                                                        |
| intent (for the whole crew); the crew design's brief                                    | **goal** — _Change the goal_; its title heads the Crew tab                                      |
| intent (for one crewmate), role                                                         | **job** — _role_ is the Zerops membership role                                                  |
| assignment                                                                              | **task**                                                                                        |
| tab (another conversation with the Mate)                                                | **chat** — "+ New chat"                                                                         |
| merge (a crewmate's work into the Mate's tree); land, landed                            | **add to Fen's code** — the review's button; once in, **in Fen's code**; not a change's _Merge_ |
| your tree (the Mate's working copy)                                                     | **Fen's code** — the Mate's name, never "your tree"                                             |
| deliver; landed, not delivered                                                          | **ship** — "Fen hasn't shipped these yet · Ask Fen to ship them"                                |
| run (the crew working within limits); pause, resume                                     | **working on its own** — _Let it work on its own…_, one _Stop_, _Keep going…_; no pause         |
| budget                                                                                  | **what it may spend** — "up to $20"                                                             |
| Start fresh                                                                             | **Clear its conversation** — "It keeps its job and its work."                                   |
| Discard                                                                                 | **Drop it**; a plan's **Drop the plan**                                                         |
| Allow (a crewmate showing its work at the Mate's dev address)                           | **Let it**, beside _Not now_                                                                    |
| Back to my tree                                                                         | **Back to Fen's**                                                                               |
| parked                                                                                  | **Stopped**                                                                                     |
| writer, reader, lead (what a crewmate does)                                             | **Builds**, **Reviews**, **Plans**                                                              |
| HQ's backup set (`apps/hq` _set_), its store                                            | **backup**, **backup bucket** — "Last backup today 14:00"; pending the owner's review           |
| HQ's git repositories (_quarantined_ ones)                                              | **repositories** — "Repository Links/api is closed"; pending the owner's review                 |
| an environment's deploy token, HQ's `HQ_KEY_SECRET`                                     | **deploy tokens**, **key for its deploy tokens**; pending the owner's review                    |
| a Mate's link to HQ open (`presence.online`)                                            | **online** — "3 online" on HQ's card; pending the owner's review                                |
| HQ serving with something wrong (degraded)                                              | **Needs attention** — an owner's or an admin's headline only; pending the owner's review        |
| HQ serving, to a member who sees none of its parts                                      | **Running** — never _Healthy_, which claims more; pending the owner's review                    |

Tone: short declarative sentences, second person, "developer-first" as the one self-descriptor,
no hype. Colour grammar: **blue acts, teal identifies** — `messageAction` (`#0077cc`) for
everything that does something; teal only as the mark, the identity pill tint, the `update`
role and the connected/authorized dots.

## 3. Icon map

Placeholder until F4-FONTS/F5b fill it. Rules already fixed: lucide on web, Tabler on mobile; no
Material Icons webfont; the mark as path data (`brand.ts`) rendered by `<svg>` /
`react-native-svg`; provider marks as `currentColor` SVGs; the 87 service-type icons are **not**
used in map rows (concept D7).

| Glyph id | Meaning | lucide (web) | Tabler (mobile) |
| -------- | ------- | ------------ | --------------- |

## 4. Rules — machine-checked

Predicates are the plan's (`../../../../zcp/plans/z3-ui-foundations-2026-08-30.md` §3, frozen at
F0); this table records where each rule is enforced and by which test, and when it landed. A
rule is "landed" only when its test runs in CI.

- **R1** — `client-runtime/src/zerops/**` is UI-free and platform-free
  - _Enforced by:_ zone rule 5 (import prefixes) + `t3code/no-platform-globals` (resolved globals) +
    constructor tests
  - _Test(s):_ `scripts/mate-zone-architecture.test.ts` "client-runtime zerops is UI-free and
    platform-free"; `oxlint-plugin-t3code/rules/no-platform-globals.test.ts`; module tests "accepts
    storage / fetch / clock explicitly"
  - _Status:_ landed (W2-F3-MOVE `9e3e25d8b`)
- **R2** — Protected roots render only
  - _Enforced by:_ zone rule 6 (module-graph walk over the protected roots + explicit `WS_METHODS`
    read/allowed-command sets)
  - _Test(s):_ `scripts/mate-zone-architecture.test.ts` "protected roots render only"
  - _Status:_ landed (W1: `282c82585`, reapplied `beb3f683d`)
- **R3** — Tokens only
  - _Enforced by:_ `t3code/no-theme-escape-hatches` (semantic sinks) + `scripts/check-css-tokens.ts`
    (parser over declarations)
  - _Test(s):_ `oxlint-plugin-t3code/rules/no-theme-escape-hatches.test.ts`;
    `scripts/check-css-tokens.test.ts`
  - _Status:_ landed (W1-R3 `fe9e0a6af`; quote-aware bracket scan follows in W1-R3-FIX)
- **R4** — No legacy vocabulary in user-facing copy
  - _Enforced by:_ `t3code/no-legacy-vocabulary` (closed sink list, word boundaries)
  - _Test(s):_ `oxlint-plugin-t3code/rules/no-legacy-vocabulary.test.ts`
  - _Status:_ landed (W1-R4 `3521900ec`; ledger 102 after W1-D-NAMING)
- **R5** — One status resolver, one phrase producer
  - _Enforced by:_ `packages/shared/src/threadStatus.ts` + the vector test + zone rule 7 (bans the
    known local status-table shapes in the named consumers)
  - _Test(s):_ `packages/shared/src/threadStatus.test.ts` (vector: web row · palette pill · mobile
    row · widget props · relay); `scripts/mate-zone-architecture.test.ts` "one status resolver"
  - _Status:_ landed (W2-F3-STATUS `3149346fb`)
- **R6** — No continuous repaint
  - _Enforced by:_ `scripts/check-css-motion.ts` (`animation`/`animation-iteration-count` with
    `infinite` ⇒ stepped helper or exception) + `t3code/no-infinite-motion` (`withRepeat(-1)`
    resolved to its import; `Spinner` by binding in the protected roots)
  - _Test(s):_ `oxlint-plugin-t3code/rules/no-infinite-motion.test.ts`;
    `scripts/check-css-motion.test.ts`
  - _Status:_ landed (W1-R6 `bae1c10e8`, walker `c3be8d707`)
- **R7** — The theme is complete and legible
  - _Enforced by:_ a `packages/shared` test over `ZEROPS_THEME` × `THEME_COLOR_ROLES`
  - _Test(s):_ `packages/shared/src/zeropsTheme.test.ts` (exact key equality both appearances; alpha
    1; the named contrast pairs; projections equal their source)
  - _Status:_ landed (W2-F4-THEME `0b5ed6530`)
- **R8** — Generated copies are current
  - _Enforced by:_ `scripts/generate-theme-tokens.ts --check` in CI `check`
  - _Test(s):_ `scripts/generate-theme-tokens.test.ts` (byte equality of every projection)
  - _Status:_ landed (W2-F4-PROJ `9c9f6f04d`, preload fix `376903888`)
- **R9** — UI kit exports are used, not restyled
  - _Enforced by:_ `t3code/no-restyle` — `@shadcn/lint`'s no-restyle run as a fork guard through
    `oxlint-plugin-t3code/shadcnGuard.ts` (a `CollapsibleTrigger` is exempt); CI reconciles `--rule
no-restyle`
  - _Test(s):_ `oxlint-plugin-t3code/rules/no-restyle.test.ts`
  - _Status:_ landed (intake row 5, 2026-09-25)
- **R10** — Class names are known and static
  - _Enforced by:_ `t3code/no-unknown-classes` + `t3code/require-static-classes` — `@shadcn/lint`
    against `apps/web/src/index.css` and its imports; CI reconciles both rules
  - _Test(s):_ `oxlint-plugin-t3code/rules/no-unknown-classes.test.ts`;
    `oxlint-plugin-t3code/rules/require-static-classes.test.ts`
  - _Status:_ landed (intake row 5, 2026-09-25)
- **R11** — Scale values, not arbitrary ones
  - _Enforced by:_ `t3code/no-arbitrary-values` (Tailwind arbitrary values where the theme has a
    token: `text-2xs`/`text-3xs`, `ease-drawer`, the gutters); CI reconciles `--rule
no-arbitrary-values`
  - _Test(s):_ `oxlint-plugin-t3code/rules/no-arbitrary-values.test.ts`
  - _Status:_ landed (intake row 5, 2026-09-25)

Protected roots (R2, R6): today `apps/web/src/components/zerops/{ZeropsServiceMap,ZeropsLifecycleStrip,ZeropsOperationCard,ZeropsQuickActions}.tsx`;
after a surface round moves them, `apps/web/src/components/zerops/{map,band,cards,quickActions}/**`
and the mobile counterparts `apps/mobile/src/features/zerops/{map,band,cards,quickActions}/**`.
The door, picker, session provider and agent-auth card issue commands legitimately and are not
protected; their commands are the explicit allowed set.

## 5. Exceptions

**Policy (DN10).** Every guard's exceptions are fingerprint entries, never files, never counts.
CI fails on a **new** finding without an entry, a **dead** entry (its fingerprint matches nothing
any more), a **changed** entry (the same path and kind still has a finding, but a different
fingerprint — the code under the entry moved and needs re-review) and an **expired** entry (its
`expires` phase is complete). The ledger only shrinks, except for entries with `expires: "never"`
(technical literals that are correct by design — ANSI-16, Pierre, shiki — each with a reason).

**Entry schema** (one JSON array per rule, in `oxlint-plugin-t3code/exceptions/<rule>.json`;
completed phase ids in `oxlint-plugin-t3code/exceptions/phases.json`):

```json
{
  "path": "<repo-relative path>",
  "kind": "<AST node type | css-declaration>",
  "fingerprint": "<normalized source of the node / declaration>",
  "owner": "<name>",
  "reason": "<why this is correct>",
  "expires": "<phase id | surface:<manifest id> | never>"
}
```

Normalization: whitespace collapsed to one space, trimmed; for a CSS declaration
`<selector>{<property>:<value>}` with the same collapsing. The loader, the reconcile function and
their tests are shared (`oxlint-plugin-t3code/exceptions.ts`, W1-EXC).

**Ledger sizes** (updated at every wave end and every intake; the machine files are the truth — counted 2026-09-29, after pass 16):

| Rule | File                                      |                Entries | `never` | Notes                                                                                                                                  |
| ---- | ----------------------------------------- | ---------------------: | ------: | -------------------------------------------------------------------------------------------------------------------------------------- |
| R3   | `exceptions/no-theme-escape-hatches.json` | 385 (358 ast + 27 css) |     230 | baseline = the violations outside the Zerops dirs; the vendor provider colours (Claude, Cursor, OpenCode, Antigravity) are `never`     |
| R4   | `exceptions/no-legacy-vocabulary.json`    |                     55 |      50 | upstream surfaces' exact literals (the branch toolbar, settings panels, thread actions, mobile git sheets); 5 expire at F6             |
| R6   | `exceptions/no-infinite-motion.json`      |    27 (18 ast + 9 css) |      27 | the known continuous uses; since 2026-09-29 a working Mate's face (its turn and glance), the composing dots and a running call's sweep |
| R9   | `exceptions/no-restyle.json`              |                    306 |       0 | restyles that predate the ui-kit pass (65 in the Zerops dirs); all expire at F6                                                        |
| R10  | `exceptions/no-unknown-classes.json`      |                      3 |       3 | the `MateMark.css` classes — `@shadcn/lint` reads only `index.css` and its imports                                                     |
| R10  | `exceptions/require-static-classes.json`  |                      4 |       0 | runtime-built `className`s on ui exports (1 in the Zerops dirs); expire at F6                                                          |
| R11  | `exceptions/no-arbitrary-values.json`     |                    206 |       0 | arbitrary values that predate the token pass (118 in the Zerops dirs; 2 are the usage breakdown's 8px avatar initials); expire at F6   |

## 6. Decisions taken inside the programme

The dated log lives in [`design-decisions.md`](design-decisions.md) — grep it by date or by a
surface's name; never read it whole.
