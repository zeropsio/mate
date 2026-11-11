/** The destination holds its own reads before acknowledging the source's scoped handover. */
import { useAtomValue } from "@effect/atom-react";
import { mateEngineHostAtom, mateFeedReadsAtom } from "@t3tools/client-runtime/data";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";
import { useThreadDetail, useThreadStatus } from "../state/entities";
import { useZeropsAgentAuth } from "./useZeropsFeeds";
import { useMateHandOver } from "./newMate";

declare module "@tanstack/react-router" {
  interface HistoryState {
    mateHandOver?: string | undefined;
  }
}

export function useMateHandOverDestination(
  conversation: ScopedThreadRef | null,
  handOverId: string | undefined,
): void {
  const destination = handOverId === undefined ? null : conversation;
  const engine = useAtomValue(mateEngineHostAtom);
  const feeds = useAtomValue(mateFeedReadsAtom);
  useThreadStatus(destination);
  useThreadDetail(destination);
  useZeropsAgentAuth(destination?.environmentId ?? null);
  const environmentId = destination?.environmentId;
  const threadId = destination?.threadId;
  useEffect(() => {
    if (handOverId === undefined || environmentId === undefined || threadId === undefined) return;
    // Subscription effects above acquire this destination's reads first. Remote readiness and
    // aggregate demand (which includes the source) cannot acknowledge this transfer.
    if (engine !== null && feeds !== null)
      useMateHandOver.getState().acquired(handOverId, { environmentId, threadId });
  }, [engine, feeds, environmentId, threadId, handOverId]);
  useEffect(() => {
    if (handOverId === undefined || environmentId === undefined || threadId === undefined) return;
    return () => useMateHandOver.getState().cancel(handOverId);
  }, [environmentId, threadId, handOverId]);
}
