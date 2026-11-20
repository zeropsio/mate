next: EO19

- EO1 — Effects are claimed first-in first-out per conversation and lane, and a row in backoff holds the rows behind it while other lanes and conversations go on; breaks: a message overtakes the one before it
- EO2 — A Stop or an answer is claimed while the send before it is still in flight; breaks: a Stop waits behind a hanging send
- EO3 — An effect queued twice under one id runs once; breaks: a deploy or a message goes twice
- EO4 — A handler that finds evidence of its act adopts it instead of acting again; breaks: a restart repeats an act that already happened
- EO5 — A conversation's retryable failure backs off and fails for good at its attempt limit; breaks: a run waits forever on an effect that cannot succeed
- EO6 — At boot, process-bound work the restart cut is cut and its owner told, and replay-safe work is queued again; breaks: a send goes to a session that died with the process
- EO7 — The first message after a restart opens a new session and reaches the agent; breaks: the message waits on the dead session
- EO8 — A message accepted on an open session before a restart reaches the agent after it; breaks: the message is lost with the session
- EO9 — An outcome that failed to record is recorded later, and its lane moves on; breaks: the lane stays held for good
- EO10 — Every write that changes what the worker may claim rings its bell: an outcome, a backoff, a settle put off, a stray row closed, rows queued; breaks: work waits for an unrelated wake
- EO11 — An idle worker claims nothing until a row is due or the bell rings, and sleeps exactly to the next due row; breaks: a periodic wake polls the outbox
- EO12 — An outcome decided before a restart is recorded at boot before anything is cut; breaks: finished work is cut and done again
- EO13 — A send whose handler died after the message went out is not sent again; breaks: the agent gets the message twice
- EO14 — A long crew effect on one lane never holds another lane; breaks: one crewmate's check blocks another's Git
- EO15 — The crew runs at most 8 effects at once, and its cap never holds a conversation's effect; breaks: a busy crew stalls every conversation
- EO16 — Each boot tells a crew once that it restarted, so it reconciles what it holds; breaks: a crew keeps work the restart cut
- EO17 — A conversation's effect that waits on a crewmate's copy rides out the outage a crew effect rides out; breaks: a brief ssh outage fails the person's step
- EO18 — A crew effect rides out a minute's outage that fails a conversation's ordinary effect for good; breaks: the crew gives up on a container restart, or a person waits minutes on a dead effect
