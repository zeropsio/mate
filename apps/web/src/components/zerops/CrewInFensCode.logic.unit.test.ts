import { expect, it } from "vite-plus/test";

import { crewNotShippedWork } from "./crew/CrewInFensCode.logic";

const piece = (id: string, delivered: boolean) => ({ id, delivered });

// witness: apps/web/src/components/zerops/crew/CrewInFensCode.logic.ts | return pending.length === notShipped ? new Set(pending.map((task) => task.id)) : new Set(); → return new Set(work.map((task) => task.id));
it("MN131: The crew's work in the Mate's code is marked not shipped only where the Mate read it as not shipped: the pieces it did not deliver, and none while they are not what it read or some is still unread; breaks: the Crew tab says work that went out hasn't shipped", () => {
  const work = [piece("count", false), piece("guestbook", true)];
  expect([
    [...crewNotShippedWork(work, 1, 0)],
    [...crewNotShippedWork(work, 0, 0)],
    [...crewNotShippedWork(work, 2, 0)],
    [...crewNotShippedWork(work, 1, 1)],
  ]).toEqual([["count"], [], [], []]);
});
