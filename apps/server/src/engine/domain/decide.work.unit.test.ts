import { expect, it } from "vite-plus/test";
import type { KnownEngineEvent, TurnHandle } from "@t3tools/contracts";
import type { Command, ProviderSignal } from "./command.ts";
import { AGENT_TURN_DUE_MS } from "./decide.sessions.ts";
import type { ConversationState } from "./state.ts";
import {
  opened,
  play,
  prepared,
  r,
  send,
  settled,
  signal,
  stop,
  T,
  T0,
  turnEnded,
} from "../testing/scene.ts";

const sentTurn = (run: number) =>
  settled(r(run), "provider.send", { kind: "ok", value: { providerTurnId: `t${run}` } });
const sessionClosed = (session = "s1") => settled(session, "session.close", { kind: "ok" });
const proofRunning = [send("go"), prepared(1), opened(1), sentTurn(1)];
const selfTurning = [send("go"), prepared(1), opened(1, { selfTurns: true }), sentTurn(1)];
const runningOn = (stopClosesSession: boolean) => [
  send("go"),
  prepared(1),
  opened(1, { stopClosesSession }),
  sentTurn(1),
];

const work = (
  status: Extract<ProviderSignal, { kind: "work-upserted" }>["status"],
  origin: TurnHandle | "unknown" = T(1),
): Command =>
  signal({
    kind: "work-upserted",
    work: "w1",
    origin,
    workKind: "helper",
    status,
    title: "Explore",
  });
const second = (status: "running" | "completed"): Command =>
  signal({
    kind: "work-upserted",
    work: "w2",
    origin: T(1),
    workKind: "helper",
    status,
    title: "Explore more",
  });
const selfStarted = signal({
  kind: "turn-started",
  turn: "bg" as TurnHandle,
  origin: "self",
  providerTurnId: "bg",
});
const selfEnded = signal({
  kind: "turn-ended",
  turn: "bg" as TurnHandle,
  outcome: { kind: "completed" },
  source: "agent",
});
const turnDue = (state: ConversationState) =>
  Object.values(state.wakes).filter((wake) => wake.kind === "agent-turn-due");
const workClosed = (log: ReadonlyArray<KnownEngineEvent>) =>
  log.flatMap((e) =>
    e._tag === "ItemClosed" && e.body.kind === "work" ? [`${e.runId}:${e.body.status}`] : [],
  );
const ends = (log: ReadonlyArray<KnownEngineEvent>) =>
  log.flatMap((e) =>
    e._tag === "RunEnded" ? [`${e.runId.split("/").at(-1)}:${e.end.kind}/${e.source}`] : [],
  );
/** Lost-work notes that would wake the Mate on their own: one held for a message never does. */
const dueLostWork = (
  wakes: ReadonlyArray<{ readonly kind: string; readonly dueAt: number | null }>,
) => wakes.filter((wake) => wake.kind === "lost-work" && wake.dueAt !== Number.MAX_SAFE_INTEGER);

// witness: apps/server/src/engine/domain/decide.ts | signal.origin === "unknown" → signal.origin !== "unknown"
it("ED76: A helper the agent started is an item under the run whose turn started it, and under the latest run when the driver cannot name the turn", () => {
  const { log, state } = play([...proofRunning, work("running")]);
  expect(log.at(-1)).toMatchObject({
    _tag: "ItemOpened",
    runId: r(1),
    key: "w1",
    body: { kind: "work", workKind: "helper", status: "running", title: "Explore" },
  });
  expect(Object.values(state.items).map((item) => item.key)).toEqual(["w1"]);
  expect(play([...proofRunning, turnEnded, work("running", "unknown")]).log.at(-1)).toMatchObject({
    _tag: "ItemOpened",
    runId: r(1),
    key: "w1",
  });
});

// witness: apps/server/src/engine/domain/decide.ts | const ends = WORK_ENDED.has(signal.status); → const ends = signal.status === "lost" || signal.status === "stopped";
it("ED77: Background work outlives its turn's end and closes on its own end", () => {
  const { log, state } = play([...proofRunning, work("running"), turnEnded, work("completed")]);
  expect(log.filter((e) => e._tag === "ItemClosed").map((e) => e.body.kind)).toEqual(["work"]);
  expect(log.at(-1)).toMatchObject({
    _tag: "ItemClosed",
    runId: r(1),
    body: { status: "completed" },
  });
  expect(state.items).toEqual({});
});

// witness: apps/server/src/engine/domain/evolve.ts | (event.body.status === "completed" || event.body.status === "failed") && → event.body.status === "completed" &&
it("ED78: A helper finishing after its run keeps the conversation going until the turn it wakes", () => {
  const given = [...selfTurning, work("running"), turnEnded];
  expect(turnDue(play([...given, work("completed")]).state).map((wake) => wake.dueAt)).toEqual([
    T0 + AGENT_TURN_DUE_MS,
  ]);
  expect(turnDue(play([...given, work("failed")]).state).map((wake) => wake.dueAt)).toEqual([
    T0 + AGENT_TURN_DUE_MS,
  ]);
});

