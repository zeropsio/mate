import { describe, expect, it } from "@effect/vitest";
import type { CrewDefinition, CrewMemberSpec } from "@t3tools/shared/crewHome";

import { isPromptPending, suggestedApplyChoice, versionsAfterSave } from "./crewVersions.ts";

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

describe("versionsAfterSave", () => {
  it.each([
    {
      name: "the first save starts every version at 1",
      previous: undefined,
      next: saved,
      expected: {
        versions: { brief: 1, jobs: { backend: 1, frontend: 1 } },
        pending: [],
        freshOnly: [],
      },
    },
    {
      name: "a save that changes nothing bumps nothing",
      previous: saved,
      next: saved,
      expected: { versions, pending: [], freshOnly: [] },
    },
    {
      name: "a brief edit bumps the brief and marks every crewmate",
      previous: saved,
      next: crew(saved.members, { text: "Build it faster.\n" }),
      expected: {
        versions: { ...versions, brief: 5 },
        pending: ["backend", "frontend"],
        freshOnly: [],
      },
    },
    {
      name: "a new brief title is a brief edit",
      previous: saved,
      next: crew(saved.members, { title: "Shooter v2" }),
      expected: {
        versions: { ...versions, brief: 5 },
        pending: ["backend", "frontend"],
        freshOnly: [],
      },
    },
    {
      name: "a job edit bumps one job and marks one crewmate",
      previous: saved,
      next: crew([member("backend", { job: "Own the API.\n" }), member("frontend")]),
      expected: {
        versions: { ...versions, jobs: { ...versions.jobs, backend: 3 } },
        pending: ["backend"],
        freshOnly: [],
      },
    },
    {
      name: "model, effort and a new name reach the next turn without a version",
      previous: saved,
      next: crew([
        member("backend", { model: "claude-sonnet-5", effort: "low", displayName: "Bea" }),
        member("frontend"),
      ]),
      expected: { versions, pending: [], freshOnly: [] },
    },
    {
      name: "a new login, the Read only switch or a new host needs a fresh conversation",
      previous: saved,
      next: crew([member("backend", { login: "claudeAgent-work" }), reader("frontend")]),
      expected: { versions, pending: [], freshOnly: ["backend", "frontend"] },
    },
    {
      name: "a crewmate added later starts at job v1 and is not pending",
      previous: saved,
      next: crew([...saved.members, member("erik")]),
      expected: {
        versions: { ...versions, jobs: { ...versions.jobs, erik: 1 } },
        pending: [],
        freshOnly: [],
      },
    },
    {
      name: "a removed crewmate leaves the versions",
      previous: saved,
      next: crew([member("backend")]),
      expected: { versions: { brief: 4, jobs: { backend: 2 } }, pending: [], freshOnly: [] },
    },
  ])("$name", ({ previous, next, expected }) => {
    expect(versionsAfterSave(previous, previous ? versions : undefined, next)).toEqual(expected);
  });
});

describe("isPromptPending", () => {
  it.each([
    { running: { brief: 4, job: 2 }, current: { brief: 4, job: 2 }, pending: false },
    { running: { brief: 3, job: 2 }, current: { brief: 4, job: 2 }, pending: true },
    { running: { brief: 4, job: 1 }, current: { brief: 4, job: 2 }, pending: true },
    { running: { brief: 3, job: 1 }, current: { brief: 4, job: 2 }, pending: true },
  ])(
    "brief v$running.brief job v$running.job against brief v$current.brief job v$current.job",
    ({ running, current, pending }) => {
      expect(isPromptPending(running, current)).toBe(pending);
    },
  );
});

describe("suggestedApplyChoice", () => {
  const job = "Own the API.\nWrite tests first.\nKeep handlers small.\nDocument endpoints.\n";

  it.each([
    { name: "an unchanged job", next: job, choice: "nextTurn" },
    {
      name: "one line of four changed",
      next: job.replace("Keep handlers small.", "Keep handlers tiny."),
      choice: "nextTurn",
    },
    {
      name: "two lines of four changed",
      next: job.replace("Keep handlers small.", "A").replace("Document endpoints.", "B"),
      choice: "nextTurn",
    },
    {
      name: "three lines of four changed",
      next: "Own the API.\nA\nB\nC\n",
      choice: "fresh",
    },
    { name: "a job written from nothing", previous: "", next: job, choice: "fresh" },
    {
      name: "blank lines and indentation only",
      next: job.replaceAll("\n", "\n\n  "),
      choice: "nextTurn",
    },
  ])("$name → $choice", ({ previous, next, choice }) => {
    expect(suggestedApplyChoice(previous ?? job, next)).toBe(choice);
  });
});
