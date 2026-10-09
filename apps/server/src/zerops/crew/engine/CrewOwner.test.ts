import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  CREW_OWNER_ID,
  CommandId,
  wakeId as deriveWakeId,
  type Principal,
} from "@t3tools/contracts";

import { CommandRejected } from "../../../engine/ConversationActor.ts";
import { Conversations } from "../../../engine/Conversations.ts";
import { engineLayer, tempDb } from "../../../engine/testing/world.ts";
import type { CrewOwnerCommand } from "./CrewOwner.ts";
import { crewDomain, crewRefusalOf } from "./CrewOwner.ts";
import { CrewWorld, home, reader } from "./crewDecideFixture.ts";
import { membersInOrder } from "./state.ts";

const KAREL: Principal = { kind: "person", subject: "zerops:karel" };

let commands = 0;
const ask = (command: CrewOwnerCommand, principal: Principal = KAREL) =>
  Effect.flatMap(Conversations, (conversations) =>
    conversations.owner(crewDomain).ask({
      commandId: CommandId.make(`test-${++commands}`),
      conversationId: CREW_OWNER_ID,
      principal,
      command,
    }),
  );

const press = (input: Extract<CrewOwnerCommand, { _tag: "Press" }>["press"], extra = {}) =>
  ask({ _tag: "Press", press: input, door: { refusal: null }, ...extra });

const withEngine = <A, E>(effect: Effect.Effect<A, E, Conversations | SqlClient.SqlClient>) =>
  Effect.scoped(
    effect.pipe(Effect.provide(engineLayer(tempDb("crew-owner"), new Map(), {}, [crewDomain]))),
  );

describe("the crew owner on the engine", () => {
  it.effect("a press the crew refuses comes back with the crew's own reason", () =>
    withEngine(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          press({ _tag: "message", handle: "backend", text: "hi", attachments: [] }),
        );
        // The engine's rejection carries the crew's reason as it was refused.
        assert.isTrue(Exit.isFailure(exit));
        const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
        assert.isTrue(Schema.is(CommandRejected)(error));
        assert.strictEqual(crewRefusalOf((error as CommandRejected).rejection).reason, "no-crew");
      }),
    ),
  );

  it.effect("every task the crew creates is a row beside its log, open until it is finished", () =>
    withEngine(
      Effect.gen(function* () {
        yield* press({ _tag: "apply" }, { home: home(reader("scout")) });
        const accepted = yield* press({
          _tag: "taskCreate",
          owner: "scout",
          title: "Add pagination",
          brief: "Cursor based.",
          doneWhen: "",
          dependsOn: [],
        });
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{
          task_id: string;
          number: number;
          handle: string;
          finished: number;
        }>`
          SELECT task_id, number, handle, finished FROM engine_crew_task
        `;
        assert.deepStrictEqual(
          rows.map((row) => [row.number, row.handle, row.finished]),
          [[1, "scout", 0]],
        );
        assert.deepStrictEqual(
          (accepted as { taskIds?: ReadonlyArray<string> }).taskIds,
          rows.map((row) => row.task_id),
        );
      }),
    ),
  );

  it.effect("a wake the crew no longer holds is refused, so the scheduler drops it", () =>
    withEngine(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          ask(
            { _tag: "WakeFired", wakeId: deriveWakeId(CREW_OWNER_ID, "question", "t1") },
            { kind: "engine" },
          ),
        );
        assert.isTrue(Exit.isFailure(exit));
        assert.include(String(exit), "wake-not-armed");
      }),
    ),
  );

  it.effect("a crewmate's memory a flip imported is written whole", () =>
    withEngine(
      Effect.gen(function* () {
        const v1 = new CrewWorld();
        v1.apply(home(reader("scout")));
        const entry = {
          id: "m-1",
          kind: "fact" as const,
          topic: "ports",
          text: "The API listens on 3000.",
          paths: ["src/server.ts"],
          verifiedAt: null,
          fromAssignment: null,
          updatedAt: "2026-10-08T10:00:00.000Z",
        };
        yield* ask(
          {
            _tag: "ImportV1",
            crew: {
              definition: v1.state.applied!.definition,
              briefVersion: 1,
              members: membersInOrder(v1.state),
              tasks: [],
              run: null,
              claims: {},
              hosts: {},
              memory: { scout: { op: "imported", entries: [entry] } },
              interrupted: [],
            },
          },
          { kind: "engine" },
        );
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{ handle: string; entry_id: string; text: string }>`
          SELECT handle, entry_id, text FROM engine_crew_memory
        `;
        assert.deepStrictEqual(
          rows.map((row) => [row.handle, row.entry_id, row.text]),
          [["scout", "m-1", "The API listens on 3000."]],
        );
      }),
    ),
  );
});
