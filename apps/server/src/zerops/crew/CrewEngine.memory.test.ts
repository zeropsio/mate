// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { CrewThreadDirectory, CrewToolHost, type CrewThreadMember } from "./crewSeams.ts";
import {
  eventually,
  spiEvent,
  withCrewEngine,
  writeCrewHome,
  type CrewWorld,
} from "./testing/crewEngineFixture.ts";
import {
  applied,
  command,
  dispatchedOf,
  everyCopyReady,
  firstTurn,
  latest,
  snapshotWhere,
} from "./testing/crewEngineSteps.ts";
import { git, write } from "./testing/crewGitFixture.ts";

const decodeBoard = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      tasks: Schema.Array(Schema.Struct({ number: Schema.Number, state: Schema.String })),
    }),
  ),
);

const memberOf = (thread: ThreadId) =>
  Effect.map(
    Effect.flatMap(CrewThreadDirectory, (directory) => directory.memberFor(thread)),
    (member): CrewThreadMember => Option.getOrThrow(member),
  );

/** The crew home with `rotateAfter` on its writer. */
const appliedRotatingAfter = (world: CrewWorld, rotateAfter: number) =>
  Effect.gen(function* () {
    writeCrewHome(world.workspace, {
      "crew.yaml": [
        "name: Game team",
        "briefTitle: Space shooter",
        "members:",
        "  - handle: backend",
        "    displayName: Backend",
        "    host: appdev",
        "    check: test -f ok.txt",
        `    rotateAfter: ${rotateAfter}`,
        "",
      ].join("\n"),
    });
    yield* command({ _tag: "apply" });
    yield* eventually(Effect.map(latest, everyCopyReady));
  });

const sessionStarted = (
  thread: ThreadId,
  source: "startup" | "resume" | "compact" | "clear",
  transcriptPath: string,
) =>
  Effect.gen(function* () {
    const member = yield* memberOf(thread);
    return yield* (yield* CrewToolHost).sessionStart(member, {
      source,
      sessionId: "session-1",
      transcriptPath,
    });
  });

describe("CrewEngine memory", () => {
  it.live("a crewmate keeps memory: its prompt turns crew_memory on", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () => undefined);
        assert.isTrue((yield* memberOf(thread)).prompt.memory);
      }),
    ),
  );

  it.live("a compaction gets the state packet, a resume the delta", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () => undefined);
        const transcript = NodePath.join(world.workspace, "transcript.jsonl");
        const compact = yield* sessionStarted(thread, "compact", transcript);
        const resume = yield* sessionStarted(thread, "resume", transcript);
        assert.deepStrictEqual(
          [
            compact?.startsWith("crew-state seq"),
            compact?.includes("## Task #1"),
            resume?.includes("supersedes earlier crew-state blocks"),
            resume?.includes("Task #1 is working"),
          ],
          [true, true, true, true],
        );
      }),
    ),
  );

  it.live("after rotateAfter compactions the conversation waits and rotates at the next task", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* appliedRotatingAfter(world, 1);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* world.publish(spiEvent("thread.state.changed", thread, { state: "compacted" }));
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const pending = yield* snapshotWhere(
          (current) => current.crewmates[0]!.stints[0]?.state === "rotate-pending",
        );
        yield* command({ _tag: "message", handle: "backend", text: "More", attachments: [] });
        const steered = (yield* dispatchedOf(world, "thread.crew.create")).length;
        yield* world.publish(spiEvent("turn.started", thread, {}));
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        yield* snapshotWhere((current) => current.crewmates[0]!.lane?.ahead === 1);
        yield* command({ _tag: "landNow", taskId: pending.board.tasks[0]!.id });
        yield* snapshotWhere((current) => current.board.tasks[0]?.state === "landed");
        yield* command({ _tag: "message", handle: "backend", text: "Next", attachments: [] });
        const rotated = yield* snapshotWhere(
          (current) => current.crewmates[0]!.stints.length === 2,
        );
        assert.deepStrictEqual(
          [steered, rotated.crewmates[0]!.stints.map((stint) => [stint.state, stint.reason])],
          [
            1,
            [
              ["retired", null],
              ["open", "New conversation — continues from memory"],
            ],
          ],
        );
      }),
    ),
  );

  it.live("a transcript gone before a resume rotates the conversation at once", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () => undefined);
        const transcript = NodePath.join(world.workspace, "transcript.jsonl");
        NodeFS.writeFileSync(transcript, "{}\n");
        yield* sessionStarted(thread, "startup", transcript);
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        yield* snapshotWhere((current) => current.crewmates[0]!.stints[0]?.state === "active");
        NodeFS.rmSync(transcript);
        yield* command({ _tag: "message", handle: "backend", text: "More", attachments: [] });
        const rotated = yield* snapshotWhere(
          (current) => current.crewmates[0]!.stints.length === 2,
        );
        assert.strictEqual(
          rotated.crewmates[0]!.stints[1]!.reason,
          "New conversation — the last one could not be resumed",
        );
      }),
    ),
  );

  it.live("the crew-state ref carries each crewmate's memory and the board", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () => undefined);
        yield* (yield* CrewToolHost).memory(yield* memberOf(thread), {
          op: "add",
          kind: "decision",
          topic: "api",
          text: "Prices are in EUR.",
        });
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const tree = () => {
          try {
            return git(world.root, [
              "ls-tree",
              "-r",
              "--name-only",
              "refs/t3/crew-state/main",
            ]).split("\n");
          } catch {
            return [];
          }
        };
        yield* eventually(Effect.sync(() => tree().includes("memory/backend/index.json")));
        const board = yield* decodeBoard(
          git(world.root, ["show", "refs/t3/crew-state/main:board.json"]),
        );
        assert.deepStrictEqual(
          [
            tree().includes("memory/backend/index.json"),
            board.tasks.map((task) => [task.number, task.state]),
          ],
          [true, [[1, "working"]]],
        );
      }),
    ),
  );
});
