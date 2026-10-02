import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { fixMatesOf, runFixMate } from "./fixMates";

const GROUP = "group-snap";

/** A Mate's candidate: its project in a group, named as HQ records it. */
function mate(
  id: string,
  bot: string,
  overrides: {
    group?: string;
    environment?: string;
    missingContainer?: true;
    connected?: false;
  } = {},
): ZeropsCandidate {
  return {
    key: `candidate-${id}`,
    project: {
      id,
      name: `${bot.toLowerCase()}-project`,
      tagList: ["mate"],
      hq: {
        appId: overrides.group ?? GROUP,
        appName: "Snap",
        kind: "mate",
        mate: { name: bot, face: "" },
      },
    },
    group: overrides.missingContainer
      ? "unavailable"
      : overrides.connected === false
        ? "ready"
        : "connected",
    ...(overrides.missingContainer ? { missingContainer: true as const } : {}),
    ...(overrides.environment === undefined
      ? {}
      : { environmentId: EnvironmentId.make(overrides.environment) }),
  } as unknown as ZeropsCandidate;
}

describe("fixMatesOf", () => {
  // S6: only the person's own Mates are offered, the one they used last in
  // the project first; nobody writes to a colleague's Mate.
  it.each([
    {
      name: "the person's own Mates in the project, the last used first",
      candidates: [
        mate("p-nova", "Nova", { environment: "env-nova" }),
        mate("p-kai", "Kai", { environment: "env-kai" }),
        mate("p-lena", "Lena", { environment: "env-lena" }),
      ],
      mine: { "p-nova": true, "p-kai": true, "p-lena": false },
      visits: { "env-kai": "2026-09-29T21:00:00.000Z", "env-nova": "2026-09-29T20:00:00.000Z" },
      names: ["Kai", "Nova"],
    },
    {
      name: "a Mate nobody can say is someone else's is offered",
      candidates: [mate("p-nova", "Nova", { environment: "env-nova" })],
      mine: {},
      visits: {},
      names: ["Nova"],
    },
    {
      name: "only the project's: another project's Mates, and an environment with no Mate, are not",
      candidates: [
        mate("p-nova", "Nova", { environment: "env-nova" }),
        mate("p-theo", "Theo", { group: "group-other", environment: "env-theo" }),
        mate("p-stage", "Stage", { missingContainer: true }),
      ],
      mine: {},
      visits: {},
      names: ["Nova"],
    },
    {
      // Asking one the app is not connected to would land on the projects
      // screen, and the words written for it would be lost.
      name: "only a Mate the app is connected to, with its conversation's environment",
      candidates: [
        mate("p-nova", "Nova", { environment: "env-nova" }),
        mate("p-kai", "Kai", { connected: false }),
        mate("p-lena", "Lena"),
      ],
      mine: {},
      visits: {},
      names: ["Nova"],
    },
    {
      name: "a colleague's conversation: none of the person's own to offer",
      candidates: [mate("p-lena", "Lena", { environment: "env-lena" })],
      mine: { "p-lena": false },
      visits: {},
      names: [],
    },
  ])("$name", ({ candidates, mine, visits, names }) => {
    const options = fixMatesOf({
      projectId: "p-nova",
      groupId: GROUP,
      candidates,
      isMine: (candidate) => (mine as Record<string, boolean>)[candidate.project.id],
      visitedAt: (environmentId) => (visits as Record<string, string>)[environmentId],
    });
    expect(options.map((option) => option.name)).toEqual(names);
  });

  it("finds the conversation's own Mate even outside a project", () => {
    const options = fixMatesOf({
      projectId: "p-nova",
      groupId: undefined,
      candidates: [
        mate("p-nova", "Nova", { environment: "env-nova" }),
        mate("p-kai", "Kai", { environment: "env-kai" }),
      ],
      isMine: () => true,
      visitedAt: () => undefined,
    });
    expect(options).toEqual([{ mateProjectId: "p-nova", mine: true, name: "Nova" }]);
  });
});

describe("runFixMate", () => {
  // The owner, 2026-09-29: "'ask lena to fix' when im at iris". A run's
  // problem was found in its Mate's conversation, in that Mate's services:
  // the fix goes to that Mate, and only while it is the person's (D6) —
  // another of theirs would be pointed at a service that is not its own.
  it.each([
    {
      name: "the run's own Mate, though another of theirs was used later",
      mine: { "p-iris": true, "p-lena": true },
      visits: { "env-lena": "2026-09-29T21:00:00.000Z", "env-iris": "2026-09-29T20:00:00.000Z" },
      fixer: "Iris",
    },
    {
      name: "a colleague's run: nobody, though the person has a Mate in the project",
      mine: { "p-iris": false, "p-lena": true },
      visits: {},
      fixer: undefined,
    },
    {
      name: "a run nobody can say is someone else's: its own Mate",
      mine: {},
      visits: {},
      fixer: "Iris",
    },
  ])("$name", ({ mine, visits, fixer }) => {
    const options = fixMatesOf({
      projectId: "p-iris",
      groupId: GROUP,
      candidates: [
        mate("p-iris", "Iris", { environment: "env-iris" }),
        mate("p-lena", "Lena", { environment: "env-lena" }),
      ],
      isMine: (candidate) => (mine as Record<string, boolean>)[candidate.project.id],
      visitedAt: (environmentId) => (visits as Record<string, string>)[environmentId],
    });
    expect(runFixMate(options, "p-iris")?.name).toBe(fixer);
  });
});
