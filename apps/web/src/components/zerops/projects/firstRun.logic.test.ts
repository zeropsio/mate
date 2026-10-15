import { describe, expect, it } from "vite-plus/test";

import { firstRunWords } from "./firstRun.logic";

describe("an account with no project, by what its role may do", () => {
  it.each([
    {
      who: "an owner or an admin",
      create: true,
      reachesEveryProject: true,
      heading: "Start a project",
      offersNewProject: true,
      says: "Name a project and it is up in a few minutes.",
    },
    {
      who: "a Developer",
      create: true,
      reachesEveryProject: false,
      heading: "Start a project",
      offersNewProject: true,
      says: "Projects your team gives you access to appear here",
    },
    {
      who: "a Guest",
      create: false,
      reachesEveryProject: false,
      heading: "Nothing is shared with you yet",
      offersNewProject: false,
      says: "Projects an owner or admin gives you access to appear here",
    },
    {
      who: "a member who sees every project but may not create one",
      create: false,
      reachesEveryProject: true,
      heading: "No projects yet",
      offersNewProject: false,
      says: "once someone on your team starts one",
    },
  ])(
    "$who is told only what is true of the organization, and offered New project only if the role creates projects",
    ({ create, reachesEveryProject, heading, offersNewProject, says }) => {
      const words = firstRunWords({ create, reachesEveryProject });
      expect(words.heading).toBe(heading);
      expect(words.body).toContain(says);
      expect(words.newProject).toBe(offersNewProject);
    },
  );

  it("never tells a member who may not create one to start a project", () => {
    for (const reachesEveryProject of [true, false]) {
      const words = firstRunWords({ create: false, reachesEveryProject });
      expect(`${words.heading} ${words.body}`).not.toMatch(/start a project|name a project/i);
    }
  });
});
