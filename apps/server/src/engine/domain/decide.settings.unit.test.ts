import { expect, it } from "vite-plus/test";

import type { Command } from "./command.ts";
import { BACKGROUND_WORK_WORDS } from "./decide.ts";
import { ended, play, prepared, r, send, settled, signal, T } from "../testing/scene.ts";

const sentTurn = (run: number) =>
  settled(r(run), "provider.send", { kind: "ok", value: { providerTurnId: `t${run}` } });
const sessionClosed = (session = "s1") => settled(session, "session.close", { kind: "ok" });

const effortHigh = [{ id: "effort", value: "high" }] as const;
const agent = {
  instanceId: "claude-ana",
  driver: "claudeAgent",
  model: "opus",
  options: effortHigh,
  profile: { kind: "mate" },
} as const;
/** The session opened as asked; `inSessionOptions` is what its driver takes per turn. */
const openedWith = (run: number, inSessionOptions: "all" | ReadonlyArray<string>) =>
  settled(r(run), "session.open", {
    kind: "ok",
    value: {
      sessionId: "s1",
      driver: "claudeAgent",
      model: "opus",
      nativeRef: "native-1",
      capabilities: { steer: false, inSessionOptions },
      requestedModel: "opus",
      instanceId: "claude-ana",
      options: effortHigh,
      runtimeMode: "full-access",
    },
  });
const firstRun = (inSession: "all" | ReadonlyArray<string>): ReadonlyArray<Command> => [
  { _tag: "AssignAgent", agent },
  send("go"),
  prepared(1),
  openedWith(1, inSession),
  sentTurn(1),
];
const firstRunOver = (inSession: "all" | ReadonlyArray<string>) => [
  ...firstRun(inSession),
  ended(1),
];
const effortLow: Command = {
  _tag: "SwitchModel",
  model: "opus",
  options: [{ id: "effort", value: "low" }],
};
const fastMode: Command = {
  _tag: "SwitchModel",
  model: "opus",
  options: [...effortHigh, { id: "fastMode", value: true }],
};
const approvalRequired: Command = { _tag: "SetRuntimeMode", runtimeMode: "approval-required" };
const work = (status: "running" | "completed"): Command =>
  signal({
    kind: "work-upserted",
    work: "w1",
    origin: T(1),
    workKind: "shell",
    status,
    title: "watch",
  });

// witness: apps/server/src/engine/domain/decide.ts | b.emit({ _tag: "RuntimeModeSet", runtimeMode, by: b.envelope.principal }); → b.emit({ _tag: "RuntimeModeSet", runtimeMode, by: b.envelope.principal }); closeSession(b, "settings");
it("ED92: A setting never cuts a running turn: it applies at the next run", () => {
  const { log, state } = play([...firstRun(["effort"]), approvalRequired, fastMode]);
  expect(log.some((e) => e._tag === "SessionClosing")).toBe(false);
  expect(state.runs[r(1)]?.state).toBe("running");
  const next = play([
    ...firstRun(["effort"]),
    approvalRequired,
    fastMode,
    ended(1),
    send("next"),
    prepared(2),
  ]);
  expect(next.effects).toMatchObject([{ kind: "session.close", payload: { reason: "settings" } }]);
});

// witness: apps/server/src/engine/domain/decide.ts | return inSession === "all" || changed.every((id) => inSession.includes(id)) ? null : "settings"; → return inSession === "all" ? null : "settings";
it("ED93: An option its driver reads per turn goes with the next message in the same session; an option only a new session runs with closes the session between runs, and the next one resumes it", () => {
  const effort = play([...firstRunOver(["effort"]), effortLow, send("next"), prepared(2)]);
  expect(effort.effects).toMatchObject([
    {
      kind: "provider.send",
      payload: {
        sessionId: "s1",
        modelSelection: {
          instanceId: "claude-ana",
          model: "opus",
          options: [{ id: "effort", value: "low" }],
        },
      },
    },
  ]);
  const perTurn = play([...firstRunOver("all"), fastMode, send("next"), prepared(2)]);
  expect(perTurn.effects).toMatchObject([
    {
      kind: "provider.send",
      payload: {
        sessionId: "s1",
        modelSelection: {
          instanceId: "claude-ana",
          model: "opus",
          options: [...effortHigh, { id: "fastMode", value: true }],
        },
      },
    },
  ]);
  const steps = [...firstRunOver(["effort"]), fastMode, send("next"), prepared(2)];
  expect(play(steps).effects).toMatchObject([
    { kind: "session.close", payload: { reason: "settings" } },
  ]);
  expect(play([...steps, sessionClosed()]).effects).toMatchObject([
    {
      kind: "session.open",
      payload: {
        options: [...effortHigh, { id: "fastMode", value: true }],
        resume: "native-1",
        rotateFrom: "s1",
      },
    },
  ]);
});

// witness: apps/server/src/engine/domain/decide.ts | session.runtimeMode !== state.runtimeMode → session.runtimeMode === state.runtimeMode
it("ED94: A runtime mode change reopens the session with it between runs, resuming the old one", () => {
  const steps = [...firstRunOver("all"), approvalRequired, send("next"), prepared(2)];
  expect(play(steps).effects).toMatchObject([
    { kind: "session.close", payload: { reason: "settings" } },
  ]);
  expect(play([...steps, sessionClosed()]).effects).toMatchObject([
    {
      kind: "session.open",
      payload: { runtimeMode: "approval-required", resume: "native-1", rotateFrom: "s1" },
    },
  ]);
});

// witness: apps/server/src/engine/domain/decide.ts | if (misfit(b.state, session) === "settings") { → if (misfit(b.state, session) === "model") {
it("ED95: A setting or a message that needs a new session is refused while the agent's background work lives in the session, and the session is kept", () => {
  const refused = {
    _tag: "Reject",
    rejection: { reason: "background-work", detail: BACKGROUND_WORK_WORDS },
  };
  for (const change of [approvalRequired, fastMode]) {
    expect(play([...firstRun(["effort"]), work("running"), ended(1), change]).decision).toEqual(
      refused,
    );
    const done = play([...firstRun(["effort"]), work("running"), work("completed"), change]);
    expect(done.decision._tag).toBe("Accept");
  }
  const steps = [...firstRunOver(["effort"]), approvalRequired, work("running")];
  expect(play([...steps, send("next")]).decision).toEqual(refused);
  const { log, state } = play(steps);
  expect(log.some((e) => e._tag === "SessionClosing")).toBe(false);
  expect(state.session?.id).toBe("s1");
});

// witness: apps/server/src/engine/domain/decide.ts | if (lacks === "settings" && workLives(b.state)) return; → if (lacks === "model" && workLives(b.state)) return;
it("ED96: A message queued before background work started waits while it lives, never ending it, and goes once it ends", () => {
  const held = [
    ...firstRun(["effort"]),
    send("next"),
    approvalRequired,
    work("running"),
    ended(1),
    prepared(2),
  ];
  const { log, state } = play(held);
  expect(state.runs[r(2)]?.state).toBe("admitted");
  expect(
    log.some((e) => e._tag === "SessionClosing" || (e._tag === "RunEnded" && e.runId === r(2))),
  ).toBe(false);
  expect(play([...held, work("completed")]).effects).toMatchObject([
    { kind: "session.close", payload: { reason: "settings" } },
  ]);
});
