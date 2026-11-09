/**
 * What the overview's cards are handed from the page's reads: each project's places as the left
 * menu's chips read them (`productionChip`, `stageStopChip`), each place's panel with its facts and
 * its actions, and the people on a project.
 *
 * The chips are read from the same inputs the menu reads them from — the platform's deployments
 * and services, HQ's releases — so a card's foot and the menu say the same of one production.
 */
import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import {
  formatRunClock,
  releaseFailureOf,
  stageMarks,
  stageStandings,
  type FlowPullRequest,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import { deployActivatedAt, type Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { EnvironmentId, ThreadId, type ProviderApprovalDecision } from "@t3tools/contracts";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { useState, type ReactNode } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { formatShortTimestamp } from "~/timestampFormat";
import { buildPlanImplementationPrompt } from "~/proposedPlan";
import { findLatestProposedPlan } from "~/session-logic";
import { useMateWrite } from "~/zerops/useMateWrite";
import { useSecondsNowMs } from "~/zerops/useNowMs";
import { useOpenReview } from "~/zerops/review";
import { mainStageOf } from "../review/reviewReads";
import { mateDecision } from "../mateDecision.logic";
import { SidebarMateAge } from "../SidebarMateAge";
import type { MateRowSlot } from "../SidebarMateRow.logic";
import {
  buildingOf,
  drawnChip,
  productionChip,
  rollbacksOf,
  stageStopChip,
  stopServing,
  type ProductionChip,
  type ReleasesAnswer,
  type StopServing,
} from "../SidebarProductionChip.logic";
import type { CardProductionVerbs } from "./CardGroupMenu";
import { CardChanges, CardMateLiftActions } from "./ProjectCards";
import { ProjectHistory } from "./ProjectHistory";
import {
  historyOffered,
  placeLines,
  CARD_CHANGES,
  cardChanges,
  productionBuilding,
  releaseProductionRuns,
  rollBackTarget,
  type CardMateReading,
  type CardStage,
} from "./projectCard.logic";
import { CHANGES_UNKNOWN_LINE } from "./projectsView.logic";
import type { ProjectsFlowGroup } from "./ZeropsProjectsFlow";

/** What a card's places need of an environment: how its services stand and where they answer. */
export interface PlaceItem {
  readonly project: { readonly id: string; readonly status?: string | undefined };
  readonly routes?: ReadonlyArray<ZeropsPublicRoute> | undefined;
  /** Public-access evidence of an address publication in progress; absent while unread. */
  readonly addressPending?: boolean | undefined;
  /** Ports its public address would open that are not on yet; absent while its services are unread. */
  readonly routeOffers?: ReadonlyArray<unknown> | undefined;
  readonly services?:
    | {
        readonly hostnames: ReadonlyArray<string>;
        readonly deployedAt: string | undefined;
        readonly statuses: ReadonlyArray<{
          readonly hostname: string;
          readonly status: string;
          readonly runtime: boolean;
        }>;
      }
    | undefined;
}

const UNKNOWN: StopServing = { kind: "unknown" };
const NO_UNTOLD: ReadonlyArray<string> = [];

export function useOverviewSlots<T extends PlaceItem>(input: {
  readonly flows: ReadonlyMap<string, ZeropsProjectFlow>;
  readonly deployments: ReadonlyMap<string, Shown<Deployment>>;
  /** A Mate's face, small: whose a change is, beside it. */
  readonly mateFace: (item: T) => ReactNode;
  readonly nowMs: number;
  /** Drawn on the project's own page, whose column already holds its history. */
  readonly onPage?: boolean | undefined;
}) {
  const { flows, deployments, nowMs } = input;
  const openReview = useOpenReview();

  const itemOf = (entry: ProjectsFlowGroup<T>, projectId: string | undefined) =>
    projectId === undefined ? undefined : entry.stops.get(projectId)?.item;
  const servingOf = (item: T | undefined): StopServing =>
    item === undefined
      ? UNKNOWN
      : stopServing({
          projectStatus: item.project.status,
          services: item.services?.statuses,
          routes: item.routes ?? [],
        });
  const downOf = (serving: StopServing) => (serving.kind === "down" ? serving.services : []);

  /** Every place of a project as the menu's chips say it. */
  const placesOf = (entry: ProjectsFlowGroup<T>) => {
    const read = flows.get(entry.group.groupId);
    const releases: ReleasesAnswer =
      read !== undefined && read.releasesKnown
        ? {
            kind: "answered",
            failure: releaseFailureOf({
              releases: read.releases,
              environmentInputs: read.environmentInputs,
              stalled: read.release.stalled,
            }),
            rollbacks: rollbacksOf(read.releases),
          }
        : { kind: "waiting" };
    const deploymentsOf = (id: string) => {
      const row = read?.environments.find((environment) => environment.id === id);
      const projectId =
        row === undefined
          ? entry.stops.get(id)?.item?.project.id
          : row.target.kind === "zerops"
            ? row.target.projectId
            : undefined;
      return projectId === undefined ? undefined : deployments.get(projectId);
    };
    const { production } = entry.flow;
    const prodStop = "stop" in production ? production.stop : undefined;
    const prodItem = itemOf(entry, prodStop?.projectId);
    const prodServing = servingOf(prodItem);
    const chip = drawnChip(
      productionChip({
        production,
        building: productionBuilding(
          production.kind,
          prodStop === undefined ? undefined : buildingOf(deploymentsOf(prodStop.projectId)),
        ),
        waiting: entry.flow.main.notLive,
        waitingAtLeast: entry.flow.main.notLiveAtLeast,
        changeCount: entry.flow.main.changeCount,
        untold: read?.release.untold ?? NO_UNTOLD,
        serving: prodServing,
        releases,
      }),
    );
    const stageChips = new Map<string, ProductionChip | undefined>();
    const down = new Map<string, ReadonlyArray<string>>();
    const addressPending = new Map<string, boolean>();
    if (prodStop !== undefined) down.set(prodStop.projectId, downOf(prodServing));
    for (const stop of entry.flow.stages) {
      const item = itemOf(entry, stop.projectId);
      const serving = servingOf(item);
      down.set(stop.projectId, downOf(serving));
      const pending = item?.addressPending;
      if (pending !== undefined) addressPending.set(stop.projectId, pending);
      stageChips.set(stop.projectId, drawnChip(stageStopChip({ stop, serving, releases })));
    }
    const since =
      prodStop === undefined
        ? undefined
        : (deployActivatedAt(deploymentsOf(prodStop.projectId)) ?? prodItem?.services?.deployedAt);
    // The release on its way, where it is a roll back: production's line says what it goes back to.
    const rollsBackTo = chip?.rollsBackTo;
    return {
      read,
      releases,
      chip,
      stageChips,
      down,
      addressPending,
      rollsBackTo,
      since,
      prodItem,
      prodStop,
    };
  };

  /**
   * What the stage that follows `main` runs, as HQ's deploys say it, and whether it runs every
   * change a release would carry — `undefined` while either is unread.
   */
  const stageOf = (entry: ProjectsFlowGroup<T>) => {
    const read = flows.get(entry.group.groupId);
    const environment = read === undefined ? undefined : mainStageOf(read);
    if (read === undefined || environment === undefined) return undefined;
    const standings = stageStandings(environment);
    const mainHeads = new Map(
      (read.repos ?? []).flatMap(({ name, mainHead }) =>
        mainHead === null ? [] : [[name, mainHead] as const],
      ),
    );
    const marks = stageMarks({ contents: read.release.contents, stage: standings, mainHeads });
    const stage: CardStage = {
      runs: [...standings.runs.values()].filter((sha) => sha !== undefined),
      deploying: [...standings.deploying.values()],
      mainHeads,
    };
    return {
      stage,
      runsRelease:
        marks.size === 0 ? undefined : [...marks.values()].every((mark) => mark === "on-stage"),
    };
  };

  const cardPlaces = (entry: ProjectsFlowGroup<T>) => {
    const { chip, stageChips, down, addressPending, rollsBackTo, since } = placesOf(entry);
    return {
      chip,
      stageChips,
      down,
      addressPending,
      rollsBackTo,
      since,
      releaseOnStage: stageOf(entry)?.runsRelease,
    };
  };

  /** Production is down, or its last release failed, as its card's line says it. */
  const productionBroken = (entry: ProjectsFlowGroup<T>): boolean => {
    const line = placeLines({ flow: entry.flow, ...cardPlaces(entry), nowMs }).find(
      (place) => place.kind === "production",
    );
    return line?.dot === "failed" || line?.dot === "down";
  };

  /**
   * What production's rarer verbs need on its card's ···: its place, the release it would roll
   * back to while it runs well, and whether it has a history to open — `undefined` with no
   * production to speak of.
   */
  const productionVerbs = (entry: ProjectsFlowGroup<T>): CardProductionVerbs | undefined => {
    const { production } = entry.flow;
    if (!("stop" in production) || production.stop.git !== undefined) return undefined;
    const read = flows.get(entry.group.groupId);
    const releases = read?.releasesKnown === true ? read.releases : [];
    return {
      projectId: production.stop.projectId,
      rollBack: productionBroken(entry) ? undefined : rollBackTarget(releases),
      history: historyOffered({
        releases: releases.length,
        runs:
          releaseProductionRuns(
            releases,
            production.kind === "releasing" ? production.tag : undefined,
          ) !== undefined,
      }),
      runs: production.stop.version !== undefined || production.stop.state === "deployed",
    };
  };

  /**
   * A project's latest changes (`cardChanges`): its open ones, read for every project, and — while
   * the card holds its detail — the merged ones, each with where it went. A click opens its review.
   */
  const renderChanges = (entry: ProjectsFlowGroup<T>): ReactNode => {
    const read = flows.get(entry.group.groupId);
    const changes = cardChanges({
      open: entry.flow.pullRequests.map((change) => change.pull),
      merged: read?.merged ?? [],
      releases: read?.releasesKnown === true ? read.releases : [],
      // A stage whose deploys are unread runs nothing this can tell.
      stage:
        entry.flow.stages.length === 0
          ? undefined
          : (stageOf(entry)?.stage ?? { runs: [], deploying: [], mainHeads: new Map() }),
      production: entry.flow.production.kind !== "absent",
      limit: CARD_CHANGES,
      // On the project's page its History says what each release put live.
      unreleased: input.onPage === true,
    });
    const mateName = (projectId: string) =>
      entry.flow.mates.find((mate) => mate.projectId === projectId)?.name;
    const releases =
      read?.releasesKnown === true && input.onPage !== true
        ? read.releases.map((release) => ({
            tag: release.tag,
            taggedAt: release.taggedAt,
            live: release.standing === "live",
          }))
        : [];
    return (
      <CardChanges
        changes={changes}
        changesFailure={read?.changesFailure}
        changesKnown={read?.changesKnown === true}
        setupReview={
          read === undefined
            ? undefined
            : {
                appId: entry.group.groupId,
                repos: read.repos,
                merged: read.merged,
                environments: read.environmentInputs,
              }
        }
        face={(projectId) => {
          const item = entry.mates.get(projectId);
          return item === undefined ? undefined : input.mateFace(item);
        }}
        mateName={mateName}
        releases={releases}
        unknown={
          entry.changesUnknown === undefined
            ? undefined
            : CHANGES_UNKNOWN_LINE[entry.changesUnknown]
        }
        onOpen={(change, from) => {
          openChange(entry.group.groupId, change.pull, from);
        }}
      />
    );
  };

  const openChange = (groupId: string, change: FlowPullRequest, from: HTMLElement) => {
    openReview(
      { kind: "change", groupId, repository: change.repository, number: change.number },
      { from },
    );
  };

  /** A project page's History: its releases, each opening to the changes it put live. */
  const renderHistory = (entry: ProjectsFlowGroup<T>): ReactNode => (
    <ProjectHistory
      face={(projectId) => {
        const item = entry.mates.get(projectId);
        return item === undefined ? undefined : input.mateFace(item);
      }}
      flow={flows.get(entry.group.groupId)}
      groupId={entry.group.groupId}
      mateName={(projectId) => entry.flow.mates.find((mate) => mate.projectId === projectId)?.name}
      onOpen={(change, from) => {
        openChange(entry.group.groupId, change, from);
      }}
    />
  );

  return {
    cardPlaces,
    productionBroken,
    productionVerbs,
    renderChanges,
    renderHistory,
  };
}

/** A working Mate's clock, a step a second (R6). */
function CardClock({ since }: { readonly since: string }) {
  const nowMs = useSecondsNowMs(true);
  return <>{formatRunClock(nowMs - Date.parse(since))}</>;
}

/**
 * The right of a Mate's name on a card, as its menu row says it: when it last did something, the
 * run's clock while it works, or when it picks up again after a usage limit.
 */
export function CardMateSlot({
  slot,
  at,
}: {
  readonly slot: MateRowSlot;
  readonly at: string | undefined;
}) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  switch (slot.kind) {
    case "none":
      return null;
    case "clock":
      return <CardClock since={slot.since} />;
    case "paused":
      return <>{formatShortTimestamp(slot.until, timestampFormat)}</>;
    case "age":
      return <SidebarMateAge at={at} />;
  }
}

/**
 * A lifted Mate's buttons, answered in place as the menu's Waiting on you list answers them
 * (`useMateWrite`): Approve plan sends its plan to be built, Change it… asks for another; a
 * question's options and Answer… answer it; an approval's choices decide it. What cannot be
 * answered here — several questions at once, a Mate with no conversation open — opens it.
 */
export function CardMateWrite({
  name,
  lift,
  environmentId,
  threadId,
  onOpen,
  onAsk,
  onFix,
  onReview,
}: {
  readonly name: string;
  readonly lift: NonNullable<CardMateReading["lift"]>;
  readonly environmentId: string | undefined;
  readonly threadId: string | undefined;
  /** Opens its conversation. */
  readonly onOpen: () => void;
  /** Asks it in words through its conversation, where nothing answers in place. */
  readonly onAsk: (text: string) => void;
  readonly onFix: () => void;
  readonly onReview: (from: HTMLElement) => void;
}) {
  const write = useMateWrite(
    environmentId === undefined ? null : EnvironmentId.make(environmentId),
    threadId === undefined ? null : ThreadId.make(threadId),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const { detail, requests } = write;
  const settle = (pending: ReturnType<typeof write.send>) => {
    if (pending === undefined) {
      setError("Not sent: its conversation is still being read.");
      return;
    }
    setBusy(true);
    setError(undefined);
    void pending.then((result) => {
      setBusy(false);
      if (result._tag !== "Success" && !isAtomCommandInterrupted(result))
        setError("Not sent. Try again.");
    });
  };
  const shared = { name, lift, onFix, onReview, busy, error };
  const inPlace = environmentId !== undefined && threadId !== undefined;
  if (lift.kind === "plan") {
    const plan =
      detail === undefined
        ? null
        : findLatestProposedPlan(detail.proposedPlans, detail.latestTurn?.turnId ?? null);
    return (
      <CardMateLiftActions
        {...shared}
        onApprove={
          !inPlace
            ? onOpen
            : plan === null
              ? undefined
              : () =>
                  settle(write.send(buildPlanImplementationPrompt(plan.planMarkdown), "default"))
        }
        onReply={(text) => (inPlace ? settle(write.send(text, "plan")) : onAsk(text))}
      />
    );
  }
  if (lift.kind !== "question") {
    return <CardMateLiftActions {...shared} onApprove={undefined} onReply={onAsk} />;
  }
  const decision = mateDecision({
    name,
    kind: requests.approvals.length > 0 ? "approval" : "input",
    read: detail !== undefined,
    approvals: requests.approvals,
    userInputs: requests.userInputs,
    failure: undefined,
  });
  if (decision?.kind === "approval")
    return (
      <CardMateLiftActions
        {...shared}
        allowText={false}
        choices={decision.choices.map((choice) => ({
          label: choice.label,
          primary: choice.primary,
          onPick: () =>
            settle(write.decide(decision.requestId, choice.value as ProviderApprovalDecision)),
        }))}
        onApprove={undefined}
        onReply={onAsk}
      />
    );
  if (decision?.kind === "question")
    return (
      <CardMateLiftActions
        {...shared}
        allowText={decision.allowText}
        choices={decision.choices.map((choice) => ({
          label: choice.label,
          primary: false,
          onPick: () => settle(write.answer(decision.requestId, decision.questionId, choice.value)),
        }))}
        onApprove={undefined}
        onReply={(text) => settle(write.answer(decision.requestId, decision.questionId, text))}
      />
    );
  // Still being read, several questions at once, or nothing open to answer in: its conversation.
  return (
    <CardMateLiftActions
      {...shared}
      busy={busy || (inPlace && decision?.kind === "reading")}
      onApprove={undefined}
      onReply={(text) => (decision?.kind === "questions" ? onOpen() : onAsk(text))}
    />
  );
}
