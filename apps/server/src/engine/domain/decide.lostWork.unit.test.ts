import { expect, it } from "vite-plus/test";
import { ConversationId, wakeId, type Principal } from "@t3tools/contracts";
import type { Command, EffectDraft } from "./command.ts";
import {
  ended,
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
  T,
  T0,
} from "../testing/scene.ts";

const conversation = ConversationId.make("mate");
const crew: Principal = { kind: "crew", startedBy: "ana" };
const SLEEP = "Wait two minutes, then print a confirmation";
const lostNote = (titles: string, how = "by a restart", plural = false) =>
  plural
    ? `Your background work ${titles} were stopped ${how} before they reported.`
    : `Your background work ${titles} was stopped ${how} before it reported.`;
const upserted = (key: string, title: string, status: "running" | "lost" | "stopped", n = 1) =>
  ({
    kind: "work-upserted",
    work: key,
    origin: T(n),
    workKind: "shell",
    status,
    title,
  }) as const;
const work = (key: string, title: string, n = 1): Command =>
  signal(upserted(key, title, "running", n));
/** The bridge's own order as a session dies: its live work lost, then the exit. */
const exited = (...titles: ReadonlyArray<readonly [string, string]>): Command =>
  signal(...titles.map(([key, title]) => upserted(key, title, "lost")), {
    kind: "session-exited",
    reason: "exit 137",
  });
const recovered = (): Command => ({ _tag: "Recovered", bootId: "boot-2" as never, cutEffects: [] });
const sent = (run: number) => settled(r(run), "provider.send", { kind: "ok" });
const sessionClosed = (session = "s1") => settled(session, "session.close", { kind: "ok" });
const backgrounded = [...running, work("w1", SLEEP), ended(1)];
const lostWakeId = wakeId(conversation, "lost-work", "note");
const lostFired = fired("lost-work", "note", T0);
const sendText = (scene: { readonly effects: ReadonlyArray<EffectDraft> }) =>
  scene.effects.flatMap((effect) =>
    effect.kind === "provider.send" ? [(effect.payload as { text: string }).text] : [],
  );
/** Lost-work notes that would wake the Mate on their own: one held for a message never does. */
const dueLostWork = (
  wakes: ReadonlyArray<{ readonly kind: string; readonly dueAt: number | null }>,
) => wakes.filter((wake) => wake.kind === "lost-work" && wake.dueAt !== Number.MAX_SAFE_INTEGER);

// witness: apps/server/src/engine/domain/decide.ts | if (crewCarriesOn(b.state, { principal: latest?.principal ?? ENGINE })) return; → if (crewCarriesOn(b.state, { principal: ENGINE })) return;
it("ED83: Work its session lost wakes the Mate once, naming the work, and wakes no turn where its crew carries the task on", () => {
  const rows = [
    { steps: [...backgrounded, recovered()], text: lostNote(`“${SLEEP}”`) },
    {
      steps: [...backgrounded, exited(["w1", SLEEP])],
      text: lostNote(`“${SLEEP}”`, "when its session ended"),
    },
  ];
  for (const { steps, text } of rows) {
    const { log, state } = play(steps);
    expect(log.filter((event) => event._tag === "WakeArmed" && event.kind === "lost-work")).toEqual(
      [expect.objectContaining({ wakeId: lostWakeId, dueAt: T0, joins: r(1), text })],
    );
    const woken = [...steps, lostFired];
    expect(play(woken).state.runs[r(2)]).toMatchObject({
      joins: r(1),
      trigger: { kind: "wake", cause: "lost-work" },
    });
    expect(sendText(play([...woken, prepared(2), opened(2)]))).toEqual([text]);
    expect(state.runs[r(2)]).toBeUndefined();
  }

  const crewRows = [
    [
      {
        command: {
          _tag: "AssignAgent",
          agent: {
            instanceId: "claudeAgent",
            driver: "claudeAgent",
            model: null,
            profile: { kind: "crewmate", id: "backend", name: "Backend" },
          },
        } as Command,
        by: crew,
      },
      ...backgrounded,
      recovered(),
    ],
    [
      { command: send(), by: crew },
      prepared(1),
      opened(1),
      sent(1),
      work("w1", SLEEP),
      ended(1),
      recovered(),
    ],
  ];
  for (const steps of crewRows) {
    const { log, state } = play(steps);
    expect(log.filter((event) => event._tag === "WakeArmed" && event.kind === "lost-work")).toEqual(
      [],
    );
    expect(Object.values(state.wakes).map((wake) => wake.kind)).not.toContain("lost-work");
  }
});

