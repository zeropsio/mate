/**
 * The release question once a conversation bound to a lease is archived (`zeropsReleaseAsk`): a
 * notice naming the workspace, with what is known of it, that stays until the person answers.
 * Release sends the bound conversation's agent the request (`onRelease`); Not now, or closing it,
 * sends nothing. The archive is done before it shows, and no timer answers it or takes it away
 * (zcp `docs/spec-mate.md` §0 rule 4).
 */
import { ZEROPS_RELEASE_QUESTION, zeropsReleaseAsk } from "@t3tools/client-runtime/zerops";
import type {
  EnvironmentId,
  OrchestrationLatestTurn,
  ThreadId,
  ThreadLease,
} from "@t3tools/contracts";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useNowMs } from "./useNowMs";
import { useZeropsLifecycle } from "./useZeropsFeeds";

interface ReleaseAskTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** The lease the conversation is bound to. */
  readonly lease: ThreadLease;
  readonly latestTurn: OrchestrationLatestTurn | null;
}

/** What is known of the workspace while the question shows, read from the conversation's lifecycle. */
function ReleaseAskFacts({ environmentId, threadId, lease, latestTurn }: ReleaseAskTarget) {
  const ask = zeropsReleaseAsk({
    binding: lease,
    lifecycle: useZeropsLifecycle(environmentId, threadId),
    lastTurn: latestTurn,
    now: useNowMs(),
  });
  return ask?.facts ?? null;
}

export function showZeropsReleaseAsk(
  input: ReleaseAskTarget & { readonly onRelease: () => Promise<unknown> },
): void {
  let toastId: string | undefined;
  const close = () => {
    if (toastId !== undefined) toastManager.close(toastId);
  };
  toastId = toastManager.add(
    stackedThreadToast({
      type: "info",
      title: ZEROPS_RELEASE_QUESTION(input.lease.alias),
      description: (
        <ReleaseAskFacts
          environmentId={input.environmentId}
          latestTurn={input.latestTurn}
          lease={input.lease}
          threadId={input.threadId}
        />
      ),
      // A question: it stays until the person answers it.
      timeout: 0,
      actionProps: {
        children: "Release",
        onClick: async () => {
          close();
          await input.onRelease();
        },
      },
      data: { secondaryActionProps: { children: "Not now", onClick: close } },
    }),
  );
}
