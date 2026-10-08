# HQ recorded agent usage

Usage is consumption reported by completed native turns of agents launched through Mate, including
child work. The provider runtime SPI owns the billing evidence. Claude reports one final result
with model usage and cost for its billing turn; assistant messages and Task events add no separate
facts. Codex reports completed native thread/turn consumption. Transcripts and terminal activity
are not a usage source. Desktop inherits the hosted client; mobile retains its
current provider reader until a separate migration.

## Identity and delivery

Capture protocol 2 and report protocol 2 are independent capabilities. HQ advertises capture and
the registered Mate lifetime on the existing link's `state` frame; the scope socket advertises
`agentUsage: 2`. An absent answered capability is unsupported; an unanswered one is unknown.
Overview, attention, health and opened-Mate Limits remain independent.

A registered origin binds one provider to an organization, execution project and Mate registration
lifetime. A fact identifies the native thread and completed turn within that origin. Process
restart, login, cloning and repeated delivery do not create new consumption identities. Facts are
immutable: changed model lines, native identity, components or native cost at the same key are
refused. Reordering unique model lines does not change a turn.
The first server observation timestamps a completion when the provider has no timestamp; another
observation of that same completion cannot change its first occurrence or count it again.

Mate persists immutable facts in an outbox before delivery. `usage-facts` sends a bounded batch
with its registered origins; `usage-ack` names the accepted origin/fact keys after commit. Only
acknowledged keys leave the outbox. Outages and lost acknowledgements retain facts for resend.
There are no cursor chains, writer lineages, correction revisions or snapshot repair messages.
A damaged usage frame preserves the other link sections.

Admission locks the execution project and checks the current Mate registration, live credential
and process-bound socket fence in the leader transaction. A replacement connection fences the
old sender. Another organization or project cannot relabel an origin. Counts use checked decimal
strings; components are disjoint, reasoning is a subset of output, and missing components remain
unknown. An inclusive total substitutes for an incomplete split and is never added to that split.

## Permanent accounting and recent detail

One transaction commits the permanent receipt, exact turn fact and additive daily contributions before
acknowledgement. Identical retries acknowledge the existing receipt and add nothing. Conflicting
content refuses the entire batch. Receipts and daily source/model/price-band/meter cells have no
cascade to live registrations. Deleting a Mate retains its usage and last application placement;
recreating its execution project creates another registration lifetime.

A turn carries unique model lines with their disjoint components and reported model charges, plus
its separately reported total charge. Headline daily cells count one turn and sum its model tokens;
model daily cells count participation in each model. These are separate tables. Model participation
counts overlap across groups and are never summed into headline turn counts. A model filter selects
that model's participation, components and reported charge. Native headline charges are never added
to model charges or allocated to a model without provider evidence. Automatic pricing uses model
cells; its coverage denominator is model entries, independently of headline turn counts.

Exact rows and their per-turn model contributions expire after 30 days. Permanent receipts retain
only identity and a semantic digest. Leader activation and daily maintenance prune bounded batches;
receipts and daily contributions never expire. Whole UTC days use daily cells. Recent
subday edges use exact turns instead of their intersected daily cells. Hourly groups require
retained exact turns. Older exact boundaries are refused rather than interpolated. The first
recorded date belongs to the admitted origins and survives expiry. Consumption before that evidence
is unknown.
An empty result or a working connection cannot prove zero unrecorded consumption.

The forward migration preserves previous scanner origins, facts, receipts and daily history with
original provenance in separate history tables, and removes receipt contributions and its alias, journal, snapshot and
protection machinery. Reports default to `live-responses`. An explicit `legacy-scanner` query
reads historical daily accounting separately, marks its provenance and coverage gap, and refuses
exact or hourly reporting. Historical scanner values are never added to live turn accounting.
Restoration operates on the complete database, with receipts and daily cells together, and marks
restored coverage partial; today's live Mates cannot establish missing historical sources.

## Authorized report scope

The hosted client demands `agentUsage` through the account data layer on the existing HQ scope
socket. Reports use a repeatable PostgreSQL snapshot and join current canonical owners and
applications. Initiators and credential owners do not establish ownership. Retired Mates expose
last placement and have no current owner.

Live sources require `observe_mate` on the execution project. Retired sources require ACTIVE
membership in the original organization and org READ_ONLY or higher. Every filter, coverage row
and detail page uses the same admitted sources. An inaccessible selector is refused; absence
from the viewer's listing is not deletion. New facts, access changes and pricing generations
invalidate detail cursors. Reports do not open Mate sockets.

Reports have bounded server groups and keyset detail pages with explicit truncation. Daily
history remains available for lifetime reports; exact lifetime distinct-session counts are not
promised. Native cost stays separate by currency, basis and decimal scale. Automatic API-equivalent
pricing uses published model identities and retained components under a named policy revision;
unknown models, missing rates and unsupported modifiers remain unpriced. Pricing failure retains
the last usable policy. Limits and existing Mate price preferences keep their current behavior.
