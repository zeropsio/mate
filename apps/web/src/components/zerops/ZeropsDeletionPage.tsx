/** Renders the deletion review and HQ's running or stopped operation. */
import { BoxIcon, GitBranchIcon, GlobeIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCanGoBack, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { hqOperationOf, shownHqMateIdentitiesAtom } from "@t3tools/client-runtime/data";
import {
  assignCandidateMateTints,
  nameUnderApp,
  projectNameInApp,
} from "@t3tools/client-runtime/zerops";
import { birthFaceOf } from "@t3tools/client-runtime/zerops/hq";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { randomUUID } from "~/lib/utils";
import { applicationOperationAtom } from "~/state/zerops";
import { useAccountOperations } from "~/zerops/accountOperations";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { useHqStructure } from "~/zerops/useHqOffers";
import { useHqPersonNames } from "~/zerops/useZeropsMateOwners";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { writeTrouble } from "~/zerops/zeropsWrite";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";
import { endOperationIntent } from "./ZeropsOperationEnd.logic";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Fact, Facts } from "~/components/ui/facts";
import { Failure } from "~/components/ui/failure";
import { List } from "~/components/ui/list";
import { Loading } from "~/components/ui/loading";
import { LogoTile } from "~/components/ui/logo-tile";
import { PageHeader } from "~/components/ui/page-header";
import { Row } from "~/components/ui/row";
import { Section } from "~/components/ui/section";
import { StepNumber, type StepNumberState } from "~/components/ui/step-number";
import { Text } from "~/components/ui/text";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { tellKept } from "./mateActions/useMateActions";
import type { MateTintId } from "@t3tools/shared/brand";
import { MateFace } from "./primitives";
import {
  applicationHoldings,
  deletionChoiceAgain,
  deletionPageMate,
  deletionPageState,
  deletionProjectOf,
  deletionReview,
  deletionStart,
  sameDeletionStart,
  deletionPageWords,
  deletionStandingWords,
  partStateWords,
  type ApplicationHoldings,
  type DeletionChoice,
  type DeletionPart,
  type DeletionRow,
} from "./deletion.logic";
import { deleteMateServiceCount, MATE_DELETING_WORD } from "./ZeropsDeleteMateDialog.logic";
import { ZeropsConfirmName } from "./ZeropsConfirmName";
import { ZeropsOperationEnd } from "./ZeropsOperationEnd";

const PART_STEP: Readonly<Record<DeletionPart["state"], StepNumberState>> = {
  gone: "done",
  deleting: "busy",
  pending: "todo",
  stopped: "attention",
  here: "todo",
};

