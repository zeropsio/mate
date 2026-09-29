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
  tagList: ["mate", `mate:g:${GROUP}`],
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

const inventory = (services: ReadonlyArray<ZeropsService> | "failed" | null) => ({
  projects: [project],
  services: new Map(
    services === null
      ? []
      : [
          [
            PROJECT,
            services === "failed"
              ? { status: "failed" as const }
              : { status: "resolved" as const, services },
          ],
        ],
  ),
});

describe("readRunResultFacts", () => {
  // The run's Mate is found from its thread's environment: its project, the
  // group that project belongs to, and what the platform, the forge and the
  // crew say now.
  it("reads the Mate's services, its project's changes and its crew's tasks", () => {
    const facts = readRunResultFacts({
      projectId: PROJECT,
      inventory: inventory([
        zeropsService("appdev", "ACTIVE", "2026-09-29T20:00:00.000Z"),
        zeropsService("appstage", "STOPPED"),
      ]),
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
      remembered: () => undefined,
      crew: { environmentId: HOME, tasks: [{ id: "task-12", number: 12, state: "ready" }] },
    });
    expect(facts.changes).toEqual({
      groupId: GROUP,
      open: [{ repository: "app", number: 2, title: "Add a /status page" }],
      merged: [{ repository: "app", number: 1, title: "Scaffold the app" }],
      known: true,
    });
    expect(facts.services?.get("appdev")).toEqual({
      status: "ACTIVE",
      since: "2026-09-29T21:10:00.000Z",
      versionAt: "2026-09-29T20:00:00.000Z",
    });
    expect(facts.services?.get("appstage")).toMatchObject({ status: "STOPPED", versionAt: null });
    expect(facts.crew?.tasks.get(12)).toEqual({ id: "task-12", state: "ready" });
  });

  // Until the forge answers, the menu's memory of the project's open changes
  // stands in, so a reload paints the change it will keep (never a guess).
  it.each([
    {
      name: "the forge has not answered: the changes the menu remembers, not yet known",
      flows: new Map([[GROUP, { pullRequests: [], merged: [], changesKnown: false }]]),
      remembered: [pull(2, "Add a /status page")],
      changes: {
        groupId: GROUP,
        open: [{ repository: "app", number: 2, title: "Add a /status page" }],
        merged: [],
        known: false,
      },
    },
    {
      name: "the flow has not read the project yet: the same",
      flows: new Map(),
      remembered: [pull(2, "Add a /status page")],
      changes: {
        groupId: GROUP,
        open: [{ repository: "app", number: 2, title: "Add a /status page" }],
        merged: [],
        known: false,
      },
    },
    { name: "no flow at all: nothing known", flows: undefined, remembered: [], changes: undefined },
  ])("$name", ({ flows, remembered, changes }) => {
    const facts = readRunResultFacts({
      projectId: PROJECT,
      inventory: inventory(null),
      flows,
      remembered: () => remembered,
      crew: null,
    });
    expect(facts.changes).toEqual(changes);
  });

  // A fact that is not read yet is undefined, so a row stays as the run left
  // it: a service list that failed or was never read says nothing.
  it.each([
    { name: "services never read", services: null },
    { name: "services that failed to read", services: "failed" as const },
  ])("says nothing of $name", ({ services }) => {
    const facts = readRunResultFacts({
      projectId: PROJECT,
      inventory: inventory(services),
      flows: undefined,
      remembered: () => undefined,
      crew: null,
    });
    expect(facts.services).toBeUndefined();
  });

  it("knows nothing outside a Zerops project", () => {
    expect(
      readRunResultFacts({
        projectId: undefined,
        inventory: null,
        flows: undefined,
        remembered: () => undefined,
        crew: null,
      }),
    ).toEqual({});
  });
});
