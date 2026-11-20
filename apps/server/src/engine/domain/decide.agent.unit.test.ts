import { expect, it } from "vite-plus/test";
import { SessionId, type Principal } from "@t3tools/contracts";

import type { Command } from "./command.ts";
import {
  ended,
  opened,
  play,
  prepared,
  r,
  running,
  send,
  settled,
  T,
  turnEnded,
} from "../testing/scene.ts";

const ana: Principal = { kind: "person", subject: "ana" };
const sentTurn = (run: number) =>
  settled(r(run), "provider.send", { kind: "ok", value: { providerTurnId: `t${run}` } });
const sessionClosed = (session = "s1") => settled(session, "session.close", { kind: "ok" });

const agent = {
  instanceId: "claude-ana",
  driver: "claudeAgent",
  model: "opus",
  profile: { kind: "mate" },
} as const;
const assign: Command = { _tag: "AssignAgent", agent };
/** The session opened as asked: the instance and model the engine asked for. */
const openedAs = (
  run: number,
  asked: { readonly instanceId: string; readonly model: string | null },
) =>
  settled(r(run), "session.open", {
    kind: "ok",
    value: {
      sessionId: "s1",
      driver: "claudeAgent",
      model: asked.model,
      nativeRef: "native-1",
      capabilities: { steer: false },
      requestedModel: asked.model,
      instanceId: asked.instanceId,
    },
  });
const generationOf = (steps: ReadonlyArray<Command>) =>
  (play(steps).effects[0]?.payload as { readonly generation?: number } | undefined)?.generation;

// witness: apps/server/src/engine/domain/evolve.ts | model: event.agent.model, → model: state.model,
it("ED87: A conversation given its agent runs that agent's model and opens sessions on its instance", () => {
  const { state, log } = play([assign, send("go")]);
  expect(state.agent).toEqual(agent);
  expect(state.model).toBe("opus");
  expect(log.find((e) => e._tag === "AgentAssigned")).toMatchObject({ agent, by: ana });
  const scene = play([assign, send("go"), prepared(1)]);
  expect(scene.effects[0]).toMatchObject({
    kind: "session.open",
    payload: { instanceId: "claude-ana", driver: "claudeAgent", model: "opus" },
  });
});

// witness: apps/server/src/engine/domain/evolve.ts | (state.agent.instanceId !== event.agent.instanceId || → (state.agent.model !== event.agent.model ||
it("ED88: A conversation given another instance of its driver rotates its session before the next message and opens a fresh native session; a model switch resumes its own", () => {
  const rotated = play([
    assign,
    send("go"),
    prepared(1),
    openedAs(1, { instanceId: "claude-ana", model: "opus" }),
    ended(1),
    { _tag: "AssignAgent", agent: { ...agent, instanceId: "claude-bo" } },
    send("next"),
    prepared(2),
  ]);
  expect(rotated.effects).toMatchObject([{ kind: "session.close", payload: { reason: "model" } }]);
  expect(generationOf([assign, send("go"), prepared(1)])).toBe(1);
  expect(
    generationOf([assign, { _tag: "SwitchModel", model: "sonnet" }, send("go"), prepared(1)]),
  ).toBe(1);
  expect(
    generationOf([
      assign,
      { _tag: "AssignAgent", agent: { ...agent, instanceId: "claude-bo" } },
      send("go"),
      prepared(1),
    ]),
  ).toBe(2);
});

// witness: apps/server/src/engine/domain/evolve.ts | event.reason === "model" || event.reason === "settings" || state.rotation != null → event.reason === "settings" || state.rotation != null
it("ED89: A model switch closes the session that does not fit before anything is sent, and the next session opens rotating from it", () => {
  const closing = play([
    ...running,
    turnEnded,
    { _tag: "SwitchModel", model: "opus" },
    send("with opus"),
    prepared(2),
  ]);
  expect(closing.effects).toMatchObject([
    { kind: "session.close", lane: "close", payload: { reason: "model" } },
  ]);
  const next = play([
    ...running,
    turnEnded,
    { _tag: "SwitchModel", model: "opus" },
    send("with opus"),
    prepared(2),
    sessionClosed(),
    opened(2, { session: "s2" }),
  ]);
  expect(next.events.find((e) => e._tag === "SessionOpened")).toMatchObject({ rotatedFrom: "s1" });
});

