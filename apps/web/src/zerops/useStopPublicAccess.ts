/** Public access belongs to the drawn stop's id, independently of navigation and deployment reads. */
import { useAtomValue } from "@effect/atom-react";
import type { PublicAccessCellRequest } from "@t3tools/client-runtime/zerops/data";
import type { ZeropsPublicAccess } from "@t3tools/client-runtime/zerops";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";
import { useContext, useMemo } from "react";
import { ZeropsDataContext } from "./zeropsDataContext";
import { invalidateZerops } from "./accountInvalidations";
import { againStopDeployment, useStopDeployments } from "./accountForge";
import { selectPublicAccess } from "@t3tools/client-runtime/zerops/data";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

const UNREAD: Shown<ZeropsPublicAccess> = { state: "unread", waitingFor: null };
const NO_READ = Atom.make<ReadonlyMap<string, Shown<ZeropsPublicAccess>>>(new Map());

/** Mounting the cell atoms owns the demand; unmounting the last surface releases it. */
/**
 * A chip's stops' deployments, demanded while the chip is drawn — without reading their public
 * access, which only an open stop menu reads (navigation starts no detail read).
 */
export function useStopDeploymentDemand(projectIds: ReadonlyArray<string>): void {
  const data = useContext(ZeropsDataContext);
  const organizationId = useZeropsSessionOptional()?.activeOrganization?.id;
  const key = JSON.stringify(projectIds);
  const refs = useMemo(
    () =>
      data === null || organizationId === undefined
        ? []
        : (JSON.parse(key) as string[]).map((id) => data.projectRef(organizationId, id)),
    [data, organizationId, key],
  );
  useStopDeployments(refs);
}

export function useStopPublicAccesses(projectIds: ReadonlyArray<string>): {
  readonly reads: ReadonlyMap<string, Shown<ZeropsPublicAccess>>;
  readonly again: (projectId: string) => void;
} {
  const data = useContext(ZeropsDataContext);
  const organizationId = useZeropsSessionOptional()?.activeOrganization?.id;
  const key = JSON.stringify(projectIds);
  const requests = useMemo<ReadonlyArray<PublicAccessCellRequest>>(
    () =>
      data === null || organizationId === undefined
        ? []
        : (JSON.parse(key) as string[]).map((id) => ({
            kind: "public-access",
            account: data.runtime.scope,
            project: data.projectRef(organizationId, id),
          })),
    [data, organizationId, key],
  );
  useStopDeployments(requests.map((request) => request.project));
  const atom = useMemo(
    () =>
      data === null || requests.length === 0
        ? NO_READ
        : Atom.make(
            (get) =>
              new Map(
                requests.map((request) => [
                  request.project.projectId as string,
                  get(data.runtime.cells.known(request)),
                ]),
              ),
          ),
    [data, requests],
  );
  const reads = useAtomValue(atom);
  return {
    reads,
    again: (id) => {
      const request = requests.find((request) => request.project.projectId === id);
      if (request === undefined || data === null) return;
      const shown = reads.get(id);
      if (shown?.state === "withheld") {
        if (shown.reason === "access-denied" || shown.reason === "access-lapsed")
          invalidateZerops({ topic: "access", change: "renew-now" });
        againStopDeployment(request.project);
      }
      void Effect.runPromise(data.runtime.cells.readAgain(request));
    },
  };
}

export function useStopPublicAccess(projectId: string | undefined) {
  const { reads, again } = useStopPublicAccesses(projectId === undefined ? [] : [projectId]);
  const data = useContext(ZeropsDataContext);
  const bound = projectId !== undefined && data !== null;
  const shown = bound ? (reads.get(projectId) ?? UNREAD) : undefined;
  return {
    bound,
    shown,
    access: selectPublicAccess(shown ?? UNREAD),
    again: () => {
      if (projectId !== undefined) again(projectId);
    },
  };
}
