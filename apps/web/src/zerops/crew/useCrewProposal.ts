/**
 * *Let Fen suggest a crew*: one proposal at a time, through the account's Mate
 * actions (`crewPropose`), so it is recorded like any press. While it runs the
 * setup shows the Mate proposing; Cancel interrupts it, which stops the agent
 * on the Mate too, and so does closing the setup — the goal stays in the
 * draft, and the person can ask again.
 */
import { RegistryContext } from "@effect/atom-react";
import { mateActionsAtom } from "@t3tools/client-runtime/data";
import type { CrewProposal, CrewProposalInput, EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { useCallback, useContext, useEffect, useRef, useState } from "react";

import { captureAccountLifetime, onAccountLifetimeClose } from "../accountLifetime";

export type CrewProposalState =
  | { readonly kind: "idle" }
  | { readonly kind: "proposing" }
  /** `cause` is what the request failed with, for the row's words. */
  | { readonly kind: "failed"; readonly cause: unknown };

export interface UseCrewProposal {
  readonly state: CrewProposalState;
  /** The proposed crew, or `null` when it failed, was cancelled or one is already on its way. */
  readonly propose: (input: CrewProposalInput) => Promise<CrewProposal | null>;
  readonly cancel: () => void;
}

export function useCrewProposal(environmentId: EnvironmentId): UseCrewProposal {
  const registry = useContext(RegistryContext);
  const [state, setState] = useState<CrewProposalState>({ kind: "idle" });
  const running = useRef<Fiber.Fiber<CrewProposal, unknown> | null>(null);

  const propose = useCallback(
    async (input: CrewProposalInput) => {
      if (running.current !== null) return null;
      const actions = registry.get(mateActionsAtom);
      if (actions === null) {
        setState({ kind: "failed", cause: null });
        return null;
      }
      const alive = captureAccountLifetime();
      setState({ kind: "proposing" });
      const fiber = Effect.runFork(actions.execute("crewPropose", environmentId, input));
      running.current = fiber;
      const exit = await Effect.runPromise(Fiber.await(fiber));
      // Cancelled: `cancel` already let go of it and said so.
      if (running.current !== fiber) return null;
      running.current = null;
      // The account closed while it ran: nothing of it is shown, and the row is free again.
      if (!alive()) {
        setState({ kind: "idle" });
        return null;
      }
      if (Exit.isSuccess(exit)) {
        setState({ kind: "idle" });
        return exit.value;
      }
      setState({ kind: "failed", cause: Cause.squash(exit.cause) });
      return null;
    },
    [environmentId, registry],
  );

  const cancel = useCallback(() => {
    const fiber = running.current;
    running.current = null;
    setState({ kind: "idle" });
    if (fiber !== null) Effect.runFork(Fiber.interrupt(fiber));
  }, []);

  // The account closing stops a proposal on its way, as closing the setup does.
  useEffect(() => onAccountLifetimeClose(cancel), [cancel]);

  // Closing the setup stops a proposal on its way.
  useEffect(
    () => () => {
      const fiber = running.current;
      running.current = null;
      if (fiber !== null) Effect.runFork(Fiber.interrupt(fiber));
    },
    [],
  );

  return { state, propose, cancel };
}