const mate = {
  instanceId: "claude",
  driver: "claudeAgent",
  model: "opus",
  profile: { kind: "mate" },
} as const;
const choose = (instanceId: string, driver: string, resumes = false): Command => ({
  _tag: "ChooseAgent",
  instanceId,
  driver,
  model: "m2",
  resumes,
});
const started: ReadonlyArray<Command> = [
  { _tag: "AssignAgent", agent: mate },
  send("go"),
  prepared(1),
  opened(1),
  sentTurn(1),
  ended(1),
];

// witness: apps/server/src/engine/domain/decide.settings.ts | const keepsThread = carried && current.driver === command.driver && command.resumes; → const keepsThread = carried && command.resumes;
it("ED90: Before the conversation starts a person may pick any agent; after it started, another driver, or an instance whose sessions do not resume the old one's, takes it over: a line marks where, and its next run opens a session on a new thread", () => {
  const before = play([
    { _tag: "AssignAgent", agent: mate },
    choose("codex", "codex"),
    send("go"),
    prepared(1),
  ]);
  expect(before.effects).toMatchObject([
    { kind: "session.open", payload: { instanceId: "codex", driver: "codex", model: "m2" } },
  ]);
  expect(before.state.agent?.profile).toEqual({ kind: "mate" });
  expect(before.log.some((e) => e._tag === "ItemOpened" && e.body.kind === "marker")).toBe(false);
  for (const pick of [choose("codex", "codex", true), choose("claude-2", "claudeAgent")]) {
    const taken = play([...started, pick]);
    expect(taken.events).toMatchObject([
      {
        _tag: "AgentAssigned",
        agent: { instanceId: pick._tag === "ChooseAgent" ? pick.instanceId : "" },
        brief: true,
      },
      {
        _tag: "ItemOpened",
        runId: null,
        body: {
          kind: "marker",
          marker: {
            kind: "agent-switched",
            driver: pick._tag === "ChooseAgent" ? pick.driver : "",
          },
        },
      },
      { _tag: "ItemClosed" },
    ]);
    expect(taken.state.threadGeneration).toBe(2);
  }
});

const turnEndedOn = (session: string, run: number): Command => ({
  _tag: "ProviderSignals",
  sessionId: SessionId.make(session),
  signals: [{ kind: "turn-ended", turn: T(run), outcome: { kind: "completed" }, source: "agent" }],
});

// witness: apps/server/src/engine/domain/decide.runs.ts | delivery === "delivered" && → delivery === "steered" &&
it("ED137: The agent that takes a started conversation over is sent a brief of the record before the run's message, recorded as context, with each send until a run starts with it and never after; breaks: the new agent starts blind, or every message repeats the brief", () => {
  const taken = [...started, choose("codex", "codex"), send("next"), prepared(2), sessionClosed()];
  expect(play(taken).effects).toMatchObject([
    { kind: "session.open", payload: { instanceId: "codex", generation: 2, brief: true } },
  ]);
  const briefed = [
    ...taken,
    settled(r(2), "session.open", {
      kind: "ok",
      value: {
        sessionId: "s2",
        driver: "codex",
        model: "m2",
        nativeRef: "native-2",
        capabilities: { steer: false },
        requestedModel: "m2",
        instanceId: "codex",
        brief: "Person: go",
      },
    }),
  ];
  const opening = play(briefed);
  expect(opening.events).toContainEqual(
    expect.objectContaining({
      _tag: "ItemOpened",
      body: { kind: "context", notes: ["Person: go"] },
    }),
  );
  expect(opening.effects).toMatchObject([
    { kind: "provider.send", payload: { sessionId: "s2", text: "Person: go\n\nnext" } },
  ]);
  const afterwards = play([
    ...briefed,
    sentTurn(2),
    turnEndedOn("s2", 2),
    send("third"),
    prepared(3),
  ]);
  expect(afterwards.effects).toMatchObject([
    { kind: "provider.send", payload: { sessionId: "s2", text: "third" } },
  ]);
});

// witness: apps/server/src/engine/domain/decide.settings.ts | keepsThread: true → keepsThread: false
it("ED91: After the conversation started, an instance of its driver whose sessions resume the old one's carries the thread over", () => {
  const steps = [...started, choose("claude-2", "claudeAgent", true), send("next"), prepared(2)];
  const scene = play(steps);
  expect(scene.state.threadGeneration).toBe(1);
  expect(scene.effects).toMatchObject([{ kind: "session.close", payload: { reason: "model" } }]);
  expect(play([...steps, sessionClosed()]).effects).toMatchObject([
    {
      kind: "session.open",
      payload: { instanceId: "claude-2", generation: 1, resume: "native-1", rotateFrom: "s1" },
    },
  ]);
});
