import {
  parseZeropsRegistry,
  ZeropsApiError,
  type ZeropsApiClient,
  type ZeropsIntegrationToken,
} from "@t3tools/client-runtime/zerops";
import type { BirthRecord } from "@t3tools/client-runtime/zerops/birth";
import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  makeZeropsApiOrigin,
  type ProjectRef,
} from "@t3tools/client-runtime/zerops/data";
import { describe, expect, it } from "vite-plus/test";

import { birthStepFailure, webBirthPorts, type BirthInputs } from "./zeropsBirths";

const projectRef = (organizationId: string, projectId: string): ProjectRef => ({
  kind: "project",
  organization: {
    kind: "organization",
    account: {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account"),
    },
    organizationId: ZeropsOrganizationId.make(organizationId),
  },
  projectId: ZeropsProjectId.make(projectId),
});

/** A birth begun in org-1: a Mate in the group `group-1` of org-1's registry. */
const birth: BirthRecord = {
  projectId: "project-1",
  organizationId: "org-1",
  startedAt: 1_800_000_000_000,
  step: "tags",
  overdue: false,
  registration: {
    giteaProjectId: "gitea-1",
    giteaOrigin: null,
    groupId: "group-1",
    kind: "mate",
    displayName: "Todo - Vera",
  },
  container: true,
  serviceId: null,
  origin: null,
  handoff: null,
};

function fakeClient(calls: Array<string>) {
  let tagList: ReadonlyArray<string> = ["mate:tool:gitea", "mate:gn:group-1:todo"];
  const broker: ZeropsIntegrationToken = { id: "broker-1", name: "mate-broker", projects: [] };
  return {
    readGroupRegistry: async (giteaProjectId: string) => {
      calls.push(`read registry of ${giteaProjectId}`);
      return parseZeropsRegistry(tagList);
    },
    writeGroupRegistry: async (input: {
      readonly giteaProjectId: string;
      readonly tagList: ReadonlyArray<string>;
    }) => {
      calls.push(`write registry of ${input.giteaProjectId}`);
      tagList = input.tagList;
    },
    listIntegrationTokens: async (clientId: string) => {
      calls.push(`list tokens of ${clientId}`);
      return [broker];
    },
    setIntegrationTokenProjects: async (input: {
      readonly clientId: string;
      readonly projects: ReadonlyArray<{ readonly projectId: string }>;
    }) => {
      calls.push(
        `grant ${input.projects.map((project) => project.projectId).join(",")} in ${input.clientId}`,
      );
    },
  } as unknown as ZeropsApiClient;
}

describe("the birth's ports", () => {
  it("org switch after create-accepted still finishes tags and registry", async () => {
    const calls: Array<string> = [];
    // The tab has since switched to org-2; the ports read nothing of what it has open.
    const inputs = {
      client: fakeClient(calls),
      projectRef,
    } as unknown as BirthInputs;
    const ports = webBirthPorts(() => inputs);

    expect(await ports.writeTags(birth)).toEqual({ kind: "done" });
    expect(await ports.writeRegistry(birth)).toEqual({ kind: "done" });
    expect(calls).toEqual([
      "read registry of gitea-1",
      "write registry of gitea-1",
      "list tokens of org-1",
      "grant project-1 in org-1",
    ]);

    // Run again — a reload between the writes — it writes nothing twice.
    calls.length = 0;
    expect(await ports.writeTags(birth)).toEqual({ kind: "done" });
    expect(calls).toEqual(["read registry of gitea-1"]);
  });
});

describe("birthStepFailure", () => {
  const admission = (reason: string) => ({
    _tag: "ZeropsCommandAdmissionError",
    reason,
    message: "Platform write access is not verified.",
  });
  const adapter = (kind: string, retryable: boolean) => ({
    _tag: "ZeropsDataAdapterError",
    kind,
    message: "The platform said no.",
    retryable,
    accountRevocationEvidence: false,
  });
  // Only what a later attempt can get past is waited out: the account mid-verification or between
  // grants, a busy runtime, the platform not caught up, the network. An answer is an answer.
  it.each([
    {
      name: "the account mid-verification",
      cause: admission("access-unverified"),
      want: "not-yet",
    },
    { name: "the account between grants", cause: admission("access-expired"), want: "not-yet" },
    { name: "a full command queue", cause: admission("command-capacity"), want: "not-yet" },
    { name: "a denial", cause: admission("access-denied"), want: "failed" },
    { name: "a closed runtime", cause: admission("runtime-closed"), want: "failed" },
    { name: "variables not caught up", cause: adapter("uncertain", false), want: "not-yet" },
    { name: "a retryable adapter failure", cause: adapter("server", true), want: "not-yet" },
    { name: "a refused adapter write", cause: adapter("forbidden", false), want: "failed" },
    {
      name: "the network",
      cause: new ZeropsApiError("Could not reach Zerops.", "network"),
      want: "not-yet",
    },
    {
      name: "a refused API write",
      cause: new ZeropsApiError("Only owners write tags.", "forbidden"),
      want: "failed",
    },
  ])("$name: $want", ({ cause, want }) => {
    expect(birthStepFailure(cause).kind).toBe(want);
  });
});
