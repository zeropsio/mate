import { expect, it } from "vite-plus/test";
import { requestId, SessionId } from "@t3tools/contracts";
import {
  ended,
  fired,
  note,
  opened,
  play,
  prepared,
  r,
  requestOpened,
  running,
  send,
  settled,
  signal,
  stop,
  T,
  T0,
  turnEnded,
  waiting,
} from "../testing/scene.ts";

// witness: apps/server/src/engine/domain/decide.ts | ...(outcome.admission === undefined ? {} : { admission: outcome.admission }), → ...(outcome.admission === undefined ? {} : {}),
it("ED30: A run its admission refuses ends failed before anything of it ran, in admission's own words, naming the login the refusal was for", () => {
  const words = "Ana's Claude login is not yours to use.";
  const plain = play([send(), prepared(1, { kind: "failed", reason: words, refused: true })]);
  expect(plain.state.runs[r(1)]).toMatchObject({
    end: { kind: "failed", reason: words },
    endSource: "inferred-from-effect",
  });
  expect(plain.effects).toEqual([]);
  const login = play([
    send(),
    prepared(1, {
      kind: "failed",
      reason: "Claude's sign-in has expired.",
      refused: true,
      admission: { loginId: "claude-code", reason: "expired-login" },
    }),
  ]);
  expect(login.state.runs[r(1)]?.end).toMatchObject({
    kind: "failed",
    admission: { loginId: "claude-code", reason: "expired-login" },
  });
});

// witness: apps/server/src/engine/domain/decide.ts | ...(outcome.forNow === true ? { forNow: true } : {}), → ...(outcome.forNow === true ? {} : {}),
it("ED111: A run its admission refuses only for now ends failed saying so, and one refused for good ends without that mark; breaks: another Mate's message fails where it should have waited, or waits a day on a refusal that will not lift.", () => {
  const reason = "Admission refused the run.";
  const temporary = play([
    send(),
    prepared(1, { kind: "failed", reason, refused: true, forNow: true }),
  ]);
  expect(temporary.state.runs[r(1)]?.end).toMatchObject({ kind: "failed", forNow: true });

  const permanent = play([send(), prepared(1, { kind: "failed", reason, refused: true })]);
  const end = permanent.state.runs[r(1)]?.end;
  expect(end).toMatchObject({ kind: "failed" });
  expect(end).not.toHaveProperty("forNow");
});

// witness: apps/server/src/engine/domain/decide.runs.ts | updatePerson(b, run, delivery); → updatePerson(b, run, "unknown");
it("ED31: An admitted run is sending once its session opens and running once the provider accepts the send or its turn starts, and its message then reads delivered", () => {
  expect(play([send(), prepared(1), opened(1)]).state.runs[r(1)]?.state).toBe("sending");
  const accepted = play([...running]);
  expect(accepted.state.runs[r(1)]?.state).toBe("running");
  expect(accepted.events.find((e) => e._tag === "ItemUpdated")).toMatchObject({
    body: { kind: "person", delivery: { state: "delivered" } },
  });
  expect(
    play([
      send(),
      prepared(1),
      opened(1),
      signal({ kind: "turn-started", turn: T(1), origin: "engine", providerTurnId: "t1" }),
    ]).state.runs[r(1)]?.state,
  ).toBe("running");
});

// witness: apps/server/src/engine/domain/decide.runs.ts | if (b.state.activeRunId !== null) return; → if (b.state.activeRunId !== null && b.state.queue.length === 0) return;
it("ED32: A message sent while a run is active queues behind it, and that run's end admits it", () => {
  const queued = play([...running, send("and also")]);
  expect(queued.state.runs[r(2)]?.state).toBe("queued");
  const finished = play([...running, send("next"), turnEnded]);
  expect(finished.state.runs[r(2)]?.state).toBe("admitted");
});

// witness: apps/server/src/engine/domain/evolve.ts | state: "waiting", → state: "running",
it("ED33: A request makes its run wait, and an answer, or the provider closing the request, resumes it", () => {
  expect(play([...running, requestOpened()]).state.runs[r(1)]?.state).toBe("waiting");
  const answer = play([
    ...waiting,
    {
      _tag: "Answer",
      requestId: requestId(r(1), 1),
      answer: { decision: "accept" },
      summary: "Allowed",
    },
  ]);
  expect(answer.state.runs[r(1)]?.state).toBe("running");
  expect(answer.effects[0]?.kind).toBe("provider.respond");
  expect(
    play([...waiting, signal({ kind: "request-closed", key: "q1", state: "dismissed" })]).state
      .runs[r(1)]?.state,
  ).toBe("running");
});

