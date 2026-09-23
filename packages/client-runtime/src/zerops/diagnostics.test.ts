import { describe, expect, it } from "vite-plus/test";

import { ConnectionBlockedError } from "../connection/model.ts";
import { ZeropsApiError } from "./api.ts";
import {
  REDACTED,
  createMateDiagnostics,
  diagnosticFailure,
  type DiagnosticFailure,
  type MateDiagnosticEvent,
} from "./diagnostics.ts";

function clock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("the diagnostics ring", () => {
  it("keeps only the newest entries once it is full", () => {
    const diagnostics = createMateDiagnostics({ capacity: 3, now: clock().now, enabled: true });
    for (let round = 1; round <= 5; round++) {
      diagnostics.record({ kind: "access-grant", round });
    }
    expect(diagnostics.snapshot().map((entry) => ("round" in entry ? entry.round : null))).toEqual([
      3, 4, 5,
    ]);
  });

  it("stamps each typed event with the injected clock", () => {
    const time = clock(1_000);
    const diagnostics = createMateDiagnostics({ now: time.now, enabled: true });
    diagnostics.record({ kind: "access-timer", timer: "renewal" });
    time.advance(250);
    diagnostics.record({
      kind: "route-gate",
      verdict: "restoring",
      environmentId: "0b6b7d0e-3c56-4a36-9d1c-6f4f0c1d2e3f",
    });
    time.advance(50);
    diagnostics.record({ kind: "catalog", change: "disposed" });
    // @ts-expect-error — not a diagnostic the client knows
    diagnostics.record({ kind: "keystroke", key: "a" });
    expect(diagnostics.snapshot().slice(0, 3)).toEqual([
      { t: 1_000, kind: "access-timer", timer: "renewal" },
      {
        t: 1_250,
        kind: "route-gate",
        verdict: "restoring",
        environmentId: "0b6b7d0e-3c56-4a36-9d1c-6f4f0c1d2e3f",
      },
      { t: 1_300, kind: "catalog", change: "disposed" },
    ]);
  });

  it("hands a reader a copy, never the ring", () => {
    const diagnostics = createMateDiagnostics({ now: clock().now, enabled: true });
    diagnostics.record({ kind: "access-grant", round: 1 });
    const first = diagnostics.snapshot() as unknown as Array<Record<string, unknown>>;
    first[0]!.round = 99;
    first.push({ t: 5, kind: "access-grant", round: 2 });
    expect(diagnostics.snapshot()).toEqual([{ t: 0, kind: "access-grant", round: 1 }]);
  });

  it("records nothing until enabled, and nothing survives a clear", () => {
    const diagnostics = createMateDiagnostics({ now: clock().now });
    diagnostics.record({ kind: "access-grant", round: 1 });
    expect(diagnostics.snapshot()).toEqual([]);
    diagnostics.enable();
    diagnostics.record({ kind: "access-grant", round: 2 });
    expect(diagnostics.snapshot()).toEqual([{ t: 0, kind: "access-grant", round: 2 }]);
    diagnostics.clear();
    expect(diagnostics.snapshot()).toEqual([]);
  });

  it("records a first-time mark once per identity until cleared", () => {
    const time = clock();
    const diagnostics = createMateDiagnostics({ now: time.now, enabled: true });
    diagnostics.recordOnce({ kind: "flow-pr-row", groupId: "g1" });
    time.advance(5);
    diagnostics.recordOnce({ kind: "flow-pr-row", groupId: "g1" });
    diagnostics.recordOnce({ kind: "flow-pr-row", groupId: "g2" });
    expect(diagnostics.snapshot()).toEqual([
      { t: 0, kind: "flow-pr-row", groupId: "g1" },
      { t: 5, kind: "flow-pr-row", groupId: "g2" },
    ]);
    diagnostics.clear();
    diagnostics.recordOnce({ kind: "flow-pr-row", groupId: "g1" });
    expect(diagnostics.snapshot()).toEqual([{ t: 5, kind: "flow-pr-row", groupId: "g1" }]);
  });
});

describe("spans", () => {
  it("ends once with its duration, and drops only one that never ended", () => {
    const time = clock(100);
    const diagnostics = createMateDiagnostics({ now: time.now, enabled: true });
    const finished = diagnostics.span("flow-pass", { pass: "forge", groups: 2 });
    time.advance(40);
    finished.end({ answered: 1 });
    finished.drop();
    finished.end({ answered: 2 });
    const superseded = diagnostics.span("access-round", { round: 7 });
    time.advance(10);
    superseded.drop();
    superseded.end({ outcome: "verified", reads: 3 });
    expect(diagnostics.snapshot()).toEqual([
      { t: 100, kind: "flow-pass", phase: "start", pass: "forge", groups: 2 },
      {
        t: 140,
        kind: "flow-pass",
        phase: "end",
        pass: "forge",
        groups: 2,
        durationMs: 40,
        answered: 1,
      },
      { t: 140, kind: "access-round", phase: "start", round: 7 },
      { t: 150, kind: "access-round", phase: "dropped", round: 7, durationMs: 10 },
    ]);
  });

  it("measures nothing while the recorder is off", () => {
    const diagnostics = createMateDiagnostics({ now: clock().now });
    const span = diagnostics.span("identity-exchange", {
      origin: "https://a.zerops.app",
      reason: "restore",
    });
    span.end({ outcome: "success" });
    expect(diagnostics.snapshot()).toEqual([]);
  });
});

