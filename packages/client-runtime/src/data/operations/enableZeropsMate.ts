/**
 * Turning Zerops Mate on for a container, at Zerops: its `ZCP_MATE_ENABLED` flag written on, then
 * the container restarted (`ZeropsApiClient.enableZeropsMate`). Zerops's answer ends it; the
 * service's row reading the flag on, where it carries its variables, reflects it and, after a lost
 * answer, adopts it.
 *
 * @module data/operations/enableZeropsMate
 */
import { readsAsEnabled } from "../../zerops/api.ts";
import type { OperationKind } from "./kind.ts";
import { shownInFacts } from "./shownInFacts.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "enable-zerops-mate": {
      readonly orgId: string;
      readonly projectId: string;
      readonly serviceId: string;
    };
  }
}

const MATE_FLAG = "ZCP_MATE_ENABLED";

export const enableZeropsMate: OperationKind<"enable-zerops-mate"> = {
  kind: "enable-zerops-mate",
  executor: "zerops",
  ...shownInFacts(
    (intent) => intent.serviceId,
    (read, intent) => {
      const service = read.fact("service", intent.serviceId);
      if (service.kind !== "known") return false;
      const flag = service.value.userData?.find((entry) => entry.key === MATE_FLAG)?.content;
      return typeof flag === "string" && readsAsEnabled(flag);
    },
  ),
};