// witness: apps/server/src/engine/domain/decide.ts | if (notes.length === 0 || run.maintenance) return run.text; → if (notes.length === 0 || !run.maintenance) return run.text;
it("ED84: A person's message already waiting carries the note of lost work, with no wake of its own", () => {
  const rows = [
    [...running, work("w1", SLEEP), send("next"), ended(1), recovered()],
    [...backgrounded, recovered(), send("next")],
    [...backgrounded, recovered(), send("next"), lostFired],
  ];
  for (const steps of rows) {
    const scene = play([...steps, prepared(2), opened(2)]);
    expect(sendText(scene)).toEqual([`${lostNote(`“${SLEEP}”`)}\n\nnext`]);
    expect(Object.keys(scene.state.runs)).toEqual([r(1), r(2)]);
    expect(
      play([...steps, prepared(2), opened(2), sent(2)]).state.wakes[lostWakeId],
    ).toBeUndefined();
  }
});

// witness: apps/server/src/engine/domain/decide.ts | stop: BY_THE_PERSON, → stop: "by a restart",
it("ED85: Lost work wakes no one after a person's Stop or an archive, and work a person's Stop ended reaches the agent with the next message, stopped by the person", () => {
  const noWake = [
    [...running, work("w1", SLEEP), stop(), ended(1), recovered()],
    [...backgrounded, { _tag: "Archive" } as Command, recovered()],
  ];
  for (const steps of noWake) {
    const { log } = play(steps);
    expect(log.some((event) => event._tag === "ItemClosed" && event.body.kind === "work")).toBe(
      true,
    );
    expect(
      dueLostWork(log.flatMap((event) => (event._tag === "WakeArmed" ? [event] : []))),
    ).toEqual([]);
  }

  const HELPER = "Watch the api build";
  const JOB = "Tail the worker log";
  const stoppedNote = lostNote(`“${HELPER}” and “${JOB}”`, "by the person", true);
  const steps = [
    ...running,
    work("w1", HELPER),
    work("w2", JOB),
    ended(1),
    stop(),
    sessionClosed(),
  ];
  const { log, state } = play(steps);
  expect(
    log.flatMap((e) => (e._tag === "ItemClosed" && e.body.kind === "work" ? [e.body.status] : [])),
  ).toEqual(["stopped", "stopped"]);
  expect(play([...steps, lostFired]).state.runs[r(2)]).toBeUndefined();
  expect(state.runs[r(2)]).toBeUndefined();
  const next = [...steps, send("carry on"), prepared(2), opened(2, { session: "s2" })];
  expect(sendText(play(next))).toEqual([`${stoppedNote}\n\ncarry on`]);
  expect(
    Object.values(play([...next, sent(2)]).state.wakes).map((wake) => wake.kind),
  ).not.toContain("lost-work");
});

// witness: apps/server/src/engine/domain/decide.ts | if (wake === undefined || wake.dueAt !== HELD_FOR_SEND || runPending(b.state)) return; → if (wake === undefined || wake.dueAt !== HELD_FOR_SEND || !runPending(b.state)) return;
it("ED86: A note of lost work held for a message that never went fires on its own", () => {
  const held = [...running, work("w1", SLEEP), send("next"), ended(1), recovered()];
  const { log } = play([...held, stop(2)]);
  expect(
    log.findLast((event) => event._tag === "WakeArmed" && event.kind === "lost-work"),
  ).toMatchObject({ dueAt: T0, text: lostNote(`“${SLEEP}”`) });
  const woken = [...held, stop(2), lostFired, prepared(3), opened(3)];
  expect(sendText(play(woken))).toEqual([lostNote(`“${SLEEP}”`)]);
});
