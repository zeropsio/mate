// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { git, write } from "./testing/crewGitFixture.ts";
import {
  CREW_ENGINE_TEST_TIMEOUT,
  applied,
  crewJourney,
  eventually,
  everyCopyReady,
  firstTurn,
  opened,
  type CrewChat,
  type CrewWorld,
  CREW_WORLD,
} from "./testing/crewWorld.ts";

const decodeBoard = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      tasks: Schema.Array(Schema.Struct({ number: Schema.Number, state: Schema.String })),
    }),
  ),
);

const memberOf = (world: CrewWorld, chat: CrewChat) =>
  Effect.map(world.member(chat), Option.getOrThrow);

/** The crew home with `rotateAfter` on its writer. */
const appliedRotatingAfter = (world: CrewWorld, rotateAfter: number) =>
  Effect.gen(function* () {
    world.writeHome({
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
    yield* world.press({ _tag: "apply" });
    yield* world.snapshotWhere(everyCopyReady);
  });

const sessionStarted = (
  world: CrewWorld,
  chat: CrewChat,
  source: "startup" | "resume" | "compact" | "clear",
  transcriptPath: string,
) => world.sessionStart(chat, { source, sessionId: "session-1", transcriptPath });

describe("CrewEngine memory", { timeout: CREW_ENGINE_TEST_TIMEOUT }, () => {
  it.live("a crewmate keeps memory: its prompt turns crew_memory on", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () => undefined);
        assert.isTrue((yield* memberOf(world, thread)).prompt.memory);
      }),
    ),
  );

  it.live("a compaction gets the state packet, a resume the delta", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () => undefined);
        const transcript = NodePath.join(world.workspace, "transcript.jsonl");
        const compact = yield* sessionStarted(world, thread, "compact", transcript);
        const resume = yield* sessionStarted(world, thread, "resume", transcript);
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
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* appliedRotatingAfter(world, 1);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* world.compacted(thread);
        yield* world.turnEnds(thread);
        yield* world.sessionsWhere("backend", (sessions) => sessions.latest === "rotate-pending");
        const pending = yield* world.snapshot;
        yield* world.press({ _tag: "message", handle: "backend", text: "More", attachments: [] });
        const steered = (yield* opened(world)).length;
        yield* world.turnStarts(thread);
        yield* world.turnEnds(thread);
        yield* world.snapshotWhere((current) => current.crewmates[0]!.lane?.ahead === 1);
        yield* world.press({ _tag: "landNow", taskId: pending.board.tasks[0]!.id });
        yield* world.snapshotWhere((current) => current.board.tasks[0]?.state === "landed");
        yield* world.press({ _tag: "message", handle: "backend", text: "Next", attachments: [] });
        const rotated = yield* world.sessionsWhere("backend", (sessions) => sessions.count === 2);
        assert.deepStrictEqual(
          [steered, rotated],
          [
            1,
            {
              count: 2,
              latest: "open",
              reasons: [null, "A fresh conversation, carried on from memory"],
            },
          ],
        );
      }),
    ),
  );

  // A transcript gone before a resume is V1's own mechanism (the engine resumes its sessions
  // itself): it runs on V1 until the cutover (the owner, 2026-10-08).
  it.live.skipIf(CREW_WORLD !== "v1")(
    "a transcript gone before a resume rotates the conversation at once",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () => undefined);
          const transcript = NodePath.join(world.workspace, "transcript.jsonl");
          NodeFS.writeFileSync(transcript, "{}\n");
          yield* sessionStarted(world, thread, "startup", transcript);
          yield* world.turnEnds(thread);
          yield* world.snapshotWhere(
            (current) => current.crewmates[0]!.stints[0]?.state === "active",
          );
          NodeFS.rmSync(transcript);
          yield* world.press({ _tag: "message", handle: "backend", text: "More", attachments: [] });
          const rotated = yield* world.snapshotWhere(
            (current) => current.crewmates[0]!.stints.length === 2,
          );
          assert.strictEqual(
            rotated.crewmates[0]!.stints[1]!.reason,
            "A fresh conversation: the last one couldn't be resumed",
          );
        }),
      ),
  );

  // The engine keeps no crew-state git mirror (the owner, 2026-10-08): V1's until the cutover.
  it.live.skipIf(CREW_WORLD !== "v1")(
    "the crew-state ref carries each crewmate's memory and the board",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () => undefined);
          yield* world.memory(thread, {
            op: "add",
            kind: "decision",
            topic: "api",
            text: "Prices are in EUR.",
          });
          yield* world.turnEnds(thread);
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
