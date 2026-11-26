import { expect, it } from "vite-plus/test";
import { SessionId, type TurnHandle } from "@t3tools/contracts";

import { makeToCore } from "./toCore.ts";

// witness: apps/server/src/engine/pump/toCore.ts | if (signal.afterTokens === undefined) lastContext = undefined; → if (signal.afterTokens !== undefined) lastContext = undefined;
it("PU8: A compaction with no post-compaction token count leaves the context size unknown until a later reading; a reported post-compaction reading remains available. Breaks: an old large context causes a second compaction after the first made it small.", () => {
  const session = SessionId.make("s1");
  const turn = "r1" as TurnHandle;
  const header = { session, seq: 1 };
  const end = {
    ...header,
    type: "turn.ended",
    turn,
    outcome: { kind: "completed" },
    source: "agent",
  } as const;
  const unknown = makeToCore();
  unknown.step({ ...header, type: "usage.context", usage: { usedTokens: 320_000 } }, 0);
  const marker = unknown.step({ ...header, type: "context.compacted", turn, automatic: true }, 0);
  expect(marker.signals).toMatchObject([
    { kind: "item-closed", body: { kind: "marker", marker: { kind: "compacted" } } },
  ]);
  expect(unknown.step(end, 0).signals[0]).not.toHaveProperty("context");
  unknown.step({ ...header, type: "usage.context", usage: { usedTokens: 80_000 } }, 0);
  expect(unknown.step(end, 0).signals[0]).toMatchObject({ context: { usedTokens: 80_000 } });

  const known = makeToCore();
  known.step({ ...header, type: "usage.context", usage: { usedTokens: 90_000 } }, 0);
  known.step(
    { ...header, type: "context.compacted", turn, automatic: true, afterTokens: 90_000 },
    0,
  );
  expect(known.step(end, 0).signals[0]).toMatchObject({ context: { usedTokens: 90_000 } });
  known.step(
    { ...header, type: "context.compacted", turn, automatic: true, afterTokens: 40_000 },
    0,
  );
  expect(known.step(end, 0).signals[0]).toMatchObject({ context: { usedTokens: 40_000 } });
});
