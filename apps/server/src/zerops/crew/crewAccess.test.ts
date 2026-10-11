/**
 * What a write to the crew home reaches: the crewmates it changes, or every
 * crewmate when it changes what they share.
 */
import { assert, describe, it } from "@effect/vitest";
import { parseBrief, type CrewDefinition, type CrewMemberSpec } from "@t3tools/shared/crewHome";

import { crewHomeChange, type CrewHomeChange } from "./crewAccess.ts";

const member = (handle: string, fields: Partial<CrewMemberSpec> = {}): CrewMemberSpec => ({
  handle,
  displayName: handle,
  kind: "reader",
  readOnly: true,
  restartAfterMerge: false,
  afterLandRestart: false,
  env: {},
  migrations: [],
  job: `${handle}'s job.\n`,
  ...fields,
});

const home = (
  members: ReadonlyArray<CrewMemberSpec>,
  brief = "Ship the space shooter.\n",
): CrewDefinition => ({
  crew: "main",
  name: "Game team",
  brief: parseBrief("Space shooter", brief),
  members,
});

const LEAD = member("lead", { kind: "lead" });
const BACKEND = member("backend", { kind: "writer", readOnly: false, host: "appdev" });

describe("crewHomeChange", () => {
  it.each([
    ["a first home is all new", undefined, home([LEAD]), { shared: true, handles: [] }],
    [
      "the same home changes nothing",
      home([LEAD, BACKEND]),
      home([LEAD, BACKEND]),
      { shared: false, handles: [] },
    ],
    [
      "a job changes its crewmate",
      home([LEAD, BACKEND]),
      home([LEAD, { ...BACKEND, job: "Own the API.\n" }]),
      { shared: false, handles: ["backend"] },
    ],
    [
      "a login changes its crewmate",
      home([LEAD, BACKEND]),
      home([LEAD, { ...BACKEND, login: "claudeAgent_eva" }]),
      { shared: false, handles: ["backend"] },
    ],
    [
      "a crewmate added",
      home([LEAD]),
      home([LEAD, BACKEND]),
      { shared: false, handles: ["backend"] },
    ],
    [
      "a crewmate removed",
      home([LEAD, BACKEND]),
      home([LEAD]),
      { shared: false, handles: ["backend"] },
    ],
    [
      "the goal changes what every crewmate shares",
      home([LEAD, BACKEND]),
      home([LEAD, BACKEND], "Ship the sequel.\n"),
      { shared: true, handles: [] },
    ],
  ] as const satisfies ReadonlyArray<
    readonly [string, CrewDefinition | undefined, CrewDefinition, CrewHomeChange]
  >)("%s", (_name, before, after, change) => {
    assert.deepStrictEqual(crewHomeChange(before, after), change);
  });
});
