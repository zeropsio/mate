import { driverKindForAgent, type ZeropsAgentId } from "@t3tools/contracts";

import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";

/** An agent Mate signs people in to, by the logo its driver wears everywhere else. */
export function ZeropsAgentLogo({
  agentId,
  className,
}: {
  readonly agentId: ZeropsAgentId;
  readonly className?: string;
}) {
  const Logo = PROVIDER_ICON_BY_PROVIDER[driverKindForAgent(agentId)];
  return Logo === undefined ? null : <Logo aria-hidden="true" className={className} />;
}
