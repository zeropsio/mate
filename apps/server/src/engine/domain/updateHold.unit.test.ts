import { expect, it } from "@effect/vitest";
import { ConversationId, EffectId, RunId, SessionId, WakeId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";

import { makeUpdateAdmission } from "../updateAdmission.ts";
import { engineStateBlockers, lastRunEndedAt } from "../updateIdle.ts";
import { initialState } from "./state.ts";

// witness: apps/server/src/engine/updateIdle.ts | : wake.kind === "usage-resume" && wake.dueAt === pausedUntil, → : wake.kind === "usage-resume",
it("ED+1: A message queued behind a usage limit does not hold its Mate's update while the wake that lifts the limit is armed, the resume due at the limit's reset or the probe when the reset is unknown; with a resume due at another time, or no such wake, it holds the update. Breaks: one conversation waiting out a week's limit keeps its Mate from every release.", () => {
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
      runs: { queued: { state: "queued", admittedAt: null, startedAt: null, end: null } },
      pausedUntil,
      wakes,
    });
    expect(blockers.length > 0).toBe(held);
  }
});

// witness: apps/server/src/engine/updateIdle.ts | const parkedIds = new Set<string>(queue); → const parkedIds = new Set<string>(Object.keys(runs));
it("ED+2: A run that has not ended and is not waiting in the queue holds its Mate's update, with its active pointer missing and beside a queue a usage limit parks alike, and so does a queued run already admitted", () => {
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
    { runs: { lost: { end: null, state: "admitted", admittedAt: 1, startedAt: null } } },
    {
      queue: [RunId.make("queued")],
      runs: {
        queued: { state: "queued", admittedAt: null, startedAt: null, end: null },
        running: { state: "running", admittedAt: 1, startedAt: 2, end: null },
      },
      pausedUntil: 1000,
      wakes: resume,
    },
    {
      queue: [RunId.make("queued")],
      runs: { queued: { state: "queued", admittedAt: 1, startedAt: null, end: null } },
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
it("ED+3: A conversation holds its Mate's update while a run is active, a message waits in a queue no usage limit parks, a request its turn waits on is open, an answer awaits its receipt, an effect is unsettled or its session is closing; an ask the record keeps holds none, and a conversation with none of these is idle", () => {
  for (const patch of [
    { activeRunId: RunId.make("active") },
    { queue: [RunId.make("queued")] },
    { requests: { question: {} } },
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
  const requests = { ask: { kind: "vault" } };
  expect(engineStateBlockers({ ...initialState(ConversationId.make("idle")), requests })).toEqual(
    [],
  );
  expect(engineStateBlockers(initialState(ConversationId.make("idle")))).toEqual([]);
});

// witness: apps/server/src/engine/updateIdle.ts | if (run.endedAt !== null && (latest === undefined || run.endedAt > latest)) → if (run.endedAt !== null && (latest === undefined || run.endedAt < latest))
it("ED+4: An automatic update's quiet wait counts from the latest end among a conversation's runs; a run still going adds none, and a conversation with no ended run has none", () => {
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
  "ED+5: While an update waits a conversation takes only what settles or stops accepted work (a stop, an answer, a dismissal, a session's close, a cancelled wake, an effect's outcome, the provider's signals, a recovery, a lease bound or unbound) and refuses new work without running it (a message, a steered message, a model or agent change, archiving, restoring, a wake armed or fired); once the update is called off it takes new work again",
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
  "ED+6: A message accepted before an update's fence closes is finished first: the fence stays open until it has, and then refuses the next message",
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
