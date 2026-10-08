# Completed provider consumption

Mate usage belongs to agents launched by Mate and their child agents. Terminal sessions and other
container tools do not contribute. The provider runtime SPI reports completed turn usage; owned
accounting consumes only that typed evidence. A native turn identity within its native thread,
provider and registered Mate lifetime defines one immutable fact.

Claude final results include cumulative per-model usage for the main agent, Task agents and provider
helpers. Capture establishes a live native ledger baseline before admitting Mate input, then takes
the difference at each result, keyed by session id and result id. Main-only `result.usage` is never
added to that inclusive breakdown. Resume history is excluded by the live baseline. Codex records
each native thread's own responses within its turn, then emits one fact keyed by thread and turn.
Lifetime totals and context-window estimates are not consumption. Unsupported native delivery
remains an explicit coverage gap, never a guessed total.

A turn retains its reported model lines and separately reported total native cost. The headline
counts one turn; model groups count participating turns and their own token components. Those
participation counts are not additive across models. Header cost and per-model cost are separate
views of reported evidence and are never added together. Unknown categories and models remain
explicitly unknown; reasoning is a subset of output where the provider defines it that way.

`usage.sqlite` is a durable outbox separate from orchestration state. Its provider subscription is
acquired before command admission and capture continues while HQ is unavailable. A verified
org/project/Mate binding authorizes delivery; a different binding refuses it. The forward migration
drops old transcript tables without importing their unproved accounting.

The existing Mate→HQ socket sends bounded batches. HQ acknowledges identities only after its
transaction commits; Mate deletes only those facts. Permanent HQ receipts deduplicate retries and
cloned outboxes. There is no journal cursor, filesystem checkpoint or snapshot-repair protocol.

Before the first fact there is no recorded usage. Its date describes the observation boundary,
not the beginning of consumption. HQ retains exact turn facts for thirty days and daily totals and
dedup receipts indefinitely, including deleted Mates.
