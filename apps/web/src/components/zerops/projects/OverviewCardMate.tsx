/**
 * A Mate on its project's card, read as its row in the menu reads it: the one face (`mateFace`,
 * from the same facts — up as `mateAwake` says it, its activity, whose it is, its change's review,
 * its life), the same owner's mark (`ownerBadge`), the same line 2 (`mateRowSecond`) and the same
 * right edge — its time, or its change's *Review* in the time's place. What waits on the viewer is
 * lifted with its buttons, answered in place (`CardMateWrite`).
 */
import { useAutomatedKey } from "~/zerops/useAutomationSettings";
import {
  mateArrivingUntil,
  matePoseOf,
  readZeropsMembership,
  type FlowPullRequest,
} from "@t3tools/client-runtime/zerops";
import type { MatePart } from "@t3tools/client-runtime/zerops/mateParts";
import { mateOwnerRecords } from "@t3tools/client-runtime/zerops/mateAccess";
import {
  candidateContainerRuns,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import type { MateComing } from "@t3tools/client-runtime/data";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { CircleAlertIcon, GitPullRequestIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { formatShortTimestamp } from "~/timestampFormat";
import { mateReviewCount, mateReviewWaits, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import { mateDeleting, useDeletingMates } from "~/zerops/deletingMates";
import { useAskMateToFix } from "~/zerops/fixRequest";
import { mateFace } from "~/zerops/mateFace.logic";
import { useOpenReview } from "~/zerops/review";
import { useAskMate } from "~/zerops/useAskMate";
import { useMateFaceWatch } from "~/zerops/useMateMoments";
import {
  useMateAwayNow,
  useMateLinkedInHq,
  useMateOverviewInHq,
  useMateOfflineSince,
} from "~/zerops/useMenuMateReadings";
import { useNowMs, useSecondsNowMs } from "~/zerops/useNowMs";
import { usePendingSentAsk } from "~/zerops/sentAsk";
import { useProjectMateActivity } from "~/zerops/useZeropsAgentActivity";
import { useHqProjectPerson, zeropsMateOwnerOf } from "~/zerops/useZeropsMateOwners";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { MateAutomatedMark } from "../MateAutomatedMark";
import { MateOwnerMark } from "../MateOwnerMark";
import { MateFace } from "../primitives";
import {
  mateBornLine,
  mateBornLineText,
  mateComingRowView,
  mateDeletingView,
  mateOwnerView,
  mateRowAskLine,
  mateAsker,
  mateRowDraft,
  mateRowReading,
  mateRowSecond,
  mateAutomation,
  mateRowTime,
  ownerBadge,
} from "../SidebarMateRow.logic";
import { CardMateSlot, CardMateWrite } from "./overviewSlots";
import { CardMate, CardMateTime } from "./ProjectCards";
import { cardMateReading, cardSecondWords, type CardMateReading } from "./projectCard.logic";

export function OverviewCardMate({
  candidate,
  name,
  tint,
  shape,
  groupId,
  flow,
  change,
  coming,
  parts,
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
  readonly flow: import("~/zerops/projectFlows").ZeropsProjectFlow | undefined;
  /** Its open change that asks for review (`changeShowsReview`). */
  readonly change: FlowPullRequest | undefined;
  /** Still coming up, or never came, as its menu row reads it (`useMateComingOf`). */
  readonly coming?: MateComing | undefined;
  /** Its parts (`mateParts`): chips on its row. */
  readonly parts?: ReadonlyArray<MatePart> | undefined;
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
  const overviewInHq = useMateOverviewInHq(projectId);
  // Up as its menu row reads it (`mateAwake`): its container runs, or HQ holds its link open.
  const up = candidateContainerRuns(candidate) || linkedInHq;
  const offlineSince = useMateOfflineSince(projectId, candidate.key);
  const awayNowMs = useMateAwayNow(offlineSince);
  const nowMs = useNowMs();
  const deleting = mateDeleting(candidate.project, useDeletingMates());
  const pose = matePoseOf(candidate, nowMs, deleting ? "deleting" : "up");
  const reviewWaits = mateReviewWaits(flow, projectId);
  // How many of its changes wait so: an automated Mate holds one per task, several at once.
  const inReview = mateReviewCount(flow, projectId);
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
    free: mateAutomation(candidate.project.hq?.mate)?.task === null,
  });
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const read = mateRowReading({
    name,
    connected: up,
    offlineSince,
    nowMs: awayNowMs,
    timestampFormat,
    activity,
    reviewWaits,
    mine,
    pose,
    updating: watch.updating,
    free: mateAutomation(candidate.project.hq?.mate)?.task === null,
  });
  // Going, or still coming up, as its row says it: no time, and its own line.
  const view = deleting
    ? mateDeletingView(read)
    : coming !== undefined
      ? mateComingRowView(read, coming)
      : read;
  // Whose seat it is, and whether anybody has signed its agent in, read off its own records as its
  // row reads them (`mateOwnerView`): to the person who added it, that it waits on them.
  const viewer = useZeropsSessionOptional()?.user?.id;
  const owner = zeropsMateOwnerOf(people?.owner, viewer);
  const tags = readZeropsMembership(candidate.project);
  const signers = people?.everSignedIn;
  const records = mateOwnerRecords(candidate.project, people?.owned);
  const seated = mateOwnerView({
    owner,
    records,
    asked: view.ask !== undefined,
    hqSigners:
      signers === undefined ? undefined : Object.keys(signers).length > 0 ? "some" : "none",
    overview: overviewInHq,
    standUpBy: tags.standUp?.by,
    madeBy: tags.madeBy,
    viewer,
    linked: candidate.group === "connected",
  });
  // A Mate with no container read has nothing to sign in, and says nothing of it.
  const containerless = candidate.service === undefined;
  const signIn =
    outsideHq || deleting || view.coming !== undefined || containerless
      ? undefined
      : seated.signInLine;
  // What its face's corner wears, as its row's does: nobody's on the viewer's own Mate.
  const badge =
    outsideHq || (containerless && seated.seat.kind === "nobody")
      ? null
      : ownerBadge(seated.seat, owner?.isViewer === true);
  // What waits in its composer, and what this browser just sent it, as its menu row reads them
  // (`mateRowDraft`, `mateRowSentAsk`): a card led with its last words where its row led with
  // the draft.
  const draft = useComposerDraftStore((state) =>
    mateRowDraft(state, {
      environmentId: candidate.environmentId,
      threadId: activity?.threadId,
      threadKey: activity?.threadKey,
    }),
  );
  const sentAsk = usePendingSentAsk(candidate.environmentId);
  // Its line 2 as the menu's row says it (`mateRowSecond`): the same words in both places.
  const askLine = mateRowAskLine({
    view,
    signIn:
      signIn === undefined ? undefined : { text: signIn, waitsOnViewer: seated.waitsOnViewer },
    draft,
    sent:
      sentAsk !== undefined && (activity === undefined || activity.threadId === sentAsk.threadId)
        ? sentAsk.text
        : undefined,
    deleting,
    finishing: false,
    read: conversationsRead,
    asker: mateAsker(owner),
  });
  // What is read of the organization's key: an automated Mate at rest may wait for it.
  const automatedKey = useAutomatedKey();
  const automated = mateAutomation(candidate.project.hq?.mate, automatedKey, inReview);
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
      owner !== undefined &&
      !owner.isViewer &&
      activity !== undefined &&
      (activity.kind === "approval" || activity.kind === "input" || activity.kind === "planReady")
        ? owner.name.split(" ")[0]
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
        : {
            title: change.title,
            mine: people?.waitsOnViewer !== false,
            ...(inReview > 1 ? { count: inReview } : {}),
          },
    automated,
  });
  // Its time: a free automated Mate's, when its last task ended (`mateRowTime`).
  const time = mateRowTime({ slot: view.slot, at: activity?.at, automated });
  // A Mate still coming up, or that never came, says only that: nothing of it is lifted.
  const reading: CardMateReading =
    view.coming !== undefined
      ? { text: undefined, tone: "muted", lift: undefined }
      : cardMateReading({
          view,
          status: activity?.kind,
          mine,
          review: mine ? change : undefined,
          reviews: inReview,
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
  const openChange = (from: HTMLElement) => {
    if (groupId === undefined || change === undefined) return;
    openReview(
      { kind: "change", groupId, repository: change.repository, number: change.number },
      { from },
    );
  };
  // Its change's *Review* at the change's end, as its row has it (the owner, 2026-10-11: one word
  // in the time's place was "incredibly poor indication of a new merge request"): a white button,
  // the same whoever's Mate made it (2026-10-12: "I still don't understand why rosa has a
  // different looking merge request"). Lifted for the viewer's
  // review, its button carries it — one Review on a card, never two — and its time's place stays
  // empty. While its line says something else, a step on its way, the Review keeps the time's
  // place: a change never goes without its button.
  const review =
    change === undefined || groupId === undefined || deleting || outsideHq
      ? undefined
      : { mine: people?.waitsOnViewer !== false };
  const marked =
    view.coming === undefined && (second.kind === "change" || reading.lift?.kind === "review");
  const reviewButton =
    review === undefined || reading.lift?.kind === "review" ? null : (
      <button
        className="ov-review"
        data-zerops-surface="card-mate-review"
        onClick={(event) => {
          openChange(event.currentTarget);
        }}
        type="button"
      >
        Review
      </button>
    );
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
            onReview={openChange}
            threadId={activity?.threadId}
          />
        )
      }
      face={
        <>
          <MateFace
            cues={face.cues}
            greets
            known={face.known}
            restarting={face.restarting}
            shape={shape}
            size={32}
            state={view.face}
            tint={tint}
          />
          {badge === null ? null : <MateOwnerMark className="ov-mate-owner" seat={badge} />}
        </>
      }
      line={
        // Coming up, in its menu row's words first: one state, one word on every surface.
        view.coming !== undefined ? (
          <CardComingLine coming={view.coming} />
        ) : (
          (containerLine ??
          (marked ? (
            <span className="ov-mate-change" data-zerops-surface="card-mate-change">
              <GitPullRequestIcon aria-hidden="true" className="menu-change-mark" />
              <span className="ov-mate-change-title">{reading.text}</span>
              {reviewButton}
            </span>
          ) : undefined))
        )
      }
      parts={parts}
      mark={candidate.project.hq?.mate?.automated === true ? <MateAutomatedMark /> : undefined}
      name={name}
      onOpen={onOpen}
      reading={reading}
      time={
        reading.lift?.kind === "review" ? null : reviewButton !== null && !marked ? (
          reviewButton
        ) : (
          <CardMateTime dot={view.dot}>
            <CardMateSlot at={time.at} slot={time.slot} />
          </CardMateTime>
        )
      }
    />
  );
}

/** Its coming up in its menu row's words (`mateBornLine`), the attention's amber where it stopped. */
function CardComingLine({ coming }: { readonly coming: MateComing }) {
  const line = mateBornLine(coming);
  const nowMs = useSecondsNowMs(line.since !== undefined);
  return (
    <span
      className={cn(line.tone === "attention" && "text-status-attention-text")}
      data-zerops-surface="card-mate-coming-line"
    >
      {line.tone === "attention" ? (
        <CircleAlertIcon aria-hidden="true" className="mr-1 inline size-3" />
      ) : null}
      {mateBornLineText(line, nowMs)}
    </span>
  );
}
