import type { CrewDefinition, CrewMemberSpec } from "@t3tools/shared/crewHome";
import { expect, it } from "vite-plus/test";

import { crewHomeChange } from "./crewAccess.ts";

const member = (handle: string, overrides: Partial<CrewMemberSpec> = {}): CrewMemberSpec => ({
  handle,
  displayName: handle,
  kind: "writer",
  readOnly: false,
  host: "appdev",
  restartAfterMerge: false,
  afterLandRestart: false,
  env: {},
  migrations: [],
  job: `Job of ${handle}.\n`,
  ...overrides,
});

const crew = (
  members: ReadonlyArray<CrewMemberSpec>,
  brief: Partial<CrewDefinition["brief"]> = {},
): CrewDefinition => ({
  crew: "game",
  name: "Game team",
  brief: { title: "Shooter", text: "Build it.\n", doneWhen: [], ...brief },
  members,
});

const home = crew([member("backend"), member("frontend")]);

// witness: apps/server/src/zerops/crew/crewAccess.ts | before.name !== after.name || → false ||
it("CM60: A write to the crew home that changes the crew's name, its goal's title or its goal's text reaches every crewmate; any other write reaches exactly the crewmates whose entry or job it adds, removes or changes, and a home written for the first time is all new", () => {
  expect(crewHomeChange(undefined, home)).toEqual({ shared: true, handles: [] });
  expect(crewHomeChange(home, crew([member("backend"), member("frontend")]))).toEqual({
    shared: false,
    handles: [],
  });
  expect(crewHomeChange(home, { ...home, name: "Other team" })).toEqual({
    shared: true,
    handles: [],
  });
  expect(
    crewHomeChange(home, crew([member("backend"), member("frontend")], { title: "Racer" })),
  ).toEqual({ shared: true, handles: [] });
  expect(
    crewHomeChange(home, crew([member("backend"), member("frontend")], { text: "Ship it.\n" })),
  ).toEqual({ shared: true, handles: [] });
  expect(
    crewHomeChange(home, crew([member("backend", { job: "New job.\n" }), member("frontend")])),
  ).toEqual({ shared: false, handles: ["backend"] });
  expect(
    crewHomeChange(home, crew([member("backend"), member("frontend"), member("docs")])),
  ).toEqual({ shared: false, handles: ["docs"] });
  expect(crewHomeChange(home, crew([member("backend")]))).toEqual({
    shared: false,
    handles: ["frontend"],
  });
});
