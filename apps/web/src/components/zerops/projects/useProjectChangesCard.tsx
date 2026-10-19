/**
 * What a project page's Changes card reads: the flow's open and merged changes and its releases
 * (`projectChangeGroups`), what the stage that follows `main` runs, each change's Mate by name
 * and face as the menu draws it, and where a change and an older release open.
 */
import {
  assignCandidateMateTints,
  mateShapeOf,
  projectNameInApp,
  stageStandings,
} from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, type ComponentProps } from "react";

import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import { useOpenReview } from "~/zerops/review";
import { useReleaseOffer } from "../ZeropsReleaseVerb";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";

import { MateFace } from "../primitives";
import { mainStageOf } from "../review/reviewReads";
import type { CardStage } from "./projectCard.logic";
import { projectChangeGroups } from "./projectChangesCard.logic";
import type { ChangeMate, ProjectChangesCard } from "./ProjectChangesCard";

type CardProps = ComponentProps<typeof ProjectChangesCard>;

/** The project's Mates by their project, each with its name and its face as the menu draws it. */
export function useGroupMates(groupId: string): ReadonlyMap<string, ChangeMate> {
  const { listing } = useZeropsCandidates();
  return useMemo(() => {
    const candidates = heldCandidates(listing).rows;
    const tints = assignCandidateMateTints(candidates);
    return new Map(
      candidates
        .filter((candidate) => candidate.project.hq?.appId === groupId)
        .map((candidate) => {
          const tint = tints.get(candidate.project.id) ?? "slate";
          return [
            candidate.project.id,
            {
              name: projectNameInApp(candidate.project),
              face: (
                <MateFace
                  shape={mateShapeOf(candidate.project, tint)}
                  size={20}
                  state="idle"
                  tint={tint}
                />
              ),
            },
          ] as const;
        }),
    );
  }, [groupId, listing]);
}

/** What the stage that follows `main` runs, as its deploys say it; none where there is no stage. */
function cardStageOf(flow: ZeropsProjectFlow): CardStage | undefined {
  const environment = mainStageOf(flow);
  if (environment === undefined) return undefined;
  const standings = stageStandings(environment);
  return {
    runs: [...standings.runs.values()].filter((sha) => sha !== undefined),
    deploying: [...standings.deploying.values()],
    mainHeads: new Map(
      (flow.repos ?? []).flatMap(({ name, mainHead }) =>
        mainHead === null ? [] : [[name, mainHead] as const],
      ),
    ),
  };
}

export function useProjectChangesCard(
  groupId: string,
  flow: ZeropsProjectFlow,
): Omit<CardProps, "emptyAction"> {
  const mates = useGroupMates(groupId);
  const openReview = useOpenReview();
  const navigate = useNavigate();
  const production = flow.environments.find((entry) => entry.tier === "production");
  const groups = useMemo(
    () =>
      projectChangeGroups({
        open: flow.pullRequests,
        merged: flow.merged,
        releases: flow.releasesKnown
          ? flow.releases.map((release) => ({
              tag: release.tag,
              taggedAt: release.taggedAt,
              live: release.standing === "live",
            }))
          : [],
        stage: cardStageOf(flow),
        production: production !== undefined,
      }),
    [flow, production],
  );
  const onOpen = useCallback<CardProps["onOpen"]>(
    (change, from) => {
      openReview(
        {
          kind: "change",
          groupId,
          repository: change.pull.repository,
          number: change.pull.number,
        },
        { from },
      );
    },
    [groupId, openReview],
  );
  const productionId = production?.id;
  // An older release opens production's page, where every release says what it carried.
  const onOpenRelease = useMemo(
    () =>
      productionId === undefined
        ? undefined
        : () => {
            void navigate({
              to: "/group/$groupId/$projectId",
              params: { groupId, projectId: productionId },
            });
          },
    [groupId, navigate, productionId],
  );
  // The ready group's Release is the page's own Release door: offered where the release gate
  // offers it to this person, waiting while one is on its way.
  const release = useReleaseOffer(groupId, flow);
  const onRelease =
    productionId === undefined || (!release.offered && !release.releasing)
      ? undefined
      : release.onReview;
  return {
    groups,
    read:
      flow.changesFailure !== undefined && !flow.changesKnown
        ? { state: "untold", words: flow.changesFailure }
        : flow.changesKnown
          ? { state: "known" }
          : { state: "reading" },
    mateOf: (projectId) => mates.get(projectId),
    onOpen,
    onOpenRelease,
    onRelease,
    releasing: release.releasing,
  };
}
