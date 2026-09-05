/**
 * The agent sign-in dialog, hosted at thread level.
 *
 * The lifecycle band asks for a sign-in; this is where the click lands. It
 * owns nothing but which agent is being signed in, and renders the same
 * dialog the Zerops panel's card opens, so there is one sign-in flow with two
 * doors into it.
 */
import type { ScopedThreadRef, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";

import { useAgentLogin } from "../../zerops/useAgentLogin";
import { useAgentLoginCancel } from "../../zerops/useAgentLoginCancel";
import { ZeropsAgentAuthorizationDialog } from "./ZeropsAgentAuthorizationDialog";

export type ZeropsAgentId = ZeropsAgentAuthSnapshot["agents"][number]["agentId"];

export function ZeropsAgentAuthorizationHost({
  agentId,
  snapshot,
  threadRef,
  projectName,
  onClose,
}: {
  readonly agentId: ZeropsAgentId | null;
  readonly snapshot: ZeropsAgentAuthSnapshot | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly projectName: string | null;
  readonly onClose: () => void;
}) {
  const startAgentLogin = useAgentLogin(threadRef, { terminalSurface: "embedded" });
  const cancelAgentLogin = useAgentLoginCancel(threadRef);
  const agent = snapshot?.agents.find((entry) => entry.agentId === agentId);
  if (agent === undefined) return null;

  return (
    <ZeropsAgentAuthorizationDialog
      agent={agent}
      onCancel={cancelAgentLogin}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onStart={startAgentLogin}
      open
      projectName={projectName}
      threadRef={threadRef}
    />
  );
}
