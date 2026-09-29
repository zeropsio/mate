/**
 * What a new Mate needs above every view: its conversation kept read while its own view hands over
 * to it (`newMate.ts`), so the route changing under the person paints the view's last frame, never
 * a loading pane.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";

import { useThreadDetail, useThreadStatus } from "~/state/entities";
import { useNewMate } from "~/zerops/newMate";
import { useZeropsAgentAuth } from "~/zerops/useZeropsFeeds";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

export function ZeropsNewMateHost() {
  const handOver = useNewMate((state) => state.handOver);
  const { status } = useZeropsSession();
  if (status !== "signed-in" || handOver === null) return null;
  return <KeepHandOverRead conversation={handOver} key={scopedThreadKey(handOver)} />;
}

/** How long a hand-over's conversation is kept read from here, across the route changing. */
const HAND_OVER_KEPT_MS = 3_000;

/**
 * A new Mate's conversation, and its agents' sign-in, kept read while its own view hands over to
 * it: the view let go of them as the route changed and the conversation picked them up in the same
 * moment, and a read let go of in between starts over — a loading pane where the view's last
 * frame should stand.
 */
function KeepHandOverRead({ conversation }: { readonly conversation: ScopedThreadRef }) {
  useThreadStatus(conversation);
  useThreadDetail(conversation);
  useZeropsAgentAuth(conversation.environmentId);
  const handingOver = useNewMate((state) => state.handingOver);
  useEffect(() => {
    const timer = setTimeout(() => handingOver(null), HAND_OVER_KEPT_MS);
    return () => clearTimeout(timer);
  }, [handingOver]);
  return null;
}