// witness: apps/server/src/engine/domain/evolve.ts | ? { ...state, reportsDue: Math.max(0, state.reportsDue - 1) } → ? { ...state, reportsDue: 0 }
it("ED79: Each turn the agent opens itself takes one finished result and the rest stay due, unless the turn reports several at once", () => {
  const both = [
    ...selfTurning,
    work("running"),
    second("running"),
    turnEnded,
    work("completed"),
    second("completed"),
    selfStarted,
  ];
  expect(turnDue(play(both).state)).toEqual([]);
  expect(turnDue(play([...both, selfEnded]).state)).toHaveLength(1);

  const rows = [
    [work("running"), second("running"), work("completed"), second("completed"), turnEnded],
    [
      work("running"),
      second("running"),
      turnEnded,
      work("completed"),
      second("completed"),
      selfStarted,
      selfEnded,
    ],
  ];
  for (const steps of rows) {
    expect(turnDue(play([...selfTurning, ...steps]).state)).toHaveLength(1);
    const { state, log } = play([...selfTurning, ...steps, signal({ kind: "agent-caught-up" })]);
    expect(turnDue(state)).toEqual([]);
    expect(state.reportsDue).toBe(0);
    expect(log.map((event) => event._tag)).toContain("ReportsTaken");
  }
});

// witness: apps/server/src/engine/domain/decide.sessions.ts | if (b.state.wakes[turnDueWakeId(b)] === undefined) return; → if (b.state.wakes[turnDueWakeId(b)] !== undefined) return;
it("ED80: The wait for the turn a helper's end wakes ends with that turn or at the wait's bound", () => {
  const finished = [...selfTurning, work("running"), turnEnded, work("completed")];
  expect(turnDue(play([...finished, selfStarted]).state)).toEqual([]);
  const due = turnDue(play(finished).state)[0]!;
  const bounded = play([
    ...finished,
    { command: { _tag: "WakeFired", wakeId: due.id }, at: due.dueAt! },
  ]);
  expect(turnDue(bounded.state)).toEqual([]);
  expect(Object.keys(bounded.state.runs)).toEqual([r(1)]);
});

// witness: apps/server/src/engine/domain/decide.sessions.ts | status: reason === "stop" ? "stopped" : "lost", endedAt: b.now → status: reason === "restart" ? "stopped" : "lost", endedAt: b.now
it("ED81: Stop after the turn ended stops the helpers still running in its session; they close as stopped and wake no one", () => {
  const scene = play([...proofRunning, work("running"), turnEnded, stop()]);
  expect(scene.decision).toMatchObject({ _tag: "Accept", step: { result: { runId: r(1) } } });
  expect(scene.effects).toMatchObject([
    { kind: "session.close", payload: { sessionId: "s1", reason: "stop" } },
  ]);
  for (const close of [[sessionClosed()], [work("lost"), sessionClosed()]]) {
    const { log, state } = play([...proofRunning, work("running"), turnEnded, stop(), ...close]);
    expect(workClosed(log)).toEqual([`${r(1)}:stopped`]);
    expect(state.items).toEqual({});
    expect(state.session).toBeNull();
    expect(dueLostWork(Object.values(state.wakes))).toEqual([]);
  }
});

// witness: apps/server/src/engine/domain/decide.send.ts | session.capabilities.stopClosesSession !== true → session.capabilities.stopClosesSession === true
it("ED82: A Stop ends the turn and the helpers it started in one press, and nothing restarts", () => {
  const rows = [
    { closes: false, effects: ["provider.interrupt:control", "session.close:close"] },
    { closes: true, effects: ["provider.interrupt:control"] },
  ];
  for (const row of rows) {
    const scene = play([...runningOn(row.closes), work("running"), stop()]);
    expect(scene.decision).toMatchObject({ _tag: "Accept", step: { result: { runId: r(1) } } });
    expect(scene.effects.map((effect) => `${effect.kind}:${effect.lane}`)).toEqual(row.effects);
    expect(scene.state.runs[r(1)]?.stopAsked).not.toBeNull();
  }

  const interruptLate = settled(r(1), "provider.interrupt", {
    kind: "failed",
    reason: "No live session to stop.",
  });
  const { log, state } = play([
    ...runningOn(false),
    work("running"),
    stop(),
    sessionClosed(),
    interruptLate,
  ]);
  expect(ends(log)).toEqual(["1:stopped/inferred-from-close"]);
  expect(workClosed(log)).toEqual([`${r(1)}:stopped`]);
  expect(state.session).toBeNull();
  expect(state.activeRunId).toBeNull();
  expect(
    Object.values(state.wakes).filter((wake) => wake.dueAt !== Number.MAX_SAFE_INTEGER),
  ).toEqual([]);
  expect(
    log.filter(
      (e) =>
        e._tag === "RunNotContinued" || (e._tag === "RunEnded" && e.end.kind === "cut-by-restart"),
    ),
  ).toEqual([]);
  expect(log.filter((e) => e._tag === "RunQueued")).toHaveLength(1);
});
