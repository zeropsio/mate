# Instrumentation rules

Instrument side-effect boundaries: requests, persistence, external processes and queue handoffs.
Small helpers inherit the active span rather than creating a span for each call.
Request middleware owns request spans and metrics; handlers add context to the existing span.

Metric labels describe bounded categories such as operation, provider and outcome.
Identifiers, paths and detailed context belong on spans, never in metric labels.
