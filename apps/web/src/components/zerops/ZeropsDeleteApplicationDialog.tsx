/**
 * Deleting a project, or its last Mate: one dialog that renders `deletionOffer`'s answer and
 * decides nothing. The last Mate of a project the person may delete whole offers the choice —
 * "Only {M}" (the default: its project, code, Stage and Production stay) or "{M} and the whole
 * project". The whole project lists what goes and what stays, asks each Stage slid and its name
 * typed before Delete opens; a Production Mate made goes only where its own name is typed and it
 * is slid too, else it stays. It sends one start: HQ deletes the Mate first, then each Stage, then
 * each Production slid, then the code, as one operation the tab is never needed for. HQ's navigation shows that operation on
 * every device: the part it deletes, the part it stopped at and whose Continue it waits for, or
 * what is gone and what is still here once it ended failed, with Delete again. A refusal of the
 * start stays under the field. It closes once HQ removed the project.
 */
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { hqOperationOf } from "@t3tools/client-runtime/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import { cn, randomUUID } from "~/lib/utils";
import { Failure, FailureDetails } from "~/components/ui/failure";
import { Text } from "~/components/ui/text";
import { Badge } from "~/components/ui/badge";
import { Loading } from "~/components/ui/loading";
import { RadioCard, RadioGroup } from "~/components/ui/radio-group";
import { SlideConfirm } from "~/components/ui/slide-confirm";
import { useDeleteApplicationDialog, type DeleteApplicationMate } from "./deleteApplicationDialog";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { applicationOperationAtom, hqNavigationAtom } from "~/state/zerops";
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
  applicationHoldings,
  deletionOffer,
  deletionProjectOf,
  deletionStandingWords,
  deletionStart,
  lastChoiceWords,
  productionDeletionWords,
  projectDeletionReady,
  projectDeletionWords,
  type ApplicationHoldings,
  type DeletionOffer,
  type DeletionPart,
  type DeletionProject,
  type ProjectDeletionPlan,
} from "./deletion.logic";
import {
  deleteMateConfirmed,
  deleteMateWords,
  MATE_DELETING_WORD,
} from "./ZeropsDeleteMateDialog.logic";
import { ZeropsOperationEnd } from "./ZeropsOperationEnd";
import { endOperationIntent } from "./ZeropsOperationEnd.logic";

/** What the person chose to delete, confirmed: the Mate alone, or the whole project as slid. */
export type DeletionChoice =
  | { readonly kind: "mate" }
  | { readonly kind: "project"; readonly slid: ReadonlySet<string> };

/** The Mate the dialog is about, as its words name it. */
type DeletionMate = Pick<DeleteApplicationMate, "name" | "services" | "owner">;

const PART_WORDS: Readonly<Record<DeletionPart["state"], string>> = {
  gone: "Gone",
  deleting: "Deleting",
  pending: "Waiting its turn",
  stopped: "Stopped here",
  here: "Still here",
};

