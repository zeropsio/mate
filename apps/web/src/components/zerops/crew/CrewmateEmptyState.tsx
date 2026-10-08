/**
 * An empty crewmate conversation (PRD §4.5): a crewmate fresh from its start,
 * or one whose conversation was cleared or started fresh, opens on the
 * crewmate — on the stage of the Mate's own opening (`ZeropsMateEmptyState`):
 * its face a third of the way down at the Mate's size, in its tint and shape,
 * and its name in the Mate's headline, so a switch between the Mate's empty
 * chat and a crewmate's keeps the face where it stood — both held, empty,
 * until the crew is read, never a handle standing in. Under the name, whose
 * it is, led by its Mate's small face — "Fen's lead · plans and reviews the
 * crew's work". Then one quiet card, the run's tray: _Its job_, the job's
 * first line whole in the person's words, with _Change its job_ for a viewer
 * who may change the crew; and _Its work_, what it finished, so a cleared
 * conversation never reads as if it had done nothing — the newest three, each
 * that went in opening its review, and _Show all N_ opening the rest in place —
 * on the engine, whose board holds each crewmate's newest finished work only,
 * reading the rest through `crew.taskPage` as it opens.
 *
 * Nothing here invites a message: the composer does, or says why this viewer
 * cannot. The conversation's seams stand on top, and why a later
 * conversation began with the link to the one before it, where no seam of its
 * own says so (`crewCardOrigin`) — a task card carries that line once the
 * conversation has one. What runs past the composer scrolls above it.
 */
