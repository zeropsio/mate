next: ES11

- ES1 — A step's events, its run and item rows and its queued effects are written by one commit; breaks: a run the record shows admitted with no effect queued to carry it never starts
- ES2 — A write that fails anywhere inside a step leaves no receipt, event, run, item, effect or conversation row of it, and the same command then commits whole; breaks: a half-written receipt makes the retry a duplicate and the person's message is lost
- ES3 — A command committed again under its id, accepted or rejected, returns its first answer and writes nothing; breaks: a client's resend sends the message twice
- ES4 — A conversation's events are numbered without a gap, each conversation on its own, and a rejected command takes no number; breaks: a reader waiting for the missing number stalls the conversation
- ES5 — A commit from a state older than the stored head is refused and writes nothing, so the actor reloads; breaks: two writers interleave their events
- ES6 — A conversation loads from its snapshot and the events after it to the same state as a fold of its whole record, its lease included; breaks: after a restart the conversation is not the one its record holds
- ES7 — A snapshot of another state version is never read: the conversation is folded from its record; breaks: a release that changes the state's shape loads its conversations wrong
- ES8 — The conversation's row names the agent it belongs to, as the boot and the usage watch read it; breaks: after a restart the conversation's agent is unknown and its usage unwatched
- ES9 — A step whose event this build cannot encode (a driver's call state the contracts do not know) is refused as invalid-signal, writing only its receipt, and the conversation still loads; breaks: one unreadable event makes the conversation unloadable for good
- ES10 — A conversation's window carries the crew card that opened each run it holds, ended or not, beside the person's messages; breaks: a crewmate's conversation opens on a finished turn with no task, and its card drops in above it on Show work