export function ZeropsDeletionPage({
  state,
  mate,
  holdings,
  pending,
  error,
  waiting,
  onCancel,
  onConfirm,
  onAgain,
  initial,
}: {
  readonly state: ReturnType<typeof deletionPageState>;
  /** The last Mate, which goes first; absent: the project's own Delete. */
  readonly mate?:
    | {
        readonly projectId: string;
        readonly name: string;
        readonly services: number | undefined;
        readonly tint: MateTintId;
      }
    | undefined;
  readonly holdings: ApplicationHoldings | undefined;
  readonly pending: boolean;
  /** Why the last press did not start; `null` where it did not fail. */
  readonly error: string | null;
  readonly waiting?:
    | {
        readonly person: ReactNode;
        readonly press: string;
        readonly onContinue?: () => void;
        readonly onEnd?: () => void;
      }
    | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: (review: ReturnType<typeof deletionReview>) => void;
  readonly onAgain: () => void;
  readonly initial?: DeletionChoice | undefined;
}) {
  const [choice, setChoice] = useState<DeletionChoice>(
    () => initial ?? { fates: {}, names: {}, projectName: "" },
  );
  const page = deletionPageWords("project" in state ? state.project.name : "");
  if (state.kind === "reading") return <Loading label={page.reading} shape="words" />;
  if (state.kind === "gone" || state.kind === "refused")
    return (
      <>
        <PageHeader
          title={state.kind === "gone" ? page.gone : page.title}
          line={state.kind === "refused" ? state.line : undefined}
        />
        <div>
          <Button onClick={onCancel} type="button" variant="secondary">
            {state.kind === "gone" ? page.projects : page.back}
          </Button>
        </div>
      </>
    );
  const { project, offer } = state;

  if (offer.kind === "standing") {
    const standing = deletionStandingWords(project, offer.deletion);
    return (
      <div className="contents" data-zerops-surface="delete-page-standing">
        <PageHeader
          line={standing.failed || waiting !== undefined ? undefined : standing.line}
          title={standing.failed ? page.title : page.runningTitle}
        />
        <div className="flex flex-col gap-6">
          {standing.failed ? (
            <Failure
              action={
                standing.again ? (
                  <Button onClick={onAgain} size="sm" type="button" variant="destructive">
                    {page.again}
                  </Button>
                ) : undefined
              }
              cause={standing.line}
              details={standing.details ?? undefined}
              role="alert"
              size="line"
            >
              {standing.who}
            </Failure>
          ) : waiting !== undefined ? (
            <Alert surface="tint" variant="warning">
              <AlertTitle>
                {standing.line} · {page.waitingFor} {waiting.person}
              </AlertTitle>
              {offer.deletion.kind === "waiting" && offer.deletion.yours ? (
                <AlertDescription>{offer.deletion.line}</AlertDescription>
              ) : null}
              {waiting.onContinue === undefined && waiting.onEnd === undefined ? null : (
                <AlertAction>
                  {waiting.onEnd === undefined ? null : (
                    <ZeropsOperationEnd
                      disabled={pending}
                      kind="app_deletion"
                      name={project.name}
                      onEnd={waiting.onEnd}
                    />
                  )}
                  {waiting.onContinue === undefined ? null : (
                    <Button disabled={pending} onClick={waiting.onContinue} size="sm" type="button">
                      {waiting.press}
                    </Button>
                  )}
                </AlertAction>
              )}
            </Alert>
          ) : (
            <Text render={<p />} variant="description">
              {page.running}
            </Text>
          )}
          {error === null ? null : <Failure cause={error} role="alert" size="line" />}
          <Card variant="flat">
            <List>
              {standing.parts.map((part, index) => (
                <Row
                  key={`${part.part}:${part.label}`}
                  lead={<StepNumber n={index + 1} state={PART_STEP[part.state]} />}
                  meta={partStateWords(part)}
                  size="sm"
                  title={part.label}
                />
              ))}
            </List>
          </Card>
        </div>
      </div>
    );
  }

  const review = deletionReview({ project, mate, holdings, choice });
  const renderRow = (row: DeletionRow) => (
    <div key={`${row.kind}:${row.id}`} data-zerops-surface="delete-page-part">
      <Row
        badges={<Badge>{row.badge}</Badge>}
        control={
          row.switchable ? (
            <ToggleGroup
              aria-label={row.title}
              disabled={pending}
              value={[row.fate]}
              onValueChange={(value) => {
                const fate = value[0];
                if (fate === "goes" || fate === "stays")
                  setChoice((held) => ({ ...held, fates: { ...held.fates, [row.id]: fate } }));
              }}
            >
              <Toggle value="goes">Goes</Toggle>
              <Toggle value="stays">Stays</Toggle>
            </ToggleGroup>
          ) : undefined
        }
        meta={
          row.switchable ? undefined : (
            <Badge dot tone={row.fate === "goes" ? "danger" : "success"}>
              {row.fate === "goes" ? page.goes : page.stays}
            </Badge>
          )
        }
        lead={
          row.kind === "mate" && mate !== undefined ? (
            <MateFace size={32} state="idle" tint={mate.tint} />
          ) : (
            <LogoTile>
              {row.kind === "stage" ? (
                <BoxIcon />
              ) : row.kind === "code" || row.kind === "setup" ? (
                <GitBranchIcon />
              ) : (
                <GlobeIcon />
              )}
            </LogoTile>
          )
        }
        line={row.line}
        title={row.title}
      />
      {row.askName === undefined ? null : (
        <div className="flex flex-col gap-3 ps-14 pe-4 pb-4">
          {row.warning === undefined ? null : (
            <Text render={<p />} variant="description">
              {row.warning}
            </Text>
          )}
          <ZeropsConfirmName
            name={row.askName}
            whose={row.kind === "plain" ? "the Zerops project's" : "the Production's"}
            typed={choice.names[row.id] ?? ""}
            pending={pending}
            onTyped={(value) =>
              setChoice((held) => ({ ...held, names: { ...held.names, [row.id]: value } }))
            }
          />
        </div>
      )}
    </div>
  );
  const zerops = review.rows.filter((row) => row.kind !== "code" && row.kind !== "setup");
  const code = review.rows.filter((row) => row.kind === "code" || row.kind === "setup");
  return (
    <div className="contents" data-zerops-surface="delete-page-form">
      <PageHeader line={page.line} title={page.title} />
      <Section title="In Zerops">
        {zerops.length === 0 ? (
          <Text render={<p />} variant="description">
            {page.nothing}
          </Text>
        ) : (
          <Card variant="flat">
            <List>{zerops.map(renderRow)}</List>
          </Card>
        )}
      </Section>
      <Section title="Code">
        {holdings === undefined ? (
          <Loading label={page.holdingsReading} shape="words" />
        ) : (
          <Card variant="flat">
            <List>{code.map(renderRow)}</List>
          </Card>
        )}
      </Section>
      <Section title="Confirm">
        <div className="flex flex-col gap-5">
          <Text render={<p />} variant="description">
            {review.becomes.line}
          </Text>
          <Card size="md" variant="inset">
            <Facts>
              <Fact label={page.goes}>
                {review.goes === undefined
                  ? "…"
                  : review.goes.map((line) => (
                      <span className="block" key={line}>
                        {line}
                      </span>
                    ))}
              </Fact>
              <Fact label={page.stays}>
                {review.stays.map((line) => (
                  <span className="block" key={line}>
                    {line}
                  </span>
                ))}
              </Fact>
            </Facts>
          </Card>
          <ZeropsConfirmName
            hold={review.missing}
            name={project.name}
            onTyped={(projectName) => setChoice((held) => ({ ...held, projectName }))}
            pending={pending}
            typed={choice.projectName}
            whose={page.whose}
          />
          {error === null ? null : <Failure cause={error} role="alert" size="line" />}
          <div className="flex items-center justify-end gap-3">
            {review.missing === null ? null : <Text variant="note">{review.missing}</Text>}
            <Button onClick={onCancel} type="button" variant="ghost">
              {page.cancel}
            </Button>
            <Button
              aria-busy={pending || undefined}
              data-zerops-surface="delete-page-confirm"
              disabled={!review.ready || pending}
              onClick={() => {
                if (review.ready && !pending) onConfirm(review);
              }}
              type="button"
              variant="destructive"
            >
              {pending ? MATE_DELETING_WORD : review.submit}
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}

function WaitingPerson({ orgId, userId }: { readonly orgId: string; readonly userId: string }) {
  const name = useHqPersonNames(orgId)(userId);
  return name ?? "the person who started it";
}

/** Reads the page's facts and writes only the operation the person presses. */
export function ZeropsDeletionPageContainer({
  appId,
  mateId: address,
}: {
  readonly appId: string;
  readonly mateId: string | undefined;
}) {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const operations = useAccountOperations();
  const { activeOrganization } = useZeropsSession();
  const orgId = activeOrganization?.id;
  const structure = useHqStructure();
  const deletion = hqOperationOf(useAtomValue(applicationOperationAtom(appId)), "app_deletion");
  const identities = useAtomValue(shownHqMateIdentitiesAtom);
  const { listing } = useZeropsCandidates();
  const candidates = heldCandidates(listing).rows;
  const project = deletionProjectOf(structure, appId, deletion);
  const mateId = deletionPageMate({ project, address });
  const candidate = candidates.find((row) => row.project.id === mateId);
  const placement = project?.placements.find((item) => item.projectId === mateId);
  const mateName =
    candidate === undefined
      ? nameUnderApp(placement?.name ?? "", project?.name) || "Its Mate"
      : projectNameInApp(candidate.project);
  const mateFacts = mateId === undefined ? undefined : { projectId: mateId, name: mateName };
  const [past, setPast] = useState<string>();
  const [againChoice, setAgainChoice] = useState<DeletionChoice>();
  const state = deletionPageState({
    structureRead: structure !== null,
    project,
    mate: mateFacts,
    past,
  });
  const holdings = applicationHoldings(useHqAppDetail(appId));
  const face =
    mateId === undefined || candidate === undefined
      ? undefined
      : (identities[mateId] ?? birthFaceOf(structure, mateId));
  const mate =
    mateId === undefined || state.kind !== "form" || state.offer.mate === undefined
      ? undefined
      : {
          projectId: mateId,
          name: mateName,
          services: candidate === undefined ? undefined : deleteMateServiceCount(candidate),
          tint:
            face?.tint ??
            (candidate === undefined
              ? ("slate" as const)
              : (assignCandidateMateTints(candidates).get(mateId) ?? "slate")),
        };
  const startId = useRef<NonNullable<ReturnType<typeof deletionStart>> | null>(null);
  const active = useRef(true);
  const [pressing, setPressing] = useState(false);
  const pressingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const submit = (intent: Parameters<typeof operations.submit>[0]) =>
    operations.submit(intent).then(({ progress, evidence }) => {
      const trouble = writeTrouble(progress, evidence);
      if (trouble !== null) throw new Error(trouble);
    });
  const settle = (press: Promise<void>) => {
    pressingRef.current = true;
    setPressing(true);
    setError(null);
    press.then(
      () => {
        pressingRef.current = false;
        if (active.current) setPressing(false);
      },
      (cause: unknown) => {
        pressingRef.current = false;
        if (!active.current) return;
        setPressing(false);
        setError(zeropsErrorMessage(cause));
      },
    );
  };
  const confirm = (review: ReturnType<typeof deletionReview>) => {
    if (orgId === undefined || state.kind !== "form" || pressingRef.current) return;
    const previous = startId.current;
    let start = deletionStart({
      orgId,
      id: previous?.id ?? randomUUID(),
      offer: state.offer,
      review,
    });
    if (start === undefined) return;
    if (previous !== null && !sameDeletionStart(previous, start))
      start = { ...start, id: randomUUID() };
    startId.current = start;
    const accepted = start;
    settle(
      submit(accepted).then(() => {
        if (accepted.kind !== "start-mate-deletion" || !active.current) return;
        tellKept(
          state.project,
          review.becomes,
          (id) => void navigate({ to: "/git", search: { appId: id } }),
        );
        back();
      }),
    );
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
                onContinue: () =>
                  settle(submit({ kind: "continue-operation", orgId, id: deletion.id, appId })),
              }
            : {}),
          ...(end === undefined ? {} : { onEnd: () => settle(submit(end)) }),
        };
  const back = () => {
    if (canGoBack) window.history.back();
    else void navigate({ to: "/zerops" });
  };
  return (
    <ZeropsHostedFrame bar={false} width="column">
      <ZeropsDeletionPage
        key={past ?? "first"}
        state={state}
        mate={mate}
        holdings={holdings}
        pending={pressing}
        error={error}
        waiting={waiting}
        initial={againChoice}
        onCancel={back}
        onConfirm={confirm}
        onAgain={() => {
          if (state.kind !== "standing" || state.offer.deletion.kind !== "failed") return;
          startId.current = null;
          setError(null);
          setAgainChoice(deletionChoiceAgain(state.project, holdings));
          setPast(state.offer.deletion.id);
        }}
      />
    </ZeropsHostedFrame>
  );
}
