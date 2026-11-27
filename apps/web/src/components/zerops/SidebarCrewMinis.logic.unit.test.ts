import { CrewDigest } from "@t3tools/shared/mateLink";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";

import { crewRowFacts } from "./crew/SidebarCrewMinis.logic";

const crewmate = (handle: string, lead: boolean, threadKind: "input" | "working" | null) => ({
  handle,
  displayName: handle,
  tint: "slate",
  lead,
  threadId: null,
  threadKind,
  loginKey: null,
});

// witness: apps/web/src/components/zerops/crew/SidebarCrewMinis.logic.ts | const ordered = all.toSorted((a, b) => Number(b.lead) - Number(a.lead)); → const ordered = all.toSorted((a, b) => (a.state === "needs" ? 0 : a.lead ? 1 : 2) - (b.state === "needs" ? 0 : b.lead ? 1 : 2));
it("MN+2: A crew's faces in the menu stand in one order, the lead first and then the crew's, whoever works or needs the viewer; breaks: the faces reshuffle on every change of state and the person loses track of who is who", () => {
  const facts = (kinds: ReadonlyArray<"input" | "working" | null>) =>
    crewRowFacts({
      crew: Schema.decodeUnknownSync(CrewDigest)({
        crewmates: [
          crewmate("builds", false, kinds[0] ?? null),
          crewmate("lead", true, kinds[1] ?? null),
          crewmate("reviews", false, kinds[2] ?? null),
        ],
        attention: [],
        readyTasks: [],
        personLands: true,
      }),
      logins: {},
      current: true,
      environmentId: undefined,
      mine: true,
      viewerSubject: undefined,
    })?.minis.map((mini) => [mini.id, mini.state]);
  expect([facts([null, "working", "input"]), facts(["working", null, null])]).toEqual([
    [
      ["lead", "working"],
      ["builds", "idle"],
      ["reviews", "needs"],
    ],
    [
      ["lead", "idle"],
      ["builds", "working"],
      ["reviews", "idle"],
    ],
  ]);
});

// witness: apps/web/src/components/zerops/crew/SidebarCrewMinis.logic.ts | moreNeeds: ordered.slice(minis.length).some((mini) => mini.state === "needs"), → moreNeeds: minis.some((mini) => mini.state === "needs"),
it('MN+3: A crewmate past the faces the menu draws whole that needs the viewer marks the "+N" it folds into, and one that does not leaves it plain; breaks: a crew\'s sixth crewmate asks the person something and nothing in the menu shows it', () => {
  const facts = (asking: string) =>
    crewRowFacts({
      crew: Schema.decodeUnknownSync(CrewDigest)({
        crewmates: ["lead", "ada", "bo", "cy", "dee", "eve"].map((handle) =>
          crewmate(handle, handle === "lead", handle === asking ? "input" : null),
        ),
        attention: [],
        readyTasks: [],
        personLands: true,
      }),
      logins: {},
      current: true,
      environmentId: undefined,
      mine: true,
      viewerSubject: undefined,
    });
  expect([facts("eve"), facts("ada")].map((row) => [row?.more, row?.moreNeeds])).toEqual([
    [2, true],
    [2, false],
  ]);
});
