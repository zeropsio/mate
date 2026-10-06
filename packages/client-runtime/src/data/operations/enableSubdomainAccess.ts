/**
 * Opening a service to the internet, at Zerops: its subdomain asked for. Zerops's answer ends it;
 * the service's row saying `subdomainAccess` reflects it and, after a lost answer, adopts it.
 *
 * @module data/operations/enableSubdomainAccess
 */
import type { OperationKind } from "./kind.ts";
import { shownInFacts } from "./shownInFacts.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "enable-subdomain-access": {
      readonly orgId: string;
      readonly projectId: string;
      readonly serviceId: string;
    };
  }
}

export const enableSubdomainAccess: OperationKind<"enable-subdomain-access"> = {
  kind: "enable-subdomain-access",
  executor: "zerops",
  ...shownInFacts(
    (intent) => intent.serviceId,
    (read, intent) => {
      const service = read.fact("service", intent.serviceId);
      return service.kind === "known" && service.value.subdomainAccess === true;
    },
  ),
};
