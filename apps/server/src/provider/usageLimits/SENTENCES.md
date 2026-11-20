next: US14

- US1 — A usage probe that fails keeps the windows a provider last published, and one that answers unsupported replaces them
- US2 — A streamed usage update never gives windows to an account its provider answered unsupported
- US3 — Claude's usage read shows the session, the weekly and each model-scoped weekly window that reports a utilization, at most 100 percent, and no row for a window that reports none
- US4 — A streamed Claude event for the overage-included bucket opens no row before a usage read named that bucket, and lands on the named model's row after
- US5 — Codex usage shows only the main allowance: a Spark or other model-specific bucket, in a read or a notification, never fills or replaces its rows
- US6 — A refused Codex turn pauses until the latest exhausted window resets, and gives no reset when no window is exhausted with a known future reset or the bucket is another model's
- US7 — Claude's banked resets count the grants usable now that are neither paused nor past or invalid in their end, and offer one to redeem only when the account is eligible and its next grant is among them
- US8 — A Claude reset claim with a malformed grant or request id fails before any request is sent
- US9 — A Claude reset claim that Claude answered with a cooldown, a 429 or a 401 is settled, so a retry is a new claim, and one left unanswered by a 5xx or unconfirmed is not
- US10 — Redeeming a reset credit re-sends the same idempotency key after an unanswered attempt and takes a fresh key after an outcome or a settled failure
- US11 — Two redemptions on one account run one after the other, while redemptions on different accounts run at once
- US12 — A redemption through a CLIProxyAPI hub carries a request id derived from the Codex account and the credit, the same on every retry, and clears only that account's cooldown
- US13 — A CLIProxyAPI hub account whose read fails shows a failed probe while the other accounts still show their windows, and no upstream error body reaches what is published
