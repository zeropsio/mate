import { expect, it } from "vite-plus/test";

import { crewAskStanding, crewAskState } from "./crewAsk.logic";

const stateOf = (
  mate: { readonly status: "off" | "none" | "applied" | null; readonly ask: string | undefined },
  held: "off" | "none" | "applied" | null,
) => crewAskState(crewAskStanding(mate, held, "card-a"), "Fen").kind;

// witness: apps/web/src/components/ask/crewAsk.logic.ts | standing.from === "mate" && standing.ours → standing.from === "mate"
it("AK+1: A crew card says its crew is set up only once the Mate's own crew names that card as the one it was set up from; a crew set up otherwise, or one only HQ's last word names, says only that the Mate has a crew; breaks: a card nobody pressed says its crew is set up", () => {
  expect(stateOf({ status: "applied", ask: "card-a" }, null)).toBe("done");
  expect(stateOf({ status: "applied", ask: "card-b" }, null)).toBe("replaced");
  expect(stateOf({ status: "applied", ask: undefined }, "applied")).toBe("replaced");
  expect(stateOf({ status: null, ask: undefined }, "applied")).toBe("replaced");
  expect(stateOf({ status: "none", ask: undefined }, "applied")).toBe("waiting");
  expect(stateOf({ status: null, ask: undefined }, null)).toBe("waiting");
});
