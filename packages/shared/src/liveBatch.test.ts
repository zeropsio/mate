import { describe, expect, it } from "vite-plus/test";

import { liveBatch, type BatchCall } from "./liveBatch.ts";

/** A call by name, started and returned at the given seconds. */
const call = (
  item: string,
  startedAt: number | null,
  returnedAt: number | null,
  response?: string,
): BatchCall<string> => ({
  item,
  startedAt: startedAt === null ? null : startedAt * 1000,
  returnedAt: returnedAt === null ? null : returnedAt * 1000,
  ...(response === undefined ? {} : { response }),
});

describe("liveBatch", () => {
  it.each([
    { name: "no calls: nothing open, nothing stale", calls: [], open: [], stale: [] },
    {
      name: "one call open",
      calls: [call("a", 1, null)],
      open: ["a"],
      stale: [],
    },
    {
      name: "parallel calls in one batch: every open one, by start",
      calls: [call("b", 2, null), call("a", 1, null), call("c", 3, null)],
      open: ["a", "b", "c"],
      stale: [],
    },
    {
      name: "a call of the batch returned before the others: they stay open",
      calls: [call("a", 1, null), call("b", 2, 4)],
      open: ["a"],
      stale: [],
    },
    {
      name: "a dropped completion: a call started after a return makes the old call stale",
      calls: [call("a", 1, null), call("b", 2, 4), call("c", 5, null)],
      open: ["c"],
      stale: [{ item: "a", since: 5000 }],
    },
    {
      name: "a call started before the return is in the same batch, however late",
      calls: [call("a", 1, null), call("b", 2, 6), call("c", 5, null)],
      open: ["a", "c"],
      stale: [],
    },
    {
      name: "two batches with no thought between: the newer one only",
      calls: [call("a", 1, null), call("b", 2, 3), call("c", 4, null), call("d", 4.5, null)],
      open: ["c", "d"],
      stale: [{ item: "a", since: 4000 }],
    },
    {
      name: "a call started at the instant another returned is in the newer batch",
      calls: [call("a", 1, null), call("b", 2, 3), call("c", 3, null)],
      open: ["c"],
      stale: [{ item: "a", since: 3000 }],
    },
    {
      name: "a completion filed on its own: a return with no start of its own still counts",
      calls: [call("a", 1, null), call("orphan", null, 2), call("c", 3, null)],
      open: ["c"],
      stale: [{ item: "a", since: 3000 }],
    },
    {
      name: "stale since the first newer batch, not the latest",
      calls: [call("a", 1, null), call("b", 2, 3), call("c", 4, 5), call("d", 6, null)],
      open: ["d"],
      stale: [{ item: "a", since: 4000 }],
    },
    {
      // Its own start and return at one instant: a call first seen as it
      // ended (a Codex command) tells a return, never a newer batch.
      name: "a call started and returned in the same instant opens no newer batch",
      calls: [call("a", 1, null), call("b", 2, 2)],
      open: ["a"],
      stale: [],
    },
    // A batch is one model response: Claude Code runs a response's early calls
    // while the model still writes the later ones.
    {
      name: "a streamed response: a call that returned before a later one of its response started",
      calls: [call("x", 1, null, "r1"), call("y", 2, 3, "r1"), call("z", 4, null, "r1")],
      open: ["x", "z"],
      stale: [],
    },
    {
      name: "a call of a newer response makes the older response's open call stale",
      calls: [call("x", 1, null, "r1"), call("y", 2, 3, "r1"), call("z", 5, null, "r2")],
      open: ["z"],
      stale: [{ item: "x", since: 5000 }],
    },
    {
      name: "a newer response with no call returned between: still the newer response only",
      calls: [call("x", 1, null, "r1"), call("z", 5, null, "r2"), call("w", 6, null, "r2")],
      open: ["z", "w"],
      stale: [{ item: "x", since: 5000 }],
    },
    {
      name: "stale since the first newer response's first call",
      calls: [call("x", 1, null, "r1"), call("y", 4, 4.5, "r2"), call("z", 6, null, "r3")],
      open: ["z"],
      stale: [{ item: "x", since: 4000 }],
    },
  ])("$name", ({ calls, open, stale }) => {
    expect(liveBatch(calls)).toEqual({ open, stale });
  });
});
