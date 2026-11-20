import { expect, it } from "vite-plus/test";
import { effectId, requestId } from "@t3tools/contracts";
import {
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
} from "../testing/scene.ts";

const recovered = (cut: ReadonlyArray<string> = []) =>
  ({
    _tag: "Recovered",
    bootId: "boot-2" as never,
    cutEffects: cut.map((id) => id as never),
  }) as const;

// witness: apps/server/src/engine/domain/decide.restart.ts | if (refusal === null && !crewRun) { → if (refusal === null && !crewRun && run.state !== "running") {
it("ED45: A restart cuts the live run and arms its continuation: a new run that joins the cut one, acts for its principal and resumes its session's thread", () => {
  const cut = play([...running, recovered()]);
  expect(cut.state.runs[r(1)]?.end).toMatchObject({ kind: "cut-by-restart" });
  expect(cut.events.find((e) => e._tag === "WakeArmed")).toMatchObject({
    kind: "restart-continuation",
    joins: r(1),
  });
  const continued = play([...running, recovered(), fired("restart-continuation", r(1), T0)]);
  expect(continued.state.runs[r(2)]).toMatchObject({
    state: "admitted",
    joins: r(1),
    principal: { kind: "person", subject: "ana" },
  });
  expect(
    play([...running, recovered(), fired("restart-continuation", r(1), T0), prepared(2)]).effects,
  ).toMatchObject([{ kind: "session.open", payload: { resume: "native-1" } }]);
});

// witness: apps/server/src/engine/domain/decide.restart.ts | if (state.lastPersonSeq > run.sinceSeq) return "a newer person message"; → if (state.lastPersonSeq < run.sinceSeq) return "a newer person message";
it("ED46: A restart does not continue a run when a newer person message waits, a Stop was asked, the turn was maintenance or the conversation is archived", () => {
  const rows = [
    { given: [...running, send("newer")], reason: "a newer person message" },
    { given: [...running, stop()], reason: "a Stop was asked" },
    {
      given: [
        send("/compact", { maintenance: true }),
        prepared(1),
        opened(1),
        settled(r(1), "provider.send", { kind: "ok" }),
      ],
      reason: "a maintenance turn",
    },
    { given: [...running, { _tag: "Archive" as const }], reason: "archived" },
  ];
  for (const { given, reason } of rows) {
    const scene = play([...given, recovered()]);
    expect(scene.state.runs[r(1)]?.end).toMatchObject({ notContinued: reason });
    expect(scene.events.some((e) => e._tag === "WakeArmed")).toBe(false);
  }
  expect(
    play([...running, recovered(), send("I'm back"), fired("restart-continuation", r(1), T0)]).state
      .runs[r(1)]?.end,
  ).toMatchObject({ notContinued: "a newer person message" });
  expect(
    play([
      ...running,
      recovered(),
      { _tag: "Archive" },
      fired("restart-continuation", r(1), T0),
    ]).events.some((e) => e._tag === "RunNotContinued"),
  ).toBe(true);
});

// witness: apps/server/src/engine/domain/decide.restart.ts | if (run !== undefined && run.state === "sending" && neverSent.has(run.id) && !crewRun) { → if (run !== undefined && run.state === "admitted" && neverSent.has(run.id) && !crewRun) {
it("ED47: A restart puts a message whose send never started back at the head, to go as it was", () => {
  const scene = play([
    ...running,
    turnEnded,
    send("second"),
    prepared(2),
    {
      _tag: "Recovered",
      bootId: "boot-2" as never,
      cutEffects: [],
      unstartedEffects: [effectId(r(2), "provider.send", 1)],
    },
  ]);
  expect(scene.state.runs[r(2)]).toMatchObject({ state: "admitted", text: "second" });
  expect(scene.effects).toMatchObject([{ kind: "session.open" }]);
});

// witness: apps/server/src/engine/domain/decide.restart.ts | ? resentText(run.text) → ? continueText(run)
it("ED48: A message whose send a restart cut mid-flight goes again in its own words, marked", () => {
  const scene = play([
    ...running,
    turnEnded,
    send("second"),
    prepared(2),
    recovered([effectId(r(2), "provider.send", 1)]),
  ]);
  expect(scene.state.runs[r(2)]?.end).toMatchObject({ kind: "cut-by-restart" });
  expect(scene.events.find((e) => e._tag === "WakeArmed")).toMatchObject({
    kind: "restart-continuation",
    text: "(Sent again after a server restart; it may have reached you already.)\n\nsecond",
  });
});