describe("what the ring never stores", () => {
  // A field is typed as an id, an origin or a code — the recorder does not
  // trust that. Every value below arrives as a string field.
  const redacted: ReadonlyArray<readonly [string, string]> = [
    ["an e-mail", "person@example.com"],
    ["an e-mail inside a sentence", "signed in as Person.Name+mate@example.co.uk today"],
    ["a bearer header", "Bearer abc"],
    ["a lower-case bearer", "bearer sk-0123"],
    ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"],
    ["a long mixed token", "Zx9aQ2bR7cT4dU1eV8fW3gX6hY5iZ0jK2lM"],
    ["a long base64url token", "kP3_q-9Rz0T8vW2xY5aB7cD1eF4gH6iJ8kL0mN2oP4q"],
    ["a token after a label", "credential=Zx9aQ2bR7cT4dU1eV8fW3gX6hY5iZ0jK2lM"],
    ["a long run of letters", "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz"],
  ];
  const kept: ReadonlyArray<readonly [string, string]> = [
    ["a Zerops id", "Rd2bffa7R32zxR2q5UeCcA"],
    ["a UUID", "0b6b7d0e-3c56-4a36-9d1c-6f4f0c1d2e3f"],
    ["a container origin", "https://zcp-26a7-8080.prg1.zerops.app"],
    ["a failure code", "RemoteEnvironmentAuthTimeoutError"],
    ["a tagged reason", "ConnectionBlockedError:authentication"],
  ];

  for (const [name, value] of redacted) {
    it(`redacts ${name}`, () => {
      const diagnostics = createMateDiagnostics({ now: clock().now, enabled: true });
      diagnostics.record({ kind: "thread-content", environmentId: value, threadId: "t-1" });
      expect(diagnostics.snapshot()).toEqual([
        { t: 0, kind: "thread-content", environmentId: REDACTED, threadId: "t-1" },
      ]);
      expect(JSON.stringify(diagnostics.snapshot())).not.toContain(value);
    });
  }

  for (const [name, value] of kept) {
    it(`keeps ${name}`, () => {
      const diagnostics = createMateDiagnostics({ now: clock().now, enabled: true });
      diagnostics.record({ kind: "flow-pr-row", groupId: value });
      expect(diagnostics.snapshot()).toEqual([{ t: 0, kind: "flow-pr-row", groupId: value }]);
    });
  }

  it("drops a field that is not a primitive", () => {
    const diagnostics = createMateDiagnostics({ now: clock().now, enabled: true });
    const leak = { kind: "flow-pr-row", groupId: "g", cause: new Error("person@example.com") };
    diagnostics.record(leak as MateDiagnosticEvent);
    expect(diagnostics.snapshot()).toEqual([{ t: 0, kind: "flow-pr-row", groupId: "g" }]);
  });
});

describe("diagnosticFailure", () => {
  const cases: ReadonlyArray<readonly [string, unknown, DiagnosticFailure]> = [
    [
      "a platform refusal keeps its kind, its code and its status",
      new ZeropsApiError("You cannot do that, person@example.com.", "forbidden", 403, "noAccess"),
      { code: "ZeropsApiError:forbidden:noAccess", status: 403 },
    ],
    [
      "an uncertain write has a kind and nothing else",
      new ZeropsApiError("Zerops never said.", "uncertain"),
      { code: "ZeropsApiError:uncertain" },
    ],
    [
      "a door verdict keeps its reason, never its detail",
      new ConnectionBlockedError({ reason: "authentication", detail: "person@example.com" }),
      { code: "ConnectionBlockedError:authentication" },
    ],
    [
      "a transport fault is its tag",
      { _tag: "RemoteEnvironmentAuthTimeoutError", message: "timed out" },
      { code: "RemoteEnvironmentAuthTimeoutError" },
    ],
    [
      "a free-text reason is not a code",
      { _tag: "SomethingFailed", reason: "the door said no to person@example.com" },
      { code: "SomethingFailed" },
    ],
    [
      "an HTTP status rides along",
      { _tag: "GiteaError", status: 409 },
      { code: "GiteaError", status: 409 },
    ],
    [
      "a plain error is its name",
      new TypeError("Failed to fetch https://x"),
      { code: "TypeError" },
    ],
    ["anything else is unknown", "person@example.com", { code: "unknown" }],
  ];

  for (const [name, cause, expected] of cases) {
    it(name, () => {
      expect(diagnosticFailure(cause)).toEqual(expected);
    });
  }
});
