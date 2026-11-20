// What an agent's admission asks of the person: the shape `data/projections/agentAdmission.ts`
// derives and a Mate's row, composer and sign-in line read.

import type { ZeropsAgentId } from "@t3tools/contracts";

export interface AgentAdmissionAttention {
  readonly key: string;
  readonly cause: "missing-sign-in" | "expired-login" | "sign-in-in-progress";
  readonly instanceId: string;
  readonly loginKey: string;
  readonly agentId: ZeropsAgentId | undefined;
  readonly severity: "attention";
  readonly dismissible: false;
  readonly text: string;
  readonly summary: string;
  readonly action:
    | "sign-in"
    | "continue-sign-in"
    | "manage-api-key"
    | "settings"
    | "check-again"
    | "register-again";
  readonly actionLabel: string;
}
