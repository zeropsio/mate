import { expect, it } from "@effect/vitest";
import { ConversationId, EffectId, RequestId, RunId, SessionId, WakeId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";

import { makeUpdateAdmission } from "../updateAdmission.ts";
import { engineStateBlockers, lastRunEndedAt } from "../updateIdle.ts";
import { initialState } from "./state.ts";

// witness: apps/server/src/engine/updateIdle.ts | : wake.kind === "usage-resume" && wake.dueAt === pausedUntil, → : wake.kind === "usage-resume",
it("ED129: A message queued behind a usage limit does not hold its Mate's update while the wake that lifts the limit is armed, the resume due at the limit's reset or the probe when the reset is unknown; with a resume due at another time, or no such wake, it holds the update. Breaks: one conversation waiting out a week's limit keeps its Mate from every release.", () => {
  for (const [pausedUntil, wakes, held] of [
    [
      1000,
      {
        resume: {
          id: WakeId.make("resume"),
          kind: "usage-resume",
          dueAt: 1000,
          cron: null,
          principal: { kind: "person", subject: "ana" },
          joins: null,
          text: null,
          armedSeq: 1,
        },
      },
      false,
    ],
    [
      "unknown",
      {
        probe: {
          id: WakeId.make("probe"),
          kind: "usage-probe",
          dueAt: 500,
          cron: null,
          principal: { kind: "person", subject: "ana" },
          joins: null,
          text: null,
          armedSeq: 1,
        },
      },
      false,
    ],
    [
      1000,
      {
        resume: {
          id: WakeId.make("resume"),
          kind: "usage-resume",
          dueAt: 2000,
          cron: null,
          principal: { kind: "person", subject: "ana" },
          joins: null,
          text: null,
          armedSeq: 1,
        },
      },
      true,
    ],
    [1000, {}, true],
  ] as const) {
    const blockers = engineStateBlockers({
      ...initialState(ConversationId.make("idle")),
      queue: [RunId.make("queued")],
      runs: {
        queued: { state: "queued", admittedAt: null, startedAt: null, end: null, waitingOn: null },
      },
      pausedUntil,
      wakes,
    });
    expect(blockers.length > 0).toBe(held);
  }
});

// witness: apps/server/src/engine/updateIdle.ts | const parkedIds = new Set<string>(queue); → const parkedIds = new Set<string>(Object.keys(runs));
it("ED130: A run that has not ended and is not waiting in the queue holds its Mate's update unless it is the active run waiting only on its person's question, with its active pointer missing (even on such a question) and beside a queue a usage limit parks alike, and so does a queued run already admitted", () => {
  const resume = {
    resume: {
      id: WakeId.make("resume"),
      kind: "usage-resume",
      dueAt: 1000,
      cron: null,
      principal: { kind: "person", subject: "ana" },
      joins: null,
      text: null,
      armedSeq: 1,
    },
  } as const;
  for (const patch of [
    {
      runs: {
        lost: { end: null, state: "admitted", admittedAt: 1, startedAt: null, waitingOn: null },
      },
    },
    {
      runs: {
        lost: {
          end: null,
          state: "waiting",
          admittedAt: 1,
          startedAt: 2,
          waitingOn: RequestId.make("ask"),
        },
      },
      requests: { ask: { runId: RunId.make("lost"), kind: "question", asked: [{ id: "q" }] } },
    },
    {
      queue: [RunId.make("queued")],
      runs: {
        queued: { state: "queued", admittedAt: null, startedAt: null, end: null, waitingOn: null },
        running: { state: "running", admittedAt: 1, startedAt: 2, end: null, waitingOn: null },
      },
      pausedUntil: 1000,
      wakes: resume,
    },
    {
      queue: [RunId.make("queued")],
      runs: {
        queued: { state: "queued", admittedAt: 1, startedAt: null, end: null, waitingOn: null },
      },
      pausedUntil: 1000,
      wakes: resume,
    },
  ] as const) {
    expect(
      engineStateBlockers({ ...initialState(ConversationId.make("idle")), ...patch }).length > 0,
    ).toBe(true);
  }
});

// witness: apps/server/src/engine/updateIdle.ts | if (held || Object.keys(state.answering).length > 0) blockers.push("open request"); → if (held) blockers.push("open request");
it("ED131: A conversation holds its Mate's update while a run is active, a message waits in a queue no usage limit parks, a request its turn waits on is open, an answer awaits its receipt, an effect is unsettled or its session is closing; an ask the record keeps and a question a restart asks again by message hold none, and a conversation with none of these is idle", () => {
  for (const patch of [
    { activeRunId: RunId.make("active") },
    { queue: [RunId.make("queued")] },
    { requests: { question: { runId: RunId.make("run") } } },
    { answering: { answer: {} } },
    { effects: { write: {} } },
    {
      closing: {
        sessionId: SessionId.make("session"),
        reason: "idle" as const,
        effectId: EffectId.make("close"),
      },
    },
  ]) {
    expect(
      engineStateBlockers({ ...initialState(ConversationId.make("idle")), ...patch }).length > 0,
    ).toBe(true);
  }
  const requests = { ask: { runId: RunId.make("run"), kind: "vault" } } as const;
  expect(engineStateBlockers({ ...initialState(ConversationId.make("idle")), requests })).toEqual(
    [],
  );
  expect(engineStateBlockers(initialState(ConversationId.make("idle")))).toEqual([]);
});

// witness: apps/server/src/engine/updateIdle.ts | if (run?.state !== "waiting" || run.waitingOn === null) return false; → if (run?.state !== "running" || run.waitingOn === null) return false;
it("ED138: A run whose turn only waits on its person's answer to a question holds none of its Mate's update, however long the person takes, since a restart asks the question again by message; a run waiting on an approval or on a helper's question, and a running turn, still hold it. Breaks: one question left unanswered for days keeps its Mate from every release.", () => {
  const conversation = (
    state: "waiting" | "running",
    request: { readonly kind: "question" | "approval"; readonly byHelper?: true },
  ) => ({
    ...initialState(ConversationId.make("idle")),
    activeRunId: RunId.make("run"),
    runs: {
      run: {
        state,
        admittedAt: 1,
        startedAt: 2,
        end: null,
        waitingOn: RequestId.make("ask"),
      },
    },
    requests: { ask: { runId: RunId.make("run"), asked: [{ id: "q" }], ...request } },
  });
  expect(engineStateBlockers(conversation("waiting", { kind: "question" }))).toEqual([]);
  for (const held of [
    conversation("waiting", { kind: "approval" }),
    conversation("waiting", { kind: "question", byHelper: true }),
    conversation("running", { kind: "question" }),
  ]) {
    expect(engineStateBlockers(held).length > 0).toBe(true);
  }
});

// witness: apps/server/src/engine/updateIdle.ts | if (run.endedAt !== null && (latest === undefined || run.endedAt > latest)) → if (run.endedAt !== null && (latest === undefined || run.endedAt < latest))
it("ED132: An automatic update's quiet wait counts from the latest end among a conversation's runs; a run still going adds none, and a conversation with no ended run has none", () => {
  for (const [runs, ended] of [
    [{}, undefined],
    [{ a: { endedAt: null } }, undefined],
    [{ a: { endedAt: 5 }, b: { endedAt: 9 }, c: { endedAt: null } }, 9],
  ] as const) {
    expect(lastRunEndedAt({ runs: runs as never })).toBe(ended);
  }
});

// witness: apps/server/src/engine/updateAdmission.ts | case "CancelWake": → case "ArmWake":
it.effect(
  "ED133: While an update waits a conversation takes only what settles or stops accepted work (a stop, an answer, a dismissal, a session's close, a cancelled wake, an effect's outcome, the provider's signals, a recovery, a lease bound or unbound) and refuses new work without running it (a message, a steered message, a model or agent change, archiving, restoring, a wake armed or fired); once the update is called off it takes new work again",
  () =>
    Effect.gen(function* () {
      for (const command of [
        "Send",
        "Steer",
        "SwitchModel",
        "AssignAgent",
        "Archive",
        "Unarchive",
        "ArmWake",
        "WakeFired",
      ] as const) {
        const admission = yield* makeUpdateAdmission;
        yield* admission.begin;
        let accepted = false;
        const result = yield* admission.run(
          command,
          Effect.sync(() => {
            accepted = true;
            return true;
          }),
        );
        expect(result).toBeUndefined();
        expect(accepted).toBe(false);
        yield* admission.cancel;
        expect(yield* admission.run(command, Effect.succeed(true))).toBe(true);
      }
      for (const command of [
        "Stop",
        "Answer",
        "Dismiss",
        "CloseSession",
        "CancelWake",
        "EffectSettled",
        "ProviderSignals",
        "Recovered",
        "BindLease",
        "UnbindLease",
      ] as const) {
        const admission = yield* makeUpdateAdmission;
        yield* admission.begin;
        expect(yield* admission.run(command, Effect.succeed(true))).toBe(true);
      }
    }),
);

// witness: apps/server/src/update/AdmissionFence.ts | const lock = yield* Semaphore.make(1); → const lock = yield* Semaphore.make(2);
it.effect(
  "ED134: A message accepted before an update's fence closes is finished first: the fence stays open until it has, and then refuses the next message",
  () =>
    Effect.gen(function* () {
      const admission = yield* makeUpdateAdmission;
      const accepted = yield* Latch.make(false);
      const finish = yield* Latch.make(false);
      const send = yield* admission
        .run("Send", accepted.open.pipe(Effect.andThen(finish.await), Effect.as("accepted")))
        .pipe(Effect.forkScoped);
      yield* accepted.await;
      const drain = yield* admission.begin.pipe(Effect.forkScoped({ startImmediately: true }));
      const closedWhileHeld = yield* admission.closed;
      yield* finish.open;
      expect(yield* Fiber.join(send)).toBe("accepted");
      yield* Fiber.join(drain);
      expect(closedWhileHeld).toBe(false);
      expect(yield* admission.run("Send", Effect.succeed("new"))).toBeUndefined();
    }),
);

// witness: apps/server/src/engine/updateAdmission.ts | const sealedDuringUpdate = (tag: CommandTag): boolean => tag === "Answer"; → const sealedDuringUpdate = (tag: CommandTag): boolean => tag === "Dismiss";
it.effect(
  "ED139: Once an update's final idle proof is under way a person's answer is refused, while a stop still goes through; the answer is taken again when that proof does not hold or the update is called off. Breaks: an answer that looks taken goes into a turn the restart then cuts, and the person is asked again.",
  () =>
    Effect.gen(function* () {
      const admission = yield* makeUpdateAdmission;
      yield* admission.begin;
      expect(yield* admission.run("Answer", Effect.succeed("answered"))).toBe("answered");
      yield* admission.seal;
      expect(yield* admission.run("Answer", Effect.succeed("answered"))).toBeUndefined();
      expect(yield* admission.run("Stop", Effect.succeed("stopped"))).toBe("stopped");
      yield* admission.unseal;
      expect(yield* admission.run("Answer", Effect.succeed("answered"))).toBe("answered");
      yield* admission.seal;
      yield* admission.cancel;
      expect(yield* admission.run("Answer", Effect.succeed("answered"))).toBe("answered");
    }),
);
