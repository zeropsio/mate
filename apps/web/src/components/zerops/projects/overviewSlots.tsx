/**
 * What the overview's cards are handed from the page's reads: each project's places as the left
 * menu's chips read them (`applicationPlaceFacts`), production's rarer verbs for the card's ···,
 * and a project's changes and history.
 *
 * The chips are read from the same inputs the menu reads them from — the platform's deployments
 * and services, HQ's releases — so a card's foot and the menu say the same of one production.
 */
import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import { formatRunClock, type FlowPullRequest } from "@t3tools/client-runtime/zerops";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
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
import { mateDecision } from "../mateDecision.logic";
import { SidebarMateAge } from "../SidebarMateAge";
import type { MateRowSlot } from "../SidebarMateRow.logic";
import type { FixProblem } from "~/zerops/fixRequest";
import { fixProblemOf } from "../SidebarProductionChip.logic";
import {
  applicationPlaceFacts,
  applicationStage,
  type PlaceItem,
} from "../system/applicationPlaces.logic";
import type { CardProductionVerbs } from "./CardGroupMenu";
import { CardMateLiftActions } from "./ProjectCards";
import { ProjectHistory } from "./ProjectHistory";
import {
  historyOffered,
  placeLines,
  releaseProductionRuns,
  rollBackTarget,
  type CardMateReading,
} from "./projectCard.logic";
import type { ProjectsFlowGroup } from "./ZeropsProjectsFlow";

export function useOverviewSlots<T extends PlaceItem>(input: {
  readonly flows: ReadonlyMap<string, ZeropsProjectFlow>;
  readonly deployments: ReadonlyMap<string, Shown<Deployment>>;
  /** A Mate's face, small: whose a change is, beside it. */
  readonly mateFace: (item: T) => ReactNode;
  readonly nowMs: number;
}) {
  const { flows, deployments, nowMs } = input;
  const openReview = useOpenReview();

  /** Every place of a project as the menu's chips say it. */
  const placesOf = (entry: ProjectsFlowGroup<T>) =>
    applicationPlaceFacts({ entry, read: flows.get(entry.group.groupId), deployments });

  /**
   * What the stage that follows `main` runs, as HQ's deploys say it, and whether it runs every
   * change a release would carry — `undefined` while either is unread.
   */
  const stageOf = (entry: ProjectsFlowGroup<T>) => applicationStage(flows.get(entry.group.groupId));

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
   * What a Mate is told of a broken production when asked to fix it, as the menu's production chip
   * tells it (`fixProblemOf`); `undefined` where the chip is unread or production is well.
   */
  const productionFix = (entry: ProjectsFlowGroup<T>): FixProblem | undefined => {
    const { chip, releases, down, prodStop } = placesOf(entry);
    if (chip === undefined) return undefined;
    return fixProblemOf({
      chip,
      failure: releases.kind === "answered" ? releases.failure : undefined,
      down: prodStop === undefined ? [] : (down.get(prodStop.projectId) ?? []),
    });
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

  const openChange = (
    groupId: string,
    change: Pick<FlowPullRequest, "repository" | "number">,
    from: HTMLElement,
  ) => {
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
    productionFix,
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
