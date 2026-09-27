/**
 * Presses on a crew surface, and the crew home's files for its editors.
 *
 * Each caller holds its own pending and error state, so a sheet or a row shows
 * its own outcome inline; the state a command changes arrives on the crew feed,
 * never through this hook. A refusal reads as its crew phrase
 * (`crewRefusalSentence`), with the engine's detail after it.
 */
import { crewRefusalSentence } from "@t3tools/client-runtime/zerops/crew/phrases";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  CrewCommandError,
  EnvironmentAuthorizationError,
  type CrewCommand,
  type CrewCommandResult,
  type CrewFiles,
  type CrewRefusalReason,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useCallback, useRef, useState } from "react";

import { useAtomCommand } from "../../state/use-atom-command";
import { crewCommands } from "./crewCommands";

const isCrewCommandError = Schema.is(CrewCommandError);
const isEnvironmentAuthorizationError = Schema.is(EnvironmentAuthorizationError);

/** A failed crew request as the one sentence its surface shows. */
export function crewFailureSentence(cause: unknown): string {
  if (isCrewCommandError(cause)) return crewRefusalSentence(cause.reason, cause.detail);
  if (isEnvironmentAuthorizationError(cause)) return cause.message;
  return "Something went wrong.";
}

/** The engine's reason for a refused request; `null` for any other failure. */
export function crewRefusalOf(cause: unknown): CrewRefusalReason | null {
  return isCrewCommandError(cause) ? cause.reason : null;
}

export type CrewCommandTag = CrewCommand["_tag"];

export interface UseCrewCommand {
  /** Sends one press; its result, or `null` when it failed or was interrupted. */
  readonly send: (command: CrewCommand) => Promise<CrewCommandResult | null>;
  /** The crew home's files; `null` when the read failed. */
  readonly readFiles: () => Promise<CrewFiles | null>;
  /** Writes the files listed and leaves the rest; whether it saved. */
  readonly writeFiles: (files: CrewFiles) => Promise<boolean>;
  /** Anything of this caller's is in flight. */
  readonly pending: boolean;
  readonly isPending: (tag: CrewCommandTag | "filesGet" | "filesPut") => boolean;
  /** The last failure's sentence, until the next request or `clearError`. */
  readonly error: string | null;
  /** The last request's refusal reason, read after its press settles (e.g. `unlanded-commits`). */
  readonly lastRefusal: () => CrewRefusalReason | null;
  readonly clearError: () => void;
}

type RequestKey = CrewCommandTag | "filesGet" | "filesPut";

export function useCrewCommand(environmentId: EnvironmentId | null): UseCrewCommand {
  const [inFlight, setInFlight] = useState<ReadonlyMap<RequestKey, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const refusal = useRef<CrewRefusalReason | null>(null);
  const runCommand = useAtomCommand(crewCommands.command, "zerops crew command");
  const runFilesGet = useAtomCommand(crewCommands.filesGet, "zerops crew files get");
  const runFilesPut = useAtomCommand(crewCommands.filesPut, "zerops crew files put");

  const track = useCallback(
    async <A>(
      key: RequestKey,
      run: () => Promise<AtomCommandResult<A, unknown>>,
    ): Promise<{ readonly ok: true; readonly value: A } | { readonly ok: false }> => {
      const count = (delta: number) =>
        setInFlight((current) => {
          const next = new Map(current);
          const value = (next.get(key) ?? 0) + delta;
          if (value > 0) next.set(key, value);
          else next.delete(key);
          return next;
        });
      setError(null);
      refusal.current = null;
      count(1);
      const result = await run();
      count(-1);
      if (result._tag === "Success") return { ok: true, value: result.value };
      if (!isAtomCommandInterrupted(result)) {
        const cause = squashAtomCommandFailure(result);
        refusal.current = crewRefusalOf(cause);
        setError(crewFailureSentence(cause));
      }
      return { ok: false };
    },
    [],
  );

  const send = useCallback(
    async (command: CrewCommand) => {
      if (environmentId === null) return null;
      const outcome = await track(command._tag, () =>
        runCommand({ environmentId, input: command }),
      );
      return outcome.ok ? outcome.value : null;
    },
    [environmentId, runCommand, track],
  );

  const readFiles = useCallback(async () => {
    if (environmentId === null) return null;
    const outcome = await track("filesGet", () => runFilesGet({ environmentId, input: {} }));
    return outcome.ok ? outcome.value : null;
  }, [environmentId, runFilesGet, track]);

  const writeFiles = useCallback(
    async (files: CrewFiles) => {
      if (environmentId === null) return false;
      const outcome = await track("filesPut", () => runFilesPut({ environmentId, input: files }));
      return outcome.ok;
    },
    [environmentId, runFilesPut, track],
  );

  return {
    send,
    readFiles,
    writeFiles,
    pending: inFlight.size > 0,
    isPending: (key) => inFlight.has(key),
    error,
    lastRefusal: () => refusal.current,
    clearError: () => setError(null),
  };
}
