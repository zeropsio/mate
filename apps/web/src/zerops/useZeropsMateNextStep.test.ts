import { describe, expect, it } from "vite-plus/test";

import {
  formatGroupTag,
  formatRoleTag,
  mateNextStep,
  type FlowPullRequest,
  type ZeropsEnvironmentRole,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";

import type { EnvironmentRow } from "@t3tools/client-runtime/zerops";
import type { ZeropsProjectFlow } from "./projectFlowContext";
import { zeropsMateGroupFlow } from "./useZeropsMateNextStep";

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
    mergeability: "mergeable",
    merged: false,
    mergedAt: undefined,
    headSha: "abc",
    baseBranch: "main",
    line: "app #1",
    updatedAt: undefined,
    ...over,
  };
}

function environmentRow(over: Partial<EnvironmentRow> = {}): EnvironmentRow {
  return {
    kind: "environment",
    projectId: "p-prod",
    name: "production",
    tier: "production",
    source: "release",
    commit: undefined,
    version: {
      name: undefined,
      commit: undefined,
      sha: undefined,
      taggedBy: undefined,
      label: undefined,
    },
    versionRepository: undefined,
    line: "",
    tone: "neutral",
    ...over,
  };
}

function projectFlow(over: Partial<ZeropsProjectFlow> = {}): ZeropsProjectFlow {
  return {
    groupId: "g",
    slug: "g-org",
    declarations: [],
    environments: [],
    environmentInputs: [],
    mainHeads: new Map(),
    missing: [],
    pullRequests: [],
    merged: [],
    releases: [],
    release: {
      gate: { allowed: false, reason: "Nothing is merged to release." },
      suggestion: "v0.1.0",
      comparison: [],
      entries: [],
      inFlight: undefined,
      target: undefined,
      contents: [],
    },
    ...over,
  };
}

const DEPLOYMENTS = new Map<string, Shown<Deployment>>();

function project(id: string, role: ZeropsEnvironmentRole): ZeropsProject {
  return {
    id,
    name: `Links - ${role}`,
    status: "ACTIVE",
    tagList: [formatGroupTag("g"), formatRoleTag(role)],
  };
}

function mateGroupFlow(
  flow: ZeropsProjectFlow,
  projects: ReadonlyArray<ZeropsProject>,
  mayCreate: boolean,
) {
  return zeropsMateGroupFlow({
    groupId: "g",
    projects,
    projectFlow: flow,
    deployments: DEPLOYMENTS,
    mayCreate,
  });
}

describe("zeropsMateGroupFlow", () => {
  it("offers this Mate's own mergeable pull request first", () => {
    const flow = projectFlow({ pullRequests: [pull()] });
    const group = mateGroupFlow(flow, [project("p-wren", "dev")], false);
    expect(mateNextStep({ group, mateProjectId: "p-wren", mateName: "Wren" })).toMatchObject({
      kind: "merge",
      title: "Wren is waiting on you to merge #1.",
    });
  });

  it("offers the release once merged work is not live on a real production", () => {
    const flow = projectFlow({
      merged: [pull({ merged: true })],
      environments: [environmentRow()],
      release: {
        gate: { allowed: true },
        suggestion: "v0.2.0",
        comparison: [],
        entries: [],
        inFlight: undefined,
        target: undefined,
        contents: [{ service: "app", commits: [{ sha: "a".repeat(40), subject: "Add a field" }] }],
      },
    });
    const group = mateGroupFlow(flow, [project("p-wren", "dev"), project("p-prod", "prod")], false);
    expect(mateNextStep({ group, mateProjectId: "p-wren", mateName: "Wren" })).toEqual({
      kind: "release",
      tag: "v0.2.0",
      waiting: 1,
      title: "Release v0.2.0 to production",
      verb: "Release v0.2.0",
      running: "Releasing…",
    });
  });

  it("offers adding production once main has code and the viewer may create one", () => {
    const flow = projectFlow({
      merged: [pull({ merged: true })],
      missing: [
        {
          kind: "missing-environment",
          tier: "production",
          name: "Production",
          line: "not set up yet",
        },
      ],
    });
    const group = mateGroupFlow(flow, [project("p-wren", "dev")], true);
    expect(mateNextStep({ group, mateProjectId: "p-wren", mateName: "Wren" })).toEqual({
      kind: "add-production",
      title: "main has code, no production yet",
      detail: "Add it from the project's recipe; releases go there.",
      verb: "Add production",
    });
  });

  it("withholds adding production where this viewer may not create one", () => {
    const flow = projectFlow({
      merged: [pull({ merged: true })],
      missing: [
        {
          kind: "missing-environment",
          tier: "production",
          name: "Production",
          line: "not set up yet",
        },
      ],
    });
    const group = mateGroupFlow(flow, [project("p-wren", "dev")], false);
    expect(mateNextStep({ group, mateProjectId: "p-wren", mateName: "Wren" })).toEqual({
      kind: "none",
    });
  });

  it("agrees with the page: a production nobody declared still stops Add production", () => {
    // The recipe on `main` offers a production and no declared environment
    // fills it, so `missing` still lists the tier; but the group already has
    // a project tagged prod, so the page neither offers the role nor treats
    // production as absent. The thread reads the same projects.
    const flow = projectFlow({
      merged: [pull({ merged: true })],
      missing: [
        {
          kind: "missing-environment",
          tier: "production",
          name: "Production",
          line: "not set up yet",
        },
      ],
    });
    const group = mateGroupFlow(flow, [project("p-wren", "dev"), project("p-prod", "prod")], true);
    expect(group.production.kind).not.toBe("absent");
    expect(mateNextStep({ group, mateProjectId: "p-wren", mateName: "Wren" })).toEqual({
      kind: "none",
    });
  });
});
