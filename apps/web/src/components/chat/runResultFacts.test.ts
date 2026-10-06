import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import type { ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { readRunResultFacts } from "./runResultFacts";

const PROJECT = "project-nova";
const GROUP = "group-snap";
const HOME = EnvironmentId.make("env-nova");

const project = {
  id: PROJECT,
  name: "nova",
  tagList: ["mate"],
  hq: { appId: GROUP, appName: "Snap", kind: "mate", mate: { name: "Nova", face: "" } },
} as unknown as ZeropsProject;

const zeropsService = (name: string, status: string, versionAt?: string): ZeropsService =>
  ({
    id: `service-${name}`,
    name,
    status,
    lastUpdate: "2026-09-29T21:10:00.000Z",
    ...(versionAt === undefined ? {} : { activeAppVersion: { created: versionAt } }),
  }) as ZeropsService;

const pull = (number: number, title: string, merged = false): FlowPullRequest =>
  ({
    repository: "app",
    number,
    title,
    merged,
    mateProjectId: PROJECT,
  }) as FlowPullRequest;

const inventory = { projects: [project] };

describe("readRunResultFacts", () => {
  // The run's Mate is found from its thread's environment: its project, the
  // group that project belongs to, and what the platform, the forge and the
  // crew say now.
  it("reads the Mate's services, its project's changes and its crew's tasks", () => {
    const facts = readRunResultFacts({
      projectId: PROJECT,
      inventory,
      services: [
        zeropsService("appdev", "ACTIVE", "2026-09-29T20:00:00.000Z"),
        zeropsService("appstage", "STOPPED"),
      ],
      flows: new Map([
        [
          GROUP,
          {
            pullRequests: [pull(2, "Add a /status page")],
            merged: [pull(1, "Scaffold the app", true)],
            changesKnown: true,
          },
        ],
      ]),
      crew: {
        environmentId: HOME,
        tasks: [{ id: "task-12", number: 12, state: "ready", owner: "rules" }],
      },
    });
    expect(facts.changes).toEqual({
      groupId: GROUP,
      open: [{ repository: "app", number: 2, title: "Add a /status page", ready: true }],
      merged: [{ repository: "app", number: 1, title: "Scaffold the app", ready: true }],
      known: true,
    });
    expect(facts.services?.get("appdev")).toEqual({
      status: "ACTIVE",
      since: "2026-09-29T21:10:00.000Z",
      versionAt: "2026-09-29T20:00:00.000Z",
    });
    expect(facts.services?.get("appstage")).toMatchObject({ status: "STOPPED", versionAt: null });
    expect(facts.crew?.tasks.get(12)).toEqual({ id: "task-12", state: "ready", owner: "rules" });
    // Whose run it is: the Mate a fix is found by, and the project it is in.
    expect(facts.mate).toEqual({ projectId: PROJECT, groupId: GROUP });
  });

  // Until the forge answers, no change is known: never a guess.
  it.each([
    {
      name: "the forge has not answered: no change, not yet known",
      flows: new Map([[GROUP, { pullRequests: [], merged: [], changesKnown: false }]]),
      changes: { groupId: GROUP, open: [], merged: [], known: false },
    },
    {
      name: "the flow has not read the project yet: the same",
      flows: new Map(),
      changes: { groupId: GROUP, open: [], merged: [], known: false },
    },
    { name: "no flow at all: nothing known", flows: undefined, changes: undefined },
  ])("$name", ({ flows, changes }) => {
    const facts = readRunResultFacts({
      projectId: PROJECT,
      inventory,
      services: undefined,
      flows,
      crew: null,
    });
    expect(facts.changes).toEqual(changes);
  });

  // A fact that is not read yet is undefined, so a row stays as the run left
  // it: a service list not read, or refused, says nothing.
  it("says nothing of services not read", () => {
    const facts = readRunResultFacts({
      projectId: PROJECT,
      inventory,
      services: undefined,
      flows: undefined,
      crew: null,
    });
    expect(facts.services).toBeUndefined();
  });

  it("knows nothing outside a Zerops project", () => {
    expect(
      readRunResultFacts({
        projectId: undefined,
        inventory: null,
        services: undefined,
        flows: undefined,
        crew: null,
      }),
    ).toEqual({});
  });
});
