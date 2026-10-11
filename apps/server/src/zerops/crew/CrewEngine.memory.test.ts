// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { write } from "./testing/crewGitFixture.ts";
import {
  CREW_ENGINE_TEST_TIMEOUT,
  applied,
  crewJourney,
  everyCopyReady,
  firstTurn,
  opened,
  type CrewChat,
  type CrewWorld,
} from "./testing/crewWorld.ts";

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
});
