/** Observes console status while a conversation or Data panel demands it. It never starts the process. */
import { databaseSession } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useEffect } from "react";
import { useAccountDataOptional, useProjection } from "./ZeropsAccountData";
const UNKNOWN_SESSION = Atom.make(undefined);
export function useDatabaseSession(environmentId: EnvironmentId | null) {
  const database = useAccountDataOptional()?.database;
  useEffect(() => {
    if (environmentId !== null) return database?.demandSession(environmentId);
  }, [database, environmentId]);
  return useProjection(databaseSession, environmentId, UNKNOWN_SESSION);
}