import {
  CREW_MENU,
  CREW_PREVIOUS_STINT_LINK,
  CREW_WHAT_CHANGED,
  CREWMATE_EMPTY_WORDS,
  crewShowAllWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewSeam, CrewTask, EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";

import { cn } from "~/lib/utils";

import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { mateFaceFor } from "../../../zerops/agentActivity";
import type { ZeropsMateIdentity } from "../../../zerops/mateIdentities";
import { useOpenReview } from "../../../zerops/review";
import { compactSidebarTimeLabel } from "../../Sidebar.logic";
import { MateFace } from "../primitives";
import { MATE_EMPTY_FACE_CLASS, MATE_EMPTY_HEADLINE_CLASS } from "../ZeropsMateEmptyState";
import { CrewTextButton, CrewTip } from "./CrewParts";
import {
  crewmateEmptyModel,
  readFinishedWork,
  type CrewmateWorkRow,
} from "./CrewmateEmptyState.logic";
import { CrewSeamLine } from "./CrewSeamLine";
import { CrewSeamActivity, type CrewTimeline } from "./CrewTaskCard";

/** How much of its work the card shows before _Show all_, as the Crew tab's _In Fen's code_. */
const WORK_SHOWN = 3;

export function CrewmateEmptyState({
  crew,
  mateFace,
  environmentId,
  seams,
  bottomInset,
}: {
  /** The conversation's crew facts: whose it is, the board, why it began, what the viewer may do. */
  readonly crew: CrewTimeline;
  /** The Mate's face, as the conversation's line draws it; `null` while who lives here is not known. */
  readonly mateFace: Pick<ZeropsMateIdentity, "tint" | "shape" | "connected"> | null;
  readonly environmentId: EnvironmentId;
  readonly seams: ReadonlyArray<{
    readonly id: string;
    readonly seam: CrewSeam;
    readonly words: string;
  }>;
  /** The composer's height over the pane's foot: what scrolls past it stops above it. */
  readonly bottomInset: number;
}) {
  const { profile } = crew.crewmate;
  // Its finished work read past the engine's bounded board, once _Show all_ asks for it.
  const [older, setOlder] = useState<ReadonlyArray<CrewTask> | null>(null);
  const model =
    profile === null ? null : crewmateEmptyModel(profile, crew.tasks, crew.mateName, older);
  const readTaskPage = crew.readTaskPage;
  const readOlder =
    model === null || !model.more || readTaskPage === undefined
      ? null
      : () => {
          void readFinishedWork(readTaskPage, crew.crewmate.handle).then(setOlder);
        };
  // The crew lives in its Mate's container, and sleeps with it.
  const atRest = mateFaceFor(mateFace?.connected ?? true, undefined);
  const origin = crew.origin;
  const previous = origin?.previousThreadId ?? null;
  return (
    <div
      className="flex h-full flex-col items-center overflow-y-auto px-5 sm:px-6"
      data-zerops-surface="crewmate-empty-state"
    >
      {/* The face's place, a third of the way down, as the Mate's own opening puts
          it; the conversation's seams stand at its top. */}
      <div className="flex w-full shrink-0 basis-1/3 flex-col items-center">
        {origin === null && seams.length === 0 ? null : (
          <div className="flex w-full max-w-3xl flex-col gap-2 pt-4">
            {origin === null ? null : (
              <CrewSeamLine
                link={
                  previous === null
                    ? undefined
                    : { label: CREW_PREVIOUS_STINT_LINK, onOpen: () => crew.onOpenThread(previous) }
                }
                text={origin.text}
              />
            )}
            {seams.map((row) => (
              <CrewSeamActivity key={row.id} seam={row.seam} words={row.words} />
            ))}
          </div>
        )}
      </div>
      <div className="flex w-full shrink-0 flex-col items-center" data-crewmate-empty-lead>
        {/* Until the crew is read, its face's box and its name's line are held,
            empty — no handle stands in for the name — and it paints into them:
            a reload paints nothing it takes back. */}
        {profile === null ? (
          <>
            <div aria-hidden="true" className={MATE_EMPTY_FACE_CLASS} />
            <div
              aria-hidden="true"
              className={cn(MATE_EMPTY_HEADLINE_CLASS, "mt-6")}
              data-crewmate-name-held
            >
              {"\u00a0"}
            </div>
          </>
        ) : (
          <>
            <MateFace
              className={MATE_EMPTY_FACE_CLASS}
              size="lg"
              state={atRest}
              tint={profile.tint}
            />
            <h1 className={cn(MATE_EMPTY_HEADLINE_CLASS, "mt-6")}>{profile.displayName}</h1>
          </>
        )}
        {model === null ? null : (
          <>
            <p
              className="mt-1 flex max-w-md items-start gap-2 text-muted-foreground text-sm"
              data-crewmate-whose
            >
              {mateFace === null ? null : (
                <MateFace
                  className="shrink-0"
                  shape={mateFace.shape}
                  size="sm"
                  state={mateFaceFor(mateFace.connected, undefined)}
                  tint={mateFace.tint}
                />
              )}
              <span>{model.whose}</span>
            </p>
            {model.job === "" && model.work.length === 0 ? null : (
              <section
                className="mt-10 flex w-full max-w-md flex-col rounded-2xl border border-foreground/7 bg-run-tray px-4 py-3"
                data-crewmate-card
              >
                {model.job === "" ? null : (
                  <CrewmateJobLine job={model.job} onChangeJob={crew.onChangeJob} />
                )}
                {model.work.length === 0 ? null : (
                  <CrewmateWork
                    environmentId={environmentId}
                    first={model.job === ""}
                    more={model.more}
                    onShowAll={readOlder}
                    work={model.work}
                  />
                )}
              </section>
            )}
          </>
        )}
      </div>
      {/* Past the composer: whatever runs this far scrolls up above it. */}
      <div aria-hidden="true" className="shrink-0" style={{ height: bottomInset }} />
    </div>
  );
}

/** _Its job_: the first line whole, and _Change its job_ on the heading's line. */
function CrewmateJobLine({
  job,
  onChangeJob,
}: {
  readonly job: string;
  readonly onChangeJob: (() => void) | null;
}) {
  return (
    <div className="flex flex-col" data-crewmate-job>
      <div className="flex items-baseline justify-between gap-3 text-line">
        <h2 className="font-medium text-muted-foreground">{CREWMATE_EMPTY_WORDS.job}</h2>
        {onChangeJob === null ? null : (
          <CrewTextButton label={CREW_MENU.changeJob} onPress={onChangeJob} />
        )}
      </div>
      <p className="mt-0.5 text-foreground text-prose">{job}</p>
    </div>
  );
}

/**
 * _Its work_: what it finished, newest first — the newest three and _Show all
 * N_; a piece that went in opens its review, as the Crew tab's does.
 */
function CrewmateWork({
  work,
  first,
  more,
  onShowAll,
  environmentId,
}: {
  readonly work: ReadonlyArray<CrewmateWorkRow>;
  /** Nothing stands above it in the card. */
  readonly first: boolean;
  /** More of it is past the engine's board: how much is not known until it is read. */
  readonly more: boolean;
  /** Reads what is past the board as _Show all_ opens the rest; `null` where nothing is. */
  readonly onShowAll: (() => void) | null;
  readonly environmentId: EnvironmentId;
}) {
  const [all, setAll] = useState(false);
  const openReview = useOpenReview();
  const shown = all ? work : work.slice(0, WORK_SHOWN);
  return (
    <div className={cn("flex flex-col", !first && "mt-5")} data-crewmate-work>
      <h2 className="font-medium text-line text-muted-foreground">{CREWMATE_EMPTY_WORDS.work}</h2>
      {/* Each line's words on the heading's edge, a pressed line's hover 8 px past it. */}
      <ul className="-mx-2 mt-1 flex flex-col">
        {shown.map((row) => {
          const when =
            row.at === null ? "" : compactSidebarTimeLabel(formatRelativeTimeLabel(row.at));
          // Its title in ink, what became of it after it quieter — whole, wrapping
          // before it is ever cut — and when, on its first line's right.
          const words = (
            <>
              <span className="min-w-0 flex-1">
                <span className="crew-ink-2">{row.title}</span>{" "}
                <span className="text-muted-foreground">{row.outcome}</span>
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{when}</span>
            </>
          );
          return (
            <li key={row.taskId}>
              {row.wentIn ? (
                <CrewTip tip={CREW_WHAT_CHANGED}>
                  <button
                    className="flex w-full cursor-pointer items-baseline gap-3 rounded-lg px-2 py-1 text-left text-line outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
                    data-crewmate-work-task={row.taskId}
                    onClick={(event) =>
                      openReview(
                        { kind: "crew-task", environmentId, taskId: row.taskId },
                        { from: event.currentTarget },
                      )
                    }
                    type="button"
                  >
                    {words}
                  </button>
                </CrewTip>
              ) : (
                <div className="flex items-baseline gap-3 px-2 py-1 text-line">{words}</div>
              )}
            </li>
          );
        })}
      </ul>
      {all || (work.length <= WORK_SHOWN && !more) ? null : (
        <div className="flex h-7 items-center text-line">
          <CrewTextButton
            label={crewShowAllWord(more ? null : work.length)}
            onPress={() => {
              setAll(true);
              onShowAll?.();
            }}
          />
        </div>
      )}
    </div>
  );
}
