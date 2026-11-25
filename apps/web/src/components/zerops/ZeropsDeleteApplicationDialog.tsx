/**
 * Deleting a project with its code: what goes and what stays, listed (`deleteApplicationWords`),
 * one field that asks for its name, one button that starts it at HQ. The button stays shut until
 * HQ said what the project holds and the name is typed as it is spelled. HQ runs the deletion as
 * its operation, which the dialog says on every device under the field from HQ's navigation
 * (`applicationDeletionLine`): the stages still to go while it runs, its failure with Zerops' code
 * and Delete again, or whose Continue it waits for. HQ's refusal of the start is said there too.
 * It closes once HQ removed the project. Opened by its last Mate's Delete, it deletes that Mate
 * first, keeping the project's Git meanwhile so HQ asks nobody whether to keep it, and starts the
 * project's deletion once HQ let go of the Mate (`applicationDeletionHold`); closed meanwhile, it
 * goes out of sight and carries on. Opened from the menu, the button stays shut while a Mate holds
 * the project.
 */
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { hqOperationOf } from "@t3tools/client-runtime/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import { cn } from "~/lib/utils";
import { FailureDetails } from "~/components/ui/failure";
import { useDeleteApplication } from "./useDeleteApplication";
import { useDeleteApplicationDialog, type DeleteApplicationMate } from "./deleteApplicationDialog";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { applicationOperationAtom, hqNavigationAtom, hqPlacementsAtom } from "~/state/zerops";
import { randomUUID } from "~/lib/utils";
import { useAccountOperations } from "~/zerops/accountOperations";
import { useHqStructure } from "~/zerops/useHqOffers";
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
import { ZeropsOperationEnd } from "./ZeropsOperationEnd";
import { endOperationIntent } from "./ZeropsOperationEnd.logic";

