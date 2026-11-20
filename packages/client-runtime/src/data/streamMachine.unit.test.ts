import { expect, it } from "vite-plus/test";
import { initialStream, transition, type StreamEvent } from "./streamMachine.ts";

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
