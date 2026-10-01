import { describe, expect, it } from "vite-plus/test";

import { interruptedPresses, planShareReach, shareGroupReach } from "./matePress";

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
      siblingProjectIds: ["uma", "fen"],
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
        siblingProjectIds: ["uma"],
        projectId: "new",
        viewer: { userId: "u-zoe", roleCode: "OWNER" },
      }),
    ).toEqual([]);
  });
});

// Every sibling the key mint counts, whatever the services listing holds yet, each key read fresh
// right before its write (live, 2026-10-01: a press ten seconds after load reached three of nine
// siblings, picked by the zcp services the listing held).
describe("shareGroupReach", () => {
  const key = (id: string, projectId: string) => ({
    id,
    name: `zcp-${projectId}`,
    roleCode: "NO_ACCESS",
    createdByUser: "u-ada",
    projects: [{ projectId, roleCode: "BASIC_USER" as const }],
  });
  const fakeClient = (failing: ReadonlySet<string> = new Set()) => {
    const tokens = new Map(
      [key("k-uma", "uma"), key("k-fen", "fen"), key("k-ivo", "ivo")].map((token) => [
        token.id,
        token,
      ]),
    );
    const calls: Array<string> = [];
    return {
      calls,
      tokens,
      client: {
        listIntegrationTokens: async () => {
          calls.push("list");
          return [...tokens.values()];
        },
        setIntegrationTokenProjects: async (input: {
          readonly tokenId: string;
          readonly projects: ReadonlyArray<{
            readonly projectId: string;
            readonly roleCode: string;
          }>;
        }) => {
          calls.push(`put ${input.tokenId}`);
          if (failing.has(input.tokenId)) throw new Error("refused");
          const token = tokens.get(input.tokenId)!;
          tokens.set(input.tokenId, { ...token, projects: input.projects as never });
        },
      },
    };
  };
  const share = (client: ReturnType<typeof fakeClient>["client"]) =>
    shareGroupReach({
      client,
      organizationId: "org-acme",
      // A stage environment with no key among them, and the new project itself.
      groupProjectIds: ["uma", "stage", "fen", "ivo", "new"],
      projectId: "new",
      viewer: { userId: "u-zoe", roleCode: "OWNER" },
    });

  it("extends every sibling Mate's key, reading the list fresh before each write", async () => {
    const fake = fakeClient();
    expect(await share(fake.client)).toEqual({ extended: 3, failed: 0 });
    expect(fake.calls).toEqual([
      "list",
      "put k-uma",
      "list",
      "list",
      "put k-fen",
      "list",
      "put k-ivo",
    ]);
    expect(
      [...fake.tokens.values()].map((token) => token.projects.map((grant) => grant.projectId)),
    ).toEqual([
      ["uma", "new"],
      ["fen", "new"],
      ["ivo", "new"],
    ]);
  });

  it("goes on past a key it could not write, and counts it", async () => {
    const fake = fakeClient(new Set(["k-fen"]));
    expect(await share(fake.client)).toEqual({ extended: 2, failed: 1 });
  });
});