/** HQ's parts of its deletion, each with how it stands. */
function DeletionParts({ parts }: { readonly parts: ReadonlyArray<DeletionPart> }) {
  if (parts.length === 0) return null;
  return (
    <ul className="space-y-1 text-body" data-zerops-surface="delete-application-parts">
      {parts.map((part) => (
        <li className="flex justify-between gap-3" key={`${part.part}:${part.label}`}>
          <span className="min-w-0 truncate">{part.label}</span>
          <span className={cn(part.state === "gone" ? "text-muted-foreground" : "text-foreground")}>
            {PART_WORDS[part.state]}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** What goes and what stays, as two short lists; what goes reads as unread until HQ said it. */
function DeletionLists({
  goes,
  stays,
}: {
  readonly goes: ReadonlyArray<string> | undefined;
  readonly stays: ReadonlyArray<string>;
}) {
  return (
    <div className="space-y-3 text-body" data-zerops-surface="delete-application-lists">
      <div>
        <p className="font-medium">Goes</p>
        {goes === undefined ? (
          <Loading label="Reading what HQ holds" shape="words" />
        ) : (
          <ul className="list-disc ps-5" data-zerops-surface="delete-application-goes">
            {goes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="font-medium">Stays</p>
        <ul className="list-disc ps-5" data-zerops-surface="delete-application-stays">
          {stays.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The one field that asks for a name typed, and the line under it that says what holds Delete. */
function NameField({
  label,
  typed,
  onTyped,
  pending,
  reason,
  failed,
  details,
}: {
  readonly label: string;
  readonly typed: string;
  readonly onTyped: (typed: string) => void;
  readonly pending: boolean;
  readonly reason: ReactNode;
  readonly failed: boolean;
  readonly details: string | null;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-name`}>{label}</Label>
      <Input
        aria-describedby={`${id}-reason`}
        autoComplete="off"
        id={`${id}-name`}
        onChange={(event) => {
          onTyped(event.target.value);
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
  );
}

/** The whole project's part of the form: what goes and stays, a slide for each Stage, and for
 * each Production that may go its own block: what cannot be undone, its name typed, its slide. */
function ProjectDeletionBody({
  plan,
  words,
  slid,
  onSlid,
  pending,
}: {
  readonly plan: ProjectDeletionPlan;
  readonly words: ReturnType<typeof projectDeletionWords>;
  readonly slid: ReadonlySet<string>;
  readonly onSlid: (projectId: string, confirmed: boolean) => void;
  readonly pending: boolean;
}) {
  if (plan.refusal !== undefined) return <DeletionLists goes={words.goes} stays={words.stays} />;
  return (
    <div className="space-y-3">
      <DeletionLists goes={words.goes} stays={words.stays} />
      {plan.stages.length === 0 ? null : (
        <div className="space-y-2" data-zerops-surface="delete-application-slides">
          {plan.stages.map((stage) => (
            <SlideConfirm
              confirmed={slid.has(stage.projectId)}
              confirmedLabel={`Stage ${stage.name} will be deleted`}
              key={stage.projectId}
              label={`Slide to delete Stage ${stage.name}`}
              locked={pending}
              onConfirmedChange={(confirmed) => {
                onSlid(stage.projectId, confirmed);
              }}
            />
          ))}
        </div>
      )}
      {plan.productions.map((production) => (
        <ProductionDeletion
          confirmed={slid.has(production.projectId)}
          key={production.projectId}
          name={production.name}
          onConfirmedChange={(confirmed) => {
            onSlid(production.projectId, confirmed);
          }}
          pending={pending}
        />
      ))}
    </div>
  );
}

/**
 * A Production's block: Stage's slide plus one step, its Zerops project's name typed, which makes
 * the person look at which project it is. The slide stays locked until the name matches; the name
 * changed after it was slid takes the slide back, so a Production never goes unconfirmed.
 */
function ProductionDeletion({
  name,
  confirmed,
  onConfirmedChange,
  pending,
}: {
  readonly name: string;
  readonly confirmed: boolean;
  readonly onConfirmedChange: (confirmed: boolean) => void;
  readonly pending: boolean;
}) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const words = productionDeletionWords(name);
  const unlocked = deleteMateConfirmed(typed, name);
  return (
    <div className="space-y-2" data-zerops-surface="delete-application-production">
      <Badge tone="danger">Production</Badge>
      <p className="text-body text-pretty">{words.warning}</p>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-production`}>{words.label}</Label>
        <Input
          autoComplete="off"
          id={`${id}-production`}
          onChange={(event) => {
            setTyped(event.target.value);
            if (confirmed && !deleteMateConfirmed(event.target.value, name))
              onConfirmedChange(false);
          }}
          readOnly={pending}
          spellCheck={false}
          value={typed}
        />
      </div>
      <SlideConfirm
        confirmed={confirmed}
        confirmedLabel={words.slid}
        label={words.slide}
        locked={pending || !unlocked}
        onConfirmedChange={onConfirmedChange}
      />
    </div>
  );
}

/** The submit button: its words and its pending word hold one room, so it keeps its width. */
function DeleteButton({
  words,
  pending,
  disabled,
}: {
  readonly words: string;
  readonly pending: boolean;
  readonly disabled: boolean;
}) {
  return (
    <Button
      aria-busy={pending || undefined}
      aria-label={pending ? MATE_DELETING_WORD : words}
      data-zerops-surface="delete-application-confirm"
      disabled={disabled || pending}
      type="submit"
      variant="destructive"
    >
      <span className="grid">
        <span
          aria-hidden={pending}
          className={cn("col-start-1 row-start-1", pending && "invisible")}
        >
          {words}
        </span>
        <span
          aria-hidden={!pending}
          className={cn("col-start-1 row-start-1", !pending && "invisible")}
        >
          {MATE_DELETING_WORD}
        </span>
      </span>
    </Button>
  );
}

export function ZeropsDeletionForm({
  offer,
  project,
  mate,
  holdings,
  pending,
  error,
  waiting,
  onCancel,
  onConfirm,
  onAgain,
}: {
  readonly offer: DeletionOffer;
  readonly project: DeletionProject;
  /** The Mate whose Delete opened it; absent: the project's own Delete. */
  readonly mate: DeletionMate | undefined;
  readonly holdings: ApplicationHoldings | undefined;
  readonly pending: boolean;
  /** Why the last press did not start; `null` where it did not fail. */
  readonly error: string | null;
  /**
   * HQ's deletion stopped waiting for someone's Continue: whom it waits for (said by name), the
   * reader's own Continue, and the End HQ offers an Owner or an Admin.
   */
  readonly waiting?:
    | {
        readonly person: ReactNode;
        readonly press: string;
        readonly onContinue?: () => void;
        readonly onEnd?: () => void;
      }
    | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: (choice: DeletionChoice) => void;
  /** Delete again over a deletion HQ shows ended failed. */
  readonly onAgain: () => void;
}) {
  // "Only {M}" is the default: deleting a Mate is not wanting its code gone.
  const [choice, setChoice] = useState<"mate" | "project">("mate");
  const [typedMate, setTypedMate] = useState("");
  const [typedProject, setTypedProject] = useState("");
  const [slid, setSlid] = useState<ReadonlySet<string>>(() => new Set());
  const onSlid = (projectId: string, confirmed: boolean) => {
    setSlid((held) => {
      const next = new Set(held);
      if (confirmed) next.add(projectId);
      else next.delete(projectId);
      return next;
    });
  };

  if (offer.kind === "standing") {
    const standing = deletionStandingWords(project, offer.deletion);
    return (
      <div className="flex min-h-0 flex-col" data-zerops-surface="delete-application-standing">
        <DialogHeader>
          <DialogTitle>{`Delete ${project.name}?`}</DialogTitle>
          {standing.failed ? null : (
            <DialogDescription role="status">
              {waiting === undefined ? (
                standing.line
              ) : (
                <>
                  {standing.line} · waiting for {waiting.person}
                </>
              )}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-3">
            {standing.failed ? (
              <Failure
                cause={standing.line}
                details={standing.details ?? undefined}
                role="alert"
                size="line"
              />
            ) : null}
            {offer.deletion.kind === "waiting" && offer.deletion.yours ? (
              <p className="text-body text-pretty">{offer.deletion.line}</p>
            ) : null}
            <DeletionParts parts={standing.parts} />
            <Text className="min-h-4" render={<p />} role="alert" variant="error">
              {error}
            </Text>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button onClick={onCancel} type="button" variant="ghost">
            Close
          </Button>
          {waiting?.onContinue === undefined ? null : (
            <Button
              disabled={pending}
              onClick={waiting.onContinue}
              type="button"
              variant="secondary"
            >
              {waiting.press}
            </Button>
          )}
          {waiting?.onEnd === undefined ? null : (
            <ZeropsOperationEnd
              disabled={pending}
              kind="app_deletion"
              name={project.name}
              onEnd={waiting.onEnd}
            />
          )}
          {offer.deletion.kind !== "failed" ? null : (
            <Button onClick={onAgain} type="button" variant="destructive">
              Delete again
            </Button>
          )}
        </DialogFooter>
      </div>
    );
  }

  const plan = offer.kind === "last-choice" || offer.kind === "project" ? offer.plan : undefined;
  const whole = offer.kind === "project" || (offer.kind === "last-choice" && choice === "project");
  const mateName = mate?.name ?? "";
  const mateWords = deleteMateWords({
    name: mateName,
    environment: mateName,
    services: mate?.services,
    owner: mate?.owner,
    stays: offer.kind === "mate" || offer.kind === "last-mate-only" ? offer.stays : undefined,
  });
  const words =
    plan === undefined
      ? undefined
      : projectDeletionWords({
          name: project.name,
          plan,
          holdings,
          mate: mate === undefined ? undefined : { name: mate.name, services: mate.services },
          slid,
        });
  const ready =
    whole && plan !== undefined
      ? projectDeletionReady(
          plan,
          slid,
          words?.goes !== undefined && deleteMateConfirmed(typedProject, project.name),
        )
      : { ready: deleteMateConfirmed(typedMate, mateName), missing: null };
  const reason = error ?? ready.missing;
  const failed = error !== null || plan?.refusal !== undefined;

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="delete-application-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready.ready || pending) return;
        onConfirm(whole ? { kind: "project", slid } : { kind: "mate" });
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {offer.kind === "project" ? `Delete ${project.name}?` : mateWords.title}
        </DialogTitle>
        <DialogDescription>
          {offer.kind === "project"
            ? "This can't be undone."
            : offer.kind === "last-choice"
              ? lastChoiceWords(project, offer.plan, mateName, slid).description
              : mateWords.body}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="space-y-4">
          {offer.kind !== "last-choice" ? null : (
            <RadioGroup
              aria-label="What goes"
              disabled={pending}
              onValueChange={(value) => {
                if (value === "mate" || value === "project") setChoice(value);
              }}
              value={choice}
            >
              <RadioCard
                title={lastChoiceWords(project, offer.plan, mateName, slid).only.title}
                value="mate"
              >
                {lastChoiceWords(project, offer.plan, mateName, slid).only.line}
              </RadioCard>
              <RadioCard
                title={lastChoiceWords(project, offer.plan, mateName, slid).whole.title}
                value="project"
              >
                {lastChoiceWords(project, offer.plan, mateName, slid).whole.line}
              </RadioCard>
            </RadioGroup>
          )}
          {offer.kind === "last-choice" && !whole ? (
            <p className="text-body text-pretty">{mateWords.body}</p>
          ) : null}
          {whole && plan !== undefined && words !== undefined ? (
            <ProjectDeletionBody
              onSlid={onSlid}
              pending={pending}
              plan={plan}
              slid={slid}
              words={words}
            />
          ) : null}
          {whole ? (
            <NameField
              details={null}
              failed={failed}
              label={words?.label ?? ""}
              onTyped={setTypedProject}
              pending={pending}
              reason={reason}
              typed={typedProject}
            />
          ) : (
            <NameField
              details={null}
              failed={failed}
              label={mateWords.label}
              onTyped={setTypedMate}
              pending={pending}
              reason={reason}
              typed={typedMate}
            />
          )}
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <DeleteButton
          disabled={!ready.ready}
          pending={pending}
          words={whole ? (words?.submit ?? "") : mateWords.submit}
        />
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
function WaitingPerson({ orgId, userId }: { readonly orgId: string; readonly userId: string }) {
  const name = useHqPersonNames(orgId)(userId);
  return name ?? "the person who started it";
}

function ZeropsDeleteApplicationDialog({
  appId,
  mate,
  onClose,
}: {
  readonly appId: string;
  /** The last Mate whose Delete opened it. */
  readonly mate: DeleteApplicationMate | undefined;
  readonly onClose: () => void;
}) {
  const operations = useAccountOperations();
  const { activeOrganization } = useZeropsSession();
  const orgId = activeOrganization?.id;
  const structure = useHqStructure();
  const deletion = hqOperationOf(useAtomValue(applicationOperationAtom(appId)), "app_deletion");
  const project = deletionProjectOf(structure, appId, deletion);
  const [again, setAgain] = useState(false);
  const offer =
    project === undefined
      ? undefined
      : deletionOffer({
          mate: mate === undefined ? undefined : { projectId: mate.projectId, name: mate.name },
          project,
          again,
        });
  const holdings = applicationHoldings(useHqAppDetail(appId));
  const gone = useAtomValue(applicationGoneAtom(appId));
  // One id per start this dialog makes, sent again with the same body (HQ answers it again) until
  // HQ shows that deletion running; a Delete again over its failure starts anew.
  const startId = useRef<string | null>(null);
  const active = useRef(true);
  const [pressing, setPressing] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  // HQ shows the deletion it took: its standing says the rest, and a later failure is shown again.
  useEffect(() => {
    if (deletion.kind !== "going") return;
    setAgain(false);
    setStarted(false);
  }, [deletion.kind]);
  // HQ removed the project: nothing is left to delete or to say.
  useEffect(() => {
    if (gone) onClose();
  }, [gone]);
  const submit = (intent: Parameters<typeof operations.submit>[0]) =>
    operations.submit(intent).then(({ progress, evidence }) => {
      const trouble = writeTrouble(progress, evidence);
      if (trouble !== null) throw new Error(trouble);
    });
  const settle = (press: Promise<void>, then?: () => void) => {
    setPressing(true);
    setError(null);
    press.then(
      () => {
        if (!active.current) return;
        setPressing(false);
        then?.();
      },
      (cause: unknown) => {
        if (!active.current) return;
        setPressing(false);
        setError(zeropsErrorMessage(cause));
      },
    );
  };
  const confirm = (choice: DeletionChoice) => {
    if (orgId === undefined || project === undefined || offer === undefined) return;
    startId.current ??= randomUUID();
    const plan = offer.kind === "last-choice" || offer.kind === "project" ? offer.plan : undefined;
    const start = deletionStart({
      orgId,
      id: startId.current,
      mate,
      choice:
        choice.kind === "mate" || plan === undefined
          ? { kind: "mate", last: offer.kind !== "mate" }
          : { kind: "project", appId, plan, slid: choice.slid },
    });
    if (start === undefined) return;
    settle(submit(start), () => {
      if (start.kind === "start-mate-deletion") {
        mate?.leave();
        onClose();
        return;
      }
      setStarted(true);
    });
  };
  const end = endOperationIntent(deletion, orgId, appId);
  const waiting =
    deletion.kind !== "waiting" || orgId === undefined
      ? undefined
      : {
          person: <WaitingPerson orgId={orgId} userId={deletion.continueBy} />,
          press: deletion.press,
          ...(deletion.yours
            ? {
                onContinue: () => {
                  settle(submit({ kind: "continue-operation", orgId, id: deletion.id, appId }));
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

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogPopup className="max-w-md">
        {project === undefined || offer === undefined ? (
          <DialogPanel>
            <Loading label="Reading what HQ holds of it" shape="words" />
          </DialogPanel>
        ) : (
          <ZeropsDeletionForm
            error={error}
            holdings={holdings}
            mate={mate}
            offer={offer}
            onAgain={() => {
              startId.current = null;
              setError(null);
              setAgain(true);
            }}
            onCancel={onClose}
            onConfirm={confirm}
            pending={pressing || (started && offer.kind !== "standing")}
            project={project}
            waiting={waiting}
          />
        )}
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
      appId={request.appId}
      key={request.id}
      mate={request.mate}
      onClose={close}
    />
  );
}
