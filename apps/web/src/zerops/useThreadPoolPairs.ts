/**
 * The pairs a thread's lifecycle last read zcp keying by a dev pool (`poolPairsOf`): a part
 * migrated to a pool, the pool with the stages its snapshot carries — what the Git tab, Diff and
 * terminal read so the stage is never a checkout. None when asked with no environment (a hidden
 * terminal, a thread bound to a lease, which reads its leases alone). One value while the pairs
 * stay the same, so a Zerops call that changes nothing of them reads no checkout again.
 */
import { poolPairsOf } from "@t3tools/client-runtime/zerops/serviceMap";
import type { PoolPair } from "@t3tools/client-runtime/zerops/servicePairs";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";

import { useZeropsLifecycle } from "./useZeropsFeeds";

export function useThreadPoolPairs(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): ReadonlyArray<PoolPair> {
  const lifecycle = useZeropsLifecycle(environmentId, threadId);
  const key = JSON.stringify(poolPairsOf(lifecycle));
  return useMemo(() => JSON.parse(key) as ReadonlyArray<PoolPair>, [key]);
}
