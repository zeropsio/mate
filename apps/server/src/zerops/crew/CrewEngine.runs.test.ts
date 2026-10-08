import { assert, describe, it } from "@effect/vitest";
import type { CrewRunOptions } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { git, read, write } from "./testing/crewGitFixture.ts";
import {
  AS_CREW,
  applied,
  crewJourney,
  eventually,
  firstTurn,
  lastAdmitted,
  opened,
  reportDone,
  sentKind,
  turnsSent,
  type CrewChat,
  type CrewWorld,
} from "./testing/crewWorld.ts";

const OPTIONS: CrewRunOptions = {
  budgetUsd: 1,
  timeLimitHours: 8,
  stopAtUsagePercent: 80,
  landing: "person",
  devGrant: false,
  leadMayStart: false,
};

const started = (world: CrewWorld, options: Partial<CrewRunOptions> = {}) =>
  Effect.gen(function* () {
    yield* applied(world);
    yield* world.press({ _tag: "start", ...OPTIONS, ...options });
    return (yield* world.snapshotWhere((current) => current.run?.state === "running")).run!.id;
  });

const budgetOf = (world: CrewWorld, chat: CrewChat) =>
  Effect.map(world.member(chat), (member) => Option.getOrThrow(member).maxBudgetUsd);

const ended = (world: CrewWorld, chat: CrewChat, sessionCostUsd: number) =>
  world.turnEnds(chat, { sessionCostUsd });

