# The Mate engine

The engine runs a Mate's conversations: it takes what a person, a driver, a wake or a finished
effect says, decides what follows, records it, and does the work that follows. It replaces the
inherited orchestrator and the crew engine's scheduler. Until cutover both engines ship in every
build and `T3CODE_MATE_ENGINE` picks one per Mate at boot (`v1`, the default, or `mate`).

## Terms

- **Agent** — who does the work: the Mate, or a crewmate. Its profile is the persona, prompt, tool
  gate, in-process tools, hooks, driver and model. The model, its options (effort) and the runtime
  mode are the conversation's settings, never a per-message choice; an option the driver takes per
  turn goes with the next message, any other change opens a new session with a hand-off, between
  runs. Plan mode is per message. Another driver is taken only before the conversation started.
- **Conversation** — exactly one per agent: the durable record a person reads, plus the queue of
  sends waiting for their turn. There is no second chat and no pinned main.
- **Session** — the agent's context inside one driver. Sessions rotate under the conversation; each
  boundary records its reason (model, settings, context, restart, usage, cleared) and what the new session was
  seeded with. A session opens explicitly, never as a side effect of a send, stop or answer.
- **Run** — one unit of work. It has a **trigger** (a person's message, or a wake: stand-up,
  usage resume, restart continuation, a helper's or job's report, the agent's own turn, crew), a
  **principal** (on whose behalf and subscription it runs) and one of these states:
  `queued → admitted → sending → running → waiting → ended`. Its end is one of `completed`,
  `stopped`, `failed`, `crashed`, `usage-limit`, `superseded`, `cut-by-restart`, and records its
  source: the bridge's word for its turn (the agent said so, a Stop was asked or confirmed, or it
  was inferred from a crash, a closed session or the next turn), or the engine's (a restart, an
  effect that failed for good). Every turn-scoped signal names its turn, so it lands on that turn's
  run. A run that continues another one `joins` it and shares its card. `unresponsive` is a mark a
  watchdog may set on a running run; it is never an end.
- **Item** — one typed thing in the record: a person's message, a note, a thought, a call, a helper
  or job report, a plan, a request's place, the context the agent was told, a marker (compaction,
  session boundary, command, resumed, woke). Every item has a server sequence that is its order,
  and a revision. Heavy detail is read on demand.
- **Request** — something waiting on a person: an approval, a question, a vault ask, a plan. It
  knows whether it can still be answered.
- **Effect** — work outside the engine: a send, steer, interrupt, answer, session open or close,
  workspace capture, a crew step. It is recorded before it runs, its id comes from its cause, and
  its outcome comes from evidence. A process-bound effect cut by a restart is reconciled, never
  re-sent blindly; a replay-safe effect is retried.
- **Wake** — a run that no person pressed: armed with a due time and an owner, fired once, dropped
  when its guard fails.
- **Owner** — who writes a stream of the log: a conversation, or a Mate's crew (`crew/main`). Each
  kind has its own rules and state and the same machinery: one writer, the receipt, the outbox,
  wakes, boot recovery. The crew reaches a conversation only by command (its delivery's effect id
  is the command id, so the receipt dedupes a resend) and reads it only through its gapless log.

## Rules

1. **One writer per owner.** Commands, driver signals, effect outcomes and wakes enter one actor,
   in order. One conversation never waits on another's driver, and a crew's git work never holds a
   conversation's effects.
2. **One transaction per step.** The receipt, the events, the projections, the outbox rows and the
   wakes commit together or not at all. A repeated command returns its stored result and writes
   nothing.
3. **The run is the only answer to "is it working".** The face, the menu, HQ's attention and crew
   read runs; nothing else says running.
4. **No effect without a record.** Every outside action is an outbox row first.
5. **No timer decides an outcome.** A timer may make a wake due or mark a run unresponsive. Only
   evidence ends a run, settles an effect or closes a request. A gauge (context use, rate limits)
   stays live and is never an outcome; a run's end keeps only where it stood: its cost and the
   last context reading.
6. **Every run has a principal.** Only the signer starts a person's run; anyone who can open the
   Mate may stop it. A wake names its principal and passes the same admission. A run whose
   principal is the crew is the crew's to carry on: a restart or a usage limit ends it and the
   engine arms no continuation; the crew reads the end and holds or delivers again.
7. **The server orders and stamps.** Each conversation has one gapless sequence; client clocks are
   display only. Streamed text is never stored; boundaries are.
8. **Clients render, they don't derive.** Runs, items, requests and the conversation row arrive
   ready to draw. Pictures travel as asset references, never inline.
9. **What the agent was told is recorded.** Notes are composed on the server and stored as items, so
   a new session gets them too. A vault value never reaches the model or the record.
10. **Old readers keep working.** Every union on the wire tolerates unknown members, the protocol
    carries a version, and a client meets a Mate it cannot speak to with an update route, not a
    failure.

## Drivers

The engine consumes the provider SPI through a bridge: drivers stay unaware of runs and receive an
opaque turn handle. Where a driver cannot report a fact the bridge says "unknown" rather than
guessing. The engine owns the send queue and steers only a driver that really takes a message into
a running turn. A driver that parks a turn on a usage limit has its run ended `usage-limit`; a
usage-resume wake starts the next run, which joins it.

## Running beside the old engine

One engine runs per Mate process, chosen at boot. In `mate` mode the old engine is built but
parked: its reactors, reaper and boot reconcile don't start and its doors refuse. Crew stays off
until it runs on the engine. The engine's tables are `engine_*`, on their own migration track, in
the same database. At the flip the Mate's conversation copies the V1 main thread's record in once,
before it runs anything of its own: its newest turns become ended runs marked `imported`, never
sent, woken or answerable, and V1's tables are only read, so flipping back finds V1's history. A
client learns which wire a Mate speaks from the environment descriptor before it opens a socket.
The conversation's chat-gate journeys keep their sentences for both engines.
