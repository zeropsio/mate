import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  makeZeropsApiOrigin,
  type AccountRef,
  type ProjectRef,
} from "../types.ts";
const account: AccountRef = {
  apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
  accountId: ZeropsAccountId.make("account-1"),
};

const organization = {
  kind: "organization" as const,
  account,
  organizationId: ZeropsOrganizationId.make("org-1"),
};

export const project = (id = "project-1"): ProjectRef => ({
  kind: "project",
  organization,
  projectId: ZeropsProjectId.make(id),
});