// witness: apps/server/src/engine/domain/decide.effects.ts | if (run.sendAttempts >= 2 || run.stopAsked !== null || run.state !== "sending") return false; → if (run.sendAttempts >= 1 || run.stopAsked !== null || run.state !== "sending") return false;
it("ED49: A message the session could not take goes again once, on a new session, and ends its run failed, the message refused, when it could not go twice", () => {
  const undelivered = (n = 1) =>
    settled(
      r(1),
      "provider.send",
      { kind: "failed", reason: "no live session", undelivered: true },
      n,
    );
  expect(play([send("go"), prepared(1), opened(1), undelivered()]).effects).toMatchObject([
    { kind: "session.open" },
  ]);
  expect(
    play([send("go"), prepared(1), opened(1), undelivered(), opened(1, { session: "s2", n: 2 })])
      .effects,
  ).toMatchObject([
    {
      kind: "provider.send",
      effectId: effectId(r(1), "provider.send", 2),
      payload: { text: "go" },
    },
  ]);
  const failed = play([
    send("go"),
    prepared(1),
    opened(1),
    undelivered(),
    opened(1, { session: "s2", n: 2 }),
    undelivered(2),
  ]);
  expect(failed.state.runs[r(1)]?.end).toMatchObject({ kind: "failed" });
  expect(delivery(failed.log)).toBe("refused");
});

// witness: apps/server/src/engine/domain/decide.runs.ts | if (run.personBody?.delivery.state === "queued") { → if (run.personBody?.delivery.state === "queued" && end.kind !== "usage-limit") {
it("ED50: A person's message never reads queued once its run has ended: a failed send, a restart, an exited session, a usage limit and a turn never seen to start each settle its delivery", () => {
  const endings = [
    settled(r(1), "provider.send", { kind: "failed", reason: "socket closed" }),
    recovered([effectId(r(1), "provider.send", 1)]),
    signal({ kind: "session-exited", reason: "exit 137" }),
    signal({ kind: "usage-limit", resetsAt: T0 + 60_000 }),
    turnEnded,
  ];
  for (const last of endings) {
    const scene = play([send("go"), prepared(1), opened(1), last]);
    expect(scene.state.runs[r(1)]?.state).toBe("ended");
    expect(delivery(scene.log)).not.toBe("queued");
  }
});

// witness: apps/server/src/engine/domain/decide.signals.ts | if (b.state.askedKeys[signal.key] !== undefined) return; → if (b.state.askedKeys[signal.key] !== undefined && Object.values(b.state.requests).some((request) => request.key === signal.key)) return;
it("ED51: A signal delivered again changes nothing: a batch under a new batch id records nothing, and a request delivered again after its answer is not asked again", () => {
  const ask = { kind: "approval", requestKind: "command", detail: "rm -rf build" } as const;
  const batch = signal(
    { kind: "item-opened", turn: T(1), key: "k", by: { kind: "mate" }, body: note("k") },
    { kind: "item-closed", turn: T(1), key: "k", body: { ...note("k"), streaming: false } },
    { kind: "request-opened", turn: T(1), key: "q", ask },
  );
  const proofRunning = [
    send("go"),
    prepared(1),
    opened(1),
    settled(r(1), "provider.send", { kind: "ok", value: { providerTurnId: "t1" } }),
  ];
  const once = play([...proofRunning, batch]);
  const twice = play([...proofRunning, batch, batch]);
  expect(twice.log).toEqual(once.log);
  const answered = play([
    ...proofRunning,
    requestOpened("q"),
    { _tag: "Answer", requestId: requestId(r(1), 1), answer: "yes", summary: "yes" },
    requestOpened("q"),
  ]);
  expect(answered.log.filter((e) => e._tag === "RequestOpened")).toHaveLength(1);
  expect(answered.state.runs[r(1)]?.state).toBe("running");
});

function delivery(log: ReturnType<typeof play>["log"]) {
  return log
    .flatMap((e) =>
      (e._tag === "ItemOpened" || e._tag === "ItemUpdated") && e.body.kind === "person"
        ? [e.body.delivery.state]
        : [],
    )
    .at(-1);
}
