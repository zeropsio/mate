import { describe, expect, it } from "vite-plus/test";

import {
  initialStream,
  NEXT_ACTIONS,
  STREAM_POLICY,
  transition,
  type StreamEvent,
  type StreamState,
} from "./streamMachine.ts";

const root = initialStream({ parent: null, mode: "realtime" });

describe("transition", () => {
  it("starts an attempt with a handshake deadline when a root stream is demanded", () => {
    const { state, directives } = transition(root, { kind: "demand", demanded: true }, 1_000);

    expect(state.phase).toBe("connecting");
    expect(state.generation).toBe(1);
    expect(state.next).toEqual({
      kind: "await-handshake",
      deadlineAt: 1_000 + STREAM_POLICY.handshakeTimeoutMs,
    });
    expect(directives).toEqual([{ kind: "connect", generation: 1 }]);
  });

  it("is live only after the baseline commits, never on the handshake alone", () => {
    const connecting = run(root, [{ kind: "demand", demanded: true }], 0);
    const baselining = run(connecting, [{ kind: "handshake" }], 100);

    expect(baselining.phase).toBe("baselining");
    expect(baselining.next).toEqual({
      kind: "await-baseline",
      deadlineAt: 100 + STREAM_POLICY.baselineTimeoutMs,
    });
    expect(run(baselining, [{ kind: "baseline-committed" }], 200)).toMatchObject({
      phase: "live",
      next: { kind: "await-changes" },
      failures: 0,
      fault: null,
    });
  });

  it.each([
    { failures: 1, jitter: 1, retryAfterMs: undefined, delay: STREAM_POLICY.backoffBaseMs },
    { failures: 1, jitter: 0, retryAfterMs: undefined, delay: STREAM_POLICY.backoffBaseMs / 2 },
    { failures: 3, jitter: 1, retryAfterMs: undefined, delay: STREAM_POLICY.backoffBaseMs * 4 },
    { failures: 30, jitter: 1, retryAfterMs: undefined, delay: STREAM_POLICY.backoffCapMs },
    { failures: 1, jitter: 1, retryAfterMs: 90_000, delay: 90_000 },
  ])(
    "schedules transient failure $failures at $delay ms (jitter $jitter, Retry-After $retryAfterMs)",
    ({ failures, jitter, retryAfterMs, delay }) => {
      let state = run(root, [{ kind: "demand", demanded: true }], 0);
      for (let index = 0; index < failures; index += 1) {
        if (index > 0) state = transition(state, { kind: "retry-due" }, 0).state;
        state = transition(
          state,
          {
            kind: "fault",
            jitter,
            fault: {
              outcome: "transient",
              message: "socket closed",
              ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
            },
          },
          0,
        ).state;
      }

      expect(state.phase).toBe("recovering");
      expect(state.failures).toBe(failures);
      expect(state.next).toEqual({ kind: "retry", at: delay });
    },
  );

  it("never revives a definitive refusal by focus, remount, rotation or time", () => {
    const refused = run(
      root,
      [
        { kind: "demand", demanded: true },
        { kind: "fault", jitter: 0, fault: { outcome: "definitive-refusal", message: "403" } },
      ],
      0,
    );
    expect(refused).toMatchObject({ phase: "refused", next: { kind: "await-input-change" } });

    const incidental: ReadonlyArray<StreamEvent> = [
      { kind: "demand", demanded: false },
      { kind: "demand", demanded: true },
      { kind: "retry-due" },
      { kind: "handshake" },
      { kind: "fault", jitter: 0, fault: { outcome: "transient", message: "rotation" } },
      { kind: "deadline" },
    ];
    for (const event of incidental) {
      const { state, directives } = transition(refused, event, 999_999);
      expect(state.phase).toBe("refused");
      expect(directives).toEqual([]);
    }

    for (const event of [{ kind: "manual-retry" }, { kind: "input-changed" }] as const) {
      expect(transition(refused, event, 0).directives).toEqual([
        { kind: "connect", generation: refused.generation + 1 },
      ]);
    }
  });

  it("repairs a recoverable session once, then treats a second expiry as a refusal", () => {
    const sessionLost = {
      kind: "fault",
      jitter: 0,
      fault: { outcome: "recoverable-session", message: "4401" },
    } as const;
    const first = transition(run(root, [{ kind: "demand", demanded: true }], 0), sessionLost, 0);
    expect(first.state).toMatchObject({
      phase: "reauthenticating",
      next: { kind: "repair-session" },
    });
    expect(first.directives).toEqual([{ kind: "repair-session" }]);

    const repaired = transition(first.state, { kind: "session-repaired" }, 0);
    expect(repaired.state.phase).toBe("connecting");
    expect(repaired.directives).toEqual([{ kind: "connect", generation: 2 }]);

    expect(transition(repaired.state, sessionLost, 0).state.phase).toBe("refused");
  });

  it("pauses when demand ends, resumes on demand, and never retries a transient fault unasked", () => {
    const live = run(
      root,
      [{ kind: "demand", demanded: true }, { kind: "handshake" }, { kind: "baseline-committed" }],
      0,
    );
    const released = transition(live, { kind: "demand", demanded: false }, 0);
    expect(released.state).toMatchObject({ phase: "paused", next: { kind: "await-demand" } });
    expect(released.directives).toEqual([{ kind: "disconnect" }]);

    const transient = {
      kind: "fault",
      jitter: 0,
      fault: { outcome: "transient", message: "offline" },
    } as const;
    expect(transition(released.state, transient, 0).state.phase).toBe("paused");
    expect(transition(released.state, { kind: "demand", demanded: true }, 0).directives).toEqual([
      { kind: "connect", generation: 2 },
    ]);
  });

  it.each([
    { outcome: "access-unverified", phase: "paused", next: "await-access-verification" },
    { outcome: "authoritative-denial", phase: "refused", next: "await-input-change" },
  ] as const)("answers $outcome with $phase", ({ outcome, phase, next }) => {
    const state = run(
      root,
      [
        { kind: "demand", demanded: true },
        { kind: "fault", jitter: 0, fault: { outcome, message: outcome } },
      ],
      0,
    );
    expect(state).toMatchObject({ phase, next: { kind: next } });
  });

  it("lets a child scope wait for its parent's attempts, and retry only its own failed read", () => {
    const child = initialStream({ parent: "zerops:org", mode: "realtime" });
    const demanded = transition(child, { kind: "demand", demanded: true }, 0);
    expect(demanded.state).toMatchObject({ phase: "stale", next: { kind: "await-parent" } });
    expect(demanded.directives).toEqual([]);

    const live = run(
      demanded.state,
      [{ kind: "attempt" }, { kind: "handshake" }, { kind: "baseline-committed" }],
      0,
    );
    expect(live.phase).toBe("live");
    expect(live.generation).toBe(1);

    expect(transition(live, { kind: "parent-lost" }, 0).state).toMatchObject({
      phase: "stale",
      next: { kind: "await-parent" },
    });
    // Its own read failing is its own: it retries alone on the one policy, Retry-After a floor,
    // and opens nothing — the read runs on its parent's connection.
    const faulted = transition(
      live,
      {
        kind: "fault",
        jitter: 0,
        fault: { outcome: "transient", message: "HTTP 429", retryAfterMs: 3_000 },
      },
      0,
    );
    expect(faulted.state).toMatchObject({
      phase: "recovering",
      failures: 1,
      next: { kind: "retry", at: 3_000 },
    });
    expect(faulted.directives).toEqual([]);
    const retried = transition(faulted.state, { kind: "retry-due" }, 3_000);
    expect(retried.state).toMatchObject({ phase: "connecting", generation: 2 });
    expect(retried.directives).toEqual([]);

    const refused = run(
      live,
      [
        { kind: "fault", jitter: 0, fault: { outcome: "definitive-refusal", message: "403" } },
        { kind: "parent-lost" },
        { kind: "attempt" },
      ],
      0,
    );
    expect(refused.phase).toBe("refused");
  });

  it("names a revalidation for a sampled source instead of claiming live changes", () => {
    const sampled = run(
      initialStream({ parent: null, mode: "sampled" }),
      [{ kind: "demand", demanded: true }, { kind: "handshake" }, { kind: "baseline-committed" }],
      5,
    );
    expect(sampled.next).toEqual({ kind: "revalidate", at: 5 + STREAM_POLICY.sampledIntervalMs });
  });

  it("names no revalidation for a source read once: only an input change reads it again", () => {
    const once = run(
      initialStream({ parent: null, mode: "once" }),
      [{ kind: "demand", demanded: true }, { kind: "handshake" }, { kind: "baseline-committed" }],
      5,
    );
    expect(once).toMatchObject({ phase: "live", next: { kind: "await-input-change" } });
    expect(transition(once, { kind: "revalidate" }, 10).state.phase).toBe("connecting");
  });

  it.each([
    { mode: "sampled", phase: "live", reads: true },
    { mode: "sampled", phase: "recovering", reads: true },
    { mode: "sampled", phase: "refused", reads: false },
    { mode: "sampled", phase: "paused", reads: false },
    { mode: "realtime", phase: "live", reads: false },
  ] as const)(
    "a revalidation reads a $mode $phase scope again: $reads",
    ({ mode, phase, reads }) => {
      const child = initialStream({ parent: "zerops:org", mode });
      const reached = run(
        child,
        phase === "paused"
          ? [
              { kind: "demand", demanded: true },
              { kind: "demand", demanded: false },
            ]
          : [
              { kind: "demand", demanded: true },
              { kind: "attempt" },
              { kind: "handshake" },
              ...(phase === "live"
                ? [{ kind: "baseline-committed" } as const]
                : [
                    {
                      kind: "fault",
                      jitter: 0,
                      fault: {
                        outcome: phase === "refused" ? "definitive-refusal" : "transient",
                        message: phase,
                      },
                    } as const,
                  ]),
            ],
        0,
      );
      expect(reached.phase).toBe(phase);
      const next = transition(reached, { kind: "revalidate" }, 10).state;
      expect(next.phase).toBe(reads ? "connecting" : phase);
      expect(next.generation).toBe(reads ? reached.generation + 1 : reached.generation);
    },
  );

  it("keeps every reachable phase paired with its own kind of next action, and closed terminal", () => {
    const events: ReadonlyArray<StreamEvent> = [
      { kind: "demand", demanded: true },
      { kind: "demand", demanded: false },
      { kind: "handshake" },
      { kind: "baseline-committed" },
      { kind: "retry-due" },
      { kind: "deadline" },
      { kind: "manual-retry" },
      { kind: "revalidate" },
      { kind: "input-changed" },
      { kind: "session-repaired" },
      { kind: "attempt" },
      { kind: "parent-lost" },
      { kind: "unsupported" },
      ...(
        [
          "definitive-refusal",
          "recoverable-session",
          "transient",
          "access-unverified",
          "authoritative-denial",
        ] as const
      ).map(
        (outcome) =>
          ({ kind: "fault", jitter: 0.5, fault: { outcome, message: outcome } }) as const,
      ),
    ];
    let seed = 7;
    const draw = () => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed;
    };
    for (const parent of [null, "zerops:org"]) {
      for (let walk = 0; walk < 200; walk += 1) {
        const mode = (["realtime", "sampled", "once"] as const)[walk % 3]!;
        let state = initialStream({ parent, mode });
        for (let step = 0; step < 30; step += 1) {
          state = transition(state, events[draw() % events.length]!, step * 1_000).state;
          expect(NEXT_ACTIONS[state.phase]).toContain(state.next.kind);
        }
      }
    }

    const closed = transition(root, { kind: "close" }, 0).state;
    expect(closed).toMatchObject({ phase: "closed", next: { kind: "none" } });
    for (const event of events) expect(transition(closed, event, 0).state).toBe(closed);
  });
});

function run(state: StreamState, events: ReadonlyArray<StreamEvent>, now: number): StreamState {
  return events.reduce((current, event) => transition(current, event, now).state, state);
}
