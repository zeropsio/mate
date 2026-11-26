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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { hqOperationOf } from "@t3tools/client-runtime/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import { cn, randomUUID } from "~/lib/utils";
import { Failure } from "~/components/ui/failure";
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
import {
  applicationHoldings,
  deletionOffer,
  deletionProjectOf,
  deletionStandingWords,
  deletionStart,
  lastChoiceWords,
  partStateWords,
  productionDeletionWords,
  productionConfirmed,
  sameDeletionStart,
  projectDeletionReady,
  projectDeletionWords,
  type ApplicationHoldings,
  type DeletionOffer,
  type DeletionPart,
  type DeletionProject,
  type DeletionConfirmation,
  type ProjectDeletionPlan,
} from "./deletion.logic";
import {
  deleteMateConfirmed,
  deleteMateWords,
  MATE_DELETING_WORD,
} from "./ZeropsDeleteMateDialog.logic";
import { ZeropsConfirmName } from "./ZeropsConfirmName";
import { ZeropsOperationEnd } from "./ZeropsOperationEnd";
import { endOperationIntent } from "./ZeropsOperationEnd.logic";

/** What the person chose to delete, confirmed: the Mate alone, or the whole project as slid. */
export type DeletionChoice =
  | { readonly kind: "mate" }
  | ({ readonly kind: "project" } & DeletionConfirmation);

/** The Mate the dialog is about, as its words name it. */
type DeletionMate = Pick<DeleteApplicationMate, "name" | "services" | "owner">;

/** HQ's parts of its deletion, each with how it stands. */
function DeletionParts({ parts }: { readonly parts: ReadonlyArray<DeletionPart> }) {
  if (parts.length === 0) return null;
  return (
    <ul className="space-y-1 text-body" data-zerops-surface="delete-application-parts">
      {parts.map((part) => (
        <li className="flex justify-between gap-3" key={`${part.part}:${part.label}`}>
          <span className="min-w-0 truncate">{part.label}</span>
          <span className={cn(part.state === "gone" ? "text-muted-foreground" : "text-foreground")}>
            {partStateWords(part)}
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

/** The whole project's part of the form: what goes and stays, a slide for each Stage, and for
 * each Production that may go its own block: what cannot be undone, its name typed, its slide. */
function ProjectDeletionBody({
  plan,
  words,
  slid,
  confirmation,
  onSlid,
  onProductionTyped,
  pending,
}: {
  readonly plan: ProjectDeletionPlan;
  readonly words: ReturnType<typeof projectDeletionWords>;
  readonly slid: ReadonlySet<string>;
  readonly confirmation: DeletionConfirmation;
  readonly onSlid: (projectId: string, confirmed: boolean) => void;
  readonly onProductionTyped: (projectId: string, name: string, typed: string) => void;
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
          confirmed={productionConfirmed(
            confirmation.productionTyped[production.projectId] ?? "",
            production.name,
            confirmation.slid.has(production.projectId),
          )}
          key={production.projectId}
          name={production.name}
          typed={confirmation.productionTyped[production.projectId] ?? ""}
          onTyped={(typed) => onProductionTyped(production.projectId, production.name, typed)}
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
  typed,
  onTyped,
  pending,
}: {
  readonly name: string;
  readonly confirmed: boolean;
  readonly onConfirmedChange: (confirmed: boolean) => void;
  readonly typed: string;
  readonly onTyped: (typed: string) => void;
  readonly pending: boolean;
}) {
  const words = productionDeletionWords(name);
  const unlocked = productionConfirmed(typed, name, true);
  return (
    <div className="space-y-2" data-zerops-surface="delete-application-production">
      <Badge tone="danger">Production</Badge>
      <p className="text-body text-pretty">{words.warning}</p>
      <ZeropsConfirmName
        name={name}
        onTyped={onTyped}
        pending={pending}
        typed={typed}
        verb="unlock"
        whose="the Production's"
      />
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
  const [confirmation, setConfirmation] = useState<DeletionConfirmation>(() => ({
    slid: new Set(),
    productionTyped: {},
  }));
  const onSlid = (projectId: string, confirmed: boolean) => {
    setConfirmation((held) => {
      const slid = new Set(held.slid);
      if (confirmed) slid.add(projectId);
      else slid.delete(projectId);
      return { ...held, slid };
    });
  };
  const onProductionTyped = (projectId: string, name: string, typed: string) => {
    setConfirmation((held) => {
      const slid = new Set(held.slid);
      if (!productionConfirmed(typed, name, slid.has(projectId))) slid.delete(projectId);
      return { slid, productionTyped: { ...held.productionTyped, [projectId]: typed } };
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
  const presentMate = offer.kind === "project" ? undefined : mate;
  const mateName = presentMate?.name ?? "";
  const projectReady =
    plan === undefined
      ? undefined
      : projectDeletionReady(plan, confirmation, deleteMateConfirmed(typedProject, project.name));
  const slid = projectReady?.slid ?? confirmation.slid;
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
          mate:
            presentMate === undefined
              ? undefined
              : { name: presentMate.name, services: presentMate.services },
          slid,
        });
  const ready =
    whole && plan !== undefined
      ? { ...projectReady!, ready: projectReady!.ready && words?.goes !== undefined }
      : { ready: deleteMateConfirmed(typedMate, mateName), missing: null };

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="delete-application-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready.ready || pending) return;
        onConfirm(whole ? { kind: "project", ...confirmation } : { kind: "mate" });
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
              confirmation={confirmation}
              onProductionTyped={onProductionTyped}
              onSlid={onSlid}
              pending={pending}
              plan={plan}
              slid={slid}
              words={words}
            />
          ) : null}
          <ZeropsConfirmName
            hold={whole ? ready.missing : null}
            name={whole ? project.name : mateName}
            onTyped={whole ? setTypedProject : setTypedMate}
            pending={pending}
            typed={whole ? typedProject : typedMate}
            whose={whole ? "the project's" : "the Mate's"}
          />
          {error === null ? null : <Failure cause={error} role="alert" size="line" />}
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
  const [past, setPast] = useState<string>();
  const offer =
    project === undefined
      ? undefined
      : deletionOffer({
          mate: mate === undefined ? undefined : { projectId: mate.projectId, name: mate.name },
          project,
          past,
        });
  const holdings = applicationHoldings(useHqAppDetail(appId));
  const gone = useAtomValue(applicationGoneAtom(appId));
  // One id per start this dialog makes, sent again with the same body (HQ answers it again) until
  // HQ shows that deletion running; a Delete again over its failure starts anew.
  const startId = useRef<NonNullable<ReturnType<typeof deletionStart>> | null>(null);
  const active = useRef(true);
  const [pressing, setPressing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
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
    const previous = startId.current;
    let start = deletionStart({ orgId, id: previous?.id ?? randomUUID(), offer, choice });
    if (start === undefined) return;
    if (previous !== null && !sameDeletionStart(previous, start))
      start = { ...start, id: randomUUID() };
    startId.current = start;
    settle(submit(start), () => {
      if (start.kind === "start-mate-deletion") {
        mate?.leave();
        onClose();
      }
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
              if (deletion.kind === "failed") setPast(deletion.id);
            }}
            onCancel={onClose}
            onConfirm={confirm}
            pending={pressing}
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
