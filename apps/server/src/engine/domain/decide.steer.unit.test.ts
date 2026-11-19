import { expect, it } from "vite-plus/test";
import type {
  ChatImageAttachment,
  KnownEngineEvent,
  Principal,
  TurnHandle,
} from "@t3tools/contracts";

import { STEERED_NOTE } from "./told.ts";
import {
  ended,
  opened,
  play,
  prepared,
  r,
  running,
  send,
  settled,
  signal,
  stop,
  turnEnded,
} from "../testing/scene.ts";

const ana: Principal = { kind: "person", subject: "ana" };
const bo: Principal = { kind: "person", subject: "bo" };
const sent = (run: number) => settled(r(run), "provider.send", { kind: "ok" });
const runningWithSteer = [send(), prepared(1), opened(1, { steer: true }), sent(1)];
const runningWithPictureSteer = [
  send(),
  prepared(1),
  opened(1, { steer: true, steerAttachments: true }),
  sent(1),
];
const steeredPicture = {
  type: "image",
  id: "img-s",
  name: "belts.png",
  mimeType: "image/png",
  sizeBytes: 2048,
} as unknown as ChatImageAttachment;

const BG = "bg" as TurnHandle;
const selfTurn = (turn: TurnHandle = BG) =>
  signal({ kind: "turn-started", turn, origin: "self", providerTurnId: turn });
const bgEnded = (turn: TurnHandle = BG) =>
  signal({ kind: "turn-ended", turn, outcome: { kind: "completed" }, source: "agent" });
const idle = [...runningWithSteer, turnEnded];
const message = (n: number) => `${r(n)}/i/1`;
const ends = (log: ReadonlyArray<KnownEngineEvent>) =>
  log.flatMap((e) =>
    e._tag === "RunEnded" ? [`${e.runId.split("/").at(-1)}:${e.end.kind}/${e.source}`] : [],
  );

// witness: apps/server/src/engine/domain/decide.ts | if (run.state !== "running" && run.state !== "waiting") throw new Rejected("run-not-running"); → if (run.state !== "waiting") throw new Rejected("run-not-running");
it("ED99: Steer puts a message, with the person's pictures where the driver takes them, into the running turn", () => {
  const words = play([...runningWithSteer, { _tag: "Steer", runId: r(1), text: "use pnpm" }]);
  expect(words.effects.map((effect) => effect.kind)).toEqual(["provider.steer"]);
  expect(words.events[0]).toMatchObject({ body: { delivery: { state: "steered" } } });

  const pictures = play([
    ...runningWithPictureSteer,
    { _tag: "Steer", runId: r(1), text: "look", attachments: [steeredPicture] },
  ]);
  expect(pictures.effects.map((effect) => effect.kind)).toEqual(["provider.steer"]);
  expect(pictures.events[0]).toMatchObject({
    body: { attachments: [steeredPicture], delivery: { state: "steered" } },
  });
  expect(pictures.effects[0]).toMatchObject({ payload: { attachments: [steeredPicture] } });
});

// witness: apps/server/src/engine/domain/decide.ts | const told = steeredWith(toldWith(command.text, command.context), mateSenderOf(b.state, run)); → const told = toldWith(command.text, command.context);
it("ED100: A message sent while the Mate works asks its agent to answer it in words the person reads, and the record keeps what they typed", () => {
  // A Mate answered two such questions only in its thinking; a compaction then summarised them
  // as answered and the person never got a reply.
  const scene = play([
    ...runningWithSteer,
    { _tag: "Steer", runId: r(1), text: "is the stage live?" },
  ]);
  expect(scene.events[0]).toMatchObject({ body: { text: "is the stage live?" } });
  expect(scene.effects[0]).toMatchObject({
    kind: "provider.steer",
    payload: { text: `is the stage live?\n\n${STEERED_NOTE}` },
  });
});

