/**
 * What a service actually runs, as the account's store states it.
 *
 * The sha is the commit the deployed version's name spells (`versionName.ts`,
 * measured 2026-09-16), named only while it is the active version's (A14),
 * and it is the only proof of what an environment runs —
 * a branch head is what *should* be there. Two screens need it: the projects
 * screen, which shows every group's environments, and a Mate's Git tab, whose
 * *Release* compares the stage against production. They share this reader
 * rather than each holding a read of their own, so a group is read the same way
 * wherever it is shown.
 *
 * A read that fails rejects: the flow keeps the version it read last rather
 * than a row that says nothing is there.
 */
import type {
  ZeropsResourceBroker,
  ZeropsResourceRequest,
  ZeropsResourceValue,
} from "@t3tools/client-runtime/zerops/data";
import {
  readDeployedVersion,
  settledValue,
  ZeropsServiceId,
} from "@t3tools/client-runtime/zerops/data";
import { RegistryContext } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import { useCallback, useContext } from "react";

import { useZeropsData } from "./zeropsDataContext";
import { useZeropsSession } from "./ZeropsSessionProvider";

/**
 * A one-shot action demand owns its lease until the resource settles, or
 * until `signal` aborts — an unmount abandoning the flow releases the lease
 * immediately instead of holding it until the read finally settles. Rejects
 * unless the read that settled it succeeded: a failure, a withholding, or a
 * value whose revalidation failed.
 */
export function readZeropsResource<Request extends ZeropsResourceRequest>(
  resources: ZeropsResourceBroker,
  request: Request,
  signal?: AbortSignal,
): Promise<ZeropsResourceValue<Request>> {
  return Effect.runPromise(
    Effect.scoped(resources.acquire(request).pipe(Effect.flatMap((lease) => lease.awaitSettled))),
    signal === undefined ? undefined : { signal },
  ).then((shown) => {
    const answer = settledValue(shown);
    if (answer !== null) return answer.value;
    throw new Error(`The ${request.kind} read did not succeed (${shown.state}).`);
  });
}

/** {@link readZeropsResource} for a caller that treats a failed read as no answer. */
export function readZeropsResourceOnce<Request extends ZeropsResourceRequest>(
  resources: ZeropsResourceBroker,
  request: Request,
  signal?: AbortSignal,
): Promise<ZeropsResourceValue<Request> | undefined> {
  return readZeropsResource(resources, request, signal).catch(() => undefined);
}

/**
 * The name of the version one service runs, as the account's store states it (`readDeployedVersion`):
 * the organization's versions and variables are streamed, so nothing is read for it. Rejects when
 * the store could not say. `undefined` when nothing names what runs there.
 */
export type ZeropsDeployedVersionReader = (
  projectId: string,
  serviceId: string,
  signal: AbortSignal,
) => Promise<string | undefined>;

export function useZeropsDeployedVersionReader(): ZeropsDeployedVersionReader {
  const { activeOrganization } = useZeropsSession();
  const { projectRef, runtime } = useZeropsData();
  const atoms = useContext(RegistryContext);
  return useCallback(
    async (projectId: string, serviceId: string, signal: AbortSignal) => {
      if (activeOrganization === null) throw new Error("No organization is chosen.");
      const deployed = await readDeployedVersion(
        runtime,
        atoms,
        {
          kind: "service",
          project: projectRef(activeOrganization.id, projectId),
          serviceId: ZeropsServiceId.make(serviceId),
        },
        signal,
      );
      return deployed.name ?? undefined;
    },
    [activeOrganization, atoms, projectRef, runtime],
  );
}
