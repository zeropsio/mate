import { describe, expect, it } from "vite-plus/test";

import {
  buildGroupRows,
  deployedCommit,
  deployStatusContext,
  deployTone,
  environmentRow,
  GROUP_BEING_SET_UP_LINE,
  mateRow,
  pullRequestRow,
  shortCommit,
  type EnvironmentServiceState,
  type MateRowState,
} from "./groupRows.ts";

const SHA = "3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d";
const OTHER = "77ab0e1f2d3c4b5a69788796a5b4c3d2e1f0a9b8";

function service(
  hostname: string,
  state: "pending" | "success" | "failure" | undefined,
  options: { readonly environment?: string; readonly version?: string | undefined } = {},
): EnvironmentServiceState {
  return {
    hostname,
    ...(options.version === undefined ? {} : { appVersionName: options.version }),
    ...(state === undefined
      ? {}
      : {
          statuses: [
            { context: deployStatusContext(options.environment ?? "stage", hostname), state },
          ],
        }),
  };
}

describe("deployedCommit", () => {
  it.each([
    { name: "a stage version, named by its commit", value: SHA, expected: SHA },
    {
      name: "a production version, named by commit, tag and tagger",
      value: `${SHA} v1.2.0 u-jan`,
      expected: SHA,
    },
    { name: "an upper-case sha", value: SHA.toUpperCase(), expected: SHA },
    // Nothing of ours named it, so it does not name a commit.
    { name: "a hand-made version", value: "manual upload", expected: undefined },
    { name: "a short sha, which never compares equal", value: "3f9c1b2", expected: undefined },
    { name: "nothing deployed", value: undefined, expected: undefined },
  ])("reads $name", ({ value, expected }) => {
    expect(deployedCommit(value)).toBe(expected);
  });

  it("shortens a commit to the seven characters people read it by", () => {
    expect(shortCommit(SHA)).toBe("3f9c1b2");
  });
});

describe("deployTone", () => {
  it.each([
    { name: "nothing deployed yet", services: [service("api", undefined)], expected: "neutral" },
    { name: "a deploy in flight", services: [service("api", "pending")], expected: "pending" },
    { name: "a deploy that landed", services: [service("api", "success")], expected: "good" },
    { name: "a deploy that failed", services: [service("api", "failure")], expected: "bad" },
    {
      // Averaging a failure away is how a screen says "configured" for a
      // broken setup.
      name: "one service failing among three",
      services: [service("api", "success"), service("web", "failure"), service("db", "success")],
      expected: "bad",
    },
    {
      name: "one service still going",
      services: [service("api", "success"), service("web", "pending")],
      expected: "pending",
    },
  ])("reads $name as $expected", ({ services, expected }) => {
    expect(deployTone({ environment: "stage", services })).toBe(expected);
  });

  it("ignores a status written for another environment", () => {
    const foreign: EnvironmentServiceState = {
      hostname: "api",
      statuses: [{ context: deployStatusContext("production", "api"), state: "failure" }],
    };
    expect(deployTone({ environment: "stage", services: [foreign] })).toBe("neutral");
  });
});

describe("environmentRow", () => {
  const base = {
    projectId: "p-stage",
    name: "Acme - stage",
    tier: "stage" as const,
    environment: "acme-stage",
  };

  it("names its source and nothing else before the first deploy", () => {
    const row = environmentRow({
      ...base,
      sources: ["main"],
      services: [service("api", undefined)],
    });
    expect(row.line).toBe("main");
    expect(row.commit).toBeUndefined();
    expect(row.tone).toBe("neutral");
  });

  it("names the commit it actually runs once something is deployed", () => {
    const row = environmentRow({
      ...base,
      sources: ["main"],
      services: [service("api", "success", { environment: "acme-stage", version: SHA })],
    });
    expect(row.line).toBe("main · 3f9c1b2");
    expect(row.tone).toBe("good");
  });

  it("stays on the commit it runs when the last deploy failed", () => {
    // The sha is the version's, not the branch head's: what is running is what
    // is running, whatever the failed attempt was for.
    const row = environmentRow({
      ...base,
      sources: ["main"],
      services: [service("api", "failure", { environment: "acme-stage", version: SHA })],
    });
    expect(row.line).toBe("main · 3f9c1b2");
    expect(row.tone).toBe("bad");
  });

  it("joins several sources, the way the broker merges them", () => {
    const row = environmentRow({
      ...base,
      sources: ["main", "feature/invoices"],
      services: [],
    });
    expect(row.line).toBe("main + feature/invoices");
  });

  it("says release for a production, not a branch", () => {
    const row = environmentRow({
      ...base,
      name: "Acme - production",
      tier: "production",
      environment: "production",
      sources: "release",
      services: [
        service("api", "success", { environment: "production", version: `${SHA} v1.2.0 u-jan` }),
      ],
    });
    expect(row.line).toBe("release · 3f9c1b2");
  });
});