// witness: apps/server/src/engine/domain/decide.ts | (attachments.length > 0 && session.capabilities.steerAttachments !== true) → (attachments.length > 0 && session.capabilities.steerAttachments === false)
it("ED101: Steer is refused where the driver cannot steer, with pictures where the driver takes words only, into a queued or unknown run, in an archived conversation, and from the engine itself", () => {
  const refused = (scene: ReturnType<typeof play>, reason: string) =>
    expect(scene.decision).toMatchObject({ _tag: "Reject", rejection: { reason } });
  refused(play([...running, { _tag: "Steer", runId: r(1), text: "faster" }]), "steer-unsupported");
  refused(
    play([
      ...runningWithSteer,
      { _tag: "Steer", runId: r(1), text: "look", attachments: [steeredPicture] },
    ]),
    "steer-unsupported",
  );
  refused(
    play([...runningWithSteer, send("queued"), { _tag: "Steer", runId: r(2), text: "faster" }]),
    "run-not-running",
  );
  refused(
    play([...runningWithSteer, { _tag: "Steer", runId: r(9), text: "faster" }]),
    "unknown-run",
  );
  refused(
    play([
      ...runningWithSteer,
      { _tag: "Archive" },
      { _tag: "Steer", runId: r(1), text: "faster" },
    ]),
    "archived",
  );
  refused(
    play([
      ...runningWithSteer,
      { command: { _tag: "Steer", runId: r(1), text: "faster" }, by: { kind: "engine" } },
    ]),
    "invalid-principal",
  );
});

// witness: apps/server/src/engine/domain/decide.ts | const joins = reportsOn ?? b.state.endedRuns.at(-1) ?? b.state.latestRunId; → const joins = b.state.endedRuns.at(-1) ?? b.state.latestRunId;
it("ED102: A turn the agent starts itself joins the run whose work it reports, or the latest run when the bridge names none", () => {
  const reported = play([
    ...running,
    turnEnded,
    { command: send("other"), by: bo },
    prepared(2),
    ended(2),
    signal({
      kind: "turn-started",
      turn: BG,
      origin: "self",
      providerTurnId: "bg",
      reportsOn: r(1),
    }),
  ]);
  expect(reported.state.runs[r(3)]).toMatchObject({
    state: "running",
    joins: r(1),
    trigger: { kind: "wake", cause: "self" },
    principal: ana,
  });

  const latest = play([
    ...running,
    turnEnded,
    signal({ kind: "turn-started", turn: BG, origin: "self", providerTurnId: "bg" }),
  ]);
  expect(latest.state.runs[r(2)]).toMatchObject({
    state: "running",
    joins: r(1),
    trigger: { kind: "wake", cause: "self" },
    principal: ana,
  });
});

// witness: apps/server/src/engine/domain/decide.ts | if (active?.state === "admitted") { → if (active?.state === "sending") {
it("ED103: A turn the agent starts itself while a run is prepared requeues that run, which is sent when the agent's own turn ends", () => {
  // A driver that takes no message into a running turn: the message waits for the agent's turn.
  const own = signal({ kind: "turn-started", turn: BG, origin: "self", providerTurnId: "bg" });
  const scene = play([...running, turnEnded, send("next"), own]);
  expect(scene.state.queue).toEqual([r(2)]);
  expect(scene.state.runs[r(3)]).toMatchObject({ state: "running", joins: r(1) });
  const after = play([...running, turnEnded, send("next"), own, prepared(2), bgEnded()]);
  expect(after.state.runs[r(2)]?.state).toBe("sending");
  expect(after.effects.map((effect) => effect.kind)).toEqual(["provider.send"]);
});

