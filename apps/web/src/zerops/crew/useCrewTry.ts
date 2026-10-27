/**
 * *Try its work* for one crewmate, as a press (`crewTry.ts` decides what it
 * does): the crewmate's menu on the conversation's line and *Try it* on a
 * finished task's result row both press it. An address it can open now opens
 * at once; a stopped app is run, and a copy not on dev is shown there, and the
 * address opens once the crew's feed says it can — for as long as the engine
 * waits on a Show-on-dev request, then the wait is dropped.
 *
 * An address opens where the conversation opens its services' addresses
 * (`ServiceBrowserLink`): in the side panel's preview when it is one of the
 * project's routes, else in a new tab. A refused press says so in a toast
 * titled for it, with the engine's own sentence.
 *
 * For a crewmate the viewer may not run (D6) it only opens: work already
 * running or shown, or on its way there; running its app, showing it on dev
 * and stopping its app are not offered.
 */
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { crewMenuFailureWord } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewCommand, EnvironmentId } from "@t3tools/contracts";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { ServiceBrowserLinkContext } from "../../components/ServiceBrowserLink";
import { stackedThreadToast, toastManager } from "../../components/ui/toast";
import { useAtomCommand } from "../../state/use-atom-command";
import { useZeropsTopology } from "../useZeropsFeeds";
import { crewCommands } from "./crewCommands";
import { crewTryOf, crewTryOpens, crewTryPress, crewTryStops, type CrewTry } from "./crewTry";
import { useCrew } from "./useCrew";
import { useCrewAccess } from "./useCrewAccess";
import { crewFailureSentence } from "./useCrewCommand";

/** How long a press waits for the work to open: the engine's own wait on a Show-on-dev request. */
export const CREW_TRY_WAIT_MS = 10 * 60_000;

export interface CrewTryControl {
  readonly tries: CrewTry;
  /** A press does something now; not while one of its presses is on its way. */
  readonly enabled: boolean;
  /** Offered to this viewer: for a crewmate they may not run, only a press that opens. */
  readonly offered: boolean;
  readonly press: () => void;
  /** *Stop its app*, while its own app runs and the viewer runs it; `null` otherwise. */
  readonly stop: (() => void) | null;
}

/** `null` for a crewmate with no copy of the code, or a crew not read yet. */
export function useCrewTry(
  environmentId: EnvironmentId | null,
  handle: string | null,
): CrewTryControl | null {
  const { snapshot, view, current } = useCrew(environmentId);
  const access = useCrewAccess(environmentId, snapshot);
  const services = useZeropsTopology(environmentId)?.services;
  const runCommand = useAtomCommand(crewCommands.command, { reportFailure: false });
  const resolvePreview = useContext(ServiceBrowserLinkContext);
  const [pending, setPending] = useState(false);
  const [waiting, setWaiting] = useState<{
    readonly handle: string;
    readonly until: number;
  } | null>(null);
  const row =
    handle === null ? undefined : view?.crewmates.find((each) => each.crewmate.handle === handle);
  const tries = useMemo(
    () =>
      snapshot === null || row === undefined
        ? null
        : crewTryOf(snapshot.hosts, row.crewmate, services),
    [row, services, snapshot],
  );

  const open = useCallback(
    (url: string) => {
      const preview = resolvePreview?.(url) ?? null;
      if (preview !== null) preview();
      else window.open(url, "_blank", "noopener,noreferrer");
    },
    [resolvePreview],
  );

  // A press waiting on the work opens it once the feed says it can — once:
  // the wait it answered is marked answered, and lapses with its time.
  const opens = tries === null ? null : crewTryOpens(tries);
  const waitingHere = waiting !== null && waiting.handle === handle && opens === null;
  const answered = useRef<object | null>(null);
  useEffect(() => {
    if (waiting === null || waiting.handle !== handle || opens === null) return;
    if (answered.current === waiting) return;
    answered.current = waiting;
    open(opens);
  }, [handle, open, opens, waiting]);
  useEffect(() => {
    if (waiting === null) return;
    const timer = setTimeout(() => setWaiting(null), Math.max(0, waiting.until - Date.now()));
    return () => clearTimeout(timer);
  }, [waiting]);

  const name = row?.crewmate.displayName ?? handle ?? "";
  const send = useCallback(
    async (command: CrewCommand, press: "try" | "stop"): Promise<boolean> => {
      if (environmentId === null) return false;
      setPending(true);
      const result = await runCommand({ environmentId, input: command });
      setPending(false);
      if (result._tag === "Success") return true;
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: crewMenuFailureWord(press, name),
            description: crewFailureSentence(squashAtomCommandFailure(result)),
          }),
        );
      }
      return false;
    },
    [environmentId, name, runCommand],
  );

  if (tries === null || row === undefined || handle === null) return null;
  const action = crewTryPress(tries, row.working);
  const waitFor = () => setWaiting({ handle, until: Date.now() + CREW_TRY_WAIT_MS });
  const runs = access.crewmate(handle) === null;
  const onlyOpens = action?.kind === "open" || action?.kind === "wait";
  return {
    tries,
    enabled: action !== null && current && !pending && !waitingHere && !access.reading,
    offered: runs || onlyOpens,
    press: () => {
      if (action === null || !(runs || onlyOpens)) return;
      switch (action.kind) {
        case "open":
          open(action.url);
          return;
        case "wait":
          waitFor();
          return;
        case "run":
        case "show":
          waitFor();
          void send(
            action.kind === "run" ? { _tag: "appRun", handle } : { _tag: "showOnDev", handle },
            "try",
          ).then((sent) => {
            if (!sent) setWaiting(null);
          });
          return;
      }
    },
    stop: runs && crewTryStops(tries) ? () => void send({ _tag: "appStop", handle }, "stop") : null,
  };
}
