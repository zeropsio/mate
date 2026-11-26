/**
 * Deleting a whole project, on a page of its own: three numbered steps the person goes through in
 * order, each on its own lines, and the one Delete at the end. 1, what goes from Zerops: its last
 * Mate, each Stage slid, and each Production that may go, kept until its name is typed and it is
 * slid. 2, its code: each code repository and its setup files go.
 * 3, a summary of what goes and what stays, the project's name typed, Delete. Once HQ runs the
 * deletion the same page shows each part as it goes, where it waits and on whom, or where it
 * stopped with Delete again; any reader of the project reaches it from its row.
 *
 * Renders `deletionOffer`'s answer and `deletion.logic`'s words; decides nothing.
 */
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
import { SlideConfirm } from "~/components/ui/slide-confirm";
import { StepNumber, type StepNumberState } from "~/components/ui/step-number";
import { Text } from "~/components/ui/text";
import type { MateTintId } from "@t3tools/shared/brand";
import { MateFace } from "./primitives";
import {
  applicationHoldings,
  deletionPageState,
  deletionProjectOf,
  deletionStart,
  deletionStepStates,
  productionConfirmed,
  sameDeletionStart,
  type DeletionConfirmation,
  deletionCodeRows,
  deletionGoesRows,
  deletionPageWords,
  deletionStandingWords,
  partStateWords,
  productionDeletionWords,
  projectDeletionReady,
  projectDeletionWords,
  type ApplicationHoldings,
  type DeletionPart,
} from "./deletion.logic";
import {
  deleteMateConfirmed,
  deleteMateServiceCount,
  MATE_DELETING_WORD,
} from "./ZeropsDeleteMateDialog.logic";
import { ZeropsConfirmName } from "./ZeropsConfirmName";
import { ZeropsOperationEnd } from "./ZeropsOperationEnd";

const PART_STEP: Readonly<Record<DeletionPart["state"], StepNumberState>> = {
  gone: "done",
  deleting: "busy",
  pending: "todo",
  stopped: "attention",
  here: "todo",
};

/** A step's heading: its number, in the state the person's progress gives it, and its name. */
function StepTitle({
  n,
  state,
  children,
}: {
  readonly n: number;
  readonly state: StepNumberState;
  readonly children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-2.5">
      <StepNumber n={n} state={state} />
      {children}
    </span>
  );
}

