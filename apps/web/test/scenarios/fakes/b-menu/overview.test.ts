import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ThreadId } from "@t3tools/contracts";
import { MateLinkUp } from "@t3tools/shared/mateLink";
import { MateFake } from "../mate.ts";
import { reportConversation } from "../../areas/b-menu/fake.ts";

const decode = Schema.decodeUnknownSync(MateLinkUp);
describe("B menu overview wire driver", () => {
  // Catches a new chat whose overview still notifies HQ about the previous conversation.
  it.effect("replacement chats carry matching main and digest identities", () =>
    Effect.gen(function* () {
      const frames: unknown[] = [];
      const drivers = {
        mates: new Map([["Ada", new MateFake("Ada", "Ada")]]),
        links: new Map([
          [
            "Ada",
            {
              send: (value: unknown) =>
                Effect.sync(() => {
                  frames.push(value);
                }),
            },
          ],
        ]),
      };
      yield* reportConversation(
        drivers,
        "Ada",
        {
          id: ThreadId.make("fresh"),
          title: "New task",
          hasPendingUserInput: true,
          pendingQuestion: "Which branch?",
        },
        "input",
      );
      const frame = decode(frames[0]);
      expect(frame.type).toBe("overview");
      if (frame.type !== "overview" || !frame.full) throw new Error("Expected a full overview");
      expect(frame.overview.main?.id).toBe("fresh");
      expect(frame.overview.main?.pendingQuestion).toBe("Which branch?");
      expect(frame.overview.threads.list).toEqual([
        {
          id: "fresh",
          title: "New task",
          kind: "input",
          turnId: null,
          turnState: null,
          completedAt: null,
        },
      ]);
    }),
  );
});
