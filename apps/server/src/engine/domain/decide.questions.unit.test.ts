import { expect, it } from "vite-plus/test";
import {
  effectId,
  RequestId,
  requestId,
  type ChatImageAttachment,
  type KnownEngineEvent,
} from "@t3tools/contracts";
import type { Command } from "./command.ts";
import {
  ended,
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
  waiting,
} from "../testing/scene.ts";

const recovered = (cut: ReadonlyArray<string> = []) =>
  ({
    _tag: "Recovered",
    bootId: "boot-2" as never,
    cutEffects: cut.map((id) => id as never),
  }) as const;
const proofRunning = [
  send("go"),
  prepared(1),
  opened(1),
  settled(r(1), "provider.send", { kind: "ok", value: { providerTurnId: "t1" } }),
];
const preview = {
  type: "image",
  id: "img-q",
  name: "question-preview.png",
  mimeType: "image/png",
  sizeBytes: 2048,
} as unknown as ChatImageAttachment;
const lapsed = (log: ReadonlyArray<KnownEngineEvent>) =>
  log.flatMap((e) => (e._tag === "RequestClosed" ? [`${e.requestId} ${e.state}`] : []));
/** A question its turn waits on (a call holds the answer). */
const waitedQuestions = [
  { id: "0", question: "Which package manager?", options: [{ label: "pnpm" }] },
  { id: "1", question: "What should it be named?" },
];
const waitedAsk = signal({
  kind: "request-opened",
  turn: T(1),
  key: "ask-1",
  ask: { kind: "question", questions: waitedQuestions, dismissible: false },
});
/** A question asked by message (Codex's async question). */
const byMessage = signal({
  kind: "request-opened",
  turn: T(1),
  key: "codex-async:q1",
  ask: {
    kind: "question",
    questions: [
      { id: "0", question: "Which package manager?" },
      { id: "1", question: "What should it be named?" },
    ],
    dismissible: true,
  },
});
const answeredByMessage: Command = {
  _tag: "Answer",
  requestId: requestId(r(1), 1),
  answer: {
    answers: { "0": "pnpm", "1": "api" },
    attachmentsByQuestionId: { "1": [preview] },
  },
  summary: "Answered",
};
const afterTurn = [...proofRunning, byMessage, ended(1)];
const whileAsking = [...proofRunning, byMessage];
const byMessageCloses = (log: ReadonlyArray<KnownEngineEvent>) =>
  log.flatMap((e) =>
    e._tag === "RequestClosed" || e._tag === "RequestReopened"
      ? [e._tag === "RequestClosed" ? `closed ${e.state}` : "reopened"]
      : [],
  );

// witness: apps/server/src/engine/domain/decide.questions.ts | if (!request.answerable) throw new Rejected("not-answerable"); → if (request.answerable === undefined) throw new Rejected("not-answerable");
it("ED63: An answer is refused with no open request, for a request whose callback is gone, and a second time for the same request", () => {
  const rows = [
    {
      given: running,
      when: { _tag: "Answer", requestId: RequestId.make("nope"), answer: null, summary: "" },
      reason: "unknown-request",
    },
    {
      given: [...running, requestOpened("q1", false)],
      when: { _tag: "Answer", requestId: requestId(r(1), 1), answer: null, summary: "" },
      reason: "not-answerable",
    },
    {
      given: [
        ...waiting,
        { _tag: "Answer", requestId: requestId(r(1), 1), answer: null, summary: "Allowed" },
      ],
      when: { _tag: "Answer", requestId: requestId(r(1), 1), answer: null, summary: "Allowed" },
      reason: "unknown-request",
    },
  ] as const;
  for (const { given, when, reason } of rows) {
    const before = play(given).state;
    const scene = play([...given, when]);
    expect(scene.decision).toMatchObject({ _tag: "Reject", rejection: { reason } });
    expect(scene.state).toEqual(before);
  }
});

// witness: apps/server/src/engine/domain/decide.questions.ts | answer: command.answer, → answer: { answers: questionAnswer(command.answer).answers },
it("ED64: A question's answer goes to the agent with its pictures, by their asset reference, and an answer with pictures the agent failed to take opens the question again", () => {
  const asked = signal({
    kind: "request-opened",
    key: "q1",
    ask: { kind: "question", questions: [], dismissible: false },
  });
  const given = {
    answers: { target: "Inspect the preview shown here" },
    attachmentsByQuestionId: { target: [preview] },
  };
  const answer: Command = {
    _tag: "Answer",
    requestId: requestId(r(1), 1),
    answer: given,
    summary: "Answered",
  };
  expect(play([...running, asked, answer]).effects).toMatchObject([
    { kind: "provider.respond", payload: { answer: given } },
  ]);
  const { state, log } = play([
    ...proofRunning,
    asked,
    answer,
    settled(requestId(r(1), 1), "provider.respond", { kind: "failed", reason: "timeout" }),
  ]);
  expect(log.filter((e) => e._tag === "RequestReopened")).toMatchObject([
    { requestId: requestId(r(1), 1) },
  ]);
  expect(Object.keys(state.requests)).toEqual([requestId(r(1), 1)]);
});

