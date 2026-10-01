/**
 * The declared environments whose deploy token the broker does not hold (D27),
 * for the projects page to mint on its next read.
 *
 * The broker's variable *names* — never a value — read once per account and
 * shared, and again after the page finished something; the broker itself is
 * found among the organization's streamed services. Asked only for a person who may
 * mint a token (an org owner or admin): for anybody else a missing key is not
 * theirs to fix, and the page says nothing about it.
 */
import { useAtomValue } from "@effect/atom-react";
import { BROKER_HOSTNAME, environmentsWithoutDeployToken } from "@t3tools/client-runtime/zerops";
import {
  selectVariableNames,
  type CollectionRead,
  type ServiceRecord,
  type EnvCellRequest,
} from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useMemo, useRef } from "react";

import { useKnown, useZeropsData, useZeropsDataInterest } from "./zeropsDataContext";
import { useZeropsSession } from "./ZeropsSessionProvider";

const NO_SERVICES = Atom.make<CollectionRead<ServiceRecord> | null>(null);

export function useZeropsDeployTokenGaps(input: {
  readonly giteaProjectId: string | undefined;
  /** Every project some group's `environments.yaml` declares. */
  readonly declaredProjects: ReadonlyArray<string>;
  readonly enabled: boolean;
  /** Bumped by the caller after it finished an environment, to read again. */
  readonly generation: number;
}): ReadonlySet<string> | undefined {
  const { enabled, generation, giteaProjectId } = input;
  const { activeOrganization } = useZeropsSession();
  const { projectRef, runtime } = useZeropsData();
  const project = useMemo(
    () =>
      enabled && giteaProjectId !== undefined && activeOrganization !== null
        ? projectRef(activeOrganization.id, giteaProjectId)
        : null,
    [activeOrganization, enabled, giteaProjectId, projectRef],
  );
  // The broker is one of the organization's services, streamed: finding it reads nothing.
  useZeropsDataInterest(
    useMemo(() => (project === null ? null : { kind: "project-inventory", project }), [project]),
  );
  const services = useAtomValue(project === null ? NO_SERVICES : runtime.reads.servicesOf(project));
  const broker = services?.value.find(
    (knowledge) =>
      knowledge.knowledge === "observed" &&
      knowledge.record.identity.knowledge === "observed" &&
      knowledge.record.identity.fields.hostname === BROKER_HOSTNAME,
  );
  const brokerRef = broker?.knowledge === "observed" ? broker.record.ref : undefined;
  // Its variable names, one read shared by every reader of them (the account's cells).
  const request = useMemo<EnvCellRequest | null>(
    () =>
      brokerRef === undefined ? null : { kind: "env", account: runtime.scope, service: brokerRef },
    [brokerRef, runtime.scope],
  );
  const names = useKnown(request === null ? null : runtime.cells.known(request));
  // Something the page finished may have minted a key: the names are read again.
  const seenGeneration = useRef(generation);
  useEffect(() => {
    if (seenGeneration.current === generation) return;
    seenGeneration.current = generation;
    if (request !== null) Effect.runFork(runtime.cells.invalidate(request));
  }, [generation, request, runtime.cells]);
  const read = selectVariableNames(names);
  const brokerVariables = read.status === "known" ? read.names : undefined;
  const declaredKey = input.declaredProjects.toSorted().join(",");
  return useMemo(
    () =>
      brokerVariables === undefined || declaredKey === ""
        ? undefined
        : new Set(
            environmentsWithoutDeployToken({
              declaredProjects: declaredKey.split(","),
              brokerVariables,
            }),
          ),
    [brokerVariables, declaredKey],
  );
}
