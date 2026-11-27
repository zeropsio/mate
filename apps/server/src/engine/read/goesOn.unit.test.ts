import { ConversationId, runId, type RunEnd } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { goesOnIn } from "./goesOn.ts";

const c = ConversationId.make("mate");
const cut: RunEnd = {
  kind: "cut-by-restart",
  continuedBy: null,
  notContinued: "its question waits for your answer",
};

// witness: apps/server/src/engine/read/goesOn.ts | asked.some((request) => request.state === "open") → asked.some((request) => request.state !== "open")
it("RS+1: A run a restart or crash cut goes on in its restart's continuation, or, when it waited on a question asked again by message, in the run its person's answer started, and waits on that answer while the question is open; one whose question was dismissed, that waited on none, or that ended otherwise goes on nowhere; breaks: a Mate's message is told stopped after a restart while its question still waits for its person, and their answer never reaches the sender", () => {
  const open = { state: "open", bySend: null };
  expect(goesOnIn(cut, [open])).toEqual({ kind: "asked" });
  expect(goesOnIn({ kind: "crashed", reason: "the agent exited" }, [open])).toEqual({
    kind: "asked",
  });
  expect(goesOnIn(cut, [{ state: "answered", bySend: runId(c, 4) }])).toEqual({
    kind: "run",
    runId: runId(c, 4),
  });
  expect(goesOnIn({ kind: "cut-by-restart", continuedBy: runId(c, 3) }, [])).toEqual({
    kind: "run",
    runId: runId(c, 3),
  });
  expect(goesOnIn(cut, [{ state: "dismissed", bySend: null }])).toBeUndefined();
  expect(goesOnIn(cut, [])).toBeUndefined();
  expect(goesOnIn({ kind: "completed" }, [open])).toBeUndefined();
});
