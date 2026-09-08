import { describe, expect, it } from "@effect/vitest";

import { commandAdmissionError } from "./commands.ts";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  ZeropsServiceId,
  type AccessState,
  type AccountScope,
  type ServiceRef,
} from "./types.ts";

const account = {
  apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
  accountId: ZeropsAccountId.make("account-a"),
};
const scope: AccountScope = { account, epoch: AccountEpoch.make(3) };
const project = {
  kind: "project" as const,
  organization: {
    kind: "organization" as const,
    account,
    organizationId: ZeropsOrganizationId.make("org-a"),
  },
  projectId: ZeropsProjectId.make("project-a"),
};
const service: ServiceRef = {
  kind: "service",
  project,
  serviceId: ZeropsServiceId.make("service-a"),
};

const verified = (overrides: Partial<Extract<AccessState, { status: "verified" }>> = {}) =>
  ({
    status: "verified",
    account,
    accountEpoch: scope.epoch,
    verifiedAtMs: 100,
    deadlineMs: 1_000,
    mutationsAllowed: true,
    organizations: [{ organization: project.organization, mutationsAllowed: true }],
    projects: [{ project, role: "ADMIN", mutationsAllowed: true }],
    ...overrides,
  }) satisfies AccessState;

describe("commandAdmissionError", () => {
  it("admits a current project-scoped grant", () => {
    expect(commandAdmissionError(scope, verified(), service, 999)).toBeNull();
  });

  it("rejects an expired grant at the execution clock", () => {
    expect(commandAdmissionError(scope, verified(), service, 1_000)?.reason).toBe("access-expired");
  });

  it("rejects a stale account epoch even if the API client object is reused", () => {
    expect(
      commandAdmissionError(
        scope,
        verified({ accountEpoch: AccountEpoch.make(2), deadlineMs: 10_000 }),
        service,
        500,
      )?.reason,
    ).toBe("access-expired");
  });

  it("requires an effective project mutation grant", () => {
    expect(commandAdmissionError(scope, verified({ projects: [] }), service, 500)?.reason).toBe(
      "access-denied",
    );
  });

  it("does not reuse a same-ID grant from another organization", () => {
    const foreignProject = {
      ...project,
      organization: {
        ...project.organization,
        organizationId: ZeropsOrganizationId.make("org-b"),
      },
    };
    expect(
      commandAdmissionError(
        scope,
        verified({
          projects: [{ project: foreignProject, role: "ADMIN", mutationsAllowed: true }],
        }),
        service,
        500,
      )?.reason,
    ).toBe("access-denied");
  });

  it("rejects when mutations are disallowed at the account level despite an admitted project", () => {
    expect(
      commandAdmissionError(scope, verified({ mutationsAllowed: false }), service, 500)?.reason,
    ).toBe("access-denied");
  });

  it("rejects writes for a verifying grant even with a usable previous grant", () => {
    const previous = verified() as Extract<AccessState, { status: "verified" }>;
    expect(
      commandAdmissionError(
        scope,
        { status: "verifying", accountEpoch: scope.epoch, previous },
        service,
        500,
      )?.reason,
    ).toBe("access-unverified");
  });

  it("rejects writes for a failed grant even with a usable previous grant", () => {
    const previous = verified() as Extract<AccessState, { status: "verified" }>;
    expect(
      commandAdmissionError(
        scope,
        {
          status: "failed",
          accountEpoch: scope.epoch,
          failedAtMs: 500,
          retryable: true,
          reason: "network",
          previous,
          mutationsAllowed: false,
        },
        service,
        500,
      )?.reason,
    ).toBe("access-unverified");
  });

  it("requires the exact organization capability for account-level creation", () => {
    expect(commandAdmissionError(scope, verified(), project.organization, 500)).toBeNull();
    expect(
      commandAdmissionError(
        scope,
        verified({
          organizations: [
            {
              organization: {
                ...project.organization,
                organizationId: ZeropsOrganizationId.make("org-b"),
              },
              mutationsAllowed: true,
            },
          ],
        }),
        project.organization,
        500,
      )?.reason,
    ).toBe("access-denied");
  });
});
