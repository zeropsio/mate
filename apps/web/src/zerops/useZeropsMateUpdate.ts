/**
 * The one verb next to the update line (spec-mate.md §2.9, MU-2): calls
 * `zerops.mate.update`, then waits for the socket to come back on the
 * version the RPC promised — the same proof `restartAndVerifyMate` waits
 * for on the pre-connection door, read here off the caller's own live
 * `serverVersion` rather than a second container probe, since the caller
 * already holds one (the descriptor subscription behind `useEnvironment`).
 *
 * `idle → confirm → updating → updated/already-current → idle`, or
 * `→ failed` from a transport error, an `exec:operate` refusal, or the RPC's
 * own `ZeropsMateUpdateResult.error`. `already-current`/`updated` settle
 * back to `idle` on their own after a few seconds — nothing here is
 * dismissable, nothing is stored (MU-1).
 */
import { useCallback, useRef, useState } from "react";

import type { EnvironmentId } from "@t3tools/contracts";

import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { zeropsCommands } from "../state/zeropsCommands";
import { useAtomCommand } from "../state/use-atom-command";

const SETTLE_DISPLAY_MS = 4_000;
const VERIFY_ATTEMPTS = 60;
const VERIFY_INTERVAL_MS = 2_000;

export type MateUpdateState =
  | { readonly phase: "idle" }
  | { readonly phase: "confirm" }
  | { readonly phase: "updating" }
  | { readonly phase: "already-current" }
  | { readonly phase: "updated"; readonly to: string }
  | { readonly phase: "failed"; readonly message: string };

export interface MateUpdate {
  readonly state: MateUpdateState;
  readonly request: () => void;
  readonly confirm: () => void;
  readonly cancel: () => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useZeropsMateUpdate(
  environmentId: EnvironmentId,
  serverVersion: string | undefined,
  options: { readonly verifyAttempts?: number; readonly verifyIntervalMs?: number } = {},
): MateUpdate {
  const [state, setState] = useState<MateUpdateState>({ phase: "idle" });
  const versionRef = useRef(serverVersion);
  versionRef.current = serverVersion;
  const generationRef = useRef(0);
  const runUpdate = useAtomCommand(zeropsCommands.mateUpdate, {
    label: "zerops mate update",
    reportFailure: false,
  });
  const attempts = options.verifyAttempts ?? VERIFY_ATTEMPTS;
  const intervalMs = options.verifyIntervalMs ?? VERIFY_INTERVAL_MS;

  const settleToIdleAfter = useCallback((generation: number) => {
    setTimeout(() => {
      if (generationRef.current !== generation) return;
      setState({ phase: "idle" });
    }, SETTLE_DISPLAY_MS);
  }, []);

  const request = useCallback(() => {
    setState((current) =>
      current.phase === "idle" ||
      current.phase === "failed" ||
      current.phase === "already-current" ||
      current.phase === "updated"
        ? { phase: "confirm" }
        : current,
    );
  }, []);

  const cancel = useCallback(() => {
    setState((current) => (current.phase === "confirm" ? { phase: "idle" } : current));
  }, []);

  const confirm = useCallback(() => {
    setState((current) => (current.phase !== "confirm" ? current : { phase: "updating" }));
    generationRef.current += 1;
    const generation = generationRef.current;
    void (async () => {
      const result = await runUpdate({ environmentId, input: {} });
      if (generationRef.current !== generation) return;
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        setState({
          phase: "failed",
          message: cause instanceof Error ? cause.message : "The update could not be started.",
        });
        return;
      }
      const value = result.value;
      if (value.error) {
        setState({ phase: "failed", message: value.error });
        return;
      }
      if (value.action === "none") {
        setState({ phase: "already-current" });
        settleToIdleAfter(generation);
        return;
      }
      for (let attempt = 0; attempt < attempts; attempt++) {
        await delay(intervalMs);
        if (generationRef.current !== generation) return;
        if (versionRef.current === value.to) {
          setState({ phase: "updated", to: value.to });
          settleToIdleAfter(generation);
          return;
        }
      }
      if (generationRef.current !== generation) return;
      setState({
        phase: "failed",
        message: "The server has not come back yet. Check the connection again.",
      });
    })();
  }, [attempts, environmentId, intervalMs, runUpdate, settleToIdleAfter]);

  return { state, request, confirm, cancel };
}
