/**
 * Deleting a project with its code: what goes and what stays, listed (`deleteApplicationWords`),
 * one field that asks for its name, one button that starts it at HQ. The button stays shut until
 * HQ said what the project holds and the name is typed as it is spelled. HQ runs the deletion as
 * its operation, which the dialog says on every device under the field from HQ's navigation
 * (`applicationDeletionLine`): the stages still to go while it runs, its failure with Zerops' code
 * and Delete again, or whose Continue it waits for. HQ's refusal of the start is said there too.
 * It closes once HQ removed the project. Opened confirmed — by its last Mate's Delete — it starts
 * once HQ let go of that Mate (`applicationDeletionHold`); the button stays shut while a Mate holds
 * it.
 */
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { hqOperationOf } from "@t3tools/client-runtime/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import { cn } from "~/lib/utils";
import { useDeleteApplication } from "./useDeleteApplication";
import { useDeleteApplicationDialog } from "./deleteApplicationDialog";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { applicationOperationAtom, hqNavigationAtom, hqPlacementsAtom } from "~/state/zerops";
import { randomUUID } from "~/lib/utils";
import { useAccountOperations } from "~/zerops/accountOperations";
import { useHqPersonNames } from "~/zerops/useZeropsMateOwners";
import { writeTrouble } from "~/zerops/zeropsWrite";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  applicationDeletionHold,
  applicationDeletionLine,
  applicationHoldings,
  deleteApplicationWords,
  stagesStanding,
  type DeleteApplicationTarget,
  type DeleteApplicationWords,
} from "./ZeropsDeleteApplicationDialog.logic";
import { DeleteApplicationLists } from "./ZeropsDeleteApplicationLists";
import { deleteMateConfirmed } from "./ZeropsDeleteMateDialog.logic";
import { ZeropsAnswerDetails } from "./ZeropsAnswerDetails";

export function ZeropsDeleteApplicationForm({
  name,
  words,
  confirmed: confirmedBefore = false,
  hold,
  pending,
  running = false,
  error,
  status,
  waiting,
  onCancel,
  onConfirm,
}: {
  /** The project's name, as the field asks for it. */
  readonly name: string;
  readonly words: DeleteApplicationWords;
  /** Confirmed in its last Mate's Delete: no field asks again. */
  readonly confirmed?: boolean;
  /** Why it cannot start yet (`applicationDeletionHold`); absent once it can. */
  readonly hold?:
    | { readonly words: string; readonly failed: boolean; readonly details: string | null }
    | undefined;
  readonly pending: boolean;
  /** HQ's deletion of it runs: nothing to press, and closing stops nothing. */
  readonly running?: boolean;
  /** Why the last press did not delete it; `null` where it did not fail. */
  readonly error: string | null;
  /** How HQ's deletion of it stands (`applicationDeletionLine`), where it runs or failed. */
  readonly status?:
    | { readonly words: string; readonly failed: boolean; readonly details: string | null }
    | undefined;
  /** HQ's deletion stopped waiting for someone's Continue: who, and the reader's own Continue. */
  readonly waiting?: { readonly line: ReactNode; readonly onContinue?: () => void } | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const confirmed =
    hold === undefined &&
    (confirmedBefore || (words.goes !== undefined && deleteMateConfirmed(typed, name)));
  const reason = error ?? waiting?.line ?? status?.words ?? hold?.words ?? null;
  const failed = error !== null || (status ?? hold)?.failed === true;
  const details =
    error !== null || waiting !== undefined ? null : ((status ?? hold)?.details ?? null);

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="delete-application-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!confirmed || pending) return;
        onConfirm();
      }}
    >
      <DialogHeader>
        <DialogTitle>{words.title}</DialogTitle>
        <DialogDescription>This can't be undone.</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="space-y-3">
          <DeleteApplicationLists words={words} />
          <div className="space-y-1.5 [&_.arrival-failure-details]:text-left!">
            {confirmedBefore ? null : (
              <>
                <Label htmlFor={`${id}-name`}>{words.label}</Label>
                <Input
                  aria-describedby={`${id}-reason`}
                  autoComplete="off"
                  autoFocus
                  id={`${id}-name`}
                  onChange={(event) => {
                    setTyped(event.target.value);
                  }}
                  readOnly={pending}
                  spellCheck={false}
                  value={typed}
                />
              </>
            )}
            <p
              className={cn(
                "min-h-4 text-xs",
                failed ? "text-status-failed-text" : "text-muted-foreground",
              )}
              id={`${id}-reason`}
              role="alert"
            >
              {reason}
            </p>
            {details === null ? null : <ZeropsAnswerDetails text={details} />}
          </div>
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          {running || waiting !== undefined ? "Close" : "Cancel"}
        </Button>
        {waiting?.onContinue === undefined ? null : (
          <Button onClick={waiting.onContinue} disabled={pending} type="button" variant="secondary">
            Continue
          </Button>
        )}
        <Button
          aria-busy={pending || undefined}
          aria-label={pending ? words.pending : words.submit}
          data-zerops-surface="delete-application-confirm"
          disabled={!confirmed || pending || waiting !== undefined}
          type="submit"
          variant="destructive"
        >
          <span className="grid">
            <span
              aria-hidden={pending}
              className={cn("col-start-1 row-start-1", pending && "invisible")}
            >
              {words.submit}
            </span>
            <span
              aria-hidden={!pending}
              className={cn("col-start-1 row-start-1", !pending && "invisible")}
            >
              {words.pending}
            </span>
          </span>
        </Button>
      </DialogFooter>
    </form>
  );
}

