import { expect, it } from "vite-plus/test";
import {
  initialStream,
  liveOrHeld,
  streamTrouble,
  transition,
  type StreamEvent,
  type StreamState,
} from "./streamMachine.ts";

const root = initialStream({ parent: null, mode: "realtime" });
const connecting = transition(root, { kind: "demand", demanded: true }, 0).state;

// witness: packages/client-runtime/src/data/streamMachine.ts | (event.kind === "manual-retry" || event.kind === "input-changed") → (event.kind === "manual-retry" || event.kind === "input-changed" || event.kind === "resume")
it("ST21: A definitive refusal is never revived by focus, remount, rotation or time", () => {
  const refused = transition(
    connecting,
    {
      kind: "fault",
      jitter: 0,
      fault: { outcome: "definitive-refusal", message: "403" },
    },
    0,
  ).state;
  expect(refused).toMatchObject({ phase: "refused", next: { kind: "await-input-change" } });
  const incidental: ReadonlyArray<StreamEvent> = [
    { kind: "resume" },
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
    expect(transition(refused, event, 0).directives).toEqual([{ kind: "connect", generation: 2 }]);
  }
});

// witness: packages/client-runtime/src/data/streamMachine.ts | attempt({ ...state, repaired: true }, now) → attempt({ ...state, repaired: false }, now)
it("ST22: A recoverable session is repaired once; a second expiry is a refusal", () => {
  const expired = {
    kind: "fault",
    jitter: 0,
    fault: { outcome: "recoverable-session", message: "4401" },
  } as const;
  const first = transition(connecting, expired, 0);
  expect(first.state).toMatchObject({
    phase: "reauthenticating",
    next: { kind: "repair-session" },
  });
  expect(first.directives).toEqual([{ kind: "repair-session" }]);
  const repaired = transition(first.state, { kind: "session-repaired" }, 0);
  expect(repaired.state.phase).toBe("connecting");
  expect(repaired.directives).toEqual([{ kind: "connect", generation: 2 }]);
  expect(transition(repaired.state, expired, 0).state.phase).toBe("refused");
});

const dropped = {
  kind: "fault",
  jitter: 0,
  fault: { outcome: "transient", message: "closed" },
} as const;
const run = (state: StreamState, steps: ReadonlyArray<readonly [StreamEvent, number]>) =>
  steps.reduce((current, [event, now]) => transition(current, event, now).state, state);
const live = run(connecting, [
  [{ kind: "handshake" }, 0],
  [{ kind: "baseline-committed" }, 0],
]);

// witness: packages/client-runtime/src/data/streamMachine.ts | if (state.held === true && state.lostAt === event.since) { → if (state.held === true && state.lostAt !== event.since) {
it("ST75: A link lost from live keeps what it read as current through its grace, and once the grace is over it is in trouble, down since the loss", () => {
  expect(live.phase).toBe("live");
  // Its first retry, within the grace, fails too.
  const lost = run(live, [
    [dropped, 1_000],
    [{ kind: "retry-due" }, 1_800],
    [dropped, 1_900],
  ]);
  expect(lost.phase).toBe("recovering");
  expect(liveOrHeld(lost)).toBe(true);
  expect(streamTrouble(lost)).toBeNull();
  expect(lost.lostAt).toBe(1_000);
  const down = transition(lost, { kind: "grace-over", since: 1_000 }, 6_000).state;
  expect(liveOrHeld(down)).toBe(false);
  expect(streamTrouble(down)).toBe("retrying");
  expect(down.lostAt).toBe(1_000);
});

// witness: packages/client-runtime/src/data/streamMachine.ts | lostAt: _lostAt, →
it("ST76: A link back live within its grace forgets the loss: the grace that then ends changes nothing", () => {
  const steps: ReadonlyArray<readonly [StreamEvent, number]> = [
    [dropped, 1_000],
    [{ kind: "retry-due" }, 1_800],
    [{ kind: "handshake" }, 1_900],
    [{ kind: "baseline-committed" }, 2_000],
  ];
  let state = live;
  for (const [event, now] of steps) {
    state = transition(state, event, now).state;
    expect(liveOrHeld(state)).toBe(true);
  }
  expect(state.phase).toBe("live");
  expect(state.lostAt).toBeUndefined();
  const after = transition(state, { kind: "grace-over", since: 1_000 }, 6_000).state;
  expect(after.phase).toBe("live");
  expect(liveOrHeld(after)).toBe(true);
  expect(after.lostAt).toBeUndefined();
});

// witness: packages/client-runtime/src/data/streamMachine.ts | return firstTry ? { ...after, patientSince: now } : after; → return after;
it("ST77: A first attempt gets the same grace before its failure is trouble", () => {
  const failed = run(root, [
    [{ kind: "demand", demanded: true }, 1_000],
    [dropped, 1_200],
  ]);
  expect(failed.phase).toBe("recovering");
  expect(streamTrouble(failed)).toBeNull();
  const over = transition(failed, { kind: "grace-over", since: 1_000 }, 6_000).state;
  expect(streamTrouble(over)).toBe("retrying");
});
