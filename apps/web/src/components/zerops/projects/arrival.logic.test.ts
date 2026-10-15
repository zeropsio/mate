import { describe, expect, it } from "vite-plus/test";

import { arrivalWelcome, welcomeOwed, type ArrivalApp } from "./arrival.logic";

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
      sentence: "An Admin is told what the role reaches and starts their own Mate",
      viewer: { roleCode: "ADMIN" },
      apps: [SNAP, BEVIRO],
      line: "Welcome to Acme. You're an Admin: every project and its Mates, and you invite people.",
      detail: null,
      action: { label: "Start your own Mate on Snap", groupId: "g-snap" },
    },
    {
      sentence: "An Owner is told the organization is theirs to run",
      viewer: { roleCode: "OWNER" },
      apps: [SNAP],
      line: "Welcome to Acme. You're an Owner: everything here, billing and the team included.",
      detail: null,
      action: { label: "Start your own Mate on Snap", groupId: "g-snap" },
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
