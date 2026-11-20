next: RS4

- RS1 — A run reads as a running turn from its admission until it ends and as none while queued or in a state this build does not know; its end reads completed, interrupted when stopped, cut by a restart or held by a usage limit, broken when it failed or crashed, and none for an end kind this build does not know; breaks: a stopped turn shows as an error, or a queued message as working
- RS2 — An attempt admission refused because the sender may not use the login or nobody is on record for it never ran: it reads interrupted and leaves its conversation ready, while a refusal whose reason this build does not know reads broken; breaks: another person's refused message marks the conversation failed
- RS3 — A conversation reads running while a run is on, even when its last run broke; at rest it reads error only when its last run broke, otherwise ready; breaks: a working conversation shows an error, or a broken one shows ready
