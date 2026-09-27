import { assert, describe, it } from "@effect/vitest";
import { ProviderInstanceId, type CrewRunOptions, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import { CrewThreadDirectory } from "./crewSeams.ts";
import { spiEvent, withCrewEngine, type CrewWorld } from "./testing/crewEngineFixture.ts";
import {
  applied,
  command,
  dispatchedOf,
  firstTurn,
  snapshotWhere,
} from "./testing/crewEngineSteps.ts";
import { write } from "./testing/crewGitFixture.ts";

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

  it.live("Pause interrupts the crew's running turns; Resume and Stop move the run", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        const runId = yield* started(world);
        const thread = yield* firstTurn(world, () => undefined);
        yield* command({ _tag: "pause", runId });
        const paused = (yield* snapshotWhere((current) => current.run?.state === "paused")).run!;
        const interrupts = (yield* dispatchedOf(world, "thread.turn.interrupt")).map(
          (entry) => entry.threadId,
        );
        yield* command({ _tag: "resume", runId });
        const resumed = (yield* snapshotWhere((current) => current.run?.state === "running")).run!;
        yield* command({ _tag: "stop", runId });
        const stopped = (yield* snapshotWhere((current) => current.run?.state === "stopped")).run!;
        const again = yield* Effect.flip(command({ _tag: "resume", runId }));
        assert.deepStrictEqual(
          {
            paused: [paused.state, paused.reason],
            interrupts,
            resumed: [resumed.state, resumed.reason],
            stopped: stopped.state,
            again: again.reason,
          },
          {
            paused: ["paused", "person"],
            interrupts: [thread],
            resumed: ["running", null],
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
          yield* started(world);
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
          yield* ended(world, thread, 0.1);
          const working = yield* snapshotWhere(
            (current) => current.crewmates[0]!.lane?.ahead === 1,
          );
          yield* Ref.set(world.refusal, "You are not this login's signer.");
          yield* command({ _tag: "landNow", taskId: working.board.tasks[0]!.id });
          const paused = yield* snapshotWhere((current) => current.run?.state === "paused");
          assert.deepStrictEqual(
            {
              run: [paused.run!.reason, paused.run!.reasonDetail],
              second: paused.board.tasks[1]!.state,
              principal: (yield* Ref.get(world.admitted)).at(-1)?.principal,
            },
            {
              run: ["refused", "You are not this login's signer."],
              second: "queued",
              principal: { kind: "crew", startedBy: "user-karel" },
            },
          );
        }),
      ),
  );
});