/** HQ's navigation no longer holds the application: it removed it. Unread is not gone. */
const applicationGoneAtom = Atom.family((appId: string) =>
  Atom.make((get) => {
    const structure = get(hqNavigationAtom).structure;
    return structure != null && !structure.apps.some((app) => app.id === appId);
  }).pipe(Atom.withLabel(`zerops:app-gone:${appId}`)),
);

/** Whom a stopped deletion waits for, by the member list's name of them; mounted only for one. */
function DeletionWaitingWords({
  orgId,
  userId,
}: {
  readonly orgId: string;
  readonly userId: string;
}) {
  const name = useHqPersonNames(orgId)(userId);
  return `Deleting stopped: waiting for ${name ?? "the person who started it"}`;
}

function ZeropsDeleteApplicationDialog({
  target,
  confirmed,
  onClose,
}: {
  readonly target: DeleteApplicationTarget;
  readonly confirmed: boolean;
  readonly onClose: () => void;
}) {
  const remove = useDeleteApplication();
  const operations = useAccountOperations();
  const { activeOrganization } = useZeropsSession();
  const detail = useHqAppDetail(target.appId);
  const words = deleteApplicationWords(target, applicationHoldings(detail));
  const placements = useAtomValue(hqPlacementsAtom);
  const hold = applicationDeletionHold(placements, target.appId);
  const deletion = hqOperationOf(
    useAtomValue(applicationOperationAtom(target.appId)),
    "app_deletion",
  );
  const gone = useAtomValue(applicationGoneAtom(target.appId));
  const line = applicationDeletionLine(deletion, stagesStanding(target, placements));
  // One id per start this dialog makes, sent again with the same body (HQ answers it again) until
  // HQ shows the deletion failed: that ended whatever start it took, so a Delete after it starts anew.
  const startId = useRef<string | null>(null);
  const active = useRef(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settle = (press: Promise<void>) => {
    setPending(true);
    setError(null);
    press.then(
      () => {
        if (active.current) setPending(false);
      },
      (cause: unknown) => {
        if (!active.current) return;
        setPending(false);
        setError(zeropsErrorMessage(cause));
      },
    );
  };
  const run = () => {
    if (deletion.kind === "failed" || startId.current === null) startId.current = randomUUID();
    settle(remove(target, startId.current));
  };
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  // Its last Mate's Delete confirmed it: it starts when HQ's structure lets it, once.
  const started = useRef(false);
  const free = hold === undefined;
  useEffect(() => {
    if (confirmed && free && !started.current) {
      started.current = true;
      run();
    }
  }, [confirmed, free]);
  // HQ removed the project: nothing is left to delete or to say.
  useEffect(() => {
    if (gone) onClose();
  }, [gone]);
  const orgId = activeOrganization?.id;
  const waiting =
    deletion.kind !== "waiting" || orgId === undefined
      ? undefined
      : {
          line: <DeletionWaitingWords orgId={orgId} userId={deletion.continueBy} />,
          ...(deletion.yours
            ? {
                onContinue: () => {
                  settle(
                    operations
                      .submit({
                        kind: "continue-operation",
                        orgId,
                        id: deletion.id,
                        appId: target.appId,
                      })
                      .then(({ progress, evidence }) => {
                        const trouble = writeTrouble(progress, evidence);
                        if (trouble !== null) throw new Error(trouble);
                      }),
                  );
                },
              }
            : {}),
        };
  const running = deletion.kind === "going";

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogPopup className="max-w-md">
        <ZeropsDeleteApplicationForm
          confirmed={confirmed}
          error={error}
          hold={hold}
          status={line}
          name={target.name}
          onCancel={onClose}
          onConfirm={run}
          pending={pending || running}
          running={running}
          waiting={waiting}
          words={words}
        />
      </DialogPopup>
    </Dialog>
  );
}

/** Mounted once: the open project's Delete dialog, if any (`useDeleteApplicationDialog`). */
export function ZeropsDeleteApplicationHost() {
  const request = useDeleteApplicationDialog((state) => state.request);
  const close = useDeleteApplicationDialog((state) => state.close);
  if (request === null) return null;
  return (
    <ZeropsDeleteApplicationDialog
      confirmed={request.confirmed === true}
      key={request.target.appId}
      onClose={close}
      target={request.target}
    />
  );
}
