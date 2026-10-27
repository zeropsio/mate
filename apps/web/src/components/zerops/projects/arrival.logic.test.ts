import { describe, expect, it } from "vite-plus/test";

import {
  arrivalWelcome,
  firstVisit,
  signInSettled,
  welcomeOwed,
  welcomeStep,
  welcomeStart,
  type ArrivalApp,
} from "./arrival.logic";

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
      action: { label: "Add a project Mate to Snap", groupId: "g-snap" },
    },
    {
      sentence:
        "A Guest is told they can see the changes and open the app, and offered nothing to create",
      viewer: { roleCode: "NO_ACCESS", canCreateProjects: false },
      apps: [{ ...SNAP, addMate: false }],
      line: "Welcome to Acme. You're a Guest on Snap.",
      detail: "You can see the changes and open the app once it is released.",
      action: null,
    },
    {
      sentence:
        "A Developer on several projects hears them named, and starts on the first they may",
      viewer: { roleCode: "NO_ACCESS", canCreateProjects: true },
      apps: [{ ...SNAP, addMate: false }, BEVIRO, SHOP],
      line: "Welcome to Acme. You're a Developer on Snap and 2 more projects.",
      detail: null,
      action: { label: "Add a project Mate to Beviro", groupId: "g-beviro" },
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

  it.each([{ roleCode: "OWNER" }, { roleCode: "ADMIN" }])(
    "Where HQ gives no word on a first sign-in, an Owner or an Admin is not welcomed: a new browser is no arrival",
    (viewer) => {
      expect(
        arrivalWelcome({
          organizationName: "Acme",
          viewer,
          apps: [SNAP, BEVIRO],
          firstVisit: null,
        }),
      ).toBeNull();
    },
  );

  it("Whoever set up the organization's HQ is never welcomed to it", () => {
    const first = firstVisit(
      { firstSignedInAt: "2026-10-16T11:00:00Z", founder: true },
      Date.parse("2026-10-16T11:05:00Z"),
    );
    expect(welcomeOwed({ welcomed: false, apps: [SNAP], firstVisit: first })).toBe(false);
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

describe("a first visit, as HQ records it", () => {
  const NOW = Date.parse("2026-10-16T12:00:00Z");
  it.each([
    {
      sentence: "Someone who first signed in to HQ within the hour is on their first visit",
      signIn: { firstSignedInAt: "2026-10-16T11:00:00Z", founder: false },
      first: true,
    },
    {
      sentence: "Someone who first signed in days ago is not, whichever browser they come from",
      signIn: { firstSignedInAt: "2026-10-12T11:00:00Z", founder: false },
      first: false,
    },
    {
      sentence: "The person who set HQ up is never welcomed to their own organization",
      signIn: { firstSignedInAt: "2026-10-16T11:00:00Z", founder: true },
      first: false,
    },
    {
      sentence: "Where HQ holds no sign-in of theirs, it is no first visit",
      signIn: { firstSignedInAt: null, founder: false },
      first: false,
    },
    {
      sentence: "An older HQ that does not say leaves the browser's memory to decide",
      signIn: undefined,
      first: null,
    },
  ])("$sentence", ({ signIn, first }) => {
    expect(firstVisit(signIn, NOW)).toBe(first);
  });

  it.each([
    {
      sentence: "A first visit as HQ records it is welcomed, on any browser",
      welcomed: false,
      first: true,
      owed: true,
    },
    {
      sentence: "A later visit as HQ records it is quiet, even on a browser that never said it",
      welcomed: false,
      first: false,
      owed: false,
    },
    {
      sentence: "A first visit already welcomed in this browser is quiet",
      welcomed: true,
      first: true,
      owed: false,
    },
    {
      sentence: "Where HQ does not say, the browser remembers the welcome as before",
      welcomed: false,
      first: null,
      owed: true,
    },
  ])("$sentence", ({ welcomed, first, owed }) => {
    expect(welcomeOwed({ welcomed, apps: [SNAP], firstVisit: first })).toBe(owed);
  });

  it.each([
    {
      sentence: "An invited Owner on their first visit is told the organization is theirs to run",
      viewer: { roleCode: "OWNER" },
      line: "Welcome to Acme. You're an Owner.",
      detail: "The organization is yours to run: every project, its billing and its team.",
    },
    {
      sentence:
        "An invited Admin on their first visit is told they reach every project and invite people",
      viewer: { roleCode: "ADMIN" },
      line: "Welcome to Acme. You're an Admin.",
      detail: "You reach every project and its Mates, and you invite people.",
    },
  ])("$sentence", ({ viewer, line, detail }) => {
    expect(
      arrivalWelcome({ organizationName: "Acme", viewer, apps: [SNAP], firstVisit: true }),
    ).toEqual({
      line,
      detail,
      action: { label: "Add a project Mate to Snap", groupId: "g-snap" },
    });
  });
});

describe("the welcome never waits on an HQ that does not answer", () => {
  it.each([
    {
      sentence: "With HQ's record of the organization read, the welcome may decide",
      recordRead: true,
      hqUnavailable: false,
      settled: true,
    },
    {
      sentence: "While HQ's record is on its way, the welcome waits for it",
      recordRead: false,
      hqUnavailable: false,
      settled: false,
    },
    {
      sentence:
        "With HQ down or refusing as the overview paints, the welcome decides by this browser's memory",
      recordRead: false,
      hqUnavailable: true,
      settled: true,
    },
  ])("$sentence", ({ recordRead, hqUnavailable, settled }) => {
    expect(signInSettled({ recordRead, hqUnavailable })).toBe(settled);
  });
});

// Run 2 (2026-10-16): the welcome offered "Start your own Mate" while the project's first Mate was
// still setting it up; the press opened a dialog that refused, and the button came back unchanged.
describe("the welcome's way to start a Mate, while the project takes none yet", () => {
  const action = { label: "Add a project Mate to Snap", groupId: "g-snap" };
  it("says why in the button's place while the project takes no Mate, and offers it once it does", () => {
    const waiting = "Ada is still setting Snap up. New Mates can join once it's done.";
    expect(welcomeStart(action, () => waiting)).toEqual({ kind: "waits", line: waiting });
    expect(welcomeStart(action, () => null)).toEqual({ kind: "start", ...action });
    expect(welcomeStart(null, () => waiting)).toBeNull();
  });
});
