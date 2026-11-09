/**
 * Creating the services a project lacks, at Zerops (`POST /project/{id}/service-stack/import`),
 * followed to its end: the import answers with each service's processes, which are the
 * operation's handles and say how each creation ended. A second import is refused for the
 * hostnames the first made, so a lost answer stays uncertain — never sent again.
 *
 * @module data/operations/createServices
 */
import { processFailureWords } from "../../zerops/activity/dto.ts";
import type { OperationKind } from "./kind.ts";
import { historyHolding, reflectedByProcess, settledByProcess } from "./processEnd.ts";

/** What Zerops answered an accepted creation with. */
export interface CreateServicesResult {
  /** When Zerops took the import, by this client's clock: what its elapsed time counts from. */
  readonly acceptedAtMs: number;
  /** Each service it began creating, with the processes bringing it up. */
  readonly services: ReadonlyArray<{
    readonly hostname: string;
    readonly serviceId: string;
    readonly processIds: ReadonlyArray<string>;
  }>;
}

declare module "../model.ts" {
  interface OperationIntents {
    readonly "create-services": {
      /** The organization whose link observes the project's processes. */
      readonly orgId: string;
      readonly projectId: string;
      /** The import that creates them, as HQ's plan settles each. */
      readonly yaml: string;
    };
  }
  interface OperationResults {
    readonly "create-services": CreateServicesResult;
  }
}

export const createServices: OperationKind<"create-services"> = {
  kind: "create-services",
  executor: "zerops",
  reflected: (read, _intent, receipt) => reflectedByProcess(read, receipt),
  settledBy: (read, _intent, receipt) => {
    const created =
      receipt.acceptance.kind === "accepted"
        ? (receipt.acceptance.result as CreateServicesResult | undefined)?.services
        : undefined;
    return settledByProcess(read, receipt, (process) => {
      const hostname = created?.find((service) => service.processIds.includes(process.id));
      const words = processFailureWords(process)?.replace(/[.\s]+$/u, "");
      const what = `Zerops could not create ${hostname?.hostname ?? "a service"}`;
      return words === undefined || words === "" ? `${what}.` : `${what}: ${words}.`;
    });
  },
  observedIn: (intent, receipt) => historyHolding(intent.projectId, receipt),
};
