/**
 * The project's usual coding agent, for a sign-in to offer first: the one its other Mates are
 * signed in with, read as a new Mate's creation reads it (`agentSelection.ts` — each Mate's
 * `ZCP_AGENT_OAUTH_*` flags, the one source the platform does not redact). Each Mate's agents are
 * read once when a surface asks — never kept polling — and what was read before answers at once;
 * until every read has settled, or a second and a half has passed, the answer is not settled, so a
 * sign-in never paints its cards in one order and then another.
 */
import {
  hasMate,
  readZeropsMembership,
  type ZeropsAgentType,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { servicesAgents, type SampledRead } from "@t3tools/client-runtime/data";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { ZeropsAgentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo, useState } from "react";

import { usualAgentOf } from "../components/zerops/ZeropsAgentSignIn.logic";
import { useZeropsCandidates } from "./useZeropsCandidates";
import { useAccountDataOptional, useProjection } from "./ZeropsAccountData";

/** How long a sign-in waits for the answer before it offers the agents in their own order. */
const USUAL_AGENT_WAIT_MS = 1_500;

const NOT_READ = Atom.make<Readonly<Record<string, SampledRead<ReadonlyArray<ZeropsAgentType>>>>>(
  {},
);

/** The project's other Mates: those sharing its group, each with a container to read. */
export function otherMatesOf(
  rows: ReadonlyArray<ZeropsCandidate>,
  projectId: string | undefined,
): ReadonlyArray<ZeropsCandidate> {
  if (projectId === undefined) return [];
  const own = rows.find((row) => row.project.id === projectId);
  const groupId = own === undefined ? undefined : readZeropsMembership(own.project).groupId;
  if (groupId === undefined) return [];
  return rows.filter(
    (row) =>
      row.project.id !== projectId &&
      row.service !== undefined &&
      hasMate(row) &&
      readZeropsMembership(row.project).groupId === groupId,
  );
}

export function useUsualAgent(projectId: string | undefined): {
  readonly usual: ZeropsAgentId | null;
  readonly settled: boolean;
} {
  const account = useAccountDataOptional();
  const readDetail = account?.readDetail;
  const orgId = account?.orgId ?? null;
  const { listing } = useZeropsCandidates();
  const serviceIds = useMemo(
    () =>
      otherMatesOf(heldCandidates(listing).rows, projectId).flatMap((other) =>
        other.service === undefined ? [] : [other.service.id],
      ),
    [listing, projectId],
  );
  const asked = serviceIds.join(",");
  const [waited, setWaited] = useState(false);
  // The services whose read this surface asked for has settled, read or not.
  const [settledReads, setSettledReads] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (readDetail === undefined || orgId === null || asked === "") return;
    let current = true;
    for (const ownerId of asked.split(","))
      void readDetail({ family: "serviceAgents", ownerId }).then(() => {
        if (current) setSettledReads((settled) => new Set(settled).add(ownerId));
      });
    return () => {
      current = false;
    };
  }, [readDetail, asked, orgId]);
  const agents = useProjection(
    servicesAgents,
    orgId === null ? null : { orgId, serviceIds },
    NOT_READ,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), USUAL_AGENT_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [projectId]);

  // Retained sign-ins settle the card order; completing a failed read only settles the wait.
  const read = serviceIds.flatMap((serviceId) => {
    const value = agents[serviceId]?.value;
    return value !== undefined ? [value] : [];
  });
  return {
    usual: usualAgentOf(read),
    settled:
      waited ||
      orgId === null ||
      serviceIds.every(
        (serviceId) => agents[serviceId]?.value !== undefined || settledReads.has(serviceId),
      ),
  };
}
