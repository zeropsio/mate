/**
 * The coding-agents card's actions on the logins beyond the agents' defaults
 * (crew mode's *Runs on*, PRD §2.3): add one, sign one out, remove one.
 *
 * Adding an account returns its id, and the card then signs it in through the
 * same dialog a default login uses. An API key is signed in the moment the key
 * is stored, by whoever stored it: the Mate's server records that person.
 *
 * Offered only where the environment advertises `capabilities.mateLogins`;
 * the caller checks.
 */
import {
  EnvironmentAuthorizationError,
  ZeropsAgentLoginError,
  type EnvironmentId,
  type ZeropsLoginAddInput,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { MateLoginRow } from "@t3tools/client-runtime/zerops/logins";
import * as Schema from "effect/Schema";
import { useCallback, useState } from "react";

import { requestConfirmDialog } from "../confirmDialog";
import { zeropsCommands } from "../state/zeropsCommands";
import { useAtomCommand } from "../state/use-atom-command";

const isZeropsAgentLoginError = Schema.is(ZeropsAgentLoginError);
const isEnvironmentAuthorizationError = Schema.is(EnvironmentAuthorizationError);

function failureMessage(cause: unknown): string {
  if (isZeropsAgentLoginError(cause)) return cause.message;
  if (isEnvironmentAuthorizationError(cause)) return cause.message;
  return "Something went wrong.";
}

export interface MateLoginStatus {
  readonly pending: boolean;
  readonly error: string | undefined;
}

export interface UseMateLogins {
  /** Resolves the new login's id, or `undefined` when the server refused it (`addError` says why). */
  readonly add: (input: ZeropsLoginAddInput) => Promise<string | undefined>;
  readonly addError: string | undefined;
  readonly signOut: (login: MateLoginRow) => void;
  readonly remove: (login: MateLoginRow) => void;
  readonly statusFor: (loginId: string) => MateLoginStatus;
}

export function useMateLogins(environmentId: EnvironmentId | null): UseMateLogins {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const runAdd = useAtomCommand(zeropsCommands.loginAdd, "zerops login add");
  const runRemove = useAtomCommand(zeropsCommands.loginRemove, "zerops login remove");
  const runSignOut = useAtomCommand(zeropsCommands.agentSignOut, "zerops login sign out");

  const add = useCallback(
    async (input: ZeropsLoginAddInput) => {
      if (environmentId === null) return undefined;
      setAddError(undefined);
      const result = await runAdd({ environmentId, input });
      if (result._tag === "Success") return result.value.id;
      if (!isAtomCommandInterrupted(result)) {
        setAddError(failureMessage(squashAtomCommandFailure(result)));
      }
      return undefined;
    },
    [environmentId, runAdd],
  );

  /** Confirms, then runs `action` for the login, keeping its pending state and failure. */
  const confirmThen = useCallback(
    (
      login: MateLoginRow,
      question: string,
      action: () => Promise<Awaited<ReturnType<typeof runRemove>>>,
    ) => {
      const confirmed = requestConfirmDialog(question, { variant: "destructive" });
      if (confirmed === undefined) return;
      void confirmed.then((ok) => {
        if (!ok) return;
        setErrors((current) => {
          if (!current.has(login.id)) return current;
          const next = new Map(current);
          next.delete(login.id);
          return next;
        });
        setPending((current) => new Set(current).add(login.id));
        void action().then((result) => {
          setPending((current) => {
            const next = new Set(current);
            next.delete(login.id);
            return next;
          });
          if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
          const message = failureMessage(squashAtomCommandFailure(result));
          setErrors((current) => new Map(current).set(login.id, message));
        });
      });
    },
    [],
  );

  const signOut = useCallback(
    (login: MateLoginRow) => {
      if (environmentId === null) return;
      confirmThen(
        login,
        `Sign ${login.title} out of this project? Work running on it stops now; its sessions stay.`,
        () => runSignOut({ environmentId, input: { agentId: login.agent, loginId: login.id } }),
      );
    },
    [environmentId, confirmThen, runSignOut],
  );

  const remove = useCallback(
    (login: MateLoginRow) => {
      if (environmentId === null) return;
      const crewmates =
        login.crewmates.length === 0
          ? ""
          : ` ${login.crewmates.join(", ")} run${login.crewmates.length === 1 ? "s" : ""} on it and will need another login.`;
      confirmThen(
        login,
        `Remove ${login.title} from this project? It is signed out and its ${login.kind === "apiKey" ? "key" : "sign-in"} is deleted.${crewmates}`,
        () => runRemove({ environmentId, input: { id: login.id } }),
      );
    },
    [environmentId, confirmThen, runRemove],
  );

  return {
    add,
    addError,
    signOut,
    remove,
    statusFor: (loginId) => ({ pending: pending.has(loginId), error: errors.get(loginId) }),
  };
}
