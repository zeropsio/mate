import type { MateAttention } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { attentionWatch, watchMates } from "./ThreadNotificationCoordinator.logic";

const NOW = Date.parse("2026-10-03T12:00:00.000Z");

describe("watchMates — a Mate that publishes its attention", () => {
  const said = (over: Partial<MateAttention>): MateAttention =>
    ({
      source: { environmentId: "env-ada", epoch: 1, incarnation: "m1", revision: 1 },
      mainThreadId: "t1",
      lastThreadId: "t1",
      working: 0,
      waiting: 0,
      results: [],
      questions: [],
      truncated: false,
      ...over,
    }) as MateAttention;
  const look = (attention: MateAttention) =>
    new Map([["p-ada", attentionWatch(attention, (threadId) => `Chat ${threadId}`)]]);

  it("rings once for what a chat waits on its person for, and once for a finished turn", () => {
    const first = watchMates(null, look(said({})), NOW);
    expect(first.rings).toEqual([]);
    const asked = watchMates(
      first.next,
      look(said({ questions: [{ threadId: "t1", kind: "approval", turnId: "turn-2" }] as never })),
      NOW + 1_000,
    );
    expect(asked.rings).toEqual([
      {
        environmentId: "env-ada",
        threadId: "t1",
        title: "Chat t1",
        kind: "input",
        status: "approval",
      },
    ]);
    const again = watchMates(
      asked.next,
      look(said({ questions: [{ threadId: "t1", kind: "approval", turnId: "turn-2" }] as never })),
      NOW + 2_000,
    );
    expect(again.rings).toEqual([]);
    const done = watchMates(
      again.next,
      look(
        said({
          results: [
            { threadId: "t1", turnId: "turn-2", completedAt: "2026-10-03T12:00:05.000Z" },
          ] as never,
        }),
      ),
      NOW + 6_000,
    );
    expect(done.rings).toMatchObject([{ threadId: "t1", kind: "completion" }]);
  });

  it("takes the first look at a Mate as its baseline", () => {
    const first = watchMates(
      null,
      look(said({ questions: [{ threadId: "t1", kind: "input", turnId: null }] as never })),
      NOW,
    );
    expect(first.rings).toEqual([]);
  });
});