describe("CrewEngine runs", () => {
  it.live("a run's sessions get what its budget has left; reaching it pauses the run", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* started(world);
        const thread = yield* firstTurn(world, () => undefined);
        const first = yield* budgetOf(world, thread);
        yield* ended(world, thread, 0.25);
        yield* world.snapshotWhere((current) => current.run?.spentUsd === 0.25);
        const left = yield* budgetOf(world, thread);
        yield* world.press({ _tag: "message", handle: "backend", text: "More", attachments: [] });
        yield* world.turnStarts(thread);
        // A session's total is cumulative: 1.0 is this turn's 0.75 on top of the first's 0.25.
        yield* ended(world, thread, 1);
        const paused = (yield* world.snapshotWhere((current) => current.run?.state === "paused"))
          .run!;
        // The CLI caps a session process's own spend: what the run has left.
        assert.deepStrictEqual(
          [first, left, paused.reason, paused.spentUsd],
          [1, 0.75, "budget", 1],
        );
      }),
    ),
  );

  it.live(
    "Resume on a spent budget is refused by name; a raised budget runs on with the new remainder",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          const runId = yield* started(world);
          const thread = yield* firstTurn(world, () => undefined);
          yield* ended(world, thread, 1.25);
          yield* world.snapshotWhere((current) => current.run?.reason === "budget");
          const refused = yield* Effect.flip(world.press({ _tag: "resume", runId }));
          const tooLow = yield* Effect.flip(world.press({ _tag: "resume", runId, budgetUsd: 1.2 }));
          yield* world.press({ _tag: "resume", runId, budgetUsd: 2 });
          const raised = (yield* world.snapshotWhere((current) => current.run?.state === "running"))
            .run!;
          const left = yield* budgetOf(world, thread);
          yield* world.press({ _tag: "pause", runId });
          yield* world.snapshotWhere((current) => current.run?.state === "paused");
          yield* world.press({ _tag: "resume", runId, budgetUsd: "unlimited" });
          yield* world.snapshotWhere((current) => current.run?.options.budgetUsd === "unlimited");
          assert.deepStrictEqual(
            {
              refused: [refused.reason, refused.detail],
              tooLow: tooLow.detail,
              raised: [raised.options.budgetUsd, raised.options.timeLimitHours, left],
              noLimit: yield* budgetOf(world, thread),
            },
            {
              refused: [
                "wrong-state",
                "The run has spent its $1 budget — raise it or choose No limit to resume",
              ],
              tooLow: "The run has spent its $1.20 budget — raise it or choose No limit to resume",
              raised: [2, 8, 0.75],
              noLimit: undefined,
            },
          );
        }),
      ),
  );

  it.live("spend counts each turn's own cost, once, from a session's cumulative totals", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* started(world, { budgetUsd: 10 });
        const thread = yield* firstTurn(world, () => undefined);
        yield* ended(world, thread, 0.3);
        yield* world.snapshotWhere((current) => current.run?.spentUsd === 0.3);
        // The same end delivered twice, and a turn stopped before it cost anything.
        yield* world.turnEndRedelivered(thread);
        yield* world.press({ _tag: "message", handle: "backend", text: "More", attachments: [] });
        yield* world.turnStarts(thread);
        yield* world.turnEnds(thread, { state: "interrupted", sessionCostUsd: 0.3 });
        yield* world.press({ _tag: "message", handle: "backend", text: "Again", attachments: [] });
        yield* world.turnStarts(thread);
        yield* ended(world, thread, 0.5);
        const run = (yield* world.snapshotWhere((current) => current.run?.spentUsd !== 0.3)).run!;
        const [task] = (yield* world.snapshot).board.tasks;
        const attempts = yield* world.attempts(task!.id);
        assert.deepStrictEqual([run.spentUsd, attempts.map((row) => row.costUsd)], [0.5, [0.5]]);
      }),
    ),
  );

  it.live(
    "a session total below the kept one starts the count again from it, counting nothing",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* started(world, { budgetUsd: 10 });
          const thread = yield* firstTurn(world, () => undefined);
          yield* ended(world, thread, 0.5);
          yield* world.snapshotWhere((current) => current.run?.spentUsd === 0.5);
          for (const total of [0.2, 0.35]) {
            yield* world.press({
              _tag: "message",
              handle: "backend",
              text: "More",
              attachments: [],
            });
            yield* world.turnStarts(thread);
            // A resume that carried over less than the last total, then a turn on top of it.
            yield* ended(world, thread, total);
          }
          const run = (yield* world.snapshotWhere((current) => current.run?.spentUsd !== 0.5)).run!;
          assert.strictEqual(run.spentUsd.toFixed(2), "0.65");
        }),
      ),
  );

  it.live(
    "a run caps each session at the run's remainder, whatever it spent before, after a restart too",
    () =>
      crewJourney([
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            const thread = yield* firstTurn(world, () => undefined);
            yield* ended(world, thread, 0.4);
            yield* world.snapshotWhere((current) => current.crewmates[0]!.lane?.ahead === 0);
          }),
        (world) =>
          Effect.gen(function* () {
            yield* world.serverReady;
            yield* world.press({ _tag: "start", ...OPTIONS });
            yield* world.snapshotWhere((current) => current.run?.state === "running");
            const thread = (yield* opened(world)).find((entry) => entry.handle === "backend")!.chat;
            const stopped = (yield* sentKind(world, "stop")).map((entry) => entry.chat);
            assert.deepStrictEqual(
              [yield* budgetOf(world, thread), stopped.includes(thread)],
              [1, true],
            );
          }),
      ]),
  );

  it.live(
    "a session's kept total comes back after a restart: its next turn counts its own rise",
    () => {
      let thread: CrewChat | undefined;
      return crewJourney([
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            thread = yield* firstTurn(world, () => undefined);
            write(world.workspace, "backend.jsonl", "{}\n");
            yield* world.sessionStart(thread, {
              source: "startup",
              sessionId: "session-kept",
              transcriptPath: `${world.workspace}/backend.jsonl`,
            });
            yield* ended(world, thread, 0.4);
            yield* world.sessionsWhere("backend", (sessions) => sessions.latest === "active");
          }),
        (world) =>
          Effect.gen(function* () {
            yield* world.serverReady;
            yield* world.press({ _tag: "start", ...OPTIONS });
            yield* world.snapshotWhere((current) => current.run?.state === "running");
            yield* world.press({
              _tag: "message",
              handle: "backend",
              text: "More",
              attachments: [],
            });
            yield* world.turnStarts(thread!);
            yield* ended(world, thread!, 1);
            const run = (yield* world.snapshotWhere((current) => current.run?.spentUsd !== 0)).run!;
            assert.deepStrictEqual([run.state, run.spentUsd.toFixed(2)], ["running", "0.60"]);
          }),
      ]);
    },
  );

  it.live(
    "a session whose turns the engine never costed counts nothing for its next turn, not its history",
    () => {
      let thread: CrewChat | undefined;
      return crewJourney([
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            thread = yield* firstTurn(world, () => undefined);
            // A build before turn costs: the session ran, nothing counted its total.
            write(world.workspace, "lead.jsonl", "{}\n");
            yield* world.sessionStart(thread, {
              source: "startup",
              sessionId: "session-before",
              transcriptPath: `${world.workspace}/lead.jsonl`,
            });
            yield* world.turnEnds(thread);
            yield* world.sessionsWhere("backend", (sessions) => sessions.latest === "active");
          }),
        (world) =>
          Effect.gen(function* () {
            yield* world.serverReady;
            yield* world.press({ _tag: "start", ...OPTIONS });
            yield* world.snapshotWhere((current) => current.run?.state === "running");
            yield* world.press({
              _tag: "message",
              handle: "backend",
              text: "More",
              attachments: [],
            });
            yield* world.turnStarts(thread!);
            // The resumed session's total carries its history: 1.59 before, 0.19 this turn.
            yield* ended(world, thread!, 1.78);
            yield* world.press({
              _tag: "message",
              handle: "backend",
              text: "More",
              attachments: [],
            });
            yield* world.turnStarts(thread!);
            yield* ended(world, thread!, 1.98);
            const run = (yield* world.snapshotWhere((current) => current.run?.spentUsd !== 0)).run!;
            assert.deepStrictEqual([run.state, run.spentUsd.toFixed(2)], ["running", "0.20"]);
          }),
      ]);
    },
  );

  it.live("a run with No limit sets no session budget and still meters the spend", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* started(world, { budgetUsd: "unlimited" });
        const thread = yield* firstTurn(world, () => undefined);
        const budget = yield* budgetOf(world, thread);
        yield* ended(world, thread, 6.4);
        const run = (yield* world.snapshotWhere((current) => current.run?.spentUsd === 6.4)).run!;
        assert.deepStrictEqual(
          [budget, run.state, run.options.budgetUsd],
          [undefined, "running", "unlimited"],
        );
      }),
    ),
  );

  it.live(
    "Pause interrupts the crew's running turns; Resume carries them on; Stop ends the run",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          const runId = yield* started(world);
          const thread = yield* firstTurn(world, () => undefined);
          yield* world.press({ _tag: "pause", runId });
          const paused = (yield* world.snapshotWhere((current) => current.run?.state === "paused"))
            .run!;
          const interrupts = (yield* sentKind(world, "interrupt")).map((entry) => entry.chat);
          yield* world.turnEnds(thread, { state: "interrupted" });
          yield* world.snapshotWhere((current) => current.crewmates[0]!.lane?.ahead === 0);
          yield* world.press({ _tag: "resume", runId });
          const resumed = (yield* world.snapshotWhere(
            (current) => current.run?.state === "running",
          )).run!;
          const carryOn = (yield* turnsSent(world)).at(-1)!.text;
          yield* world.press({ _tag: "stop", runId });
          const stopped = (yield* world.snapshotWhere(
            (current) => current.run?.state === "stopped",
          )).run!;
          const again = yield* Effect.flip(world.press({ _tag: "resume", runId }));
          assert.deepStrictEqual(
            {
              paused: [paused.state, paused.reason],
              interrupts,
              resumed: [resumed.state, resumed.reason],
              carryOn: carryOn.includes("The run was paused"),
              stopped: stopped.state,
              again: again.reason,
            },
            {
              paused: ["paused", "person"],
              interrupts: [thread],
              resumed: ["running", null],
              carryOn: true,
              stopped: "stopped",
              again: "wrong-state",
            },
          );
        }),
      ),
  );

  it.live("the usage window at the run's stop pauses it, and the section reads the window", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* started(world);
        yield* world.usage(85);
        const run = (yield* world.snapshotWhere((current) => current.run?.state === "paused")).run!;
        assert.deepStrictEqual([run.reason, run.usagePercent], ["usage", 85]);
      }),
    ),
  );

  it.live(
    "a run dispatches queued work as its starter; admission refusing it pauses the run with its words",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* started(world, { landing: "check" });
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/ok.txt", "ok\n"),
          );
          yield* world.press({
            _tag: "taskCreate",
            owner: "backend",
            title: "Second",
            brief: "Then this.",
            doneWhen: "",
            dependsOn: [],
          });
          yield* world.refuseTurns("You are not this login's signer.");
          yield* reportDone(world, thread);
          yield* ended(world, thread, 0.1);
          const paused = yield* world.snapshotWhere((current) => current.run?.state === "paused");
          assert.deepStrictEqual(
            {
              run: [paused.run!.reason, paused.run!.reasonDetail],
              second: paused.board.tasks[1]!.state,
              principal: yield* lastAdmitted(world),
              inRun: (yield* world.tasks).map((task) => task.run === paused.run!.id),
            },
            {
              run: ["refused", "You are not this login's signer."],
              second: "queued",
              principal: AS_CREW,
              inRun: [true, true],
            },
          );
        }),
      ),
  );

  it.live("in a run, a turn that ends without a report gets one nudge", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* started(world);
        const thread = yield* firstTurn(world, () => undefined);
        yield* ended(world, thread, 0.1);
        const nudges = (turns: ReadonlyArray<{ readonly text: string }>) =>
          turns.filter((turn) => turn.text.includes("without crew_report"));
        yield* world.snapshotWhere((current) => current.run?.spentUsd === 0.1);
        yield* eventually(Effect.map(turnsSent(world), (turns) => nudges(turns).length === 1));
        yield* world.turnStarts(thread);
        yield* ended(world, thread, 0.2);
        yield* world.snapshotWhere((current) => current.run?.spentUsd === 0.2);
        const turns = yield* turnsSent(world);
        assert.deepStrictEqual([nudges(turns).length, yield* lastAdmitted(world)], [1, AS_CREW]);
      }),
    ),
  );

  it.live("in a run, a failed check goes back to its crewmate on its own", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* started(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/b.txt", "crew\n"),
        );
        yield* reportDone(world, thread);
        yield* ended(world, thread, 0.1);
        const reworked = yield* world.snapshotWhere(
          (current) =>
            current.board.tasks[0]?.state === "working" && current.board.tasks[0]?.attempts === 2,
        );
        const fix = (yield* turnsSent(world)).at(-1)!;
        assert.deepStrictEqual(
          [
            fix.chat,
            fix.text.includes("fix the check"),
            yield* lastAdmitted(world),
            reworked.attention.map((row) => row.kind),
          ],
          [thread, true, AS_CREW, []],
        );
      }),
    ),
  );

  it.live("in a run, a merge conflict goes back to its crewmate on its own", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        write(world.root, "a.txt", "base\n");
        git(world.root, ["add", "-A"]);
        git(world.root, ["commit", "-q", "-m", "a.txt"]);
        yield* started(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/a.txt", "crew\n"),
        );
        write(world.root, "a.txt", "person\n");
        git(world.root, ["commit", "-q", "-am", "person edits a.txt"]);
        yield* reportDone(world, thread);
        yield* ended(world, thread, 0.1);
        const reworked = yield* world.snapshotWhere(
          (current) =>
            current.board.tasks[0]?.state === "working" && current.board.tasks[0]?.attempts === 2,
        );
        const resolve = (yield* turnsSent(world)).at(-1)!;
        assert.deepStrictEqual(
          [
            resolve.chat,
            resolve.text.includes("resolve the conflicts"),
            yield* lastAdmitted(world),
            (yield* world.tasks)[0]!.reworks,
            reworked.attention.map((row) => row.kind),
          ],
          [thread, true, AS_CREW, 1, []],
        );
      }),
    ),
  );

  it.live("with Land when the check passes, a run lands a task without a press", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* started(world, { landing: "check" });
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* reportDone(world, thread);
        yield* ended(world, thread, 0.1);
        yield* world.snapshotWhere((current) => current.board.tasks[0]?.state === "landed");
        assert.strictEqual(read(world.root, "ok.txt"), "ok\n");
      }),
    ),
  );

  it.live("a run's time is the time its crew works: sitting idle never reaches the limit", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis;
        const runId = yield* started(world, { landing: "person" });
        // Nothing to do yet: the crew sits idle.
        yield* Effect.sleep("400 millis");
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* Effect.sleep("400 millis");
        yield* reportDone(world, thread);
        yield* ended(world, thread, 0.1);
        yield* world.snapshotWhere((current) => current.board.tasks[0]?.state === "ready");
        // Its work waits for your review: idle again.
        yield* Effect.sleep("400 millis");
        yield* world.press({ _tag: "pause", runId });
        const paused = (yield* world.snapshotWhere((current) => current.run?.state === "paused"))
          .run!;
        const wallMs = (yield* Clock.currentTimeMillis) - startedAt;
        // The turn's 400 ms count; the two idle stretches around it do not.
        assert.isAtLeast(paused.elapsedMs, 350);
        assert.isAtMost(paused.elapsedMs, wallMs - 750);
      }),
    ),
  );

  it.live("with I land everything, a run leaves a ready task for your Land", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* started(world, { landing: "person" });
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* reportDone(world, thread);
        yield* ended(world, thread, 0.1);
        yield* world.snapshotWhere((current) => current.board.tasks[0]?.state === "ready");
        yield* Effect.sleep("300 millis");
        assert.strictEqual((yield* world.snapshotWhere(() => true)).board.tasks[0]?.state, "ready");
      }),
    ),
  );
});
