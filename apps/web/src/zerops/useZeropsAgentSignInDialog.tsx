import { useZeropsAgentAuth } from "./useZeropsFeeds";
import { zeropsAgentAuthView } from "@t3tools/client-runtime/zerops/agentLogin";
import { zeropsLoginTitle } from "@t3tools/shared/zeropsAgentAuth";
/**
 * The sign-in wherever it is started outside the Mate's own view — the chat header's band, the
 * model picker's per-agent panels, the Crew tab's lock: the one sign-in module
 * (`ZeropsAgentSignIn`) in a small dialog, opened on the agent asked for. This hook is the one
 * copy of "which agent is being signed in right now", so every caller shares one dialog.
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
import { useZeropsMateDirectory } from "./useZeropsMates";
import { zeropsMateAt } from "./mateIdentities";

export function useZeropsAgentSignInDialog(
  environmentId: EnvironmentId | null,
  threadRef: ScopedThreadRef | null,
): {
  readonly openFor: (agentId: ZeropsAgentId, loginId?: string) => void;
  readonly dialog: ReactNode;
} {
  const directory = useZeropsMateDirectory();
  const whoLivesHere = environmentId === null ? null : zeropsMateAt(directory, environmentId);
  const [openAgentId, setOpenAgentId] = useState<ZeropsAgentId | null>(null);

  const [openLoginId, setOpenLoginId] = useState<string | undefined>();
  const snapshot = zeropsAgentAuthView(useZeropsAgentAuth(environmentId)).snapshot;
  const login = snapshot?.logins?.find((row) => row.id === openLoginId && !row.default);
  const openFor = useCallback((agentId: ZeropsAgentId, loginId?: string) => {
    setOpenAgentId(agentId);
    setOpenLoginId(loginId);
  }, []);
  const close = useCallback(() => {
    setOpenAgentId(null);
  }, []);

  const dialog =
    openAgentId === null || (openLoginId !== undefined && login === undefined) ? null : (
      <ZeropsAgentSignInDialog
        agentId={openAgentId}
        login={
          login === undefined
            ? null
            : {
                id: login.id,
                agentId: login.agent,
                title: zeropsLoginTitle(login),
                login: login.login,
              }
        }
        environmentId={environmentId}
        mateName={whoLivesHere?.kind === "mate" ? whoLivesHere.mate.name : null}
        onClose={close}
        threadRef={threadRef}
      />
    );

  return { openFor, dialog };
}