describe("mateRow", () => {
  const mate: MateRowState = {
    projectId: "p-fen",
    name: "Fen",
    visibility: "open",
    registration: "registered",
  };

  it("says nothing about a Mate you open — the face carries that", () => {
    expect(mateRow(mate)).toEqual({
      kind: "mate",
      projectId: "p-fen",
      name: "Fen",
      visibility: "open",
      line: "",
      tone: "neutral",
    });
  });

  it("says whose it is for a Mate you cannot open", () => {
    const row = mateRow({ ...mate, visibility: "listed", ownerName: "Jan Novák" });
    expect(row.line).toBe("Jan Novák's Mate — only Jan Novák opens it.");
    expect(row.tone).toBe("neutral");
  });

  it("says what a Mate waiting for an owner's registry write is missing", () => {
    const row = mateRow({ ...mate, registration: "awaiting-owner" }, [
      { id: "cu-1", user: { fullName: "Jan" } },
    ]);
    expect(row.line).toBe("Waiting for Jan to add it to the project — until then it cannot push.");
    expect(row.tone).toBe("pending");
  });

  it("says whose it is before it says anything about the registry", () => {
    // A row they cannot open is not the place to explain the registry.
    const row = mateRow({ ...mate, visibility: "listed", registration: "awaiting-owner" });
    expect(row.line).toBe("Only its owner opens this Mate.");
  });
});

describe("pullRequestRow", () => {
  it("names the change and who proposed it", () => {
    expect(
      pullRequestRow({
        number: 12,
        title: "Add a worker",
        state: "open",
        user: { login: "mate-p1" },
      }),
    ).toEqual({
      kind: "pull-request",
      number: 12,
      title: "Add a worker",
      line: "#12 · mate-p1",
      tone: "pending",
    });
  });

  it("names the change alone when Gitea did not say who", () => {
    expect(pullRequestRow({ number: 12, title: "Add a worker", state: "open" }).line).toBe("#12");
  });
});

describe("buildGroupRows", () => {
  const rows = buildGroupRows({
    groupId: "g-1",
    slug: "acme",
    gitea: "ready",
    mates: [
      { projectId: "p-fen", name: "Fen", visibility: "open", registration: "registered" },
      { projectId: "p-nova", name: "Nova", visibility: "listed", registration: "registered" },
    ],
    environments: [
      {
        projectId: "p-prod",
        name: "Acme - production",
        tier: "production",
        environment: "production",
        sources: "release",
        services: [service("api", "success", { environment: "production", version: SHA })],
      },
      {
        projectId: "p-stage",
        name: "Acme - stage",
        tier: "stage",
        environment: "acme-stage",
        sources: ["main"],
        services: [service("api", "success", { environment: "acme-stage", version: OTHER })],
      },
    ],
    pullRequests: [{ number: 12, title: "Add a worker", state: "open" }],
  });

  it("reads Mates, then where the code runs, then what is waiting to change", () => {
    expect(rows.rows.map((row) => row.kind)).toEqual([
      "mate",
      "mate",
      "environment",
      "environment",
      "pull-request",
    ]);
  });

  it("puts the stages before the production — the order code travels", () => {
    const environments = rows.rows.filter((row) => row.kind === "environment");
    expect(environments.map((row) => row.name)).toEqual(["Acme - stage", "Acme - production"]);
  });

  it("says nothing about a group whose Gitea is up", () => {
    expect(rows.line).toBe("");
  });

  it.each([
    { gitea: "being-set-up" as const, expected: GROUP_BEING_SET_UP_LINE },
    // Not asked yet: a line that appears and then disappears is the layout
    // shift this screen refuses.
    { gitea: "unknown" as const, expected: "" },
    { gitea: "ready" as const, expected: "" },
  ])("says $expected while its Gitea is $gitea", ({ gitea, expected }) => {
    const group = buildGroupRows({
      groupId: "g-1",
      slug: "acme",
      gitea,
      mates: [],
      environments: [],
      pullRequests: [],
    });
    expect(group.line).toBe(expected);
    expect(group.rows).toEqual([]);
  });
});
