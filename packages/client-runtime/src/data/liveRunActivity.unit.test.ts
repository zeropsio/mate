import { expect, it } from "vite-plus/test";

import { liveRunActivity } from "./liveRunActivity.ts";

// witness: packages/client-runtime/src/data/liveRunActivity.ts | item.state === "running" → item.state !== "running"
it("ST83: A run's open call takes its live row ahead of a streaming thought, but a closed call does not", () => {
  const call = {
    kind: "call",
    id: "workflow",
    state: "running",
    presentation: { title: "Workflow orchestration" },
    at: 1,
  } as const;
  const thought = { kind: "thinking", text: "Considering the next step" } as const;
  const streamingThought = { kind: "thought", streaming: true } as const;
  expect(liveRunActivity([call, streamingThought], () => thought)).toEqual({
    kind: "calls",
    calls: [call],
  });
  expect(liveRunActivity([streamingThought], () => thought)).toEqual({
    kind: "other",
    activity: thought,
  });
  expect(liveRunActivity([{ ...call, state: "done" }, streamingThought], () => thought)).toEqual({
    kind: "other",
    activity: thought,
  });
});