export function ZeropsDeleteApplicationForm({
  name,
  words,
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
  /** Why it cannot start yet (`applicationDeletionHold`); absent once it can. */
  readonly hold?:
    | { readonly words: string; readonly failed: boolean; readonly details: string | null }
    | undefined;
  readonly pending: boolean;
  /** What it started runs: nothing to press, and closing stops nothing. */
  readonly running?: boolean;
  /** Why the last press did not delete it; `null` where it did not fail. */
  readonly error: string | null;
  /** How HQ's deletion of it stands (`applicationDeletionLine`), where it runs or failed. */
  readonly status?:
    | { readonly words: string; readonly failed: boolean; readonly details: string | null }
    | undefined;
  /**
   * HQ's deletion stopped waiting for someone's Continue: who, the reader's own Continue, and the
   * End HQ offers an Owner or an Admin once its maker cannot continue it.
   */
  readonly waiting?:
    | {
        readonly line: ReactNode;
        readonly press: string;
        readonly onContinue?: () => void;
        readonly onEnd?: () => void;
      }
    | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const confirmed =
    hold === undefined && words.goes !== undefined && deleteMateConfirmed(typed, name);
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
        <DialogDescription>{words.body}</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="space-y-3">
          <DeleteApplicationLists words={words} />
          <div className="space-y-1.5">
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
            <p
              className={cn(
                "min-h-4 text-caption",
                failed ? "text-status-failed-text" : "text-muted-foreground",
              )}
              id={`${id}-reason`}
              role="alert"
            >
              {reason}
            </p>
            {details === null ? null : <FailureDetails>{details}</FailureDetails>}
          </div>
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          {running || waiting !== undefined ? "Close" : "Cancel"}
        </Button>
        {waiting?.onContinue === undefined ? null : (
          <Button onClick={waiting.onContinue} disabled={pending} type="button" variant="secondary">
            {waiting.press}
          </Button>
        )}
        {waiting?.onEnd === undefined ? null : (
          <ZeropsOperationEnd
            disabled={pending}
            kind="app_deletion"
            name={name}
            onEnd={waiting.onEnd}
          />
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
  mate,
  hidden,
  onHide,
  onClose,
}: {
  readonly target: DeleteApplicationTarget;
  /** Its last Mate, deleted first. */
  readonly mate: DeleteApplicationMate | undefined;
  readonly hidden: boolean;
  readonly onHide: () => void;
  readonly onClose: () => void;
}) {
  const remove = useDeleteApplication();
  const operations = useAccountOperations();
  const { activeOrganization } = useZeropsSession();
  const orgId = activeOrganization?.id;
  const detail = useHqAppDetail(target.appId);
  const words = deleteApplicationWords(target, applicationHoldings(detail), mate);
  const placements = useAtomValue(hqPlacementsAtom);
  const structure = useHqStructure();
  // HQ took its last Mate's deletion from here; before that, the Mate standing in it is no hold.
  const [mateTaken, setMateTaken] = useState(false);
  const standing = applicationDeletionHold(
    placements,
    target.appId,
    structure?.apps.find((app) => app.id === target.appId)?.contents?.deletingProjectIds ?? [],
    mateTaken,
  );
  const hold = mate === undefined || mateTaken || placements === null ? standing : undefined;
  const deletion = hqOperationOf(
    useAtomValue(applicationOperationAtom(target.appId)),
    "app_deletion",
  );
  const gone = useAtomValue(applicationGoneAtom(target.appId));
  const line = applicationDeletionLine(deletion, stagesStanding(target, placements));
  // One id per start this dialog makes, sent again with the same body (HQ answers it again) until
  // HQ shows the deletion failed: that ended whatever start it took, so a Delete after it starts anew.
  const startId = useRef<string | null>(null);
  // The Mate's deletion: one id for this dialog, sent again with the same body until HQ took it.
  const mateStartId = useRef<string | null>(null);
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
  const submit = (intent: Parameters<typeof operations.submit>[0]) =>
    operations.submit(intent).then(({ progress, evidence }) => {
      const trouble = writeTrouble(progress, evidence);
      if (trouble !== null) throw new Error(trouble);
    });
  const run = () => {
    if (mate !== undefined && !mateTaken) {
      if (orgId === undefined) return;
      mateStartId.current ??= randomUUID();
      settle(
        submit({
          kind: "start-mate-deletion",
          orgId,
          projectId: mate.projectId,
          id: mateStartId.current,
          keptGit: "keep",
        }).then(() => {
          if (active.current) setMateTaken(true);
          mate.leave();
        }),
      );
      return;
    }
    if (deletion.kind === "failed" || startId.current === null) startId.current = randomUUID();
    settle(remove(target, startId.current));
  };
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  // Its last Mate's deletion taken, the project's starts when HQ's structure lets it, once.
  const started = useRef(false);
  const free = hold === undefined;
  useEffect(() => {
    if (mateTaken && free && !started.current) {
      started.current = true;
      run();
    }
  }, [mateTaken, free]);
  // HQ removed the project: nothing is left to delete or to say.
  useEffect(() => {
    if (gone) onClose();
  }, [gone]);
  const end = endOperationIntent(deletion, orgId, target.appId);
  const waiting =
    deletion.kind !== "waiting" || orgId === undefined
      ? undefined
      : {
          line: <DeletionWaitingWords orgId={orgId} userId={deletion.continueBy} />,
          press: deletion.press,
          ...(deletion.yours
            ? {
                onContinue: () => {
                  settle(
                    submit({
                      kind: "continue-operation",
                      orgId,
                      id: deletion.id,
                      appId: target.appId,
                    }),
                  );
                },
              }
            : {}),
          ...(end === undefined
            ? {}
            : {
                onEnd: () => {
                  settle(submit(end));
                },
              }),
        };
  // What it started runs on from the Mate's deletion to the project's end, unless either stopped.
  const carrying =
    mateTaken &&
    hold?.failed !== true &&
    deletion.kind !== "failed" &&
    deletion.kind !== "waiting" &&
    error === null;
  const running = deletion.kind === "going" || carrying;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) (carrying ? onHide : onClose)();
      }}
      open={!hidden}
    >
      <DialogPopup className="max-w-md">
        <ZeropsDeleteApplicationForm
          error={error}
          hold={hold}
          status={line}
          name={target.name}
          onCancel={carrying ? onHide : onClose}
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
  const hide = useDeleteApplicationDialog((state) => state.hide);
  const close = useDeleteApplicationDialog((state) => state.close);
  if (request === null) return null;
  return (
    <ZeropsDeleteApplicationDialog
      hidden={request.hidden}
      key={request.id}
      mate={request.mate}
      onClose={close}
      onHide={hide}
      target={request.target}
    />
  );
}
