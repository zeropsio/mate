# Instrumentation rules

Instrument side-effect boundaries: requests, persistence, external processes and queue handoffs.
Small helpers inherit the active span rather than creating a span for each call.
Request middleware owns request spans and metrics; handlers add context to the existing span.

Metric labels describe bounded categories such as operation, provider and outcome.
Identifiers, paths and detailed context belong on spans, never in metric labels.

## A run's timing

Each ended run of a conversation is one `engine.run` span in the server trace. Its duration is the
run's wall time; its attributes split that time into the model, waiting on the person, compaction
and each tool class, which always sum to the wall. A call's time starts when the agent starts writing
the call, so writing a large edit counts to its tool.

Read one conversation's runs with:

```sh
grep -h '"name":"engine.run"' <logs dir>/server.trace.ndjson* | grep -F '<conversation id>'
```

Read all runs' p50 and p90 with `mate trace summary`.
