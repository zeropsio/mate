import { assert, describe, it } from "@effect/vitest";
import { ProviderInstanceId, type CrewRunOptions, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import { CrewThreadDirectory } from "./crewSeams.ts";
import { CrewStore } from "./CrewStore.ts";
import {
  eventually,
  spiEvent,
  withCrewEngine,
  type CrewWorld,
} from "./testing/crewEngineFixture.ts";
import {
  applied,
  command,
  dispatchedOf,
  firstTurn,
  reportDone,
  snapshotWhere,
} from "./testing/crewEngineSteps.ts";
import { read, write } from "./testing/crewGitFixture.ts";

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
        yield* ended(world, thread, 0.75);
        const paused = (yield* snapshotWhere((current) => current.run?.state === "paused")).run!;
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
              principal: { kind: "crew", startedBy: "user-karel" },
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
        yield* ended(world, thread, 0.1);
        yield* snapshotWhere((current) => current.run?.spentUsd === 0.2);
        const turns = yield* dispatchedOf(world, "thread.turn.start");
        assert.deepStrictEqual(
          [nudges(turns).length, (yield* Ref.get(world.admitted)).at(-1)?.principal],
          [1, { kind: "crew", startedBy: "user-karel" }],
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
          [thread, true, { kind: "crew", startedBy: "user-karel" }, []],
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
        yield* Effect.sleep("300 millis");
        assert.strictEqual((yield* snapshotWhere(() => true)).board.tasks[0]?.state, "ready");
      }),
    ),
  );
});
