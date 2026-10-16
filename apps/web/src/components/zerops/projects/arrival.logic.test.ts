import { describe, expect, it } from "vite-plus/test";

import { arrivalWelcome, welcomeOwed, welcomeStep, type ArrivalApp } from "./arrival.logic";

const SNAP: ArrivalApp = { groupId: "g-snap", name: "Snap", mine: false, addMate: true };
const BEVIRO: ArrivalApp = { groupId: "g-beviro", name: "Beviro", mine: false, addMate: true };
const SHOP: ArrivalApp = { groupId: "g-shop", name: "Shop", mine: false, addMate: true };

describe("the first minute after an invitation", () => {
  it.each([
    {
      sentence:
        "A Developer is told their role on the team's project and starts their own Mate there",
      viewer: { roleCode: "NO_ACCESS", canCreateProjects: true },
      apps: [SNAP],
      line: "Welcome to Acme. You're a Developer on Snap.",
      detail: null,
      action: { label: "Start your own Mate on Snap", groupId: "g-snap" },
    },
    {
      sentence:
        "A Guest is told they can follow the work and open the app, and offered nothing to create",
      viewer: { roleCode: "NO_ACCESS", canCreateProjects: false },
      apps: [{ ...SNAP, addMate: false }],
      line: "Welcome to Acme. You're a Guest on Snap.",
      detail: "You can follow the work and open the app.",
      action: null,
    },
    {
      sentence:
        "A Developer on several projects hears them named, and starts on the first they may",
      viewer: { roleCode: "NO_ACCESS", canCreateProjects: true },
      apps: [{ ...SNAP, addMate: false }, BEVIRO, SHOP],
      line: "Welcome to Acme. You're a Developer on Snap and 2 more projects.",
      detail: null,
      action: { label: "Start your own Mate on Beviro", groupId: "g-beviro" },
    },
    {
      sentence: "A Developer whose projects take no Mate of theirs is offered none",
      viewer: { roleCode: "NO_ACCESS", canCreateProjects: true },
      apps: [
        { ...SNAP, addMate: false },
        { ...BEVIRO, addMate: false },
      ],
      line: "Welcome to Acme. You're a Developer on Snap and Beviro.",
      detail: null,
      action: null,
    },
  ])("$sentence", ({ viewer, apps, line, detail, action }) => {
    expect(arrivalWelcome({ organizationName: "Acme", viewer, apps })).toEqual({
      line,
      detail,
      action,
    });
  });

  it.each([
    { role: "an Owner", viewer: { roleCode: "OWNER" } },
    { role: "an Admin", viewer: { roleCode: "ADMIN" } },
  ])("$role runs the organization and is never welcomed to it", ({ viewer }) => {
    expect(arrivalWelcome({ organizationName: "Acme", viewer, apps: [SNAP, BEVIRO] })).toBeNull();
  });

  it("an organization whose name ends in a period is welcomed with one period", () => {
    expect(
      arrivalWelcome({
        organizationName: "Acme s.r.o.",
        viewer: { roleCode: "NO_ACCESS", canCreateProjects: true },
        apps: [SNAP],
      })?.line,
    ).toBe("Welcome to Acme s.r.o. You're a Developer on Snap.");
  });
});

describe("when the welcome is said", () => {
  it.each([
    {
      sentence: "A first visit to projects someone else started is welcomed",
      welcomed: false,
      apps: [SNAP],
      owed: true,
    },
    {
      sentence: "A later visit is quiet",
      welcomed: true,
      apps: [SNAP],
      owed: false,
    },
    {
      sentence: "Someone with a Mate of their own here started it: no welcome",
      welcomed: false,
      apps: [{ ...SNAP, mine: true }, BEVIRO],
      owed: false,
    },
    {
      sentence: "Nothing shared yet: the empty page speaks, and the welcome waits for a project",
      welcomed: false,
      apps: [],
      owed: false,
    },
  ])("$sentence", ({ welcomed, apps, owed }) => {
    expect(welcomeOwed({ welcomed, apps })).toBe(owed);
  });
});

describe("the welcome paints with the overview or not at all on that visit", () => {
  it.each([
    {
      sentence: "Read before the overview paints: decided under its wait, painted with it",
      settled: true,
      hasApps: true,
      painted: false,
      step: "decide",
    },
    {
      sentence: "Still reading under the overview's wait: it waits too",
      settled: false,
      hasApps: true,
      painted: false,
      step: "wait",
    },
    {
      sentence: "The overview painted first: quiet on this visit, still owed on the next",
      settled: false,
      hasApps: true,
      painted: true,
      step: "late",
    },
    {
      sentence: "The overview painted with nothing shared yet: it waits for a project",
      settled: true,
      hasApps: false,
      painted: true,
      step: "wait",
    },
  ] as const)("$sentence", ({ settled, hasApps, painted, step }) => {
    expect(welcomeStep({ settled, hasApps, painted })).toBe(step);
  });
});
