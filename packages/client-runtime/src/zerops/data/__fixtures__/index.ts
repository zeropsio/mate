import {
  AccountEpoch,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProcessId,
  ZeropsProjectId,
  ZeropsServiceId,
  makeZeropsApiOrigin,
  type AccountRef,
  type AccountScope,
  type ProjectRef,
  type ServiceRef,
  type ProcessRef,
} from "../types.ts";
export const account: AccountRef = {
  apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
  accountId: ZeropsAccountId.make("account-1"),
};

export const scope = (epoch = 1): AccountScope => ({ account, epoch: AccountEpoch.make(epoch) });

export const organization = {
  kind: "organization" as const,
  account,
  organizationId: ZeropsOrganizationId.make("org-1"),
};

export const project = (id = "project-1"): ProjectRef => ({
  kind: "project",
  organization,
  projectId: ZeropsProjectId.make(id),
});

export const service = (id = "service-1", owner = project()): ServiceRef => ({
  kind: "service",
  project: owner,
  serviceId: ZeropsServiceId.make(id),
});

export const process = (id = "process-1", owner = project()): ProcessRef => ({
  kind: "process",
  project: owner,
  processId: ZeropsProcessId.make(id),
});
