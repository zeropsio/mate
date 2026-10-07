import { useAtomValue } from "@effect/atom-react";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import { Atom } from "effect/unstable/reactivity";
/**
 * Presses on a crew surface, and the crew home's files for its editors.
 *
 * Each caller holds its own pending and error state, so a sheet or a row shows
 * its own outcome inline; the state a command changes arrives on the crew feed,
 * never through this hook. A refusal reads as one sentence
 * (`crewRefusalSentence`): the engine's detail, or its reason's own words.
 *
 * A press may name its `origin` — the row or button it came from — so its
 * failure shows there (`errorAt`), not in a line of its own. A failure lasts
 * until the next request or for {@link CREW_FAILURE_SHOWN_MS}, whichever comes
 * first: a refusal is news about a press, not a state of the crew.
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
import { useCallback, useEffect, useRef, useState } from "react";

import { useAtomCommand } from "../../state/use-atom-command";
import { crewCommands, crewFilesAtom } from "./crewCommands";

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

/** How long a refused press says so. */
export const CREW_FAILURE_SHOWN_MS = 10_000;

export interface CrewFailure {
  readonly sentence: string;
  /** The row or button the press came from; `null` for none. */
  readonly origin: string | null;
}

/** The failure shown at `origin` — at the press's own row, or, owned by none, at `null`. */
export function crewFailureAt(failure: CrewFailure | null, origin: string | null): string | null {
  return failure !== null && failure.origin === origin ? failure.sentence : null;
}

export type CrewCommandTag = CrewCommand["_tag"];

const UNREAD_FILES = Atom.make<Known<CrewFiles>>({ state: "unread", waitingFor: "mate-session" });
export interface UseCrewCommand {
  readonly files: Known<CrewFiles>;
  /**
   * Sends one press; its result, or `null` when it failed or was interrupted.
   * `origin` names the row or button it came from, where its failure shows.
   */
  readonly send: (command: CrewCommand, origin?: string) => Promise<CrewCommandResult | null>;
  /** The crew home's files; `null` when the read failed. */
  readonly readFiles: () => Promise<CrewFiles | null>;
  /** Writes the files listed and leaves the rest; whether it saved. */
  readonly writeFiles: (files: CrewFiles) => Promise<boolean>;
  /** Anything of this caller's is in flight. */
  readonly pending: boolean;
  readonly isPending: (tag: CrewCommandTag | "filesGet" | "filesPut") => boolean;
  /** The last failure's sentence, wherever it came from, while it shows. */
  readonly error: string | null;
  /** The last failure's sentence at `origin` (`crewFailureAt`); `null` for an unplaced one's line. */
  readonly errorAt: (origin: string | null) => string | null;
  /** The last request's refusal reason, read after its press settles (e.g. `unlanded-commits`). */
  readonly lastRefusal: () => CrewRefusalReason | null;
  readonly clearError: () => void;
}

type RequestKey = CrewCommandTag | "filesGet" | "filesPut";

export function useCrewCommand(environmentId: EnvironmentId | null): UseCrewCommand {
  const files = useAtomValue(environmentId === null ? UNREAD_FILES : crewFilesAtom(environmentId));
  const [inFlight, setInFlight] = useState<ReadonlyMap<RequestKey, number>>(new Map());
  const [failure, setFailure] = useState<CrewFailure | null>(null);
  const refusal = useRef<CrewRefusalReason | null>(null);
  const runCommand = useAtomCommand(crewCommands.command, "zerops crew command");
  const runFilesGet = useAtomCommand(crewCommands.filesGet, "zerops crew files get");
  const runFilesPut = useAtomCommand(crewCommands.filesPut, "zerops crew files put");

  const track = useCallback(
    async <A>(
      key: RequestKey,
      run: () => Promise<AtomCommandResult<A, unknown>>,
      origin: string | null,
    ): Promise<{ readonly ok: true; readonly value: A } | { readonly ok: false }> => {
      const count = (delta: number) =>
        setInFlight((current) => {
          const next = new Map(current);
          const value = (next.get(key) ?? 0) + delta;
          if (value > 0) next.set(key, value);
          else next.delete(key);
          return next;
        });
      setFailure(null);
      refusal.current = null;
      count(1);
      const result = await run();
      count(-1);
      if (result._tag === "Success") return { ok: true, value: result.value };
      if (!isAtomCommandInterrupted(result)) {
        const cause = squashAtomCommandFailure(result);
        refusal.current = crewRefusalOf(cause);
        setFailure({ sentence: crewFailureSentence(cause), origin });
      }
      return { ok: false };
    },
    [],
  );

  useEffect(() => {
    if (failure === null) return;
    const timer = setTimeout(() => setFailure(null), CREW_FAILURE_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [failure]);

  const send = useCallback(
    async (command: CrewCommand, origin?: string) => {
      if (environmentId === null) return null;
      const outcome = await track(
        command._tag,
        () => runCommand({ environmentId, input: command }),
        origin ?? null,
      );
      return outcome.ok ? outcome.value : null;
    },
    [environmentId, runCommand, track],
  );

  const readFiles = useCallback(async () => {
    if (environmentId === null) return null;
    const outcome = await track("filesGet", () => runFilesGet({ environmentId, input: {} }), null);
    return outcome.ok ? outcome.value : null;
  }, [environmentId, runFilesGet, track]);

  const writeFiles = useCallback(
    async (files: CrewFiles) => {
      if (environmentId === null) return false;
      const outcome = await track(
        "filesPut",
        () => runFilesPut({ environmentId, input: files }),
        null,
      );
      return outcome.ok;
    },
    [environmentId, runFilesPut, track],
  );

  const readFailure =
    files.state === "failed"
      ? files.failure.kind === "refused"
        ? files.failure.words
        : "The Mate could not report the crew files."
      : null;
  const shownFailure =
    failure ?? (readFailure === null ? null : { sentence: readFailure, origin: null });
  return {
    files,
    send,
    readFiles,
    writeFiles,
    pending: inFlight.size > 0,
    isPending: (key) => inFlight.has(key),
    error: shownFailure?.sentence ?? null,
    errorAt: (origin) => crewFailureAt(shownFailure, origin),
    lastRefusal: () => refusal.current,
    clearError: () => setFailure(null),
  };
}
