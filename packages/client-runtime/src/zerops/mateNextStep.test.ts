import { describe, expect, it } from "vite-plus/test";

import { groupFlow, type GroupFlowInput } from "./groupFlow.ts";
import { deployedVersion, environmentRow } from "./groupRows.ts";
import { mateNextStep } from "./mateNextStep.ts";
import type { FlowPullRequest } from "./projectFlow.ts";

const MAIN_SHA = "055a7e8f0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f";

function pull(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "app",
    number: 1,
    title: "Greet with a fuller line",
    kind: "code",
    mateProjectId: "p-wren",
    author: "mate-p-wren",
    url: undefined,
    checks: "none",
    checkWord: undefined,
    mergeable: true,
    merged: false,
    mergedAt: undefined,
    headSha: "abc",
    baseBranch: "main",
    line: "app #1",
    updatedAt: undefined,
    ...over,
  };
}

function flow(over: Partial<GroupFlowInput>) {
  return groupFlow({
    groupId: "g",
    mates: [],
    pullRequests: [],
    merged: [],
    stops: [],
    missing: [],
    release: {
      gate: { allowed: false, reason: "Nothing is merged to release." },
      suggestion: "v0.1.0",
      waiting: 0,
    },
    mainHasCode: undefined,
    mainHead: undefined,
    productionAddable: true,
    ...over,
  });
}

/** `sm-fixture`: Wren's #1 merges, and main already has code with no production. */
const SM_FIXTURE = flow({
  groupId: "sm-fixture",
  mates: [{ projectId: "p-wren", name: "Wren", preview: undefined, waiting: false, talked: false }],
  pullRequests: [pull()],
  missing: [{ tier: "production" }],
  mainHasCode: true,
});

/** `fsadfdasfsa`: Juno's #4 merged, a production that runs nothing, the person may release. */
const FSADFDASFSA_INPUT: Partial<GroupFlowInput> = {
  groupId: "fsadfdasfsa",
  mates: [{ projectId: "p-juno", name: "Juno", preview: undefined, waiting: false, talked: true }],
  merged: [pull({ number: 4, merged: true, mateProjectId: "p-juno" })],
  stops: [
    {
      projectId: "p-prod",
      name: "production",
      tier: "production",
      row: undefined,
      deployment: {
        state: "known",
        value: { kind: "none" },
        asOf: { ordinal: 1, atMs: 0 },
        coverage: "complete",
        freshness: { kind: "live" },
      },
      route: undefined,
    },
  ],
  release: { gate: { allowed: true }, suggestion: "v0.1.0", waiting: 1 },
  mainHasCode: true,
};
const FSADFDASFSA = flow(FSADFDASFSA_INPUT);

describe("mateNextStep", () => {
  it("offers the Mate's own mergeable pull request first (sm-fixture)", () => {
    expect(mateNextStep({ group: SM_FIXTURE, mateProjectId: "p-wren", mateName: "Wren" })).toEqual({
      kind: "merge",
      pull: pull(),
      title: "Wren is waiting on you to merge #1.",
      verb: "Merge",
      running: "Merging…",
    });
  });

  it("offers the release where its project has merged work that is not live (fsadfdasfsa)", () => {
    expect(mateNextStep({ group: FSADFDASFSA, mateProjectId: "p-juno", mateName: "Juno" })).toEqual(
      {
        kind: "release",
        tag: "v0.1.0",
        waiting: 1,
        title: "Release v0.1.0 to production",
        verb: "Release v0.1.0",
        running: "Releasing…",
      },
    );
  });

  it("offers the release that might clear a failed production deploy, not nothing", () => {
    const failed = flow({
      ...FSADFDASFSA_INPUT,
      stops: [
        {
          projectId: "p-prod",
          name: "production",
          tier: "production",
          row: environmentRow({
            projectId: "p-prod",
            name: "production",
            tier: "production",
            sources: "release",
            environment: "production",
            services: [
              {
                hostname: "app",
                appVersionName: MAIN_SHA,
                statuses: [{ context: "mate/deploy/production/app", state: "failure" }],
              },
            ],
          }),
          deployment: {
            state: "known",
            value: { kind: "running", activatedAt: null, version: deployedVersion(MAIN_SHA) },
            asOf: { ordinal: 1, atMs: 0 },
            coverage: "complete",
            freshness: { kind: "live" },
          },
          route: undefined,
        },
      ],
    });
    expect(mateNextStep({ group: failed, mateProjectId: "p-juno", mateName: "Juno" })).toEqual({
      kind: "release",
      tag: "v0.1.0",
      waiting: 1,
      title: "Release v0.1.0 to production",
      verb: "Release v0.1.0",
      running: "Releasing…",
    });
  });

  it("offers adding production once the merge has landed on main (sm-fixture, after #1)", () => {
    const landed = flow({
      groupId: "sm-fixture",
      mates: [
        { projectId: "p-wren", name: "Wren", preview: undefined, waiting: false, talked: true },
      ],
      merged: [pull({ merged: true })],
      missing: [{ tier: "production" }],
      mainHasCode: true,
    });
    expect(mateNextStep({ group: landed, mateProjectId: "p-wren", mateName: "Wren" })).toEqual({
      kind: "add-production",
      title: "main has code, no production yet",
      detail: "Add it from the project's recipe; releases go there.",
      verb: "Add production",
    });
  });

  /** `testzcp`: Rune talked, opened nothing, and nothing is merged. */
  const TESTZCP = flow({
    groupId: "testzcp",
    mates: [
      { projectId: "p-rune", name: "Rune", preview: undefined, waiting: false, talked: true },
    ],
    missing: [{ tier: "production" }],
    mainHasCode: false,
  });

  it.each([
    { case: "a Mate with nothing merged yet (testzcp)", group: TESTZCP, mate: "p-rune" },
    { case: "another Mate's change", group: flow({ pullRequests: [pull()] }), mate: "p-juno" },
    {
      case: "its own change that does not merge",
      group: flow({ pullRequests: [pull({ mergeable: false, checks: "failing" })] }),
      mate: "p-wren",
    },
    {
      case: "a recipe change of its own",
      group: flow({ pullRequests: [pull({ repository: "group", kind: "recipe" })] }),
      mate: "p-wren",
    },
    {
      case: "merged work the person may not release",
      group: flow({
        ...FSADFDASFSA_INPUT,
        release: {
          gate: { allowed: false, reason: "Only releasers can tag." },
          suggestion: "v0.1.0",
          waiting: 1,
        },
      }),
      mate: "p-juno",
    },
    { case: "a project not read yet", group: undefined, mate: "p-wren" },
    { case: "a conversation that is no Mate's", group: SM_FIXTURE, mate: undefined },
  ])("offers nothing for $case", ({ group, mate }) => {
    expect(mateNextStep({ group, mateProjectId: mate, mateName: "Wren" })).toEqual({
      kind: "none",
    });
  });

  it("names the Mate as this Mate where its name is not known", () => {
    const step = mateNextStep({ group: SM_FIXTURE, mateProjectId: "p-wren", mateName: undefined });
    expect(step.kind === "merge" ? step.title : undefined).toBe(
      "This Mate is waiting on you to merge #1.",
    );
  });

  it("asks for its own merge before the release of what is already merged", () => {
    const both = flow({
      ...FSADFDASFSA_INPUT,
      pullRequests: [pull({ number: 5, mateProjectId: "p-juno" })],
    });
    expect(mateNextStep({ group: both, mateProjectId: "p-juno", mateName: "Juno" })).toMatchObject({
      kind: "merge",
      title: "Juno is waiting on you to merge #5.",
    });
  });
});
