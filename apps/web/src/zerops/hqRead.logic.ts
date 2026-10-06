import type { HqNavigationView } from "../state/zerops";
import { hqDown } from "../state/zerops";
import type { AccountHq } from "./accountHq";

/**
 * Whether HQ's navigation of the organization has said what it will (unknown is not empty, but it
 * ends): its catchup ended, or HQ stopped answering, or the organization has no HQ to ask. Until
 * then, HQ's list can contradict an empty answer.
 */
export function hqNavigationSettled(input: {
  readonly organizationId: string | null;
  readonly accountHq: {
    readonly status: AccountHq["status"];
    readonly hq: Pick<AccountHq["hq"], "kind">;
  };
  readonly navigation: Pick<
    HqNavigationView,
    "orgId" | "read" | "live" | "reconnecting" | "capped" | "refusal"
  >;
}): boolean {
  if (input.organizationId === null) return true;
  if (input.accountHq.status === "failed") return true;
  if (input.accountHq.status === "ready" && input.accountHq.hq.kind !== "official") return true;
  return (
    input.navigation.orgId === input.organizationId &&
    (input.navigation.read === "read" || hqDown(input.navigation))
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
