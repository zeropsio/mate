import { ConversationId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
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

/** Where the conversation works: none of the crew's, the crew's copy, or nowhere. */
const where = (conversation: ConversationId, found: Effect.Effect<Front>) =>
  Effect.exit(crewWorkspaceOf(found)(conversation)).pipe(
    Effect.map((exit) =>
      Exit.isFailure(exit)
        ? "unavailable"
        : Option.isNone(exit.value)
          ? "none"
          : exit.value.value === copy
            ? "copy"
            : "other",
    ),
  );

// witness: apps/server/src/zerops/crew/engine/CrewEngineLayer.ts | Option.isSome(workspace) → Option.isNone(workspace)
it.effect(
  "CD35: A crewmate's conversation works in the copy its crew names, and opens nowhere, never in the Mate's tree, when the crew cannot read that copy or has not started; a conversation that is not a crewmate's is none of the crew's",
  () =>
    Effect.gen(function* () {
      expect(yield* where(mate, front(Option.none()))).toBe("none");
      expect(yield* where(backend, front(Option.some(copy)))).toBe("copy");
      expect(yield* where(backend, front(Option.none()))).toBe("unavailable");
      expect(yield* where(backend, front("no front"))).toBe("unavailable");
    }),
);