/** A Production that may go: kept by default; "Delete it too" opens its name and its slide. */
function ProductionBlock({
  name,
  slid,
  onSlid,
  typed,
  onTyped,
  pending,
}: {
  readonly name: string;
  readonly slid: boolean;
  readonly onSlid: (confirmed: boolean) => void;
  readonly typed: string;
  readonly onTyped: (typed: string) => void;
  readonly pending: boolean;
}) {
  const words = productionDeletionWords(name);
  return (
    <div
      className="flex flex-col gap-3 ps-14 pe-4 pb-4"
      data-zerops-surface="delete-page-production"
    >
      <Text render={<p />} variant="description">
        {words.warning}
      </Text>
      <ZeropsConfirmName
        name={name}
        onTyped={(next) => {
          onTyped(next);
        }}
        pending={pending}
        typed={typed}
        verb="unlock"
        whose={words.whose}
      />
      <SlideConfirm
        confirmed={slid}
        confirmedLabel={words.slid}
        label={words.slide}
        locked={pending || !deleteMateConfirmed(typed, name)}
        onConfirmedChange={onSlid}
      />
    </div>
  );
}

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
  readonly onConfirm: (confirmation: DeletionConfirmation) => void;
  readonly onAgain: () => void;
  readonly initial?: {
    readonly confirmation: DeletionConfirmation;
    readonly opened: ReadonlySet<string>;
    readonly typed: string;
  };
}) {
  const [confirmation, setConfirmation] = useState<DeletionConfirmation>(
    () => initial?.confirmation ?? { slid: new Set(), productionTyped: {} },
  );
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => initial?.opened ?? new Set());
  const [typed, setTyped] = useState(initial?.typed ?? "");
  const toggle = (id: string, on: boolean) => {
    setConfirmation((held) => {
      const slid = new Set(held.slid);
      if (on) slid.add(id);
      else slid.delete(id);
      return { ...held, slid };
    });
  };
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

  const plan = offer.kind === "project" || offer.kind === "last-choice" ? offer.plan : undefined;
  if (plan === undefined) return null;
  const ready = projectDeletionReady(
    plan,
    confirmation,
    deleteMateConfirmed(typed, project.name),
    holdings !== undefined,
  );
  const slid = ready.slid;
  const words = projectDeletionWords({
    name: project.name,
    plan,
    holdings,
    mate: mate === undefined ? undefined : { name: mate.name, services: mate.services },
    slid,
  });
  const rows = deletionGoesRows({ plan, mate, slid });
  const steps = deletionStepStates(plan, confirmation, ready.ready);

  return (
    <div className="contents" data-zerops-surface="delete-page-form">
      <PageHeader line={page.line} title={page.title} />
      {plan.refusal === undefined ? null : (
        <Failure cause={plan.refusal} role="alert" size="line" />
      )}
      <Section
        line={page.stepLines[0]}
        title={
          <StepTitle n={1} state={steps[0]}>
            {page.steps[0]}
          </StepTitle>
        }
      >
        {rows.length === 0 ? (
          <Text render={<p />} variant="description">
            {page.nothing}
          </Text>
        ) : null}
        <Card hidden={rows.length === 0} variant="flat">
          <List>
            {rows.map((row) => (
              <div key={row.id}>
                <Row
                  badges={
                    <Badge tone={row.kind === "production" ? "danger" : "neutral"}>
                      {row.badge}
                    </Badge>
                  }
                  control={
                    row.kind !== "production" ? undefined : (
                      <Button
                        disabled={pending}
                        onClick={() => {
                          const open = !opened.has(row.id);
                          setOpened((held) => {
                            const next = new Set(held);
                            if (open) next.add(row.id);
                            else next.delete(row.id);
                            return next;
                          });
                          if (!open) toggle(row.id, false);
                        }}
                        size="sm"
                        type="button"
                        variant={opened.has(row.id) ? "ghost" : "secondary"}
                      >
                        {opened.has(row.id) ? page.keepProduction : page.deleteProduction}
                      </Button>
                    )
                  }
                  lead={
                    row.kind === "mate" && mate !== undefined ? (
                      <MateFace size={32} state="idle" tint={mate.tint} />
                    ) : (
                      <LogoTile>{row.kind === "stage" ? <BoxIcon /> : <GlobeIcon />}</LogoTile>
                    )
                  }
                  line={row.line}
                  meta={
                    row.kind === "production" ? undefined : (
                      <Badge dot tone={row.goes ? "danger" : "success"}>
                        {row.goes ? page.goes : page.stays}
                      </Badge>
                    )
                  }
                  title={row.title}
                />
                {row.kind === "stage" && row.slide !== undefined ? (
                  <div className="ps-14 pe-4 pb-4" data-zerops-surface="delete-page-stage">
                    <SlideConfirm
                      confirmed={slid.has(row.id)}
                      confirmedLabel={row.slide.confirmed}
                      label={row.slide.label}
                      locked={pending}
                      onConfirmedChange={(confirmed) => {
                        toggle(row.id, confirmed);
                      }}
                    />
                  </div>
                ) : null}
                {row.kind === "production" && opened.has(row.id) ? (
                  <ProductionBlock
                    name={row.title}
                    onSlid={(confirmed) => {
                      toggle(row.id, confirmed);
                    }}
                    onTyped={(next) =>
                      setConfirmation((held) => {
                        const slid = new Set(held.slid);
                        if (!productionConfirmed(next, row.title, slid.has(row.id)))
                          slid.delete(row.id);
                        return {
                          slid,
                          productionTyped: { ...held.productionTyped, [row.id]: next },
                        };
                      })
                    }
                    pending={pending}
                    typed={confirmation.productionTyped[row.id] ?? ""}
                    slid={slid.has(row.id)}
                  />
                ) : null}
              </div>
            ))}
          </List>
        </Card>
      </Section>
      <Section
        line={page.stepLines[1]}
        title={
          <StepTitle n={2} state={steps[1]}>
            {page.steps[1]}
          </StepTitle>
        }
      >
        {holdings === undefined ? (
          <Loading label={page.holdingsReading} shape="words" />
        ) : (
          <Card variant="flat">
            <List>
              {deletionCodeRows(holdings).map((row) => (
                <Row
                  meta={
                    <Badge dot tone="danger">
                      {page.goes}
                    </Badge>
                  }
                  key={row.repo}
                  lead={
                    <LogoTile>
                      <GitBranchIcon />
                    </LogoTile>
                  }
                  line={row.line}
                  title={row.title}
                />
              ))}
            </List>
          </Card>
        )}
      </Section>
      <Section
        line={page.stepLines[2]}
        title={
          <StepTitle n={3} state={steps[2]}>
            {page.steps[2]}
          </StepTitle>
        }
      >
        <div className="flex flex-col gap-5">
          <Card size="md" variant="inset">
            <Facts>
              <Fact label={page.goes}>
                {words.goes === undefined
                  ? "…"
                  : words.goes.map((line) => (
                      <span className="block" key={line}>
                        {line}
                      </span>
                    ))}
              </Fact>
              <Fact label={page.stays}>
                {words.stays.map((line) => (
                  <span className="block" key={line}>
                    {line}
                  </span>
                ))}
              </Fact>
            </Facts>
          </Card>
          <ZeropsConfirmName
            hold={ready.missing}
            name={project.name}
            onTyped={setTyped}
            pending={pending}
            typed={typed}
            whose={page.whose}
          />
          {error === null ? null : <Failure cause={error} role="alert" size="line" />}
          <div className="flex items-center justify-end gap-3">
            {ready.missing === null ? null : <Text variant="note">{ready.missing}</Text>}
            <Button onClick={onCancel} type="button" variant="ghost">
              {page.cancel}
            </Button>
            <Button
              aria-busy={pending || undefined}
              data-zerops-surface="delete-page-confirm"
              disabled={!ready.ready || pending}
              onClick={() => {
                if (ready.ready && !pending) onConfirm(confirmation);
              }}
              type="button"
              variant="destructive"
            >
              {pending ? MATE_DELETING_WORD : words.submit}
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
  mateId,
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
  const candidate = candidates.find((row) => row.project.id === mateId);
  const project = deletionProjectOf(structure, appId, deletion);
  const placement = project?.placements.find((item) => item.projectId === mateId);
  const mateName =
    candidate === undefined
      ? nameUnderApp(placement?.name ?? "", project?.name) || "Its Mate"
      : projectNameInApp(candidate.project);
  const mateFacts = mateId === undefined ? undefined : { projectId: mateId, name: mateName };
  const [past, setPast] = useState<string>();
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
    mateId === undefined || state.kind !== "form" || state.offer.kind !== "last-choice"
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
    setPressing(true);
    setError(null);
    press.then(
      () => {
        if (active.current) setPressing(false);
      },
      (cause: unknown) => {
        if (!active.current) return;
        setPressing(false);
        setError(zeropsErrorMessage(cause));
      },
    );
  };
  const confirm = (confirmation: DeletionConfirmation) => {
    if (orgId === undefined || state.kind !== "form") return;
    const previous = startId.current;
    let start = deletionStart({
      orgId,
      id: previous?.id ?? randomUUID(),
      offer: state.offer,
      choice: { kind: "project", ...confirmation },
    });
    if (start === undefined) return;
    if (previous !== null && !sameDeletionStart(previous, start))
      start = { ...start, id: randomUUID() };
    startId.current = start;
    settle(submit(start));
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
        onCancel={back}
        onConfirm={confirm}
        onAgain={() => {
          if (state.kind !== "standing" || state.offer.deletion.kind !== "failed") return;
          startId.current = null;
          setError(null);
          setPast(state.offer.deletion.id);
        }}
      />
    </ZeropsHostedFrame>
  );
}
