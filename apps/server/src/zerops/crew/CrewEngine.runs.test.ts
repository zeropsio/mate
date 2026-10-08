import { assert, describe, it } from "@effect/vitest";
import { ProviderInstanceId, type CrewRunOptions, type ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import { ServerCommandReadiness } from "../../spi/serverCommandReadiness.ts";
import { CrewThreadDirectory, CrewToolHost } from "./crewSeams.ts";
import { CrewStore } from "./CrewStore.ts";
import {
  eventually,
  drained,
  spiEvent,
  withCrewEngine,
  withCrewEngines,
  type CrewWorld,
} from "./testing/crewEngineFixture.ts";
import {
  AS_CREW,
  applied,
  command,
  dispatchedOf,
  firstTurn,
  latest,
  reportDone,
  snapshotWhere,
} from "./testing/crewEngineSteps.ts";
import { git, read, write } from "./testing/crewGitFixture.ts";

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
    yield* command({ _tag: "start", ...OPTIONS, ...options });
    return (yield* snapshotWhere((current) => current.run?.state === "running")).run!.id;
  });

const budgetOf = (thread: ThreadId) =>
  Effect.map(
    Effect.flatMap(CrewThreadDirectory, (directory) => directory.memberFor(thread)),
    (member) => Option.getOrThrow(member).maxBudgetUsd,
  );

const ended = (world: CrewWorld, thread: ThreadId, totalCostUsd: number) =>
  world.publish(spiEvent("turn.completed", thread, { state: "completed", totalCostUsd }));

