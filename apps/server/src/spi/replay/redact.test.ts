import * as NodeOS from "node:os";

import { assert, describe, it } from "vite-plus/test";

import { REDACTED_CREATED_AT, redact } from "./redact.ts";

describe("redact", () => {
  it("replaces eventId with a stable per-array sequence id", () => {
    const events = [
      { eventId: "11111111-1111-1111-1111-111111111111", type: "session.started" },
      { eventId: "22222222-2222-2222-2222-222222222222", type: "session.configured" },
    ];

    const result = redact(events);

    assert.equal(result[0]?.eventId, "evt-0");
    assert.equal(result[1]?.eventId, "evt-1");
  });

  it("leaves an event with no eventId field untouched by that rule", () => {
    const result = redact([{ type: "session.started" }]);
    assert.equal("eventId" in (result[0] ?? {}), false);
  });

  it("replaces createdAt with a fixed placeholder", () => {
    const events = [{ eventId: "e1", createdAt: "2026-08-28T12:34:56.789Z" }];
    const result = redact(events);
    assert.equal(result[0]?.createdAt, REDACTED_CREATED_AT);
  });

  it("rewrites a freshly generated id consistently by value, wherever the field name occurs", () => {
    const events = [
      { eventId: "e1", type: "turn.started", turnId: "uuid-abc" },
      {
        eventId: "e2",
        type: "item.started",
        turnId: "uuid-abc",
        providerRefs: { providerTurnId: "uuid-abc" },
      },
      { eventId: "e3", type: "turn.started", turnId: "uuid-def" },
    ];

    const result = redact(events, {
      ids: [{ fields: ["turnId", "providerTurnId"], prefix: "turn" }],
    });

    assert.equal(result[0]?.turnId, "turn-0");
    assert.equal(result[1]?.turnId, "turn-0");
    assert.equal((result[1]?.providerRefs as { providerTurnId: string })?.providerTurnId, "turn-0");
    assert.equal(result[2]?.turnId, "turn-1");
  });

  it("rewrites an id value found nested anywhere, not just under its declared field name", () => {
    const events = [
      { eventId: "e1", turnId: "uuid-abc", raw: { payload: { turn: { id: "uuid-abc" } } } },
    ];

    const result = redact(events, { ids: [{ fields: ["turnId"], prefix: "turn" }] });

    assert.equal(
      (result[0]?.raw as { payload: { turn: { id: string } } })?.payload.turn.id,
      "turn-0",
    );
  });

  // Regression guard. Redaction used to rewrite any string equal to (or
  // under) the RUNNING machine's cwd/home/tmpdir. Applied to recorded
  // fixture content that came from another machine, that made the golden
  // comparison depend on where it ran: the recorded
  // "/tmp/cc-socks/<pid>.sock" survived on macOS (tmpdir /var/folders/...)
  // and was rewritten to "<TMPDIR>/..." on every Linux host, so all four
  // Claude goldens were red in CI and in the container while green on one
  // laptop. Redaction must stay a pure function of its input.
  it("leaves absolute paths untouched — redaction never consults the host environment", () => {
    const events = [
      {
        eventId: "e1",
        payload: {
          cwd: process.cwd(),
          home: NodeOS.homedir(),
          socket: `${NodeOS.tmpdir()}/cc-socks/164264.sock`,
        },
      },
    ];
    const result = redact(events, { ids: [{ fields: ["turnId"], prefix: "turn" }] });
    assert.deepEqual(result[0]?.payload, events[0]?.payload);
  });

  it("is a pure function: does not mutate the input array or its objects", () => {
    const original = { eventId: "e1", createdAt: "2026-01-01T00:00:00.000Z", nested: { a: 1 } };
    const events = [original];
    redact(events, {});
    assert.equal(original.eventId, "e1");
    assert.equal(original.createdAt, "2026-01-01T00:00:00.000Z");
  });
});
