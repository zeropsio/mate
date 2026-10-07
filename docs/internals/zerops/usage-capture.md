# Completed provider consumption

Mate usage belongs to agents launched by Mate and their child agents. Terminal sessions and other
container tools do not contribute. The provider runtime SPI reports immutable completed response
usage; owned accounting code consumes only that typed evidence. A native response identity within
its native thread, provider and registered Mate lifetime defines one fact. Neither process boots,
provider homes, copied files nor equal token counts define consumption identity.

`usage.sqlite` is a durable outbox separate from orchestration state. The provider subscription is
acquired before command admission, and capture continues while HQ is unavailable. A verified
org/project/Mate binding authorizes delivery. A different binding refuses delivery of the retained
outbox. The forward database migration drops the old transcript tables without importing their
unproved accounting.

The existing Mate→HQ socket sends bounded fact batches. HQ acknowledges fact identities only after
its transaction commits. Mate deletes only those acknowledged facts; a lost acknowledgement causes
resend under the same identities. HQ's permanent receipts deduplicate both retries and cloned
outboxes. No journal cursor, filesystem checkpoint or snapshot-repair protocol exists.

A response's reported model and disjoint token components are retained, with unknown components
represented explicitly. Reasoning is a subset of output where the provider defines it that way;
it is never added twice. Native cost is retained only with reported amount and currency. A chosen
model, subscription limit, lifetime total or parent aggregate is not a response usage fact. Native
reporting capabilities differ; missing evidence remains a coverage gap.

Before the first fact there is no recorded usage. The first-recorded date describes the observation
boundary, not the beginning of a person's consumption. HQ retains exact response facts for thirty
days and daily totals and dedup receipts indefinitely, including deleted Mates.
