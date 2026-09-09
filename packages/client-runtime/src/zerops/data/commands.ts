import type {
  AccessState,
  AccountRef,
  AccountScope,
  CommandAdmissionError,
  CommandTarget,
  PlatformCommandIntent,
  ProjectRef,
} from "./types.ts";
import { organizationKeyOf, projectKeyOf } from "./types.ts";

function sameAccount(left: AccountRef, right: AccountRef): boolean {
  return left.apiOrigin === right.apiOrigin && left.accountId === right.accountId;
}

function projectOf(target: CommandTarget): ProjectRef | null {
  return target.kind === "organization"
    ? null
    : target.kind === "project"
      ? target
      : target.project;
}

export function commandTarget(intent: PlatformCommandIntent): CommandTarget {
  switch (intent.kind) {
    case "restart-service":
    case "start-service":
    case "enable-zerops-mate":
    case "enable-subdomain-access":
      return intent.service;
    case "name-project-agent":
    case "update-project-group-tags":
    case "import-development-container":
    case "import-services":
    case "start-project":
      return intent.project;
    case "create-project":
    case "create-project-with-mate":
    case "import-project":
    case "create-tool-project":
    case "set-integration-token-projects":
      return intent.organization;
  }
}

function admissionError(
  reason: CommandAdmissionError["reason"],
  message: string,
): CommandAdmissionError {
  return { _tag: "ZeropsCommandAdmissionError", reason, message };
}

/**
 * Checks the grant used immediately before a platform write. Call this again
 * between writes in a multi-step command; admission at enqueue time is not a
 * durable authorization decision.
 */
export function commandAdmissionError(
  scope: AccountScope,
  access: AccessState,
  target: CommandTarget,
  nowMs: number,
): CommandAdmissionError | null {
  const project = projectOf(target);
  const account = target.kind === "organization" ? target.account : project!.organization.account;
  if (!sameAccount(scope.account, account)) {
    return admissionError("access-denied", "The command target belongs to another account.");
  }

  switch (access.status) {
    case "unverified":
    case "verifying":
    case "failed":
      return admissionError("access-unverified", "Platform write access is not verified.");
    case "expired":
      return admissionError("access-expired", "Platform write access has expired.");
    case "denied":
      return admissionError("access-denied", "Platform write access was denied.");
    case "verified": {
      if (
        access.accountEpoch !== scope.epoch ||
        !sameAccount(access.account, scope.account) ||
        access.deadlineMs <= nowMs
      ) {
        return admissionError("access-expired", "Platform write access is no longer current.");
      }
      const projectDenied =
        project !== null &&
        !access.projects.some(
          (entry) =>
            projectKeyOf(entry.project) === projectKeyOf(project) && entry.mutationsAllowed,
        );
      const organizationDenied =
        target.kind === "organization" &&
        !access.organizations.some(
          (entry) =>
            organizationKeyOf(entry.organization) === organizationKeyOf(target) &&
            entry.mutationsAllowed,
        );
      if (!access.mutationsAllowed || projectDenied || organizationDenied) {
        return admissionError("access-denied", "The current project role cannot perform writes.");
      }
      return null;
    }
  }
}