// witness: apps/server/src/engine/domain/decide.ts | return first.personBody?.delivery.state === "queued" ? first : undefined; → return first.personBody?.delivery.state === "steered" ? first : undefined;
it("ED104: A person's waiting message is steered into a turn the agent starts itself, which becomes its run; that turn's end ends the run and admits the next waiting message", () => {
  const scene = play([...idle, send("carry on"), selfTurn()]);
  expect(scene.state.runs[r(2)]).toMatchObject({ state: "running", turn: BG });
  expect(scene.state.runs[r(3)]).toBeUndefined();
  expect(scene.effects).toMatchObject([
    {
      kind: "provider.steer",
      payload: {
        runId: r(2),
        sessionId: "s1",
        itemId: message(2),
        text: `carry on\n\n${STEERED_NOTE}`,
      },
    },
  ]);
  expect(scene.events.find((event) => event._tag === "ItemUpdated")).toMatchObject({
    itemId: message(2),
    body: { kind: "person", text: "carry on", delivery: { state: "steered" } },
  });

  const { state, log } = play([...idle, send("first"), send("second"), selfTurn(), bgEnded()]);
  expect(ends(log)).toEqual(["1:completed/agent", "2:completed/agent"]);
  expect(state.activeRunId).toBe(r(3));
  expect(state.runs[r(3)]?.state).toBe("admitted");
});

// witness: apps/server/src/engine/domain/decide.ts | turn: run.turn, → turn: run.id,
it("ED105: A message stopped before the agent's turn opens never goes into it, and a Stop on a message that went into the agent's turn stops that turn", () => {
  const before = play([...idle, send("carry on"), stop(2), selfTurn()]);
  expect(before.state.runs[r(2)]?.end).toMatchObject({ kind: "stopped" });
  // The stopped run stays stopped: the agent's turn is a run of its own.
  expect(before.state.runs[r(3)]).toMatchObject({ state: "running", joins: null });
  expect(before.effects.map((effect) => effect.kind)).not.toContain("provider.steer");

  const into = play([...idle, send("carry on"), selfTurn(), stop(2)]);
  expect(into.effects).toMatchObject([
    { kind: "provider.interrupt", payload: { runId: r(2), turn: BG } },
  ]);
});

// witness: apps/server/src/engine/domain/decide.ts | if (run.state !== "admitted") return; → if (run.state === "queued") return;
it("ED106: An admission that refuses a message already in the agent's turn leaves that turn running", () => {
  const scene = play([
    ...idle,
    send("carry on"),
    selfTurn(),
    prepared(2, { kind: "failed", reason: "the signer is offboarded", refused: true }),
  ]);
  expect(scene.state.runs[r(2)]?.state).toBe("running");
});

// witness: apps/server/src/engine/domain/decide.ts | if (first.maintenance || first.interactionMode !== "default") return; → if (first.maintenance && first.interactionMode !== "default") return;
it("ED107: A plan or a maintenance command waits for the agent's turn to end, first in line", () => {
  for (const waiting of [
    send("plan it", { interactionMode: "plan" }),
    send("/compact", { maintenance: true }),
  ]) {
    const scene = play([...idle, waiting, selfTurn()]);
    expect(scene.state.queue).toEqual([r(2)]);
    expect(scene.state.runs[r(3)]).toMatchObject({ state: "running", trigger: { cause: "self" } });
    expect(scene.effects.map((effect) => effect.kind)).not.toContain("provider.steer");
  }
});

// witness: apps/server/src/engine/domain/decide.ts | if (signal.origin !== "self" && steered === undefined) return; → if (signal.origin !== "self") return;
it("ED108: A message steered in as its turn ended opens a turn of its own, and that turn's end ends the run the engine holds it as", () => {
  // The driver took the message as its next turn: unowned, its end would be dropped and the next
  // send, steered into it, would never end.
  const lateTurn = `${r(1)}/i/2` as TurnHandle;
  const late = [
    ...runningWithSteer,
    { _tag: "Steer", runId: r(1), text: "more" } as const,
    turnEnded,
    signal({ kind: "turn-started", turn: lateTurn, origin: "engine", providerTurnId: "T2" }),
  ];
  expect(play(late).state.runs[r(2)]).toMatchObject({
    state: "running",
    joins: r(1),
    trigger: { kind: "wake", cause: "self" },
    principal: ana,
  });
  const lateEnded = play([
    ...late,
    signal({
      kind: "turn-ended",
      turn: lateTurn,
      outcome: { kind: "completed" },
      source: "agent",
    }),
  ]);
  expect(lateEnded.state.runs[r(2)]).toMatchObject({ state: "ended", end: { kind: "completed" } });
});
