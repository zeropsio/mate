import type { HqMatesView, HqStructureView } from "../state/zerops";
import type { AccountHq } from "./accountHq";

/** HQ's list can contradict an empty answer until its snapshot, absence, or failure is known. */
export function hqMatesSettled(input: {
  readonly organizationId: string | null;
  readonly accountHq: {
    readonly status: AccountHq["status"];
    readonly hq: Pick<AccountHq["hq"], "kind">;
  };
  readonly mates: Pick<HqMatesView, "organizationId" | "current"> | null;
  readonly structure: Pick<HqStructureView, "organizationId" | "unavailableSince"> | null;
}): boolean {
  if (input.organizationId === null) return true;
  if (input.accountHq.status === "failed") return true;
  if (input.accountHq.status === "ready" && input.accountHq.hq.kind !== "official") return true;
  return (
    (input.mates?.organizationId === input.organizationId && input.mates.current) ||
    (input.structure?.organizationId === input.organizationId &&
      input.structure.unavailableSince !== null)
  );
}

/** The reason a detail page cannot read its project from HQ, without another platform read. */
export function unreadFlowWords(input: {
  readonly failure: string | undefined;
  readonly groupsRead: boolean;
  readonly groupKnown: boolean;
}): string | null {
  if (input.failure !== undefined) return input.failure;
  if (input.groupsRead && !input.groupKnown) return "This project isn't here any more.";
  return null;
}
