next: RS18

- RS1 — A run reads as a running turn from its admission until it ends and as none while queued or in a state this build does not know; its end reads completed, interrupted when stopped, cut by a restart or held by a usage limit, broken when it failed or crashed, and none for an end kind this build does not know; breaks: a stopped turn shows as an error, or a queued message as working
- RS2 — An attempt admission refused because the sender may not use the login or nobody is on record for it never ran: it reads interrupted and leaves its conversation ready, while a refusal whose reason this build does not know reads broken; breaks: another person's refused message marks the conversation failed
- RS3 — A conversation reads running while a run is on, even when its last run broke; at rest it reads error only when its last run broke, otherwise ready; breaks: a working conversation shows an error, or a broken one shows ready
- RS4 — A conversation's row is named by the first line of its latest ask that has words once its markdown is read, a rule or a code fence having none and a message of pictures alone reading as their count, never by a request a page sent for the person
- RS5 — A row's snippet is the agent's latest words with their credentials masked, and none when those words came before the latest ask
- RS6 — While its run is on the row reads working since the run started, and queued since it was asked while the run is admitted, being sent or waiting its turn
- RS7 — The row waits on a question or an approval its running turn asks, in the ask's words
- RS8 — A value asked of the person makes the row wait on them in the ask's words once the run that asked ended, and the row reads working while the agent works on
- RS9 — After its run ended, an approval or a question a helper waits on makes the row wait on the person, while a question asked by message or an ask nobody can answer any more leaves the helpers working
- RS10 — A usage limit holding the queue reads paused until its reset, and paused with no reset when the reset is unknown
- RS11 — Work its turn started keeps the row working after the turn, naming the first five of its helpers and the first five of its own jobs apart, oldest first, each title cut to what shares a line, and counting them all and its helpers; the agent's own turn due on them reads working too
- RS12 — A last run that failed or crashed reads failed with its reason, and a completed or stopped one reads idle, as does a conversation where nothing ever ran
- RS13 — A person's Stop in force says stopping on the working row, of its run or of the helpers its turn left, and a Stop with nothing left to end reads idle
- RS14 — Answering a request takes the row from waiting straight to working, never through idle
- RS15 — A run a restart cut says what the platform said and that it carries on while its continuation runs, or, when it was not continued, why, as the row's failure; without the platform's words it says the Mate restarted
- RS16 — The row names the run on and, as its latest run, the one with the highest ordinal and how it ended
- RS17 — The row says when the agent asked what its running turn waits on