// witness: apps/server/src/engine/domain/decide.carried.ts | ask: { kind: "question", questions: [...request.asked], dismissible: true }, → ask: { kind: "question", questions: [...request.asked], dismissible: false },
it("ED65: A question its turn waited on, cut by a restart or a crash, stays open for the person, and its answer then reaches the agent as the person's message", () => {
  const again = requestId(r(1), 2);
  const answer: Command = {
    _tag: "Answer",
    requestId: again,
    answer: { answers: { "0": "pnpm", "1": "api" } },
    summary: "Answered",
  };
  for (const cut of [recovered(), signal({ kind: "session-exited", reason: "exit 137" })]) {
    const { state, log } = play([...proofRunning, waitedAsk, cut]);
    expect(lapsed(log)).toEqual([`${requestId(r(1), 1)} lapsed`]);
    expect(state.requests[again]).toMatchObject({ answerable: true, dismissible: true });
    expect(log.find((e) => e._tag === "RequestOpened" && e.requestId === again)).toMatchObject({
      ask: { kind: "question", questions: waitedQuestions, dismissible: true },
    });
    const answered = play([...proofRunning, waitedAsk, cut, answer]);
    expect(answered.events.find((e) => e._tag === "ItemOpened")).toMatchObject({
      runId: r(2),
      body: {
        kind: "person",
        text: "Which package manager?\npnpm\n\nWhat should it be named?\napi",
      },
    });
  }
});

// witness: apps/server/src/engine/domain/decide.carried.ts | request.runId === run.id && request.kind === "question" && request.asked !== undefined, → request.runId === run.id && request.kind === "question" && request.asked === undefined,
it("ED66: A restart does not carry a turn on without the answer its question waits for", () => {
  const { state, log } = play([...proofRunning, waitedAsk, recovered()]);
  expect(state.runs[r(1)]?.end).toMatchObject({ kind: "cut-by-restart" });
  expect(state.runs[r(1)]?.end).toHaveProperty("notContinued");
  expect(log.some((e) => e._tag === "WakeArmed" && e.kind === "restart-continuation")).toBe(false);
});

// witness: apps/server/src/engine/domain/decide.carried.ts | new Set(["cut-by-restart", "crashed"]) → new Set(["cut-by-restart", "crashed", "stopped"])
it("ED67: A Stop ends a waited question with its turn", () => {
  const { state, log } = play([
    ...proofRunning,
    waitedAsk,
    stop(1),
    ended(1, { kind: "interrupted" }, "stop-confirmed"),
  ]);
  expect(lapsed(log)).toEqual([`${requestId(r(1), 1)} lapsed`]);
  expect(state.requests).toEqual({});
});

// witness: apps/server/src/engine/domain/decide.questions.ts | if (request.dismissible !== true) throw new Rejected("not-dismissible"); → if (request.dismissible === false) throw new Rejected("not-dismissible");
it("ED68: A dismissible question is closed dismissed, telling the agent nothing; a question its agent waits on, an approval and a question already dismissed are refused", () => {
  const question = (dismissible: boolean) =>
    signal({
      kind: "request-opened",
      key: "q1",
      ask: { kind: "question", questions: [], dismissible },
    });
  const dismiss: Command = { _tag: "Dismiss", requestId: requestId(r(1), 1) };
  const scene = play([...running, question(true), dismiss]);
  expect(scene.events.find((e) => e._tag === "RequestClosed")).toMatchObject({
    state: "dismissed",
  });
  expect(scene.effects).toEqual([]);
  expect(scene.state.requests).toEqual({});
  expect(scene.state.runs[r(1)]?.state).toBe("running");
  const rows = [
    { given: [...running, question(false)], reason: "not-dismissible" },
    { given: waiting, reason: "not-dismissible" },
    { given: [...running, question(true), dismiss], reason: "unknown-request" },
  ] as const;
  for (const { given, reason } of rows) {
    const before = play(given).state;
    const refused = play([...given, dismiss]);
    expect(refused.decision).toMatchObject({ _tag: "Reject", rejection: { reason } });
    expect(refused.state).toEqual(before);
  }
});

// witness: apps/server/src/engine/domain/decide.signals.ts | (signal.ask.kind === "question" && signal.ask.dismissible) || isCardAsk(signal.ask.kind); → (signal.ask.kind === "question" && !signal.ask.dismissible) || isCardAsk(signal.ask.kind);
it("ED69: A question asked by message does not hold its run and outlives the turn that asked it", () => {
  const { state, log } = play(afterTurn);
  expect(log.some((e) => e._tag === "RunWaiting")).toBe(false);
  expect(state.runs[r(1)]?.end).toMatchObject({ kind: "completed" });
  expect(byMessageCloses(log)).toEqual([]);
  expect(state.requests[requestId(r(1), 1)]).toMatchObject({ answerable: true });
  const late = play([...proofRunning, ended(1), byMessage]);
  expect(byMessageCloses(late.log)).toEqual([]);
  expect(late.state.requests[requestId(r(1), 1)]).toMatchObject({ answerable: true });
});

