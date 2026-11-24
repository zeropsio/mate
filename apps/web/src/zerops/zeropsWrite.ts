/**
 * A Zerops write a surface asks for, as one of the account's operations: submitted in the open
 * organization, resolved once Zerops took it, rejected with what to tell the person. Nothing here
 * waits for the write's end; a surface that follows it reads the operation's progress.
 */
import type { OperationProgress } from "@t3tools/client-runtime/data";

import { mateServicesToWrite } from "@t3tools/client-runtime/zerops/mateState";

import type { AccountOperations } from "./accountOperations";

type Intent = Parameters<AccountOperations["submit"]>[0];

/** An intent of the open organization: its `orgId` is the account's to add. */
export type ZeropsWrite = Intent extends infer Each
  ? Each extends { readonly orgId: string }
    ? Omit<Each, "orgId">
    : never
  : never;

/** The client's own text for a write whose answer was lost: the same words, whoever lost it. */
const MAY_HAVE_LANDED =
  "Zerops may have accepted this operation, but its response was lost. Check the project and its services before starting another operation.";

/** What the person is told of a write Zerops did not take, or ended failed; `null` otherwise. */
export function writeTrouble(progress: OperationProgress, evidence: string | null): string | null {
  switch (progress.stage) {
    case "refused":
      return progress.reason;
    case "unsent":
      return progress.reason ?? "Zerops did not take the change. Try again.";
    case "uncertain":
      return MAY_HAVE_LANDED;
    case "unresolved":
      return `${progress.nextAction ?? "Check it in Zerops"}.`;
    case "done":
      return progress.outcome === "succeeded"
        ? null
        : (progress.reason ?? evidence ?? "Zerops could not do it.");
    default:
      return null;
  }
}

export async function submitZeropsWrite(
  operations: AccountOperations,
  orgId: string | null,
  write: ZeropsWrite,
): Promise<{ readonly requestId: string; readonly progress: OperationProgress }> {
  if (orgId === null) throw new Error("No organization is open.");
  const { requestId, progress, evidence } = await operations.submit({
    ...write,
    orgId,
  } as Intent);
  const trouble = writeTrouble(progress, evidence);
  if (trouble !== null) throw new Error(trouble);
  return { requestId, progress };
}

/**
 * One service write per service, in order (`mateServicesToWrite`), each its own operation: the
 * first one Zerops does not take ends it, said as its refusal, and the rest stay unsent.
 */
export async function submitServiceWrites(
  operations: AccountOperations,
  orgId: string | null,
  kind: "stop-service" | "start-service",
  projectId: string,
  serviceIds: ReadonlyArray<string>,
): Promise<void> {
  for (const serviceId of serviceIds)
    await submitZeropsWrite(operations, orgId, { kind, projectId, serviceId });
}

/** A Mate as its Stop and Start need it: its project, and its container where it has one. */
interface MateTarget {
  readonly project: { readonly id: string; readonly status: string };
  readonly service?: { readonly id: string } | undefined;
}

type ProjectServiceList = Parameters<typeof mateServicesToWrite>[1] | undefined;

/** What a Stop or Start writes: its project's services as read, or its container alone before. */
const mateServiceIds = (
  verb: "stop" | "start",
  mate: MateTarget,
  services: ProjectServiceList,
): ReadonlyArray<string> => {
  const ids = services === undefined ? [] : mateServicesToWrite(verb, services);
  return ids.length > 0 || mate.service === undefined ? ids : [mate.service.id];
};

/** A Mate's Start: a STOPPED project starts whole; in a running one, every stopped service of it. */
export async function startMate(
  operations: AccountOperations,
  orgId: string | null,
  mate: MateTarget,
  services: ProjectServiceList,
): Promise<void> {
  const projectId = mate.project.id;
  if (mate.project.status === "STOPPED")
    await submitZeropsWrite(operations, orgId, { kind: "start-project", projectId });
  else
    await submitServiceWrites(
      operations,
      orgId,
      "start-service",
      projectId,
      mateServiceIds("start", mate, services),
    );
}

/** A Mate's Stop: every running service of its project, its container last. */
export function stopMate(
  operations: AccountOperations,
  orgId: string | null,
  mate: MateTarget,
  services: ProjectServiceList,
): Promise<void> {
  return submitServiceWrites(
    operations,
    orgId,
    "stop-service",
    mate.project.id,
    mateServiceIds("stop", mate, services),
  );
}
