/**
 * The leases a thread reads (`threadLeasesOf`): the one it is bound to, then every other lease of
 * its repository and branch the Mate last read zcp holding — what its Git tab, Diff, terminal
 * and addresses show. A thread bound to no lease, or asked with no environment (a hidden terminal), reads no
 * copy feed. One value while the leases stay the same, so a Zerops call that changes nothing of
 * them reads no checkout again.
 */
import type { CheckoutLease } from "@t3tools/client-runtime/zerops";
import { threadLeasesOf } from "@t3tools/client-runtime/zerops/serviceMap";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import { useZeropsMateCopies } from "./useZeropsFeeds";

export function useThreadLeases(
  environmentId: EnvironmentId | null,
  /** The lease the thread is bound to; `null` for none. */
  lease: CheckoutLease | null,
): ReadonlyArray<CheckoutLease> {
  const lifecycle = useZeropsMateCopies(lease === null ? null : environmentId);
  const key = JSON.stringify(threadLeasesOf(lease, lifecycle));
  return useMemo(() => JSON.parse(key) as ReadonlyArray<CheckoutLease>, [key]);
}