// witness: apps/server/src/engine/domain/decide.questions.ts | (asking.state === "running" || asking.state === "waiting") && → asking.state === "waiting" &&
it("ED70: The answer to a question asked by message goes as the person's message with its pictures, never through the respond call, and into the turn that asked while that turn still runs", () => {
  const text = [
    "Which package manager?\npnpm",
    "What should it be named?\napi\nAttached file: question-preview.png (img-q)",
  ].join("\n\n");
  const after = play([...afterTurn, answeredByMessage]);
  expect(after.effects.map((effect) => effect.kind)).not.toContain("provider.respond");
  expect(after.events.find((e) => e._tag === "ItemOpened")).toMatchObject({
    runId: r(2),
    body: { kind: "person", text, attachments: [preview], sendId: "c6" },
  });
  expect(after.events.find((e) => e._tag === "RequestAnswered")).toMatchObject({
    requestId: requestId(r(1), 1),
    bySend: r(2),
  });
  const during = play([...whileAsking, answeredByMessage]);
  expect(during.events.some((e) => e._tag === "RunQueued")).toBe(false);
  expect(during.events.find((e) => e._tag === "ItemOpened")).toMatchObject({
    runId: r(1),
    body: { kind: "person", text, attachments: [preview], delivery: { state: "steered" } },
  });
  expect(during.effects).toMatchObject([
    { kind: "provider.steer", runId: r(1), payload: { attachments: [preview] } },
  ]);
});

// witness: apps/server/src/engine/domain/decide.effects.ts | } else reopenCarried(b, answered, `The answer did not reach the agent: ${failure}`); → } else if (outcome.kind === "failed") reopenCarried(b, answered, `The answer did not reach the agent: ${failure}`);
it("ED71: A question asked by message is answered once the agent took the answer into its turn, never before, and opens again when the agent did not take it, did not say in time, or a restart cut it", () => {
  const scene = play([...whileAsking, answeredByMessage]);
  const item = scene.events.find((e) => e._tag === "ItemOpened" && e.runId === r(1));
  const steeredItem = item?._tag === "ItemOpened" ? item.itemId : "";
  const steerEffect = effectId(steeredItem, "provider.steer", 1);
  expect(byMessageCloses(scene.log)).toEqual([]);
  const taken = play([
    ...whileAsking,
    answeredByMessage,
    settled(steeredItem, "provider.steer", { kind: "ok", value: { as: "steered" } }),
  ]);
  expect(byMessageCloses(taken.log)).toEqual(["closed answered"]);
  expect(taken.state.requests).toEqual({});
  expect(taken.state.answering).toEqual({});
  for (const last of [
    settled(steeredItem, "provider.steer", { kind: "failed", reason: "refused" }),
    settled(steeredItem, "provider.steer", { kind: "timed-out", after: 30_000 }),
    recovered([steerEffect]),
  ]) {
    const { log, state } = play([...whileAsking, answeredByMessage, last]);
    expect(byMessageCloses(log)).toEqual(["reopened"]);
    expect(state.requests[requestId(r(1), 1)]).toMatchObject({ answerable: true });
  }
});

// witness: apps/server/src/engine/domain/decide.questions.ts | if (typeof said !== "string" || (said.trim() === "" && files.length === 0)) throw unanswered(); → if (typeof said !== "string" || (said === "" && files.length === 0)) throw unanswered();
it("ED72: An answer that leaves a question unanswered is refused", () => {
  const scene = play([
    ...afterTurn,
    { ...answeredByMessage, answer: { answers: { "0": "pnpm", "1": " " } } } as Command,
  ]);
  expect(scene.decision).toMatchObject({ _tag: "Reject", rejection: { reason: "empty-message" } });
});

// witness: apps/server/src/engine/domain/decide.effects.ts | if (b.run(run.id).state === "running") markWaiting(b, b.run(run.id), answered.id); → if (b.run(run.id).state === "waiting") markWaiting(b, b.run(run.id), answered.id);
it("ED73: A failed answer leaves the run waiting on its request, and an answer the provider can no longer take expires it", () => {
  const failed = play([
    send("go"),
    prepared(1),
    opened(1),
    settled(r(1), "provider.send", { kind: "ok" }),
    requestOpened("q"),
    { _tag: "Answer", requestId: requestId(r(1), 1), answer: "yes", summary: "yes" },
    settled(requestId(r(1), 1), "provider.respond", { kind: "failed", reason: "callback gone" }),
  ]);
  expect(failed.state.runs[r(1)]?.state).toBe("waiting");
  const { state, log } = play([
    ...proofRunning,
    requestOpened("q"),
    { _tag: "Answer", requestId: requestId(r(1), 1), answer: "yes", summary: "yes" },
    settled(requestId(r(1), 1), "provider.respond", {
      kind: "failed",
      reason: "the callback is gone",
      refused: true,
    }),
  ]);
  expect(log.at(-1)).toMatchObject({ _tag: "RequestClosed", state: "expired" });
  expect(state.requests).toEqual({});
});
