import { describe, expect, it } from "vite-plus/test";

import { interruptedPresses, planShareReach } from "./matePress";

const mate = (serviceId: string | undefined, tags: ReadonlyArray<string>) => ({
  ...(serviceId === undefined ? {} : { service: { id: serviceId } }),
  project: { tagList: tags },
});

// A press interrupted before its close-off: the container carries the press's marker, its
// project no `mate:closed-off` (pass 28). *Finish setup* finishes it.
describe("interruptedPresses", () => {
  it.each([
    {
      case: "a marked container whose project was never marked closed off",
      mate: mate("zcp-a", ["mate"]),
      marker: true,
      interrupted: true,
    },
    {
      case: "a press that got as far as its close-off",
      mate: mate("zcp-a", ["mate", "mate:closed-off"]),
      marker: true,
      interrupted: false,
    },
    {
      case: "a Mate made before the press: no marker",
      mate: mate("zcp-a", ["mate"]),
      marker: false,
      interrupted: false,
    },
    {
      case: "a marker the store has not read yet",
      mate: mate("zcp-a", ["mate"]),
      marker: "unread" as const,
      interrupted: false,
    },
    {
      case: "a marker whose stream failed",
      mate: mate("zcp-a", ["mate"]),
      marker: "unknown" as const,
      interrupted: false,
    },
    {
      case: "a Mate with no container listed",
      mate: mate(undefined, ["mate"]),
      marker: true,
      interrupted: false,
    },
  ])("$case", ({ mate: candidate, marker, interrupted }) => {
    const markers = new Map([["zcp-a", marker]]);
    expect(interruptedPresses([candidate], markers).has("zcp-a")).toBe(interrupted);
  });
});

// The group's other Mates given sight of the new project in the press itself, where the person may
// edit their keys: an org owner, or the keys' creator (live, 2026-10-01: Otto's siblings gained no
// READ_ONLY until some owner's browser reconciled).
describe("planShareReach", () => {
  const key = (id: string, projectId: string, createdByUser: string) => ({
    id,
    name: `zcp-${projectId}`,
    roleCode: "NO_ACCESS",
    createdByUser,
    projects: [
      { projectId, roleCode: "BASIC_USER" as const },
      { projectId: "stage", roleCode: "READ_ONLY" as const },
    ],
  });
  const TOKENS = [key("k-uma", "uma", "u-ada"), key("k-fen", "fen", "u-eva")];
  const plan = (viewer: { readonly userId: string; readonly roleCode: string }) =>
    planShareReach({
      tokens: TOKENS,
      groupMateProjectIds: ["uma", "fen"],
      projectId: "new",
      viewer,
    }).map((write) => [write.tokenId, write.projects.map((grant) => grant.projectId)]);

  it("extends every sibling's key for an org owner", () => {
    expect(plan({ userId: "u-zoe", roleCode: "OWNER" })).toEqual([
      ["k-uma", ["uma", "new", "stage"]],
      ["k-fen", ["fen", "new", "stage"]],
    ]);
  });

  it("extends only the keys this person created, for anyone else", () => {
    expect(plan({ userId: "u-ada", roleCode: "ADMIN" })).toEqual([
      ["k-uma", ["uma", "new", "stage"]],
    ]);
  });

  it("writes nothing to a key that reads the project already", () => {
    expect(
      planShareReach({
        tokens: [
          {
            ...TOKENS[0]!,
            projects: [...TOKENS[0]!.projects, { projectId: "new", roleCode: "READ_ONLY" }],
          },
        ],
        groupMateProjectIds: ["uma"],
        projectId: "new",
        viewer: { userId: "u-zoe", roleCode: "OWNER" },
      }),
    ).toEqual([]);
  });
});
