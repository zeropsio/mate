/**
 * HQ's update, for an owner or an admin (`ZeropsHqCard`): offered when HQ's stream names an older
 * Core than this app carries, so the offer costs no read of its own — or, where the stream names
 * none, when the opened card's facts of HQ's project do. Opened, it says where HQ stands — the
 * Core HQ's health answers with, and its `hq` service's builds as the account observes them — and
 * offers the one action that fits. *Update HQ* is the account's `hq-update` operation: it deploys
 * the carried Core with the person's own token, and its build's own end is the update's. Its
 * builds are held only while the update is followed; nothing reads on a clock or retries.
 */
import { useAtomValue } from "@effect/atom-react";
import { NOT_READ_PROCESSES, projectProcessesAtom } from "@t3tools/client-runtime/data";
import { HQ_SERVICE, hqUpdateState, type HqUpdateState } from "@t3tools/client-runtime/zerops/hq";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAccountOperations } from "~/zerops/accountOperations";
import { useAccountOrgId, useDetailDemand, useProjectServices } from "~/zerops/ZeropsAccountData";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { hqUpdateWords } from "./ZeropsHqUpdate.logic";

/** Where HQ's Core stands, as the account's facts of its project say it now. */
export type HqUpdateRead =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly state: HqUpdateState }
  | { readonly kind: "unread"; readonly reason: string };

