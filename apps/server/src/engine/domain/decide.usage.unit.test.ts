import { expect, it } from "vite-plus/test";
import { ConversationId, wakeId } from "@t3tools/contracts";
import type { Command } from "./command.ts";
import type { ConversationState } from "./state.ts";
import {
  T,
  T0,
  fired,
  opened,
  play,
  prepared,
  r,
  running,
  send,
  settled,
  signal,
  stop,
} from "../testing/scene.ts";

const MINUTE = 60_000;
const bo = { kind: "person", subject: "bo" } as const;
const conversation = ConversationId.make("mate");
const resumeOf = (n: number) => wakeId(conversation, "usage-resume", r(n));
const probeOf = (n: number) => wakeId(conversation, "usage-probe", r(n));
const sentTurn = (run: number) =>
  settled(r(run), "provider.send", { kind: "ok", value: { providerTurnId: `t${run}` } });
const proofRunning = [send("go"), prepared(1), opened(1), sentTurn(1)];
const limited = [...running, signal({ kind: "usage-limit", resetsAt: T0 + 60 * MINUTE })];
const unknownLimit = signal({ kind: "usage-limit", resetsAt: null });
const reset = T0 + 24 * 60 * MINUTE;
const pausedOn = [...proofRunning, signal({ kind: "usage-limit", resetsAt: reset })];
const held = [...pausedOn, send("still there?")];
const usage = (
  windows: ReadonlyArray<{ readonly usedPercent: number; readonly resetsAt: number | null }>,
  checkedAt = T0 + MINUTE,
) => ({
  command: { _tag: "ProviderUsage", usage: { checkedAt, windows } } as Command,
  by: { kind: "engine" } as const,
  at: checkedAt,
});
const otherAccount = usage([
  { usedPercent: 17, resetsAt: T0 + 3 * 60 * MINUTE },
  { usedPercent: 24, resetsAt: T0 + 4 * 24 * 60 * MINUTE },
]);
const shape = (state: ConversationState) => ({
  paused: state.pausedUntil,
  runs: Object.values(state.runs).map((run) => [
    run.ordinal,
    run.state,
    run.trigger.kind === "wake" ? run.trigger.cause : run.trigger.kind,
  ]),
});
const continued: Command = { _tag: "Continue" };

// witness: apps/server/src/engine/domain/decide.step.ts | b.now < b.state.pausedUntil → b.now > b.state.pausedUntil
it("ED52: A usage limit ends its run and holds every later message until the provider's exact reset", () => {
  const scene = play([...running, signal({ kind: "usage-limit", resetsAt: T0 + 60 * MINUTE })]);
  expect(scene.state.runs[r(1)]).toMatchObject({
    end: { kind: "usage-limit" },
    endSource: "agent",
  });
  expect(scene.state.wakes[resumeOf(1)]?.dueAt).toBe(T0 + 60 * MINUTE);
  expect(scene.state.pausedUntil).toBe(T0 + 60 * MINUTE);
  expect(play([...limited, send("still there?")]).state.runs[r(2)]?.state).toBe("queued");
});

// witness: apps/server/src/engine/domain/decide.wakes.ts | !newerPersonMessage(b.state, wake) && → newerPersonMessage(b.state, wake) &&
it("ED53: At the reset the limited work resumes as a run that joins the limited one and acts for its principal, unless a message sent during the limit goes first", () => {
  const resumed = play([...limited, fired("usage-resume", r(1), T0 + 60 * MINUTE)]);
  expect(resumed.state.runs[r(2)]).toMatchObject({
    state: "admitted",
    joins: r(1),
    trigger: { kind: "wake", cause: "usage-resume" },
    principal: { kind: "person", subject: "ana" },
  });
  expect(resumed.state.pausedUntil).toBeNull();
  const first = play([
    ...limited,
    { command: send("me first"), by: bo },
    fired("usage-resume", r(1), T0 + 60 * MINUTE),
  ]);
  expect(first.state.runs[r(2)]).toMatchObject({ state: "admitted", principal: bo });
  expect(first.state.runs[r(3)]).toBeUndefined();
});

// witness: apps/server/src/engine/domain/decide.usage.ts | Math.min(2 * last, USAGE_PROBE_MAX_MS) → 2 * last
it("ED54: A usage limit whose reset is unknown holds queued work and is probed after 15 minutes, then twice as long, up to an hour; the person writing again lifts it", () => {
  const queued = play([...proofRunning, send("queued"), unknownLimit]);
  expect(queued.state.runs[r(1)]?.end?.kind).toBe("usage-limit");
  expect(queued.state.runs[r(2)]?.state).toBe("queued");
  const first = play([...proofRunning, unknownLimit]);
  expect(first.state.wakes[probeOf(1)]?.dueAt).toBe(T0 + 15 * MINUTE);
  const second = play([
    ...proofRunning,
    unknownLimit,
    fired("usage-probe", r(1), T0 + 15 * MINUTE),
    prepared(2),
    signal({ kind: "usage-limit", turn: T(2), resetsAt: null }),
  ]);
  expect(second.state.runs[r(2)]).toMatchObject({ joins: r(1), end: { kind: "usage-limit" } });
  expect(second.state.wakes[probeOf(2)]?.dueAt).toBe(T0 + 45 * MINUTE);
  const capped = play([
    ...proofRunning,
    unknownLimit,
    fired("usage-probe", r(1), T0 + 15 * MINUTE),
    prepared(2),
    signal({ kind: "usage-limit", turn: T(2), resetsAt: null }),
    fired("usage-probe", r(2), T0 + 45 * MINUTE),
    prepared(3),
    signal({ kind: "usage-limit", turn: T(3), resetsAt: null }),
    fired("usage-probe", r(3), T0 + 105 * MINUTE),
    prepared(4),
    signal({ kind: "usage-limit", turn: T(4), resetsAt: null }),
  ]);
  expect(capped.state.wakes[probeOf(4)]?.dueAt).toBe(T0 + 165 * MINUTE);
  const wrote = play([...proofRunning, unknownLimit, send("try again")]);
  expect({ run: wrote.state.runs[r(2)]?.state, paused: wrote.state.pausedUntil }).toEqual({
    run: "admitted",
    paused: null,
  });
  expect(wrote.state.wakes[probeOf(1)]).toBeUndefined();
});