// witness: apps/server/src/engine/domain/decide.ts | endRun(b, run, { kind: "failed", reason: failure, next: null }, "inferred-from-effect"); → endRun(b, run, { kind: "failed", reason: failure, next: null }, "agent");
it("ED34: A run ends completed when the agent ends its turn, failed said by the agent when the turn fails, and failed inferred when its session cannot open or its send fails", () => {
  expect(play([...running, turnEnded]).state.runs[r(1)]).toMatchObject({
    end: { kind: "completed" },
    endSource: "agent",
  });
  expect(
    play([...running, ended(1, { kind: "failed", class: "provider", words: "overloaded" })]).state
      .runs[r(1)],
  ).toMatchObject({ end: { kind: "failed" }, endSource: "agent" });
  expect(
    play([
      send(),
      prepared(1),
      settled(r(1), "session.open", { kind: "failed", reason: "not signed in" }),
    ]).state.runs[r(1)],
  ).toMatchObject({ end: { kind: "failed" }, endSource: "inferred-from-effect" });
  expect(
    play([
      send(),
      prepared(1),
      opened(1),
      settled(r(1), "provider.send", { kind: "failed", reason: "socket closed" }),
    ]).state.runs[r(1)],
  ).toMatchObject({ end: { kind: "failed" }, endSource: "inferred-from-effect" });
});

// witness: apps/server/src/engine/domain/decide.ts | endRun(b, run, { kind: "crashed", reason: signal.reason }, "inferred-from-crash"); → endRun(b, run, { kind: "failed", reason: signal.reason, next: null }, "inferred-from-crash");
it("ED35: A session that exits under a run ends it crashed, closing its open items and lapsing its requests", () => {
  const scene = play([
    ...waiting,
    signal({ kind: "item-opened", turn: T(1), key: "k", by: { kind: "mate" }, body: note("k") }),
    signal({ kind: "session-exited", reason: "exit 137" }),
  ]);
  expect(scene.state.runs[r(1)]).toMatchObject({
    end: { kind: "crashed" },
    endSource: "inferred-from-crash",
  });
  expect(scene.events.find((e) => e._tag === "ItemClosed")).toMatchObject({
    body: { streaming: false },
  });
  expect(scene.events.find((e) => e._tag === "RequestClosed")).toMatchObject({ state: "lapsed" });
});

// witness: apps/server/src/engine/domain/decide.ts | return runOfTurn(b.state, turn); → return activeRun(b.state);
it("ED36: A turn's end that arrives late never ends the next run, and an item after its turn's end is never filed under the next run", () => {
  const proofRunning = [
    send("go"),
    prepared(1),
    opened(1),
    settled(r(1), "provider.send", { kind: "ok", value: { providerTurnId: "t1" } }),
  ];
  const late = play([
    ...proofRunning,
    send("next"),
    turnEnded,
    prepared(2),
    settled(r(2), "provider.send", { kind: "ok", value: { providerTurnId: "t2" } }),
    turnEnded,
    signal({
      kind: "item-closed",
      turn: T(1),
      key: "late",
      body: { kind: "note", text: "x", streaming: false, answer: false },
      afterEnd: true,
    }),
  ]);
  expect(late.state.runs[r(2)]?.state).toBe("running");
  const filed = late.log.flatMap((e) =>
    e._tag === "ItemOpened" && e.by.kind === "mate" ? [e.runId] : [],
  );
  expect(filed).toEqual([r(1)]);
  const first = play([
    ...proofRunning,
    send("next"),
    stop(),
    settled(r(1), "provider.interrupt", { kind: "ok" }),
    ended(1, { kind: "interrupted" }, "stop-confirmed"),
    prepared(2),
  ]);
  expect(first.state.runs[r(2)]?.state).toBe("sending");
  expect(first.log.filter((e) => e._tag === "RunEnded")).toMatchObject([
    { runId: r(1), end: { kind: "stopped" }, source: "stop-confirmed" },
  ]);
  const stopped = play([
    ...proofRunning,
    send("next"),
    stop(),
    settled(r(1), "provider.interrupt", { kind: "failed", reason: "timeout" }),
    turnEnded,
  ]);
  expect(stopped.log.filter((e) => e._tag === "RunEnded")).toMatchObject([
    { runId: r(1), end: { kind: "stopped" }, source: "stop-asked" },
  ]);
  const reset = T0 + 3_600_000;
  const limited = play([
    ...proofRunning,
    signal({ kind: "usage-limit", resetsAt: reset }),
    fired("usage-resume", r(1), reset),
    turnEnded,
  ]);
  expect(limited.log.filter((e) => e._tag === "RunEnded")).toMatchObject([
    { runId: r(1), end: { kind: "usage-limit" }, source: "agent" },
  ]);
});

