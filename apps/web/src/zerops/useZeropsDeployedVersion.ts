/**
 * What a service actually runs, read once through the account's runtime.
 *
 * The sha is the first token of the deployed version's name (`groupDeploys.ts`,
 * measured 2026-09-16), and it is the only proof of what an environment runs —
 * a branch head is what *should* be there. Two screens need it: the projects
 * screen, which shows every group's environments, and a Mate's Git tab, whose
 * *Release* compares the stage against production. They share this reader
 * rather than each holding a read of their own, so a group is read the same way
 * wherever it is shown.
 *
 * A read that fails answers nothing, which is a row without a commit rather
 * than a row that lies.
 */
import type {
  ZeropsResourceBroker,
  ZeropsResourceRequest,
  ZeropsResourceValue,
} from "@t3tools/client-runtime/zerops/data";
import { ZeropsServiceId } from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import { useCallback } from "react";

import { useZeropsData } from "./zeropsDataContext";
import { useZeropsSession } from "./ZeropsSessionProvider";

/**
 * A one-shot action demand owns its lease until the resource settles, or
 * until `signal` aborts — an unmount abandoning the flow releases the lease
 * immediately instead of holding it until the read finally settles.
 */
export function readZeropsResourceOnce<Request extends ZeropsResourceRequest>(
  resources: ZeropsResourceBroker,
  request: Request,
  signal?: AbortSignal,
): Promise<ZeropsResourceValue<Request> | undefined> {
  return Effect.runPromise(
    Effect.scoped(
      resources.acquire(request).pipe(
        Effect.flatMap((lease) => lease.awaitSettled),
        Effect.map((snapshot) => (snapshot.status === "success" ? snapshot.value : undefined)),
        Effect.orElseSucceed(() => undefined),
      ),
    ),
    signal === undefined ? undefined : { signal },
  ).catch(() => undefined);
}

/** Reads one service's deployed version name, in the account's scope. */
export type ZeropsDeployedVersionReader = (
  projectId: string,
  serviceId: string,
  signal: AbortSignal,
) => Promise<string | undefined>;

export function useZeropsDeployedVersionReader(): ZeropsDeployedVersionReader {
  const { activeOrganization } = useZeropsSession();
  const { projectRef, runtime } = useZeropsData();
  return useCallback(
    async (projectId: string, serviceId: string, signal: AbortSignal) => {
      if (activeOrganization === null) return undefined;
      return readZeropsResourceOnce(
        runtime.resources,
        {
          kind: "service-deployed-version",
          account: runtime.scope,
          service: {
            kind: "service",
            project: projectRef(activeOrganization.id, projectId),
            serviceId: ZeropsServiceId.make(serviceId),
          },
        },
        signal,
      );
    },
    [activeOrganization, projectRef, runtime.resources, runtime.scope],
  );
}