// witness: apps/server/src/engine/domain/decide.ts | if (b.state.pausedUntil !== "unknown" || probe === undefined) return; → if (b.state.pausedUntil === "unknown" || probe === undefined) return;
it("ED55: A reset learned later replaces the probe with a resume at that time", () => {
  const learned = T0 + 40 * MINUTE;
  const { state } = play([
    ...proofRunning,
    send("queued"),
    unknownLimit,
    signal({ kind: "usage-reset-known", resetsAt: learned }),
  ]);
  expect(state.wakes[probeOf(1)]).toBeUndefined();
  expect(state.wakes[resumeOf(1)]).toMatchObject({ dueAt: learned, joins: r(1) });
  expect({ queued: state.runs[r(2)]?.state, paused: state.pausedUntil }).toEqual({
    queued: "queued",
    paused: learned,
  });
});

// witness: apps/server/src/engine/domain/decide.usage.ts | window.usedPercent < 100 && → window.usedPercent <= 100 &&
it("ED56: A usage report that no longer shows the limit lifts the pause at once and the held message goes; a report that still shows the limit's window, shows a full window or was read before the limit keeps the pause", () => {
  const stillHeld = {
    paused: reset,
    runs: [
      [1, "ended", "person"],
      [2, "queued", "person"],
    ],
  };
  expect(shape(play([...held, otherAccount]).state)).toEqual({
    paused: null,
    runs: [
      [1, "ended", "person"],
      [2, "admitted", "person"],
    ],
  });
  expect(shape(play([...pausedOn, otherAccount]).state)).toEqual({
    paused: null,
    runs: [
      [1, "ended", "person"],
      [2, "admitted", "usage-resume"],
    ],
  });
  expect(shape(play([...held, usage([{ usedPercent: 99, resetsAt: reset }])]).state)).toEqual(
    stillHeld,
  );
  expect(
    shape(play([...held, usage([{ usedPercent: 100, resetsAt: T0 + 3 * 60 * MINUTE }])]).state),
  ).toEqual(stillHeld);
  expect(
    shape(
      play([
        ...held,
        usage([{ usedPercent: 24, resetsAt: T0 + 4 * 24 * 60 * MINUTE }], T0 - MINUTE),
      ]).state,
    ),
  ).toEqual(stillHeld);
});

// witness: apps/server/src/engine/domain/decide.usage.ts | if (b.state.pausedUntil === null) return; → if (b.state.pausedUntil !== null) return;
it("ED57: Continue during a usage limit tries the provider now, sending a held message first", () => {
  expect(shape(play([...pausedOn, continued]).state)).toEqual({
    paused: null,
    runs: [
      [1, "ended", "person"],
      [2, "admitted", "usage-resume"],
    ],
  });
  expect(shape(play([...held, continued]).state)).toEqual({
    paused: null,
    runs: [
      [1, "ended", "person"],
      [2, "admitted", "person"],
    ],
  });
});

// witness: apps/server/src/engine/domain/decide.send.ts | if (!isLive(run) || run.sessionId === null) { → if (!isLive(run) && run.sessionId !== null) {
it("ED58: A held message withdrawn ends stopped, unsent, and the next held message moves up", () => {
  const { state } = play([...held, send("and this"), stop(2)]);
  expect(state.runs[r(2)]).toMatchObject({ end: { kind: "stopped" }, endSource: "stop-asked" });
  expect(state.runs[r(2)]?.startedAt ?? null).toBeNull();
  expect(state.queue).toEqual([r(3)]);
  const resumed = play([...held, send("and this"), stop(2), continued]);
  expect(resumed.state.runs[r(3)]?.state).toBe("admitted");
});

// witness: apps/server/src/engine/domain/decide.ts | if (signal.parks === true → if (signal.parks !== true
it("ED59: A usage limit that parks its turn closes the session; the resume opens a new one", () => {
  const at = T0 + 60 * MINUTE;
  const parks = signal({ kind: "usage-limit", turn: T(1), resetsAt: at, parks: true });
  const scene = play([...running, parks]);
  expect(scene.effects.map((effect) => effect.kind)).toEqual(["session.close"]);
  const resumed = play([
    ...running,
    parks,
    settled("s1", "session.close", { kind: "ok" }),
    fired("usage-resume", r(1), at),
    prepared(2),
  ]);
  expect(resumed.effects).toMatchObject([
    { kind: "session.open", payload: { resume: "native-1" } },
  ]);
});
