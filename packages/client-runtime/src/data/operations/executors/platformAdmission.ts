/** Write admission belongs to the executor and reads the current access projection. */
import * as Effect from "effect/Effect";
import { platformCapabilities } from "../../projections/platformCapabilities.ts";
import type { ZeropsOrganization } from "../../../zerops/api.ts";
import { platformAccess } from "../../projections/platformAccess.ts";
import type { OperationIntent } from "../../model.ts";
import type { AccountStore } from "../../store.ts";
import { readsOfState } from "../../store.ts";
import type { DetailDemand } from "../../demand.ts";
import type { StreamFault } from "../../streamMachine.ts";
import { mateKeyRetirementAllowed } from "../mateDeletion.ts";

export function admitPlatformOperation(input: {
  readonly intent: OperationIntent;
  readonly store: AccountStore;
  readonly viewer: ZeropsOrganization | undefined;
  readonly active: () => boolean;
  readonly readDetail: (demand: DetailDemand) => Promise<boolean>;
}): Effect.Effect<void, StreamFault> {
  const refused = (message: string) =>
    Effect.fail<StreamFault>({ outcome: "definitive-refusal", message });
  return Effect.gen(function* () {
    if (!input.active()) return yield* refused("This Zerops sign-in has ended.");
    const { intent, viewer } = input;
    const capabilities = (projectId?: string) =>
      platformCapabilities.derive(readsOfState(input.store.state()), {
        orgId: viewer?.id ?? "",
        projectId,
        viewer,
      });
    if (viewer === undefined) return yield* refused("Your Zerops access is still being checked.");
    if (
      (intent.kind === "assign-mate-owner" || intent.kind === "finish-mate-handover") &&
      !capabilities().manageOrganization
    )
      return yield* refused("An organization owner or admin must hand over this Mate.");
    // Who works on an app: the organization's to decide, by its owners and admins alone.
    if (
      intent.kind === "check-invitee" ||
      intent.kind === "invite-member" ||
      intent.kind === "resend-invitation" ||
      intent.kind === "set-app-access" ||
      intent.kind === "set-project-access"
    ) {
      if (viewer.id !== intent.orgId || !capabilities().manageOrganization)
        return yield* refused(
          intent.kind === "set-app-access" || intent.kind === "set-project-access"
            ? "Only an organization owner or admin can change who has access."
            : "Only an organization owner or admin can invite.",
        );
      return;
    }
    if (intent.kind === "set-org-role" || intent.kind === "remove-member") {
      if (viewer.id !== intent.orgId || !capabilities().manageOrganization)
        return yield* refused("Only an organization owner or admin can change the team.");
      return;
    }
    if (intent.kind === "retire-mate-key") {
      if (
        viewer.id !== intent.orgId ||
        !mateKeyRetirementAllowed(readsOfState(input.store.state()), intent)
      )
        return yield* refused(
          "The original deletion receipts must confirm this exact key before retirement.",
        );
      return;
    }
    if (
      intent.kind === "create-project" ||
      intent.kind === "import-project" ||
      // Its creator gives the project it just made its people, as a creation would have.
      intent.kind === "grant-new-project-access"
    ) {
      if (!capabilities().createProject)
        return yield* refused("Your role in this organization doesn't allow this.");
      return;
    }
    let projectId = "projectId" in intent ? intent.projectId : undefined;
    if (projectId === undefined && "serviceId" in intent) {
      let service = readsOfState(input.store.state()).fact("service", intent.serviceId);
      if (service.kind !== "known") {
        yield* Effect.promise(() =>
          input.readDetail({ family: "service", listing: "service", ownerId: intent.serviceId }),
        );
        service = readsOfState(input.store.state()).fact("service", intent.serviceId);
      }
      if (service.kind === "known") projectId = service.value.projectId;
    }
    if (projectId === undefined)
      return yield* refused("Your access to this project is still being checked.");
    const key = { orgId: viewer.id, projectId, viewer };
    const access = () => platformAccess.derive(readsOfState(input.store.state()), key);
    if (access().kind === "unknown")
      yield* Effect.promise(() =>
        input.readDetail({ family: "project", listing: "project", ownerId: projectId! }),
      );
    if (!input.active()) return yield* refused("This Zerops sign-in has ended.");
    const current = access();
    if (current.kind === "unknown")
      return yield* refused("Your access to this project is still being checked.");
    const needsAdmin =
      // Buying the project its own IPv4 spends the organization's credit: an admin's to do.
      intent.kind === "delete-project" ||
      intent.kind === "rename-project" ||
      intent.kind === "request-ipv4";
    if (
      current.kind !== "allowed" ||
      !(needsAdmin ? capabilities(projectId).administer : capabilities(projectId).operate)
    )
      return yield* refused("Your role in this project doesn't allow this.");
  });
}
