import { expect, it } from "vite-plus/test";

import { crewAskPlace, crewAskStanding, crewAskState } from "./crewAsk.logic";

const stateOf = (
  mate: { readonly status: "off" | "none" | "applied" | null; readonly ask: string | undefined },
  held: "off" | "none" | "applied" | null,
) => crewAskState(crewAskStanding(mate, held, "card-a"), "Fen").kind;

// witness: apps/web/src/components/ask/crewAsk.logic.ts | standing.from === "mate" && standing.ours → standing.from === "mate"
it("AK2: A crew card says its crew is set up only once the Mate's own crew names that card as the one it was set up from; a crew set up otherwise, or one only HQ's last word names, says only that the Mate has a crew; breaks: a card nobody pressed says its crew is set up", () => {
  expect(stateOf({ status: "applied", ask: "card-a" }, null)).toBe("done");
  expect(stateOf({ status: "applied", ask: "card-b" }, null)).toBe("replaced");
  expect(stateOf({ status: "applied", ask: undefined }, "applied")).toBe("replaced");
  expect(stateOf({ status: null, ask: undefined }, "applied")).toBe("replaced");
  expect(stateOf({ status: "none", ask: undefined }, "applied")).toBe("waiting");
  expect(stateOf({ status: null, ask: undefined }, null)).toBe("waiting");
});

// witness: apps/web/src/components/ask/crewAsk.logic.ts | if (places === null) return { kind: "unread" }; → if (places === null) return crewmate.host === undefined ? { kind: "unread" } : { kind: "on", place: crewmate.host };
it("AK3: A crew card's builder works on the place the card named only where the Mate has it, else on the Mate's one place, and among several the person chooses; nothing is placed before the Mate's dev services and pools are read; breaks: a card's named pool is saved as a dev service, or a builder starts on a place nobody chose", () => {
  const builder = (host: string | undefined) => ({ kind: "writer" as const, host });
  const several = { devHosts: ["appdev"], pools: ["tinypool"] };
  expect([
    crewAskPlace(builder("tinypool"), null),
    crewAskPlace(builder("tinypool"), several),
    crewAskPlace(builder(undefined), several),
    crewAskPlace(builder("apidev"), { devHosts: ["appdev"], pools: [] }),
    crewAskPlace(builder(undefined), { devHosts: [], pools: [] }),
    crewAskPlace({ kind: "reader", host: undefined }, several),
  ]).toEqual([
    { kind: "unread" },
    { kind: "on", place: "tinypool" },
    { kind: "choose" },
    { kind: "on", place: "appdev" },
    { kind: "none" },
    null,
  ]);
});
