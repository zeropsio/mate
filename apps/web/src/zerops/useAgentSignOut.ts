/**
 * Signs an agent out of this Zerops project (`zerops.agentLogin.signOut`,
 * spec-mate D6 round 5): stops its live provider sessions, runs the CLI's
 * own logout, clears the platform flag. Any client may end any agent's
 * project sign-in, so this asks for confirmation first — the one thing the
 * person needs to know is that work running in that agent's sessions stops,
 * while the sessions themselves stay.
 *
 * Environment-scoped, not thread-scoped: signing an agent out is a project
 * fact (`ZeropsAgentAuthCard`'s own card, not any one conversation), so this
 * takes the environment directly rather than a `ScopedThreadRef` the way
 * `useAgentLoginCancel` does.
 *
 * Pending and error state are tracked per agent so a row can show its own
 * outcome inline (H13's inline-error precedent) without one agent's retry
 * disturbing another's.
 */
import {
  EnvironmentAuthorizationError,
  ZeropsAgentLoginError,
  type EnvironmentId,
  type ZeropsAgentId,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { useCallback, useState } from "react";

import { requestConfirmDialog } from "../confirmDialog";
import { zeropsCommands } from "../state/zeropsCommands";
import { useAtomCommand } from "../state/use-atom-command";

const AGENT_NAMES: Record<ZeropsAgentId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

const isZeropsAgentLoginError = Schema.is(ZeropsAgentLoginError);
const isEnvironmentAuthorizationError = Schema.is(EnvironmentAuthorizationError);

function signOutErrorMessage(cause: unknown): string {
  if (isZeropsAgentLoginError(cause)) return cause.message;
  if (isEnvironmentAuthorizationError(cause)) return cause.message;
  return "Something went wrong.";
}

export interface UseAgentSignOut {
  /** Pending, or the last failure's detail, for one agent's sign-out. */
  readonly statusFor: (agentId: ZeropsAgentId) => {
    readonly pending: boolean;
    readonly error: string | undefined;
  };
  readonly signOut: (agentId: ZeropsAgentId) => void;
}

export function useAgentSignOut(environmentId: EnvironmentId | null): UseAgentSignOut {
  const [pending, setPending] = useState<ReadonlySet<ZeropsAgentId>>(new Set());
  const [errors, setErrors] = useState<ReadonlyMap<ZeropsAgentId, string>>(new Map());
  const runSignOut = useAtomCommand(zeropsCommands.agentSignOut, "zerops agent sign out");

  const signOut = useCallback(
    (agentId: ZeropsAgentId) => {
      if (environmentId === null) return;
      const confirmed = requestConfirmDialog(
        `Sign ${AGENT_NAMES[agentId]} out of this project? Work running in its sessions stops now; the sessions themselves stay.`,
        { variant: "destructive" },
      );
      if (confirmed === undefined) return;
      void confirmed.then((ok) => {
        if (!ok) return;
        setErrors((current) => {
          if (!current.has(agentId)) return current;
          const next = new Map(current);
          next.delete(agentId);
          return next;
        });
        setPending((current) => new Set(current).add(agentId));
        void runSignOut({ environmentId, input: { agentId } }).then((result) => {
          setPending((current) => {
            const next = new Set(current);
            next.delete(agentId);
            return next;
          });
          if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
          const message = signOutErrorMessage(squashAtomCommandFailure(result));
          setErrors((current) => new Map(current).set(agentId, message));
        });
      });
    },
    [environmentId, runSignOut],
  );

  return {
    statusFor: (agentId) => ({ pending: pending.has(agentId), error: errors.get(agentId) }),
    signOut,
  };
}
