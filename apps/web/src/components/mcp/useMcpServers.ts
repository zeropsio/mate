/**
 * The MCP tab's list of servers, read from the Mate and changed through it.
 *
 * Read when the tab opens and whenever the window comes back to focus; each
 * action answers the fresh list itself, so an action is its own refresh. The
 * last answer per Mate and conversation is remembered for the session, so
 * reopening the tab paints what it last knew while the header spins — never a
 * placeholder the answer then replaces.
 */
import { RegistryContext } from "@effect/atom-react";
import type {
  EnvironmentId,
  McpServerAddInput,
  McpServersList,
  ThreadId,
} from "@t3tools/contracts";
import {
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useContext, useEffect, useReducer, useRef } from "react";

import { mcpServersEnvironment } from "../../state/mcpServers";
import { describeMcpFailure, mcpTabStart, mcpTabStep, type McpTabState } from "./McpServers.logic";

const REMEMBERED = new Map<string, McpServersList>();

export type McpAction =
  | { readonly kind: "add"; readonly input: McpServerAddInput }
  | { readonly kind: "remove"; readonly name: string }
  | { readonly kind: "reconnect"; readonly name: string }
  | { readonly kind: "setEnabled"; readonly name: string; readonly enabled: boolean };

export type McpActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export interface UseMcpServers {
  readonly state: McpTabState;
  readonly refresh: () => void;
  readonly act: (action: McpAction) => Promise<McpActionResult>;
}

export function useMcpServers(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | undefined;
}): UseMcpServers {
  const { environmentId, threadId } = input;
  const registry = useContext(RegistryContext);
  const key = `${environmentId}|${threadId ?? ""}`;
  const [state, dispatch] = useReducer(mcpTabStep, null, () =>
    mcpTabStart(REMEMBERED.get(key) ?? null),
  );
  const seqRef = useRef(0);

  const settle = useCallback(
    (seq: number, result: AtomCommandResult<McpServersList, unknown>): McpActionResult => {
      if (result._tag === "Success") {
        REMEMBERED.set(key, result.value);
        dispatch({ kind: "answered", seq, list: result.value });
        return { ok: true };
      }
      const message = describeMcpFailure(squashAtomCommandFailure(result));
      dispatch({ kind: "failed", seq, message });
      return { ok: false, message };
    },
    [key],
  );

  const refresh = useCallback(() => {
    const seq = ++seqRef.current;
    dispatch({ kind: "asked", seq });
    void runAtomCommand(
      registry,
      mcpServersEnvironment.list,
      { environmentId, input: threadId === undefined ? {} : { threadId } },
      { reportFailure: false },
    ).then((result) => settle(seq, result));
  }, [environmentId, registry, settle, threadId]);

  const act = useCallback(
    async (action: McpAction): Promise<McpActionResult> => {
      const seq = ++seqRef.current;
      dispatch({ kind: "asked", seq });
      const target = threadId === undefined ? {} : { threadId };
      const options = { reportFailure: false };
      const result =
        action.kind === "add"
          ? await runAtomCommand(
              registry,
              mcpServersEnvironment.add,
              { environmentId, input: { ...action.input, ...target } },
              options,
            )
          : action.kind === "remove"
            ? await runAtomCommand(
                registry,
                mcpServersEnvironment.remove,
                { environmentId, input: { name: action.name, ...target } },
                options,
              )
            : action.kind === "reconnect"
              ? await runAtomCommand(
                  registry,
                  mcpServersEnvironment.reconnect,
                  { environmentId, input: { name: action.name, ...target } },
                  options,
                )
              : await runAtomCommand(
                  registry,
                  mcpServersEnvironment.setEnabled,
                  {
                    environmentId,
                    input: { name: action.name, enabled: action.enabled, ...target },
                  },
                  options,
                );
      // A failed action is the action's to say, beside its control; the list it
      // had still stands, so the failure does not become the tab's error. It is
      // asked again: a change some agents took and one refused has landed in part.
      if (result._tag !== "Success") {
        dispatch({ kind: "dropped", seq });
        if (action.kind !== "reconnect") refresh();
        return { ok: false, message: describeMcpFailure(squashAtomCommandFailure(result)) };
      }
      return settle(seq, result);
    },
    [environmentId, refresh, registry, settle, threadId],
  );

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return { state, refresh, act };
}
