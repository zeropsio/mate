/**
 * The sign-in wherever it is started outside the Mate's own view — the chat header's band, the
 * model picker's per-agent panels, the Crew tab's lock: the one sign-in module
 * (`ZeropsAgentSignIn`) in a small dialog, opened on the agent asked for. This hook is the one
 * copy of "which agent is being signed in right now", so every caller shares one dialog.
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

import { ZeropsAgentSignInDialog } from "../components/zerops/ZeropsAgentSignIn";
import { useZeropsAgentSignerRecordState } from "./useZeropsAgentSigner";
import { useZeropsMateDirectory } from "./useZeropsMates";
import { zeropsMateAt } from "./mateIdentities";

export function useZeropsAgentSignInDialog(
  environmentId: EnvironmentId | null,
  threadRef: ScopedThreadRef | null,
): {
  readonly openFor: (agentId: ZeropsAgentId) => void;
  readonly dialog: ReactNode;
  /** Logins, by signer key, whose sign-in succeeded but this browser's record write did not (H13). */
  readonly recordFailed: ReadonlySet<string>;
  readonly retryRecord: (key: string) => void;
} {
  const { recordFailed, retry: retryRecord } = useZeropsAgentSignerRecordState(environmentId);
  const directory = useZeropsMateDirectory();
  const whoLivesHere = environmentId === null ? null : zeropsMateAt(directory, environmentId);
  const [openAgentId, setOpenAgentId] = useState<ZeropsAgentId | null>(null);

  const openFor = useCallback((agentId: ZeropsAgentId) => {
    setOpenAgentId(agentId);
  }, []);
  const close = useCallback(() => {
    setOpenAgentId(null);
  }, []);

  const dialog =
    openAgentId === null ? null : (
      <ZeropsAgentSignInDialog
        agentId={openAgentId}
        environmentId={environmentId}
        mateName={whoLivesHere?.kind === "mate" ? whoLivesHere.mate.name : null}
        onClose={close}
        threadRef={threadRef}
      />
    );

  return { openFor, dialog, recordFailed, retryRecord };
}
