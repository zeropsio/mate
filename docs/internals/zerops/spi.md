# Provider runtime SPI rules

The SPI is the boundary between ported provider drivers and owned consumers. Provider-specific
complexity belongs here, so a port does not teach the product a new raw format.

## 1. Outbound boundary

Owned product consumes typed SPI events and capabilities, never provider internals or raw
`payload.data`. Raw tool decoding has one owner at the boundary. Durable core ingestion may use
the provider service's raw stream; it must not acquire product enrichment responsibilities.

## 1a. Inbound boundary

Thread tool policy is provider-neutral. A driver translates that policy into its native options
and approval protocol. Inbound SPI modules import only packages and other inbound modules;
they must not reach back through outbound wrappers into provider code.

Keep provider capability evidence separate from a policy's requested behavior. An adapter mock
cannot establish that a native CLI enforces approval, starts MCP or applies a sandbox.

## 2. Contract changes

The contract source owns the SPI version and changelog. Change its version when an event or
an enrichment changes what owned code may depend on, not merely because a driver was ported.
An expectation change requires explicit contract review; golden regeneration is not approval.

## 3. Evidence

Keep native identity and provenance. Absence of a field is not evidence of a negative result;
missing consumption is not zero consumption. Do not substitute lifetime or context counters for
own-turn consumption, or synthetic capture for native delivery evidence.

## 4. Delivery ownership

The provider service owns delivery. A wrapper preserves its guarantee rather than adding a
second buffer, replay policy or inferred receipt. A consumer must establish its subscription
before the events it needs; fan-out is not durable history.

## 5. Enrichment ownership

Normalize provider shapes once at the SPI boundary. Keep an unrelated item distinct from a tool
item whose shape cannot be read. Report failed enrichment without discarding the original event.
Consumers read typed enrichment; they never add fallback raw-shape readers.

## 6. Capabilities

Expose only the typed capability an owned consumer needs. Keep driver imports inside the boundary
and test doubles inside test support. Do not add a wrapper that merely moves caller knowledge.

## 7. Fixture evidence

A fixture names its provider, native versions and origin. Mark authored scenarios as synthetic;
never present them as recordings. Preserve identity relationships through redaction and keep
secrets out of fixtures. A replay proves only the paths it drives; native behavior needs native
evidence. Diagnose a divergence before changing an expectation.
