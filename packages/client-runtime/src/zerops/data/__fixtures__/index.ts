import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  ZeropsServiceId,
  makeZeropsApiOrigin,
  type AccountRef,
  type ProjectRef,
  type ServiceRef,
} from "../types.ts";
export const account: AccountRef = {
  apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
  accountId: ZeropsAccountId.make("account-1"),
};

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