/** How an update pressed here ended: through, or stopped with what stopped it. */
export type HqUpdateOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export function ZeropsHqUpdatePanel({
  answering,
  read,
  run,
  onBusy,
}: {
  /** The Core HQ's health names; `undefined` while unread. */
  readonly answering: string | undefined;
  /** Where HQ stands, as Zerops's facts say it now. */
  readonly read: HqUpdateRead;
  /** Deploys the carried Core, to the end its build says. */
  readonly run: () => Promise<HqUpdateOutcome>;
  readonly onBusy?: (busy: boolean) => void;
}) {
  const [running, setRunning] = useState(false);
  const pending = useRef(false);
  const [stopped, setStopped] = useState<string | null>(null);
  /** The Core an update pressed here deployed: Zerops may offer it again for a few seconds. */
  const [ran, setRan] = useState<string | null>(null);

  const update = async () => {
    if (pending.current) return;
    pending.current = true;
    setRunning(true);
    setStopped(null);
    onBusy?.(true);
    const outcome = await run();
    setStopped(outcome.ok ? null : outcome.reason);
    if (outcome.ok && read.kind === "read" && read.state.kind !== "current") {
      setRan(read.state.kind === "updating" ? null : read.state.carried);
    }
    setRunning(false);
    pending.current = false;
    onBusy?.(false);
  };

  const shown = read;
  const state: HqUpdateState | null =
    shown.kind !== "read"
      ? null
      : (shown.state.kind === "available" || shown.state.kind === "failed") &&
          shown.state.carried === ran
        ? { kind: "current", running: ran }
        : shown.state;
  const words = state === null ? null : hqUpdateWords(state, answering);
  const line = running
    ? "Updating HQ… It keeps serving until the new Core answers."
    : shown.kind === "reading"
      ? "Reading HQ from Zerops…"
      : shown.kind === "unread"
        ? `Couldn't read HQ from Zerops: ${shown.reason}`
        : words!.line;
  const action = words?.action ?? null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Update HQ</DialogTitle>
        <DialogDescription>
          HQ moves to the Core this app carries. It keeps serving while the new Core starts, and
          stays on the Core it runs if the new one does not start.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="space-y-2">
          <p className="text-sm" role="status">
            {line}
          </p>
          {stopped === null ? null : (
            <p className="text-sm text-destructive-foreground">{stopped}</p>
          )}
        </div>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Close</DialogClose>
        {action === null ? null : (
          <Button data-hq-update-action disabled={running} onClick={() => void update()}>
            {action}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/** The offer on HQ's card, and the dialog it opens. */
export function ZeropsHqUpdate({
  projectId,
  carried,
  answering,
  trigger,
  onBusy,
  onFollowing,
}: {
  /** HQ's project. */
  readonly projectId: string;
  /** The Core this app carries. */
  readonly carried: string;
  /** The Core HQ's stream names; `undefined` where it names none, and Zerops says it. */
  readonly answering: string | undefined;
  readonly trigger: "Update available" | "Up to date" | "Update HQ";
  /** Told when an update pressed here starts and ends. */
  readonly onBusy: (busy: boolean) => void;
  /** Told whether the person follows it: its dialog open, or its update running. */
  readonly onFollowing: (following: boolean) => void;
}) {
  const orgId = useAccountOrgId();
  const { run: runOperation } = useAccountOperations();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const following = open || busy;
  useEffect(() => {
    onFollowing(following);
  }, [following, onFollowing]);
  const busyNow = useCallback(
    (next: boolean) => {
      setBusy(next);
      onBusy(next);
    },
    [onBusy],
  );
  const { read, serviceId } = useHqUpdateRead(projectId, carried, answering, following);
  const running = read.kind === "read" && "running" in read.state ? read.state.running : "";
  const run = useCallback(async (): Promise<HqUpdateOutcome> => {
    if (orgId === null || serviceId === undefined)
      return { ok: false, reason: "Zerops lists no hq service in HQ's project." };
    try {
      await runOperation(
        { kind: "hq-update", orgId, projectId, serviceId, running, carried },
        { orgId, unobserved: UPDATE_UNFOLLOWED },
      );
      return { ok: true };
    } catch (cause) {
      return {
        ok: false,
        reason:
          cause instanceof Error && cause.message.length > 0
            ? cause.message
            : "Zerops could not be reached.",
      };
    }
  }, [carried, orgId, projectId, runOperation, running, serviceId]);
  return (
    <>
      <Button onClick={() => setOpen(true)} size="xs" variant="link">
        {trigger}
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogPopup className="max-w-md" keepMounted={busy}>
          {open || busy ? (
            <ZeropsHqUpdatePanel answering={answering} onBusy={busyNow} read={read} run={run} />
          ) : null}
        </DialogPopup>
      </Dialog>
    </>
  );
}

/** What an update says where its build can no longer be followed to its end. */
const UPDATE_UNFOLLOWED =
  "HQ's update could not be followed to its end. Its build in Zerops says where it stands.";

const NO_PROCESSES = Atom.make(NOT_READ_PROCESSES);

/**
 * Where HQ stands, from what the account observes of its project: its `hq` service as the
 * organization's services listing holds it, and its newest builds — its process history, held
 * while the update is followed. Nothing is read on a clock: a build that moves moves it.
 */
function useHqUpdateRead(
  projectId: string,
  carried: string,
  answering: string | undefined,
  followed: boolean,
): { readonly read: HqUpdateRead; readonly serviceId: string | undefined } {
  useDetailDemand("process", "history", followed ? projectId : null);
  const listed = useProjectServices(projectId);
  const activity = useAtomValue(followed ? projectProcessesAtom(projectId) : NO_PROCESSES);
  const service = listed.services?.find((entry) => entry.name === HQ_SERVICE);
  if (listed.unavailableReason !== undefined || activity.history === "failed")
    return { read: { kind: "unread", reason: "Zerops refused to say." }, serviceId: undefined };
  if (
    listed.services === undefined ||
    activity.history !== "read" ||
    activity.processes === undefined
  )
    return { read: { kind: "reading" }, serviceId: undefined };
  if (service === undefined)
    return {
      read: { kind: "unread", reason: "Zerops lists no hq service in HQ's project." },
      serviceId: undefined,
    };
  return {
    read: {
      kind: "read",
      state: hqUpdateState({ service, processes: activity.processes, carried, answering }),
    },
    serviceId: service.id,
  };
}
