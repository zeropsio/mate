/**
 * The project's usual coding agent, for a sign-in to offer first: the one its other Mates are
 * signed in with, read as a new Mate's creation reads it (`agentSelection.ts` — each Mate's
 * `ZCP_AGENT_OAUTH_*` flags, the one source the platform does not redact). Each Mate is read once
 * per session; until every one has answered, or a second and a half has passed, the answer is not
 * settled, so a sign-in never paints its cards in one order and then another.
 */
import { hasMate, readZeropsMembership } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { ZeropsServiceId, type AgentsCellRequest } from "@t3tools/client-runtime/zerops/data";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { ZeropsAgentId } from "@t3tools/contracts";
import { useContext, useEffect, useMemo, useState } from "react";

import { usualAgentOf } from "../components/zerops/ZeropsAgentSignIn.logic";
import { onAccountLifetimeClose } from "./accountLifetime";
import { readZeropsCellOnce } from "./readZeropsCell";
import { useZeropsCandidates } from "./useZeropsCandidates";
import { ZeropsDataContext } from "./zeropsDataContext";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

/** How long a sign-in waits for the answer before it offers the agents in their own order. */
const USUAL_AGENT_WAIT_MS = 1_500;

/** What each Mate is signed in with, by its row's key: read, or on its way. */
const signedInWith = new Map<string, ReadonlyArray<string> | "reading">();
const listeners = new Set<() => void>();

onAccountLifetimeClose(() => {
  signedInWith.clear();
});

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
  const data = useContext(ZeropsDataContext);
  const organizationId = useZeropsSessionOptional()?.activeOrganization?.id;
  const { listing } = useZeropsCandidates();
  const others = useMemo(
    () => otherMatesOf(heldCandidates(listing).rows, projectId),
    [listing, projectId],
  );
  const [, setRead] = useState(0);
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    const listener = () => setRead((count) => count + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (data === null || organizationId === undefined) return;
    for (const other of others) {
      if (signedInWith.has(other.key) || other.service === undefined) continue;
      signedInWith.set(other.key, "reading");
      const request: AgentsCellRequest = {
        kind: "agents",
        account: data.runtime.scope,
        service: {
          kind: "service",
          project: data.projectRef(organizationId, other.project.id),
          serviceId: ZeropsServiceId.make(other.service.id),
        },
      };
      void readZeropsCellOnce(data.runtime.cells, request).then((agents) => {
        signedInWith.set(other.key, agents ?? []);
        for (const listener of listeners) listener();
      });
    }
  }, [data, organizationId, others]);

  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), USUAL_AGENT_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [projectId]);

  const answers = others.map((other) => signedInWith.get(other.key));
  const read = answers.filter((answer): answer is ReadonlyArray<string> => Array.isArray(answer));
  return {
    usual: usualAgentOf(read),
    settled: waited || data === null || read.length === answers.length,
  };
}