// witness: apps/server/src/engine/domain/decide.ts | if (command.text.trim() === "" && attachments.length === 0) throw new Rejected("empty-message"); → if (command.text === "" && attachments.length === 0) throw new Rejected("empty-message");
it("ED37: A message is refused when it is empty, when its conversation is archived, and when its principal is the engine itself", () => {
  expect(play([send("  ")]).decision).toMatchObject({
    _tag: "Reject",
    rejection: { reason: "empty-message" },
  });
  expect(play([{ _tag: "Archive" }, send()]).decision).toMatchObject({
    _tag: "Reject",
    rejection: { reason: "archived" },
  });
  expect(play([{ command: send("from nobody"), by: { kind: "engine" } }]).decision).toMatchObject({
    _tag: "Reject",
    rejection: { reason: "invalid-principal" },
  });
});

// witness: apps/server/src/engine/domain/decide.ts | if (b.state.session === null || b.state.session.id !== sessionId) { → if (b.state.session !== null && b.state.session.id !== sessionId) {
it("ED38: Signals from a session that is not the conversation's, or before any session opened, are refused", () => {
  expect(
    play([...running, { _tag: "ProviderSignals", sessionId: SessionId.make("s0"), signals: [] }])
      .decision,
  ).toMatchObject({ _tag: "Reject", rejection: { reason: "stale-session" } });
  expect(
    play([
      send(),
      signal({ kind: "turn-started", turn: T(1), origin: "engine", providerTurnId: null }),
    ]).decision,
  ).toMatchObject({ _tag: "Reject", rejection: { reason: "stale-session" } });
});

// witness: apps/server/src/engine/domain/decide.ts | ...(signal.costUsd === undefined ? {} : { costUsd: signal.costUsd }), → ...(signal.costUsd === undefined ? {} : { costUsd: 0 }),
it("ED39: A turn's end records what the turn cost and how full the conversation's context was", () => {
  const scene = play([
    ...running,
    signal({
      kind: "turn-ended",
      turn: T(1),
      outcome: { kind: "completed" },
      source: "agent",
      costUsd: 0.42,
      contextTokens: 91_000,
    }),
  ]);
  expect(scene.events.find((e) => e._tag === "RunEnded")).toMatchObject({
    end: { kind: "completed" },
    costUsd: 0.42,
    contextTokens: 91_000,
  });
});

// witness: apps/server/src/engine/domain/decide.ts | prompt_too_long: "overflow", → prompt_too_long: "provider-error",
it("ED40: A run's end says why it broke off: a prompt that outgrew the context reads overflow, a provider failure reads provider-error, a finished turn reads no detail", () => {
  const overflow = play([...running, ended(1, { kind: "completed", reason: "prompt_too_long" })]);
  expect(overflow.events.find((e) => e._tag === "RunEnded")).toMatchObject({ detail: "overflow" });
  const failure = play([
    ...running,
    ended(1, { kind: "failed", class: "provider", words: "API error", reason: "api_error" }),
  ]);
  expect(failure.events.find((e) => e._tag === "RunEnded")).toMatchObject({
    detail: "provider-error",
  });
  const finished = play([...running, ended(1, { kind: "completed", reason: "end_turn" })]);
  expect(finished.events.find((e) => e._tag === "RunEnded")).not.toHaveProperty("detail");
});
