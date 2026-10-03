import { describe, expect, it } from "vite-plus/test";

import { crewStatusOf } from "./useCrew";

const CREW = { crewmates: [], attention: [], readyTasks: [], personLands: true };

describe("crewStatusOf — a Mate's menu door to its crew", () => {
  it.each([
    { case: "HQ holds an applied crew", crew: CREW, feed: null, status: "applied" },
    {
      case: "HQ holds one and the open Mate's feed lags",
      crew: CREW,
      feed: "none",
      status: "applied",
    },
    {
      case: "the open Mate's crew mode is on, no crew yet",
      crew: null,
      feed: "none",
      status: "none",
    },
    { case: "the open Mate's crew mode is off", crew: null, feed: "off", status: "off" },
    { case: "a Mate nobody opened, no crew in HQ", crew: null, feed: null, status: null },
  ] as const)(
    "reads an applied crew from HQ, and crew mode with no crew from its open Mate alone: $case",
    ({ crew, feed, status }) => {
      expect(crewStatusOf(crew, feed)).toBe(status);
    },
  );
});
