/**
 * A Mate on its project's card, read as its row in the menu reads it: the one face (`mateFace`,
 * from the same facts — up as `mateAwake` says it, its activity, whose it is, its change's review,
 * its life), the same line 2 (`mateRowSecond`) and the same time. What waits on the viewer is
 * lifted with its buttons, answered in place (`CardMateWrite`).
 */
import {
  mateArrivingUntil,
  matePoseOf,
  readZeropsMembership,
  type FlowPullRequest,
} from "@t3tools/client-runtime/zerops";
import { mateOwnerRecords } from "@t3tools/client-runtime/zerops/mateAccess";
import {
  candidateContainerRuns,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import type { ZeropsProjectFlow } from "@t3tools/client-runtime/data";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import type { ReactNode } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { formatShortTimestamp } from "~/timestampFormat";
import { mateReviewWaits, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import { mateDeleting, useDeletingMates } from "~/zerops/deletingMates";
import { useAskMateToFix } from "~/zerops/fixRequest";
import { mateFace } from "~/zerops/mateFace.logic";
import { useOpenReview } from "~/zerops/review";
import { useAskMate } from "~/zerops/useAskMate";
import { useMateFaceWatch } from "~/zerops/useMateMoments";
import { useMateLinkedInHq } from "~/zerops/useMenuMateReadings";
import { useNowMs } from "~/zerops/useNowMs";
import { useProjectMateActivity } from "~/zerops/useZeropsAgentActivity";
import { useHqProjectPerson, zeropsMateOwnerOf } from "~/zerops/useZeropsMateOwners";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { Avatar, MateFace } from "../primitives";
import {
  mateOwnerView,
  mateRowAskLine,
  mateRowReading,
  mateRowSecond,
} from "../SidebarMateRow.logic";
import { CardMateSlot, CardMateWrite } from "./overviewSlots";
import { CardMate, CardMateTime } from "./ProjectCards";
import { cardMateReading, cardSecondWords } from "./projectCard.logic";

export function OverviewCardMate({
  candidate,
  name,
  tint,
  shape,
  groupId,
  flow,
  change,
  conversationsRead,
  outsideHq,
  containerLine,
  containerActions,
  onOpen,
}: {
  readonly candidate: ZeropsCandidate;
  readonly name: string;
  readonly tint: MateTintId;
  readonly shape: MateShapeId | undefined;
  readonly groupId: string | undefined;
  /** Its project's flow, whose changes say whether its own waits on the viewer's review. */
  readonly flow: ZeropsProjectFlow | undefined;
  /** Its open change that asks for review (`changeShowsReview`). */
  readonly change: FlowPullRequest | undefined;
  readonly conversationsRead: boolean;
  readonly outsideHq: boolean;
  /** What its container says first, where it says something: coming up, a failed connect. */
  readonly containerLine: ReactNode;
  /** A verb its container needs (Start, Remove). */
  readonly containerActions: ReactNode;
  readonly onOpen: (() => void) | undefined;
}) {
  const projectId = candidate.project.id;
  // What its row in the menu reads (`useProjectMateActivity`): HQ's word, or its socket's.
  const activity: ZeropsAgentActivity | undefined = useProjectMateActivity(projectId);
  const people = useHqProjectPerson(projectId);
  const mine = people?.waitsOnViewer === true;
  const linkedInHq = useMateLinkedInHq(projectId);
  // Up as its menu row reads it (`mateAwake`): its container runs, or HQ holds its link open.
  const up = candidateContainerRuns(candidate) || linkedInHq;
  const nowMs = useNowMs();
  const deleting = mateDeleting(candidate.project, useDeletingMates());
  const pose = matePoseOf(candidate, nowMs, deleting ? "deleting" : "up");
  const reviewWaits = mateReviewWaits(flow, projectId);
  const watch = useMateFaceWatch({
    environmentId: candidate.environmentId ?? null,
    projectId,
    arriving: mateArrivingUntil(candidate) !== undefined,
    connected: candidate.group === "connected",
  });
  const face = mateFace({
    connected: up,
    activity,
    reviewWaits,
    mine,
    pose,
    restarting: watch.restarting,
    watched: watch.watched,
  });
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const view = mateRowReading({
    name,
    connected: up,
    timestampFormat,
    activity,
    reviewWaits,
    mine,
    pose,
  });
  // Whether anybody has signed its agent in, read off its own records as its row reads them
  // (`mateOwnerView`): to the person who added it, that it waits on them.
  const viewer = useZeropsSessionOptional()?.user?.id;
  const tags = readZeropsMembership(candidate.project);
  const signers = people?.everSignedIn;
  const seated = mateOwnerView({
    owner: zeropsMateOwnerOf(people?.owner, viewer),
    records: mateOwnerRecords(candidate.project, people?.owned),
    asked: view.ask !== undefined,
    hqSigners:
      signers === undefined ? undefined : Object.keys(signers).length > 0 ? "some" : "none",
    standUpBy: tags.standUp?.by,
    madeBy: tags.madeBy,
    viewer,
    linked: candidate.group === "connected",
  });
  // A Mate with no container read has nothing to sign in, and says nothing of it.
  const signIn =
    outsideHq || deleting || candidate.service === undefined ? undefined : seated.signInLine;
  // Its line 2 as the menu's row says it (`mateRowSecond`): the same words in both places.
  const askLine = mateRowAskLine({
    view,
    signIn:
      signIn === undefined ? undefined : { text: signIn, waitsOnViewer: seated.waitsOnViewer },
    draft: undefined,
    sent: undefined,
    deleting,
    finishing: false,
    read: conversationsRead,
  });
  const second = mateRowSecond({
    view,
    askLine,
    deleting,
    finishing: false,
    outsideHq,
    mine: people?.waitsOnViewer,
    // A colleague's Mate waiting on its person says whom it waits on, never their question.
    waitsOn:
      people?.waitsOnViewer === false &&
      activity !== undefined &&
      (activity.kind === "approval" || activity.kind === "input" || activity.kind === "planReady")
        ? (people.owner?.name.split(" ")[0] ?? "its person")
        : undefined,
    asks:
      activity !== undefined &&
      (activity.question !== undefined ||
        activity.kind === "approval" ||
        activity.kind === "input" ||
        activity.kind === "planReady"),
    change:
      change === undefined
        ? undefined
        : { title: change.title, mine: people?.waitsOnViewer !== false },
  });
  const reading = cardMateReading({
    view,
    status: activity?.kind,
    mine,
    review: mine ? change : undefined,
    read: conversationsRead,
    line: cardSecondWords({
      second,
      reply: view.reply,
      askLine,
      pausedUntil: (at) => formatShortTimestamp(at, timestampFormat),
    }),
  });
  const askMate = useAskMate();
  const askToFix = useAskMateToFix();
  const openReview = useOpenReview();
  const owner = mine ? undefined : people?.owner;
  return (
    <CardMate
      actions={
        reading.lift === undefined ? (
          containerActions
        ) : (
          <CardMateWrite
            environmentId={candidate.group === "connected" ? candidate.environmentId : undefined}
            lift={reading.lift}
            name={name}
            onAsk={(text) => {
              askMate(projectId, text);
            }}
            onFix={() => {
              askToFix(projectId, {
                what: `${name}'s last run stopped on an error`,
                error: activity?.errorLine,
                ask: "Find out why, fix it, and carry on.",
              });
            }}
            onOpen={() => onOpen?.()}
            onReview={(from) => {
              if (groupId === undefined || reading.lift?.kind !== "review") return;
              const { pull } = reading.lift;
              openReview(
                { kind: "change", groupId, repository: pull.repository, number: pull.number },
                { from },
              );
            }}
            threadId={activity?.threadId}
          />
        )
      }
      face={
        <>
          <MateFace
            className="size-8"
            cues={face.cues}
            greets
            known={face.known}
            restarting={face.restarting}
            shape={shape}
            size="md"
            state={view.face}
            tint={tint}
          />
          {owner == null ? null : (
            <Avatar
              className="ov-mate-owner"
              initials={owner.name.charAt(0).toLocaleUpperCase()}
              size="xs"
              src={owner.avatarUrl ?? null}
            />
          )}
        </>
      }
      line={containerLine}
      name={name}
      onOpen={onOpen}
      reading={reading}
      time={
        <CardMateTime dot={view.dot}>
          <CardMateSlot at={activity?.at} slot={view.slot} />
        </CardMateTime>
      }
    />
  );
}
