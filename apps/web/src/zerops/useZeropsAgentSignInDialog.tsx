/**
 * The one sign-in dialog, lifted out of whichever surface opened it.
 *
 * Three places open the same agent-authorization dialog: the Zerops empty
 * state (`ZeropsMateEmptyState`), the chat header's lifecycle band (via
 * `ZeropsAgentAuthorizationHost`), and — since the model picker learned to
 * offer sign-in per agent — the picker's own per-instance panel. This hook is
 * the one copy of "which agent is being authorized right now", so every
 * caller shares one `agentId` state and one dialog instead of three.
 *
 * The signer-record WRITE stays `ChatView`'s alone (`useZeropsAgentSignerRecord`,
 * run once per conversation view) — this hook only reads how it went, with
 * the shared {@link useZeropsAgentSignerRecordState}, so calling it from
 * several places never starts a second writer for the same environment.
 *
 * `dialog` renders unconditionally (null when nothing is open) so a caller
 * can place it OUTSIDE whatever popover or panel triggered `openFor` — the
 * dialog must outlive that popover closing, which is why the picker's panel
 * (rendered inside a Popover's content) never renders the dialog itself and
 * instead calls a hook instance owned by the composer around it.
 *
 * @module useZeropsAgentSignInDialog
 */
import type { EnvironmentId, ScopedThreadRef, ZeropsAgentId } from "@t3tools/contracts";
import { useCallback, useState, type ReactNode } from "react";

import { ZeropsAgentAuthorizationHost } from "../components/zerops/ZeropsAgentAuthorizationHost";
import { useZeropsAgentSignerRecordState } from "./useZeropsAgentSigner";
import { useZeropsAgentAuth } from "./useZeropsFeeds";

export function useZeropsAgentSignInDialog(
  environmentId: EnvironmentId | null,
  threadRef: ScopedThreadRef | null,
  options?: { readonly projectName?: string | null | undefined },
): {
  readonly openFor: (agentId: ZeropsAgentId) => void;
  readonly dialog: ReactNode;
  /** Agents whose sign-in succeeded but this browser's record write did not (H13). */
  readonly recordFailed: ReadonlySet<ZeropsAgentId>;
  readonly retryRecord: (agentId: ZeropsAgentId) => void;
} {
  const agentAuth = useZeropsAgentAuth(environmentId);
  const { recordFailed, retry: retryRecord } = useZeropsAgentSignerRecordState(environmentId);
  const [openAgentId, setOpenAgentId] = useState<ZeropsAgentId | null>(null);

  const openFor = useCallback((agentId: ZeropsAgentId) => {
    setOpenAgentId(agentId);
  }, []);

  const dialog = (
    <ZeropsAgentAuthorizationHost
      agentId={openAgentId}
      onClose={() => setOpenAgentId(null)}
      projectName={options?.projectName ?? null}
      snapshot={agentAuth ?? null}
      threadRef={threadRef}
    />
  );

  return { openFor, dialog, recordFailed, retryRecord };
}
