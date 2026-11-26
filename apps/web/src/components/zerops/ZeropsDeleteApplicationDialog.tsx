/** The last Mate's choice: delete only it, or continue to the project's deletion page. */
import { useAtomValue } from "@effect/atom-react";
import { hqOperationOf } from "@t3tools/client-runtime/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { randomUUID } from "~/lib/utils";
import { applicationOperationAtom } from "~/state/zerops";
import { useAccountOperations } from "~/zerops/accountOperations";
import { useHqStructure } from "~/zerops/useHqOffers";
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
import { Failure } from "../ui/failure";
import { Loading } from "../ui/loading";
import { RadioCard, RadioGroup } from "../ui/radio-group";
import { Text } from "../ui/text";
import { ZeropsConfirmName } from "./ZeropsConfirmName";
import {
  deleteMateConfirmed,
  deleteMateWords,
  MATE_DELETING_WORD,
} from "./ZeropsDeleteMateDialog.logic";
import { useDeleteApplicationDialog, type DeleteApplicationMate } from "./deleteApplicationDialog";
import {
  deletionOffer,
  deletionProjectOf,
  deletionStart,
  keptWhere,
  lastChoiceWords,
  sameDeletionStart,
  type DeletionOffer,
  type DeletionProject,
} from "./deletion.logic";

type DeletionMate = Pick<DeleteApplicationMate, "name" | "services" | "owner">;

export function ZeropsDeletionForm({
  offer,
  project,
  mate,
  pending,
  error,
  onCancel,
  onConfirm,
  onWhole,
}: {
  readonly offer: DeletionOffer;
  readonly project: DeletionProject;
  readonly mate: DeletionMate;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly onWhole: () => void;
}) {
  const [choice, setChoice] = useState<"mate" | "project">("mate");
  const [typed, setTyped] = useState("");
  if (offer.kind === "project" || offer.kind === "standing") return null;
  const whole = offer.kind === "last-choice" && choice === "project";
  const words = deleteMateWords({
    name: mate.name,
    environment: mate.name,
    services: mate.services,
    owner: mate.owner,
    stays: offer.kind === "last-choice" ? undefined : offer.stays,
  });
  const choices =
    offer.kind === "last-choice" ? lastChoiceWords(project, offer.plan, mate.name) : undefined;
  const ready = deleteMateConfirmed(typed, mate.name);
  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="delete-application-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        if (whole) onWhole();
        else if (ready) onConfirm();
      }}
    >
      <DialogHeader>
        <DialogTitle>{words.title}</DialogTitle>
        <DialogDescription>{choices?.description ?? words.body}</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="space-y-4">
          {choices === undefined ? null : (
            <RadioGroup
              aria-label="What goes"
              disabled={pending}
              onValueChange={(value) => {
                if (value === "mate" || value === "project") setChoice(value);
              }}
              value={choice}
            >
              <RadioCard title={choices.only.title} value="mate">
                <span className="block">{choices.only.line}</span>
                <span className="block">{choices.only.where}</span>
              </RadioCard>
              <RadioCard title={choices.whole.title} value="project">
                {choices.whole.line}
              </RadioCard>
            </RadioGroup>
          )}
          {whole && choices !== undefined ? (
            <Text render={<p />} variant="description">
              {choices.whole.next}
            </Text>
          ) : (
            <>
              {choices === undefined ? null : <p className="text-body text-pretty">{words.body}</p>}
              <ZeropsConfirmName
                name={mate.name}
                onTyped={setTyped}
                pending={pending}
                typed={typed}
                whose="the Mate's"
              />
              {error === null ? null : <Failure cause={error} role="alert" size="line" />}
            </>
          )}
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button
          aria-busy={pending || undefined}
          data-zerops-surface="delete-application-confirm"
          disabled={pending || (!whole && !ready)}
          type="submit"
          variant={whole ? "primary" : "destructive"}
        >
          {whole ? choices?.whole.press : pending ? MATE_DELETING_WORD : words.submit}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ZeropsDeleteApplicationDialog({
  appId,
  mate,
  onClose,
}: {
  readonly appId: string;
  readonly mate: DeleteApplicationMate;
  readonly onClose: () => void;
}) {
  const navigate = useNavigate();
  const operations = useAccountOperations();
  const { activeOrganization } = useZeropsSession();
  const orgId = activeOrganization?.id;
  const structure = useHqStructure();
  const deletion = hqOperationOf(useAtomValue(applicationOperationAtom(appId)), "app_deletion");
  const project = deletionProjectOf(structure, appId, deletion);
  const offer =
    project === undefined
      ? undefined
      : deletionOffer({ mate: { projectId: mate.projectId, name: mate.name }, project });
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
  useEffect(() => {
    if (
      (structure !== null && project === undefined) ||
      offer?.kind === "standing" ||
      offer?.kind === "project"
    )
      onClose();
  }, [structure, project, offer?.kind, onClose]);
  const confirm = () => {
    if (orgId === undefined || project === undefined || offer === undefined || pressing) return;
    const previous = startId.current;
    let start = deletionStart({
      orgId,
      id: previous?.id ?? randomUUID(),
      offer,
      choice: { kind: "mate" },
    });
    if (start === undefined) return;
    if (previous !== null && !sameDeletionStart(previous, start))
      start = { ...start, id: randomUUID() };
    startId.current = start;
    setPressing(true);
    setError(null);
    void operations
      .submit(start)
      .then(
        ({ progress, evidence }) => {
          const trouble = writeTrouble(progress, evidence);
          if (trouble !== null) throw new Error(trouble);
          if (!active.current) return;
          setPressing(false);
          if (start.kind === "start-mate-deletion") {
            mate.leave(start.keptGit === "keep" ? keptWhere(project) : undefined);
            onClose();
          }
        },
        (cause: unknown) => {
          if (!active.current) return;
          setPressing(false);
          setError(zeropsErrorMessage(cause));
        },
      )
      .catch((cause: unknown) => {
        if (!active.current) return;
        setPressing(false);
        setError(zeropsErrorMessage(cause));
      });
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
            mate={mate}
            offer={offer}
            onCancel={onClose}
            onConfirm={confirm}
            onWhole={() => {
              onClose();
              void navigate({
                to: "/projects/$projectKey/delete",
                params: { projectKey: appId },
                search: { mate: mate.projectId },
              });
            }}
            pending={pressing}
            project={project}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

export function ZeropsDeleteApplicationHost() {
  const request = useDeleteApplicationDialog((state) => state.request);
  const close = useDeleteApplicationDialog((state) => state.close);
  if (request === null || request.mate === undefined) return null;
  return (
    <ZeropsDeleteApplicationDialog
      appId={request.appId}
      key={request.id}
      mate={request.mate}
      onClose={close}
    />
  );
}
