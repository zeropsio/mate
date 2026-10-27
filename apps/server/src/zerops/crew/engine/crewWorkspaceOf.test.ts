import { assert, describe, it } from "@effect/vitest";
import { ConversationId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

import type { WorkspaceSetup } from "../../../engine/ports.ts";
import { crewWorkspaceOf } from "./CrewEngineLayer.ts";

const backend = ConversationId.make("crew-main-backend-1");
const mate = ConversationId.make("mate");
const copy: WorkspaceSetup = { cwd: "/var/www/.crew/backend", runtimeMode: "approval-required" };

type Front = Option.Option<{
  readonly workspaceOf: () => Effect.Effect<Option.Option<WorkspaceSetup>>;
}>;
const front = (answer: Option.Option<WorkspaceSetup> | "no front"): Effect.Effect<Front> =>
  Effect.succeed(
    answer === "no front"
      ? Option.none()
      : Option.some({ workspaceOf: () => Effect.succeed(answer) }),
  );

describe("where a conversation works, as the engine crew tells it", () => {
  it.each([
    [
      "a conversation that is not a crewmate's is none of the crew's",
      mate,
      front(Option.none()),
      "none",
    ],
    ["a crewmate's works in the copy its crew names", backend, front(Option.some(copy)), "copy"],
    [
      "a crewmate's whose copy its crew cannot read opens nowhere, never in the Mate's tree",
      backend,
      front(Option.none()),
      "unavailable",
    ],
    [
      "a crewmate's whose crew has not started yet opens nowhere, never in the Mate's tree",
      backend,
      front("no front"),
      "unavailable",
    ],
  ] as const)("%s", (_, conversation, found, expected) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(crewWorkspaceOf(found)(conversation));
      const read = Exit.isFailure(exit)
        ? "unavailable"
        : Option.isNone(exit.value)
          ? "none"
          : exit.value.value === copy
            ? "copy"
            : "other";
      assert.strictEqual(read, expected);
    }).pipe(Effect.runPromise),
  );
});
