# Design decisions — the dated log

Moved out of `design-system.md` §6 on 2026-09-30: the working spec stays short, the log only
grows. Newest entries last; grep by date or by a surface's name.

Decisions the plan did not foresee, taken by the orchestrator from the plan's rules and noted
here (the owner decides only what the orchestrator brief §6 lists).

- **2026-08-30** — DN1b default holds: a pull request linked to a thread stays a static external
  reference (number + url from `thread.linkedPullRequest`, no live state on web or mobile, excluded
  from auto-settle keying); the checkout's own `status.pr` keeps its real state.
  - _Why:_ no owner answer arrived; a fabricated `state:"open"` would feed auto-settle
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
- **2026-08-30** — Timeline folds: a settled Zerops milestone escapes every collapse path — turn
  fold, partitioned tool summary, overflow, AND the active-turn `work-live` group (a research gap:
  the inventory said three). Membership is by entry identity, never by id (duplicate ids exist). An
  escaped card is a standalone row (keeps its section wrapper).
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
- **2026-09-25** — **Cards carry no attempt number.** A repeated deploy, verify or browser check on
  one target is a card of its own with nothing counting it: `ZeropsOperation.attempts`,
  `attemptWord` and the whole-thread gate (`historyComplete`) are gone. **Supersedes:** of the
  2026-09-25 _card is correct at every instant_ row, "an attempt number appears only once it can no
  longer change …" and "with the attempt and the duration at the right" (the duration stays); of the
  2026-09-05 row, the `attemptWord` ("attempt N") rendering.
  - _Why:_ the owner, 2026-09-25: "attempt N" on a card was more confusing than useful
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
- **2026-09-26** — A dock above the composer holds what changes size while the Mate works: running
  pipelines, helpers, the task list, a pause countdown.
  - _Why:_ a helper starting or a deploy stepping on must never move a message; the task list had no
    home at all
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
    title showed them
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
- **2026-09-29** — **The Mate's question stands clear of the person's words.** A question's row
  after the person's own message takes a change of speaker's room (`block`, 19 px of air).
  - _Why:_ it took the 4 px meant for two messages of the person's and hung under their bubble as if
    they had asked it
- **2026-09-29** — **Superseded the same day by the one-line conversation top below.** **The header
  reads as the Mate, then what it is on.** Under a Mate the task follows its name in the muted voice
  at the body's weight, and comes up under the pointer.
  - _Why:_ a long prompt as the person typed it read as a second heading as loud as the Mate's name
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
- **2026-09-29** — **The person's bubble is neutral grey** (the owner's D10): one step darker than
  the canvas in light (`oklch(0.918 0.006 255.5)`), one step lighter in dark (`oklch(0.26 0.009
178)`), the same shape and size; the phone's bubble follows the generated tokens.
  - _Why:_ in AI chat the person's bubble is a neutral grey and the assistant has none; blue for
    "me" is a messenger's, set against a grey "them" — here the Mate's words have no bubble, so blue
    contrasted with nothing and borrowed the colour that means "click me"
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
- **2026-09-29** — **The server relays the live step, in memory, and the client paces it.** A
  running thread's shell carries its step — thinking, writing, or the calls running — only while its
  session runs a turn, cleared however the turn ends; nothing is persisted, there is no migration,
  and no push is added, since the shell stream already re-reads a thread for the event that changed
  its step. The client phrases it with the card's own rules, skips a call the card draws nothing for
  yet, and changes a row's step at most once per 500 ms; a step is bounded to about 19.5 KB. An
  older server sends neither a step nor a question, and the row keeps its dots or its last words.
  - _Why:_ a pace on the server would need an event per step, and consumers of the same step must never
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
  Mate's face and name are its first entry, then
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
- **2026-09-29** — **Superseded 2026-09-30 by the lone card below.** **A line with nothing under it
  is no card** (the owner, of a closed run with nothing below: "shape of this with no items below is
  pretty weird"). A settled run whose card would hold its line alone — no result under it, what it
  ran being said on the line itself (`outcomeDraws`) — draws its line bare while closed, in the
  card's geometry, and opening its work draws the card around it without moving the line
  (`cardAlone`, `.run-tray-alone`).
  - _Why:_ a box around one line read as an odd shape; the line kept its place in both states,
    measured at 0 px on open and close
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
- **2026-09-30** — **The stand-up's card shows its builds** (the owner: "what is even this state?
  it shows nothing"). A stand-up call docks a bar of the platform's builds for the services it
  deploys: a segment each, the one building's pipeline step or "3 building", "1 of 4", a failed one
  in red while the rest go on. The call's words come from zcp's result: "Stood development up ·
  apistage and webstage next", then "Stood stage up". One clock per run everywhere: no step keeps
  a clock of its own beside the run's.
  - _Why:_ zcp's progress notifications never reach the card — the Claude CLI drops them from its
    headless stream — while the platform's own processes already reach the client
- **2026-09-30** — **A link in an answer reads as part of its sentence** (the owner: "design of
  this is total shit oh my god, so painful"). Links take the sentence's ink with a quiet underline
  that fills on hover; a service the side panel opens leads with the panel's own globe, nothing
  fetched; nothing stands between a link's words and its full stop. External links drop their ↗.
  - _Why:_ a blurry fetched favicon, saturated blue and a glyph glued before the full stop
- **2026-09-30** — **An empty conversation keeps its row, and a draft shows on the person's line**
  (the owner: "empty conversation not showing draft and has weird position of the name without the
  questions and response under it"). Every Mate row is three lines tall; the second line is the
  person's — the sign-in, else _Draft:_ and the unsent words, else the ask, else "Nothing asked
  yet" once the conversations are read; a draft never covers the Mate's line.
  - _Why:_ a lone name floated mid-row, and the row grew 48 → 76 px when the first message landed
- **2026-09-30** — **The run card keeps one radius** (the owner: "I'd just keep one constant border
  raidus, the 'expansion' doesn't work with the stuff on bottom"). Every state wears
  `--composer-radius` (20 px), the background-work card too, and nothing eases between radii; the
  16 px edge slice takes corners 20 across by 16 down.
  - _Why:_ 34 px pill tops sat over 16 px bottoms once rows stood in the card, animated between
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
- **2026-10-01** — **A row opens only when opening adds something** (a colleague: "you don't need an
  arrow if it doesn't show anything"). A docked operation's chevron shows only for its services'
  lines or a reason cut short; a cut-short reason opens whole, wrapped, in place.
  - _Why:_ a failed stand-up with no services opened to nothing
- **2026-10-01** — **A message echoed in the run card keeps its words** (the owner: it "swallows the
  text it had"). The echo stays one line (2026-09-28), now the first line of the words, never a
  picture label, with its pictures as a strip of thumbnails under it.
  - _Why:_ a message with a picture starts with its `[Picture 1]` line
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
- **2026-10-06** — **A helper is called what the Mate called it** (F6: the Mate's text said "the
  deep-sea builder", the card said the launch's task). Where a helper's launch gave it a name —
  Claude's Agent `name`, kept by the activity projection for an agent launch only — every place
  the card names that helper (its row, its band, the dock, its report's wake) reads the name;
  Codex's helpers were already named by their nickname or path. Where the launch named none, or
  aged out, the task's words stand as before. Cursor, Grok, Antigravity and OpenCode report no
  named helpers.