describe("CrewEngine runs", () => {
  it.live("a run's sessions get what its budget has left; reaching it pauses the run", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* started(world);
        const thread = yield* firstTurn(world, () => undefined);
        const first = yield* budgetOf(thread);
        yield* ended(world, thread, 0.25);
        yield* snapshotWhere((current) => current.run?.spentUsd === 0.25);
        const left = yield* budgetOf(thread);
        yield* command({ _tag: "message", handle: "backend", text: "More", attachments: [] });
        yield* world.publish(spiEvent("turn.started", thread, {}));
        // A session's total is cumulative: 1.0 is this turn's 0.75 on top of the first's 0.25.
        yield* ended(world, thread, 1);
        const paused = (yield* snapshotWhere((current) => current.run?.state === "paused")).run!;
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
      withCrewEngine((world) =>
        Effect.gen(function* () {
          const runId = yield* started(world);
          const thread = yield* firstTurn(world, () => undefined);
          yield* ended(world, thread, 1.25);
          yield* snapshotWhere((current) => current.run?.reason === "budget");
          const refused = yield* Effect.flip(command({ _tag: "resume", runId }));
          const tooLow = yield* Effect.flip(command({ _tag: "resume", runId, budgetUsd: 1.2 }));
          yield* command({ _tag: "resume", runId, budgetUsd: 2 });
          const raised = (yield* snapshotWhere((current) => current.run?.state === "running")).run!;
          const left = yield* budgetOf(thread);
          yield* command({ _tag: "pause", runId });
          yield* snapshotWhere((current) => current.run?.state === "paused");
          yield* command({ _tag: "resume", runId, budgetUsd: "unlimited" });
          yield* snapshotWhere((current) => current.run?.options.budgetUsd === "unlimited");
          assert.deepStrictEqual(
            {
              refused: [refused.reason, refused.detail],
              tooLow: tooLow.detail,
              raised: [raised.options.budgetUsd, raised.options.timeLimitHours, left],
              noLimit: yield* budgetOf(thread),
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
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* started(world, { budgetUsd: 10 });
        const thread = yield* firstTurn(world, () => undefined);
        const first = spiEvent("turn.completed", thread, { state: "completed", totalCostUsd: 0.3 });
        yield* world.publish(first);
        yield* snapshotWhere((current) => current.run?.spentUsd === 0.3);
        // The same end delivered twice, and a turn stopped before it cost anything.
        yield* world.publish(first);
        yield* command({ _tag: "message", handle: "backend", text: "More", attachments: [] });
        yield* world.publish(spiEvent("turn.started", thread, {}));
        yield* world.publish(
          spiEvent("turn.completed", thread, { state: "interrupted", totalCostUsd: 0.3 }),
        );
        yield* command({ _tag: "message", handle: "backend", text: "Again", attachments: [] });
        yield* world.publish(spiEvent("turn.started", thread, {}));
        yield* ended(world, thread, 0.5);
        const run = (yield* snapshotWhere((current) => current.run?.spentUsd !== 0.3)).run!;
        const [task] = (yield* latest).board.tasks;
        const attempts = yield* (yield* CrewStore).attemptsOf(task!.id);
        assert.deepStrictEqual([run.spentUsd, attempts.map((row) => row.costUsd)], [0.5, [0.5]]);
      }),
    ),
  );

  it.live(
    "a session total below the kept one starts the count again from it, counting nothing",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* started(world, { budgetUsd: 10 });
          const thread = yield* firstTurn(world, () => undefined);
          yield* ended(world, thread, 0.5);
          yield* snapshotWhere((current) => current.run?.spentUsd === 0.5);
          for (const total of [0.2, 0.35]) {
            yield* command({ _tag: "message", handle: "backend", text: "More", attachments: [] });
            yield* world.publish(spiEvent("turn.started", thread, {}));
            // A resume that carried over less than the last total, then a turn on top of it.
            yield* ended(world, thread, total);
          }
          const run = (yield* snapshotWhere((current) => current.run?.spentUsd !== 0.5)).run!;
          assert.strictEqual(run.spentUsd.toFixed(2), "0.65");
        }),
      ),
  );

  it.live(
    "a run caps each session at the run's remainder, whatever it spent before, after a restart too",
    () =>
      withCrewEngines([
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            const thread = yield* firstTurn(world, () => undefined);
            yield* ended(world, thread, 0.4);
            yield* snapshotWhere((current) => current.crewmates[0]!.lane?.ahead === 0);
          }),
        (world) =>
          Effect.gen(function* () {
            yield* (yield* ServerCommandReadiness).complete;
            yield* command({ _tag: "start", ...OPTIONS });
            yield* snapshotWhere((current) => current.run?.state === "running");
            const thread = (yield* dispatchedOf(world, "thread.crew.create")).find(
              (entry) => entry.crew.crewmate === "backend",
            )!.threadId;
            const stopped = (yield* dispatchedOf(world, "thread.session.stop")).map(
              (entry) => entry.threadId,
            );
            assert.deepStrictEqual([yield* budgetOf(thread), stopped.includes(thread)], [1, true]);
          }),
      ]),
  );

  it.live(
    "a session's kept total comes back after a restart: its next turn counts its own rise",
    () => {
      let thread: ThreadId | undefined;
      return withCrewEngines([
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            thread = yield* firstTurn(world, () => undefined);
            write(world.workspace, "backend.jsonl", "{}\n");
            const member = Option.getOrThrow(yield* (yield* CrewThreadDirectory).memberFor(thread));
            yield* (yield* CrewToolHost).sessionStart(member, {
              source: "startup",
              sessionId: "session-kept",
              transcriptPath: `${world.workspace}/backend.jsonl`,
            });
            yield* ended(world, thread, 0.4);
            yield* snapshotWhere((current) => current.crewmates[0]!.stints[0]?.state === "active");
          }),
        (world) =>
          Effect.gen(function* () {
            yield* (yield* ServerCommandReadiness).complete;
            yield* command({ _tag: "start", ...OPTIONS });
            yield* snapshotWhere((current) => current.run?.state === "running");
            yield* command({ _tag: "message", handle: "backend", text: "More", attachments: [] });
            yield* world.publish(spiEvent("turn.started", thread!, {}));
            yield* ended(world, thread!, 1);
            const run = (yield* snapshotWhere((current) => current.run?.spentUsd !== 0)).run!;
            assert.deepStrictEqual([run.state, run.spentUsd.toFixed(2)], ["running", "0.60"]);
          }),
      ]);
    },
  );

  it.live(
    "a session whose turns the engine never costed counts nothing for its next turn, not its history",
    () => {
      let thread: ThreadId | undefined;
      return withCrewEngines([
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            thread = yield* firstTurn(world, () => undefined);
            // A build before turn costs: the session ran, nothing counted its total.
            write(world.workspace, "lead.jsonl", "{}\n");
            const member = Option.getOrThrow(yield* (yield* CrewThreadDirectory).memberFor(thread));
            yield* (yield* CrewToolHost).sessionStart(member, {
              source: "startup",
              sessionId: "session-before",
              transcriptPath: `${world.workspace}/lead.jsonl`,
            });
            yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
            yield* snapshotWhere((current) => current.crewmates[0]!.stints[0]?.state === "active");
          }),
        (world) =>
          Effect.gen(function* () {
            yield* (yield* ServerCommandReadiness).complete;
            yield* command({ _tag: "start", ...OPTIONS });
            yield* snapshotWhere((current) => current.run?.state === "running");
            yield* command({ _tag: "message", handle: "backend", text: "More", attachments: [] });
            yield* world.publish(spiEvent("turn.started", thread!, {}));
            // The resumed session's total carries its history: 1.59 before, 0.19 this turn.
            yield* ended(world, thread!, 1.78);
            yield* command({ _tag: "message", handle: "backend", text: "More", attachments: [] });
            yield* world.publish(spiEvent("turn.started", thread!, {}));
            yield* ended(world, thread!, 1.98);
            const run = (yield* snapshotWhere((current) => current.run?.spentUsd !== 0)).run!;
            assert.deepStrictEqual([run.state, run.spentUsd.toFixed(2)], ["running", "0.20"]);
          }),
      ]);
    },
  );

  it.live("a run with No limit sets no session budget and still meters the spend", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* started(world, { budgetUsd: "unlimited" });
        const thread = yield* firstTurn(world, () => undefined);
        const budget = yield* budgetOf(thread);
        yield* ended(world, thread, 6.4);
        const run = (yield* snapshotWhere((current) => current.run?.spentUsd === 6.4)).run!;
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
      withCrewEngine((world) =>
        Effect.gen(function* () {
          const runId = yield* started(world);
          const thread = yield* firstTurn(world, () => undefined);
          yield* command({ _tag: "pause", runId });
          const paused = (yield* snapshotWhere((current) => current.run?.state === "paused")).run!;
          const interrupts = (yield* dispatchedOf(world, "thread.turn.interrupt")).map(
            (entry) => entry.threadId,
          );
          yield* world.publish(spiEvent("turn.completed", thread, { state: "interrupted" }));
          yield* snapshotWhere((current) => current.crewmates[0]!.lane?.ahead === 0);
          yield* command({ _tag: "resume", runId });
          const resumed = (yield* snapshotWhere((current) => current.run?.state === "running"))
            .run!;
          const carryOn = (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!.message.text;
          yield* command({ _tag: "stop", runId });
          const stopped = (yield* snapshotWhere((current) => current.run?.state === "stopped"))
            .run!;
          const again = yield* Effect.flip(command({ _tag: "resume", runId }));
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
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* started(world);
        yield* world.publish(
          spiEvent(
            "account.rate-limits.updated",
            "a-person-thread",
            {
              limits: {
                windows: [{ id: "session", kind: "session", label: "Session", usedPercent: 85 }],
              },
            },
            { providerInstanceId: ProviderInstanceId.make("claudeAgent") },
          ),
        );
        const run = (yield* snapshotWhere((current) => current.run?.state === "paused")).run!;
        assert.deepStrictEqual([run.reason, run.usagePercent], ["usage", 85]);
      }),
    ),
  );

  it.live(
    "a run dispatches queued work as its starter; admission refusing it pauses the run with its words",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* started(world, { landing: "check" });
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/ok.txt", "ok\n"),
          );
          yield* command({
            _tag: "taskCreate",
            owner: "backend",
            title: "Second",
            brief: "Then this.",
            doneWhen: "",
            dependsOn: [],
          });
          yield* Ref.set(world.refusal, "You are not this login's signer.");
          yield* reportDone(thread);
          yield* ended(world, thread, 0.1);
          const paused = yield* snapshotWhere((current) => current.run?.state === "paused");
          assert.deepStrictEqual(
            {
              run: [paused.run!.reason, paused.run!.reasonDetail],
              second: paused.board.tasks[1]!.state,
              principal: (yield* Ref.get(world.admitted)).at(-1)?.principal,
              inRun: (yield* (yield* CrewStore).assignments("main")).map(
                (task) => task.run === paused.run!.id,
              ),
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
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* started(world);
        const thread = yield* firstTurn(world, () => undefined);
        yield* ended(world, thread, 0.1);
        const nudges = (turns: ReadonlyArray<{ readonly message: { readonly text: string } }>) =>
          turns.filter((turn) => turn.message.text.includes("without crew_report"));
        yield* snapshotWhere((current) => current.run?.spentUsd === 0.1);
        yield* eventually(
          Effect.map(
            dispatchedOf(world, "thread.turn.start"),
            (turns) => nudges(turns).length === 1,
          ),
        );
        yield* world.publish(spiEvent("turn.started", thread, {}));
        yield* ended(world, thread, 0.2);
        yield* snapshotWhere((current) => current.run?.spentUsd === 0.2);
        const turns = yield* dispatchedOf(world, "thread.turn.start");
        assert.deepStrictEqual(
          [nudges(turns).length, (yield* Ref.get(world.admitted)).at(-1)?.principal],
          [1, AS_CREW],
        );
      }),
    ),
  );

  it.live("in a run, a failed check goes back to its crewmate on its own", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* started(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/b.txt", "crew\n"),
        );
        yield* reportDone(thread);
        yield* ended(world, thread, 0.1);
        const reworked = yield* snapshotWhere(
          (current) =>
            current.board.tasks[0]?.state === "working" && current.board.tasks[0]?.attempts === 2,
        );
        const fix = (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!;
        assert.deepStrictEqual(
          [
            fix.threadId,
            fix.message.text.includes("fix the check"),
            (yield* Ref.get(world.admitted)).at(-1)?.principal,
            reworked.attention.map((row) => row.kind),
          ],
          [thread, true, AS_CREW, []],
        );
      }),
    ),
  );

  it.live("in a run, a merge conflict goes back to its crewmate on its own", () =>
    withCrewEngine((world) =>
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
        yield* reportDone(thread);
        yield* ended(world, thread, 0.1);
        const reworked = yield* snapshotWhere(
          (current) =>
            current.board.tasks[0]?.state === "working" && current.board.tasks[0]?.attempts === 2,
        );
        const resolve = (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!;
        assert.deepStrictEqual(
          [
            resolve.threadId,
            resolve.message.text.includes("resolve the conflicts"),
            (yield* Ref.get(world.admitted)).at(-1)?.principal,
            (yield* (yield* CrewStore).assignments("main"))[0]!.reworks,
            reworked.attention.map((row) => row.kind),
          ],
          [thread, true, AS_CREW, 1, []],
        );
      }),
    ),
  );

  it.live("with Land when the check passes, a run lands a task without a press", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* started(world, { landing: "check" });
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* reportDone(thread);
        yield* ended(world, thread, 0.1);
        yield* snapshotWhere((current) => current.board.tasks[0]?.state === "landed");
        assert.strictEqual(read(world.root, "ok.txt"), "ok\n");
      }),
    ),
  );

  it.live("a run's time is the time its crew works: sitting idle never reaches the limit", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis;
        const runId = yield* started(world, { landing: "person" });
        // Nothing to do yet: the crew sits idle.
        yield* Effect.sleep("400 millis");
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* Effect.sleep("400 millis");
        yield* reportDone(thread);
        yield* ended(world, thread, 0.1);
        yield* snapshotWhere((current) => current.board.tasks[0]?.state === "ready");
        // Its work waits for your review: idle again.
        yield* Effect.sleep("400 millis");
        yield* command({ _tag: "pause", runId });
        const paused = (yield* snapshotWhere((current) => current.run?.state === "paused")).run!;
        const wallMs = (yield* Clock.currentTimeMillis) - startedAt;
        // The turn's 400 ms count; the two idle stretches around it do not.
        assert.isAtLeast(paused.elapsedMs, 350);
        assert.isAtMost(paused.elapsedMs, wallMs - 750);
      }),
    ),
  );

  it.live("with I land everything, a run leaves a ready task for your Land", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* started(world, { landing: "person" });
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* reportDone(thread);
        yield* ended(world, thread, 0.1);
        yield* snapshotWhere((current) => current.board.tasks[0]?.state === "ready");
        yield* drained;
        assert.strictEqual((yield* snapshotWhere(() => true)).board.tasks[0]?.state, "ready");
      }),
    ),
  );
});
