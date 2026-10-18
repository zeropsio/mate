/**
 * A project's environments in its page's Production and Stages (`environmentSlots`) — a stage or production by its name, what it runs and its
 * state, opened by its identity; a Mate that is also the stage; a tier being set up or not
 * finished; and a tier nobody added, quiet, with its Add where HQ offers it.
 *
 * Drawn once HQ has told the environments: before that, nothing is known to be absent.
 */
import {
  deployWord,
  firstDeployLine,
  firstDeployTone,
  projectNameInApp,
  readZeropsMembership,
  type CanonicalEnvironmentRow as EnvironmentRow,
  type EnvironmentSlotRow,
  type FirstDeploy,
  type GroupEnvironmentTier,
  type GroupRowTone,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";
import { stopTone, stopView, type Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { Fragment, useCallback, useMemo } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useStopDeploymentsShown } from "~/zerops/projectFlows";
import { environmentDoorLabel } from "~/zerops/putLive.logic";
import { GitDeliveryStatus } from "../GitDeliveryStatus";
import { STATUS_BADGE_TONE } from "../primitives";
import { StopReadAgain } from "../StopReadAgain";
import { ReleaseAction, type ReleaseOffer } from "../ZeropsReleaseVerb";

/**
 * The Mates of a group that are also its stage (`devstage`): HQ deploys nothing to them, their
 * agent does, and they stand for the stage on the road.
 */
export function devstagesOf(
  groupId: string,
  projects: ReadonlyArray<ZeropsProject>,
): ReadonlyArray<{ readonly id: string; readonly name: string }> {
  return projects.flatMap((project) => {
    const membership = readZeropsMembership(project);
    return membership.groupId === groupId && membership.role === "devstage"
      ? [{ id: project.id, name: projectNameInApp(project) }]
      : [];
  });
}

/** What the road's columns know of the project's environments, from the page's reads. */
export interface RoadEnvironmentFacts {
  readonly groupId: string;
  /** Empty until HQ has told the environments. */
  readonly slots: ReadonlyArray<EnvironmentSlotRow>;
  readonly environments: ReadonlyArray<EnvironmentRow>;
  readonly repos?: React.ComponentProps<typeof GitDeliveryStatus>["repos"];
  /** Said in place of a stop the grant withholds; `null` where it does not. */
  readonly withheldNotice?: ((projectId: string) => string | null) | undefined;
  /** A stage that runs nothing: where its first deploy stands. */
  readonly firstDeployOf?: ((projectId: string) => FirstDeploy | undefined) | undefined;
  readonly release: ReleaseOffer;
  /** Adds a tier: Put it live for production, Add stage for a stage. */
  readonly onAdd: (tier: GroupEnvironmentTier) => void;
  /** Its place's block under an environment's row, by its project (`RoadPlace`). */
  readonly detail?: ((projectId: string) => React.ReactNode) | undefined;
}

/** A stop's tone as a dot's. Neutral wears none: nothing has been deployed. */
const STOP_DOT_TONE: Record<GroupRowTone, ServiceStatusToneId | undefined> = {
  good: "ok",
  pending: "busy",
  bad: "failed",
  neutral: undefined,
};

const UNREAD_DEPLOYMENT: Shown<Deployment> = { state: "unread", waitingFor: null };

/** A stop's version column shares its page's runtime answer, including a failure or wait. */
function stopLineVersion(deployment: Shown<Deployment> | undefined, row: EnvironmentRow): string {
  return stopView({ deployment: deployment ?? UNREAD_DEPLOYMENT, row, nowMs: 0 }).line;
}

/** A quiet row under a stop: its words, and its one button where it has one. */
function QuietRow({
  name,
  line,
  children,
}: {
  readonly name: string;
  readonly line: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <li className="pp-road-env" data-quiet="">
      <span className="pp-road-env-name">{name}</span>
      <span className="pp-road-env-line">{line}</span>
      {children}
    </li>
  );
}

/** An environment on the road, opened by its identity — never by its project's name or address. */
function StopLine({
  environment,
  groupId,
  notice,
  firstDeploy,
}: {
  readonly environment: EnvironmentRow;
  readonly groupId: string;
  /**
   * Said in place of the stop while the grant withholds its project: its tier stays, and its
   * name, what it runs and its page do not (DESIGN §3.4).
   */
  readonly notice: string | null;
  readonly firstDeploy?: FirstDeploy | undefined;
}) {
  const navigate = useNavigate();
  const projectId = environment.target.kind === "zerops" ? environment.target.projectId : undefined;
  const deployments = useStopDeploymentsShown(
    useMemo(() => (projectId === undefined ? [] : [projectId]), [projectId]),
  );
  const deployment = projectId === undefined ? undefined : deployments.get(projectId);
  const tone = stopTone(deployment, environment);
  // No word for what runs and a first deploy asked for: the line its cell and its page say.
  const said = deployWord(tone);
  const firstWord = said === undefined ? firstDeployLine(firstDeploy) : undefined;
  const word = said ?? firstWord;
  const dotTone = firstWord === undefined ? STOP_DOT_TONE[tone] : firstDeployTone(firstDeploy);
  const open = useCallback(() => {
    void navigate({
      to: "/group/$groupId/$projectId",
      params: { groupId, projectId: environment.id },
    });
  }, [environment.id, groupId, navigate]);
  if (notice !== null)
    return (
      <li className="pp-road-env" data-quiet="">
        <span className="pp-road-env-name">{environment.tier}</span>
        <span className="pp-road-env-line">{notice}</span>
        {projectId === undefined ? null : <StopReadAgain projectId={projectId} />}
      </li>
    );
  return (
    <li>
      <button
        className="pp-road-env"
        data-zerops-environment-id={environment.id}
        onClick={open}
        type="button"
      >
        <span className="pp-road-env-name">{environment.name}</span>
        {environment.target.kind === "git" ? null : (
          <span className="pp-road-env-version">{stopLineVersion(deployment, environment)}</span>
        )}
        {word === undefined || dotTone === undefined ? null : (
          <Badge dot tone={STATUS_BADGE_TONE[dotTone]}>
            {word}
          </Badge>
        )}
        <ChevronRightIcon aria-hidden="true" className="pp-road-env-go" />
      </button>
      {environment.parts === undefined ? null : (
        <span className="pp-road-env-line">{environment.parts}</span>
      )}
      {projectId === undefined ? null : <StopReadAgain projectId={projectId} />}
    </li>
  );
}

const TIER_NAME: Record<GroupEnvironmentTier, string> = {
  stage: "Stage",
  production: "Production",
};

/** One tier's rows in its section: each environment's row, its place's block under it. */
export function RoadEnvironmentRows({
  tier,
  facts,
}: {
  readonly tier: GroupEnvironmentTier;
  readonly facts: RoadEnvironmentFacts;
}) {
  const { groupId, environments, withheldNotice, firstDeployOf } = facts;
  const rows = facts.slots.filter((slot) =>
    slot.kind === "devstage" ? tier === "stage" : slot.tier === tier,
  );
  if (rows.length === 0) return null;
  return (
    <ul className="pp-road-envs" data-zerops-road-environments={tier}>
      {rows.map((slot) => {
        switch (slot.kind) {
          case "devstage":
            return <QuietRow key={slot.id} line={slot.line} name="Stage" />;
          case "creating":
            return <QuietRow key={slot.id} line={slot.line} name={TIER_NAME[slot.tier]} />;
          case "half-made":
            return <QuietRow key={slot.id} line={slot.line} name={TIER_NAME[slot.tier]} />;
          case "slot":
            return (
              <QuietRow key={slot.tier} line={slot.line} name={slot.name}>
                {slot.add ? (
                  <Button
                    onClick={() => {
                      facts.onAdd(slot.tier);
                    }}
                    size="sm"
                    variant="secondary"
                  >
                    {environmentDoorLabel(slot.tier, slot.name)}
                  </Button>
                ) : null}
              </QuietRow>
            );
          case "environment": {
            const environment = environments.find((entry) => entry.id === slot.id);
            if (environment === undefined) return null;
            const projectId =
              environment.target.kind === "zerops" ? environment.target.projectId : undefined;
            return (
              <Fragment key={slot.id}>
                <StopLine
                  environment={environment}
                  firstDeploy={projectId === undefined ? undefined : firstDeployOf?.(projectId)}
                  groupId={groupId}
                  notice={projectId === undefined ? null : (withheldNotice?.(projectId) ?? null)}
                />
                {projectId === undefined || facts.detail === undefined ? null : (
                  <li className="pp-place-detail">{facts.detail(projectId)}</li>
                )}
                {environment.target.kind === "git" ? (
                  <li>
                    <GitDeliveryStatus
                      delivery={environment.git}
                      environment={{ target: environment.target, tier: environment.tier }}
                      repos={facts.repos}
                      showExpiry={false}
                    />
                  </li>
                ) : null}
                {slot.note === undefined ? null : (
                  <li className="pp-road-env" data-quiet="">
                    <span className="pp-road-env-line">{slot.note.text}</span>
                    {slot.note.review ? (
                      <ReleaseAction release={facts.release} variant="secondary" />
                    ) : null}
                  </li>
                )}
              </Fragment>
            );
          }
        }
      })}
    </ul>
  );
}
