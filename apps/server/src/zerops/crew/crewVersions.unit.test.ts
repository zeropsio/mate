import type { CrewDefinition, CrewMemberSpec } from "@t3tools/shared/crewHome";
import { expect, it } from "vite-plus/test";

import { isPromptPending, versionsAfterSave } from "./crewVersions.ts";

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

const reader = (handle: string): CrewMemberSpec => {
  const { host: _host, ...rest } = member(handle);
  return { ...rest, kind: "reader", readOnly: true };
};

const crew = (
  members: ReadonlyArray<CrewMemberSpec>,
  brief: Partial<CrewDefinition["brief"]> = {},
): CrewDefinition => ({
  crew: "game",
  name: "Game team",
  brief: { title: "Shooter", text: "Build it.\n", doneWhen: [], ...brief },
  members,
});

const saved = crew([member("backend"), member("frontend")]);
const versions = { brief: 4, jobs: { backend: 2, frontend: 7 } };

// witness: apps/server/src/zerops/crew/crewVersions.ts | const bumpJob = old.job !== member.job; → const bumpJob = old.job === member.job;
it("CM26: A saved brief or brief title bumps the brief's version and marks every crewmate behind; a saved job bumps only that crewmate's job version and marks only it; model, effort and display name bump nothing", () => {
  const save = (next: CrewDefinition) => versionsAfterSave(saved, versions, next);
  const unchanged = { versions, pending: [], freshOnly: [] };
  const briefEdit = {
    versions: { brief: 5, jobs: { backend: 2, frontend: 7 } },
    pending: ["backend", "frontend"],
    freshOnly: [],
  };
  expect(save(saved)).toEqual(unchanged);
  expect(save(crew(saved.members, { text: "Build it faster.\n" }))).toEqual(briefEdit);
  expect(save(crew(saved.members, { title: "Shooter v2" }))).toEqual(briefEdit);
  expect(save(crew([member("backend", { job: "Own the API.\n" }), member("frontend")]))).toEqual({
    versions: { brief: 4, jobs: { backend: 3, frontend: 7 } },
    pending: ["backend"],
    freshOnly: [],
  });
  expect(
    save(
      crew([
        member("backend", { model: "claude-sonnet-5", effort: "low", displayName: "Bea" }),
        member("frontend"),
      ]),
    ),
  ).toEqual(unchanged);
});

// witness: apps/server/src/zerops/crew/crewVersions.ts | old.login !== member.login || old.kind !== member.kind → old.kind !== member.kind
it("CM27: A crewmate whose login, Read only switch or host changed needs a fresh conversation instead of being marked behind", () => {
  const next = crew([member("backend", { login: "claudeAgent-work" }), reader("frontend")]);
  expect(versionsAfterSave(saved, versions, next)).toEqual({
    versions,
    pending: [],
    freshOnly: ["backend", "frontend"],
  });
});

// witness: apps/server/src/zerops/crew/crewVersions.ts | running.brief < current.brief || running.job < current.job → running.brief < current.brief && running.job < current.job
it("CM28: A crewmate's conversation is behind when it started on an older brief or an older job version than the current one", () => {
  const current = { brief: 4, job: 2 };
  expect(isPromptPending({ brief: 4, job: 2 }, current)).toBe(false);
  expect(isPromptPending({ brief: 3, job: 2 }, current)).toBe(true);
  expect(isPromptPending({ brief: 4, job: 1 }, current)).toBe(true);
  expect(isPromptPending({ brief: 3, job: 1 }, current)).toBe(true);
});
