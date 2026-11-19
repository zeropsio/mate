import { expect, it } from "vite-plus/test";
import type { Command } from "./command.ts";
import { WATCHDOG_SILENCE_MS } from "./decide.runs.ts";
import { T, T0, fired, note, play, r, running, signal } from "../testing/scene.ts";

const MINUTE = 60_000;

// witness: apps/server/src/engine/domain/decide.wakes.ts | if (b.now - lastActivity >= WATCHDOG_SILENCE_MS) { → if (b.now - lastActivity > WATCHDOG_SILENCE_MS) {
it("ED60: The watchdog marks a silent run unresponsive and never ends it, and a run that speaks again loses the mark", () => {
  const silent = play([...running, fired("watchdog", r(1), T0 + WATCHDOG_SILENCE_MS)]);
  expect(silent.state.runs[r(1)]).toMatchObject({ state: "running", unresponsiveSince: T0 });
  const spoke = play([
    ...running,
    fired("watchdog", r(1), T0 + WATCHDOG_SILENCE_MS),
    signal({ kind: "item-opened", turn: T(1), key: "k", by: { kind: "mate" }, body: note("k") }),
  ]);
  expect(spoke.state.runs[r(1)]).toMatchObject({ state: "running", unresponsiveSince: null });
});

// witness: apps/server/src/engine/domain/decide.wakes.ts | dueAt: nextCronTime(wake.cron, Math.max(b.now, wake.dueAt)), → dueAt: wake.dueAt,
it("ED61: A recurring wake runs with the wake's principal and re-arms at the cron's next time", () => {
  const { state } = play([
    {
      command: {
        _tag: "ArmWake",
        kind: "standup",
        key: "daily",
        cron: "0 9 * * *",
        text: "Stand up",
      },
      by: { kind: "standup", startedBy: "ana" },
    },
    fired("standup", "daily", T0 + 24 * 60 * MINUTE),
  ]);
  expect(state.runs[r(1)]).toMatchObject({
    trigger: { kind: "wake", cause: "standup" },
    principal: { kind: "standup", startedBy: "ana" },
  });
  const rearmed = Object.values(state.wakes).find((wake) => wake.kind === "standup");
  expect(rearmed?.dueAt).toBeGreaterThan(T0 + 24 * 60 * MINUTE);
});

// witness: apps/server/src/engine/domain/decide.wakes.ts | if (dueAt === undefined) throw new Rejected("invalid-wake" → if (dueAt === null) throw new Rejected("invalid-wake"
it("ED62: A wake is refused when its cron does not parse, when it has neither a due time nor a cron, when it would run as the engine, and when it fires unarmed", () => {
  const refusal = (reason: string) => ({ _tag: "Reject", rejection: { reason } });
  expect(
    play([{ _tag: "ArmWake", kind: "schedule", key: "k", cron: "every tuesday" }]).decision,
  ).toMatchObject(refusal("invalid-wake"));
  expect(play([{ _tag: "ArmWake", kind: "schedule", key: "k" }]).decision).toMatchObject(
    refusal("invalid-wake"),
  );
  expect(
    play([
      {
        command: { _tag: "ArmWake", kind: "standup", key: "daily", dueAt: T0 },
        by: { kind: "engine" },
      },
    ]).decision,
  ).toMatchObject(refusal("invalid-principal"));
  const recovered: Command = {
    _tag: "Recovered",
    bootId: "boot-2" as never,
    cutEffects: [],
  };
  expect(
    play([
      ...running,
      recovered,
      fired("restart-continuation", r(1), T0),
      fired("restart-continuation", r(1), T0),
    ]).decision,
  ).toMatchObject(refusal("wake-not-armed"));
});
