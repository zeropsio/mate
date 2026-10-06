/**
 * HQ's update, for an owner or an admin (`ZeropsHqCard`): offered when HQ's stream names an older
 * Core than this app carries, so the offer costs no read of its own — or, where the stream names
 * none, when the opened card's read of Zerops does. Opened, it reads where HQ
 * stands — the Core HQ's health answers with, and its `hq` service's builds in Zerops; again when
 * HQ answers with another Core — and offers the one action that fits. *Update HQ* deploys the carried Core with the person's own token and follows that deploy;
 * once it ends Zerops is read again. Nothing reads or retries while it is closed.
 */
import {
  readHqUpdate,
  runHqUpdate,
  type HqUpdateOutcome,
  type HqUpdateState,
} from "@t3tools/client-runtime/zerops/hq";
import { useCallback, useEffect, useState } from "react";

import { readBundledCore } from "~/zerops/accountHq";
import { appBasePath } from "~/basePath";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

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

type Read =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly state: HqUpdateState }
  | { readonly kind: "unread"; readonly reason: string };

export function ZeropsHqUpdatePanel({
  answering,
  read,
  run,
  onBusy,
}: {
  /** The Core HQ's health names; `undefined` while unread. */
  readonly answering: string | undefined;
  /** Where HQ stands, read from Zerops. */
  readonly read: () => Promise<HqUpdateState>;
  /** Deploys the carried Core and follows it to its end. */
  readonly run: () => Promise<HqUpdateOutcome>;
  readonly onBusy?: (busy: boolean) => void;
}) {
  const [shown, setShown] = useState<Read>({ kind: "reading" });
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState<string | null>(null);
  /** The Core an update pressed here deployed: Zerops may offer it again for a few seconds. */
  const [ran, setRan] = useState<string | null>(null);

  /** Zerops' answer, as the panel shows it. */
  const settle = useCallback(
    () =>
      read().then(
        (state): Read => ({ kind: "read", state }),
        (cause: unknown): Read => ({
          kind: "unread",
          reason: cause instanceof Error ? cause.message : "Zerops could not be reached.",
        }),
      ),
    [read],
  );

  useEffect(() => {
    let live = true;
    void settle().then((next) => {
      if (live) setShown(next);
    });
    return () => {
      live = false;
    };
  }, [settle]);

  const update = async () => {
    setRunning(true);
    setStopped(null);
    onBusy?.(true);
    const outcome = await run();
    setStopped(outcome.ok ? null : outcome.reason);
    if (outcome.ok && shown.kind === "read" && shown.state.kind !== "current") {
      setRan(shown.state.kind === "updating" ? null : shown.state.carried);
    }
    setRunning(false);
    onBusy?.(false);
    setShown({ kind: "reading" });
    setShown(await settle());
  };

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
        <DialogClose render={<Button disabled={running} variant="ghost" />}>Close</DialogClose>
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
  const { client } = useZeropsSession();
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
  const read = useCallback(
    () => readHqUpdate({ platform: client, projectId, carried, answering }),
    [answering, carried, client, projectId],
  );
  const run = useCallback(
    () =>
      runHqUpdate({
        platform: client,
        projectId,
        answering,
        core: () =>
          readBundledCore((input, init) => fetch(input, init), `${appBasePath()}/hq-core`),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
      }),
    [answering, client, projectId],
  );
  return (
    <>
      <Button onClick={() => setOpen(true)} size="xs" variant="link">
        {trigger}
      </Button>
      <Dialog
        onOpenChange={(next) => {
          // An update under way is seen through: its end has somewhere to land.
          if (!next && busy) return;
          setOpen(next);
        }}
        open={open}
      >
        <DialogPopup className="max-w-md">
          {open ? (
            <ZeropsHqUpdatePanel answering={answering} onBusy={busyNow} read={read} run={run} />
          ) : null}
        </DialogPopup>
      </Dialog>
    </>
  );
}
