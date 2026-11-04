/**
 * The MCP tab's list of servers, read from the Mate and changed through it.
 *
 * Read when the tab opens and whenever the window comes back to focus; each
 * action answers the fresh list itself, so an action is its own refresh. The
 * last answer per Mate and conversation is remembered for the session, so
 * reopening the tab paints what it last knew while the header spins — never a
 * placeholder the answer then replaces.
 */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  McpServerAddInput,
  McpServerSignIn,
  ThreadId,
} from "@t3tools/contracts";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { mcpServersEnvironment } from "../../state/mcpServers";
import { describeMcpFailure, type McpTabState } from "./McpServers.logic";

export type McpAction =
  | { readonly kind: "add"; readonly input: McpServerAddInput }
  | { readonly kind: "remove"; readonly name: string }
  | { readonly kind: "reconnect"; readonly name: string }
  | { readonly kind: "setEnabled"; readonly name: string; readonly enabled: boolean }
  /** Finishes a sign-in with the address the person's browser landed on. */
  | {
      readonly kind: "finishSignIn";
      readonly name: string;
      readonly flow: string;
      readonly landed: string;
    };

export type McpSignInResult =
  | { readonly ok: true; readonly signIn: McpServerSignIn }
  | { readonly ok: false; readonly message: string };

export type McpActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export interface UseMcpServers {
  readonly state: McpTabState;
  readonly refresh: () => void;
  readonly act: (action: McpAction) => Promise<McpActionResult>;
  /** Starts the conversation's agent's sign-in to a server: the page to open. */
  readonly signIn: (name: string) => Promise<McpSignInResult>;
}

export function useMcpServers(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | undefined;
}): UseMcpServers {
  const { environmentId, threadId } = input;
  const registry = useContext(RegistryContext);
  const target = useMemo(
    () => ({ environmentId, input: threadId === undefined ? {} : { threadId } }),
    [environmentId, threadId],
  );
  const atom = mcpServersEnvironment.list(target);
  const reading = useAtomValue(atom);
  const refresh = useCallback(() => registry.refresh(atom), [registry, atom]);
  const [pending, setPending] = useState(0);
  const act = useCallback(
    async (action: McpAction): Promise<McpActionResult> => {
      setPending((count) => count + 1);
      try {
        const scope = target.input;
        const options = { reportFailure: false };
        const result =
          action.kind === "add"
            ? await runAtomCommand(
                registry,
                mcpServersEnvironment.add,
                { environmentId, input: { ...action.input, ...scope } },
                options,
              )
            : action.kind === "setEnabled"
              ? await runAtomCommand(
                  registry,
                  mcpServersEnvironment.setEnabled,
                  {
                    environmentId,
                    input: { name: action.name, enabled: action.enabled, ...scope },
                  },
                  options,
                )
              : action.kind === "finishSignIn"
                ? await runAtomCommand(
                    registry,
                    mcpServersEnvironment.finishSignIn,
                    {
                      environmentId,
                      input: {
                        name: action.name,
                        flow: action.flow,
                        landed: action.landed,
                        ...scope,
                      },
                    },
                    options,
                  )
                : await runAtomCommand(
                    registry,
                    action.kind === "remove"
                      ? mcpServersEnvironment.remove
                      : mcpServersEnvironment.reconnect,
                    { environmentId, input: { name: action.name, ...scope } },
                    options,
                  );
        if (result._tag === "Success") return { ok: true };
        if (action.kind !== "reconnect") refresh();
        return { ok: false, message: describeMcpFailure(squashAtomCommandFailure(result)) };
      } finally {
        setPending((count) => count - 1);
      }
    },
    [environmentId, refresh, registry, target],
  );
  const signIn = useCallback(
    async (name: string): Promise<McpSignInResult> => {
      setPending((count) => count + 1);
      try {
        const scope = target.input;
        const result = await runAtomCommand(
          registry,
          mcpServersEnvironment.signIn,
          { environmentId, input: { name, ...scope } },
          { reportFailure: false },
        );
        if (result._tag === "Success") return { ok: true, signIn: result.value };
        return { ok: false, message: describeMcpFailure(squashAtomCommandFailure(result)) };
      } finally {
        setPending((count) => count - 1);
      }
    },
    [environmentId, registry, target],
  );
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  return {
    state: {
      list: Option.getOrNull(AsyncResult.value(reading)),
      error:
        reading._tag === "Failure"
          ? reading.cause.reasons
              .map((reason) =>
                reason._tag === "Fail"
                  ? reason.error.message
                  : "The Mate could not read MCP servers.",
              )
              .join(" ")
          : null,
      busy: reading.waiting || pending > 0,
      appliedSeq: 0,
      inFlight: [],
    },
    refresh,
    act,
    signIn,
  };
}
