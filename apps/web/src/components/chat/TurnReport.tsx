/**
 * What a finished run left, as its result: rows in the card's grid under its
 * worked line, most important first — anything still broken, then what waits
 * for the person, then what runs because of the run with its checks attached
 * (K5) — and under them the pictures it took and looked at, in one strip.
 * Not pills and not a log: a failure the run came back from, a retry, and
 * what its calls came to are the work's, one click away (K6, K9). Each row
 * follows the real thing — the change merged, the service redeployed by a
 * later run or stopped since (`runResult.logic.ts`, `runResultFacts.ts`).
 *
 * A row's mark stands in the card's 28 px column — a state's dot, or a glyph
 * for what the thing is — its words one column in, and its actions on the
 * card's right edge: a blue text action, a way to open what it runs. The
 * strip stands on the same words edge. The rows and the strip rise in once,
 * 40 ms apart, when the run finished while the person watched (T5); read
 * later, they are simply there.
 */
import { AssetImage } from "~/assets/AssetImage";
import type { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ArrowUpRightIcon, GitPullRequestIcon, TriangleAlertIcon, UsersIcon } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnimationEvent,
  type CSSProperties,
  type SyntheticEvent,
} from "react";

import { useAssetUrlStates, type AssetUrlState } from "../../assets/assetUrls";
import { formatDayAwareTimestamp } from "../../timestampFormat";
import { runFixMate, useFixMates } from "../../zerops/fixMates";
import { useAskMateToFix, type FixProblem } from "../../zerops/fixRequest";
import { rememberedGonePictures, rememberGonePicture } from "../../zerops/gonePictureMemory";
import { useOpenReview } from "../../zerops/review";
import { useZeropsSessionOptional } from "../../zerops/sessionContext";
import { ServiceBrowserLink } from "../ServiceBrowserLink";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CrewTryIt } from "../zerops/crew/CrewTryIt";
import type { OutcomeModel } from "./conversation.logic";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import {
  resultPictures,
  placeResultPictures,
  stripShowsFiles,
  resultRows,
  tileRatio,
  type ResultFacts,
  type ResultPicture,
  type ResultRow,
  STRIP_TILES,
} from "./runResult.logic";
import { useRunResultFacts } from "./runResultFacts";
import { publishStripFiles } from "./resultStripFiles";
import { TimelineRowCtx, type TimelineRowSharedState } from "./timelineContext";

const NOTHING_RISING: ReadonlySet<string> = new Set();

/** The strip's key among what rises: the rows' are theirs. */
const PICTURES = "pictures";

function compactCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);
}

function RowMark({ row }: { readonly row: ResultRow }) {
  return (
    <span
      aria-hidden="true"
      className="run-result-mark"
      data-result-mark={row.mark}
      data-tone={row.tone}
    >
      {row.mark === "dot" ? (
        <span className="run-result-dot" />
      ) : row.mark === "alert" ? (
        <TriangleAlertIcon className="size-4" />
      ) : row.mark === "change" ? (
        <GitPullRequestIcon className="size-4" />
      ) : (
        <UsersIcon className="size-4" />
      )}
    </span>
  );
}

function RowSub({
  row,
  onOpenTurnDiff,
}: {
  readonly row: ResultRow;
  readonly onOpenTurnDiff: (turnId: TurnId, fromTurnId: TurnId | null) => void;
}) {
  const timeline = useContext(TimelineRowCtx) as TimelineRowSharedState | null;
  const { sub } = row;
  if (sub === null) return null;
  if (sub.kind === "text") return <span className="run-result-sub">{sub.text}</span>;
  if (sub.kind === "since") {
    return (
      <span className="run-result-sub">
        Since {formatDayAwareTimestamp(sub.at, timeline?.timestampFormat ?? "locale")}
      </span>
    );
  }
  const files = sub.files === null ? null : sub.files === 1 ? "1 file" : `${sub.files} files`;
  const { turnId, fromTurnId } = sub;
  return (
    <span className="run-result-sub">
      {files === null ? null : turnId === null ? (
        files
      ) : (
        // What this run changed, in the diff: the change as a whole is Review's.
        <button
          aria-label={`${files} changed in this run. Open the diff`}
          className="run-result-files"
          onClick={() => onOpenTurnDiff(turnId, fromTurnId)}
          type="button"
        >
          {files}
        </button>
      )}
      {files === null ? null : " · "}
      <span className="run-result-add">+{compactCount(sub.additions)}</span>{" "}
      <span className="run-result-del">−{compactCount(sub.deletions)}</span>
    </span>
  );
}

type MateOfRun = ResultFacts["mate"];

/**
 * "Ask Nova to fix it" (S6): the run's own Mate, with the problem written into
 * its composer — not sent. Only while it is the person's: a colleague's Mate is
 * theirs to ask (D6), and another of the person's would be pointed at a service
 * that is not its own (`runFixMate`). Outside a Zerops session there is no Mate
 * to ask.
 */
function FixAction({ problem, mate }: { readonly problem: FixProblem; readonly mate: MateOfRun }) {
  const session = useZeropsSessionOptional();
  if (session === null || mate === undefined) return null;
  return <FixActionOffer mate={mate} problem={problem} />;
}

function FixActionOffer({
  problem,
  mate,
}: {
  readonly problem: FixProblem;
  readonly mate: NonNullable<MateOfRun>;
}) {
  const fixer = runFixMate(useFixMates(mate), mate.projectId);
  const askToFix = useAskMateToFix();
  if (fixer === undefined) return null;
  return (
    <button
      className="run-result-action"
      onClick={() => askToFix(fixer.mateProjectId, problem)}
      type="button"
    >
      Ask {fixer.name} to fix it
    </button>
  );
}

function RowEnd({ row, mate }: { readonly row: ResultRow; readonly mate: MateOfRun }) {
  const openReview = useOpenReview();
  const { action, url, tryIt } = row;
  const review = action?.kind === "review" ? action.target : null;
  const fix = action?.kind === "fix" ? action.problem : null;
  if (action === null && url === null) return <span />;
  return (
    <span className="run-result-end">
      {fix === null ? null : <FixAction mate={mate} problem={fix} />}
      {tryIt === undefined ? null : (
        <CrewTryIt environmentId={tryIt.environmentId} handle={tryIt.handle} title={row.title} />
      )}
      {review === null ? null : (
        <button
          aria-label={`Review ${row.title}`}
          className="run-result-action"
          onClick={(event) => openReview(review, { from: event.currentTarget })}
          type="button"
        >
          Review
        </button>
      )}
      {url === null ? null : (
        <ServiceBrowserLink
          aria-label={`Open ${row.title}`}
          className="run-result-open"
          href={url}
          rel="noreferrer"
          showIndicator={false}
          target="_blank"
        >
          <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
        </ServiceBrowserLink>
      )}
    </span>
  );
}

/** The pictures' files, by path: as the workspace read them, or as a harness gives them. */
export type ResultFiles = ReadonlyMap<string, AssetUrlState>;

const LOADING: AssetUrlState = { _tag: "Loading" };
const GONE: AssetUrlState = { _tag: "Failure" };

const NO_FILES: ResultFiles = new Map();

/**
 * One picture of the strip, in its tile: the picture whole, in its own shape
 * at the strip's one height — a phone's screenshot narrow, a desktop's wide —
 * and, past what a tile can hold, its top (`tileRatio`). The shape is known
 * before the bytes: a check's from the check, a file's from the size the
 * workspace read off its header with its address, else as it loads. While
 * its file is read, a quiet tile in a desktop's room; a file that is gone
 * has no tile (`standingPictures`). The last tile of a run with more says
 * how many more over its picture.
 */
function PictureTile({
  picture,
  state,
  more,
  onOpen,
}: {
  readonly picture: ResultPicture;
  readonly state: AssetUrlState;
  /** The pictures past the strip's last tile. */
  readonly more: number;
  /** Opens the viewer here; null where nothing here can be opened yet. */
  readonly onOpen: (() => void) | null;
}) {
  const status = state._tag === "Success" ? "ready" : "loading";
  const said = more > 0 ? `${picture.label}, and ${more} more` : picture.label;
  const failed = (picture.kind === "check" && picture.failed) || undefined;
  const size = state._tag === "Success" ? state.imageDimensions : undefined;
  const known =
    picture.kind === "check" ? picture.ratio : size === undefined ? null : size.width / size.height;
  // A file whose address came without its size takes its shape as it loads.
  const [learned, setLearned] = useState<number | null>(null);
  const shape: CSSProperties = { aspectRatio: tileRatio(known ?? learned) };
  const learn =
    known === null
      ? (event: SyntheticEvent<HTMLImageElement>) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth > 0 && naturalHeight > 0) setLearned(naturalWidth / naturalHeight);
        }
      : undefined;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          onOpen === null ? (
            <span
              aria-label={said}
              className="run-result-tile"
              data-failed={failed}
              data-result-picture={status}
              role="img"
              style={shape}
            />
          ) : (
            <button
              aria-label={`${said}. Open ${more > 0 ? "the pictures" : "the picture"}`}
              className="run-result-tile"
              data-failed={failed}
              data-result-picture={status}
              onClick={onOpen}
              style={shape}
              type="button"
            />
          )
        }
      >
        {state._tag === "Success" ? (
          <AssetImage loading="lazy" decoding="async" alt="" onLoad={learn} src={state.url} />
        ) : null}
        {more > 0 ? <span className="run-result-more">+{more}</span> : null}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{said}</TooltipPopup>
    </Tooltip>
  );
}

/** Where a picture is read from now: a check's own pixels, a file once its address is known. */
function pictureUrl(picture: ResultPicture, files: ResultFiles): string | null {
  if (picture.kind === "check") return picture.src;
  const state = files.get(picture.path);
  return state?._tag === "Success" ? state.url : null;
}

/**
 * The run's pictures as one strip under its rows (the owner, 2026-09-29: "if
 * anything it should show the screenshots"): six uniform tiles at most, in
 * the order they were taken. A click opens the viewer on every one of them,
 * from the one clicked; the last tile of a run with more opens it there, on
 * its way to the rest.
 */
function PictureStrip({
  pictures,
  files,
  onOpenImage,
}: {
  readonly pictures: ReadonlyArray<ResultPicture>;
  readonly files: ResultFiles;
  readonly onOpenImage: (preview: ExpandedImagePreview) => void;
}) {
  const shown = pictures.slice(0, STRIP_TILES);
  const more = pictures.length - shown.length;
  const viewable = pictures.flatMap((picture, at) => {
    const src = pictureUrl(picture, files);
    return src === null ? [] : [{ at, src, name: picture.label }];
  });
  // Opens the viewer on the first picture it can show among those a tile
  // stands for: the last tile of a run with more reaches the rest while its
  // own picture is still read.
  const opener = (from: number, reach: number): (() => void) | null => {
    const start = viewable.findIndex(({ at }) => at >= from && at < from + reach);
    return start < 0
      ? null
      : () =>
          onOpenImage({ images: viewable.map(({ src, name }) => ({ src, name })), index: start });
  };
  return (
    <div className="run-result-strip" data-result-strip>
      {shown.map((picture, index) => {
        const last = index === shown.length - 1 && more > 0;
        return (
          <PictureTile
            key={picture.key}
            more={last ? more : 0}
            onOpen={opener(index, last ? pictures.length - index : 1)}
            picture={picture}
            state={
              picture.kind === "file"
                ? (files.get(picture.path) ?? LOADING)
                : { _tag: "Success", url: picture.src }
            }
          />
        );
      })}
    </div>
  );
}

/** What makes a part of the result rise in once (T5), and drop its rise once it ended. */
function riseOf(
  key: string,
  index: number,
  rising: ReadonlySet<string>,
  risen: (key: string) => void,
): {
  readonly "data-rising"?: true;
  readonly style?: CSSProperties;
  readonly onAnimationEnd?: (event: AnimationEvent<HTMLElement>) => void;
} {
  if (!rising.has(key)) return {};
  return {
    "data-rising": true,
    style: { "--row-index": index } as CSSProperties,
    onAnimationEnd: (event) => {
      if (event.target === event.currentTarget) risen(key);
    },
  };
}

type TurnReportProps = {
  readonly outcome: OutcomeModel;
  readonly onOpenTurnDiff: (turnId: TurnId, fromTurnId: TurnId | null) => void;
  readonly onOpenImage: (preview: ExpandedImagePreview) => void;
  /** The person watched the turn run: its result rises in, once. */
  readonly settling?: boolean;
  /** What is true now outside the run, where it is not read from the app (a harness). */
  readonly facts?: ResultFacts;
  /** The pictures' files, where they are not read from the app's workspace (a harness). */
  readonly files?: ResultFiles;
};

export function TurnReport(props: TurnReportProps) {
  const timeline = useContext(TimelineRowCtx) as TimelineRowSharedState | null;
  const threadRef = timeline?.threadRef ?? null;
  // Outside a conversation there is no workspace to read a file from: only
  // what the checks took stands.
  if (props.files !== undefined || threadRef === null) {
    return <Report {...props} files={props.files ?? null} />;
  }
  return (
    <WorkspaceReport
      {...props}
      environmentId={threadRef.environmentId}
      threadId={threadRef.threadId}
    />
  );
}

/** The result, its pictures' files read from the conversation's workspace. */
function WorkspaceReport({
  environmentId,
  threadId,
  ...props
}: TurnReportProps & {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const paths = useMemo(
    () =>
      resultPictures(props.outcome).flatMap((picture) =>
        picture.kind === "file" ? [picture.path] : [],
      ),
    [props.outcome],
  );
  const resources = useMemo(
    () => paths.map((path) => ({ _tag: "workspace-file" as const, threadId, path })),
    [paths, threadId],
  );
  const read = useAssetUrlStates(environmentId, resources);
  // A picture this conversation found gone before is left out from the first paint, before its
  // read answers: a reload paints no tile it then takes back.
  const threadKey = scopedThreadKey(scopeThreadRef(environmentId, threadId));
  const remembered = useMemo(() => rememberedGonePictures(threadKey), [threadKey]);
  const files = useMemo<ResultFiles>(
    () =>
      new Map(
        paths.map((path, index) => {
          const state = read[index] ?? LOADING;
          return [path, state._tag === "Loading" && remembered.has(path) ? GONE : state] as const;
        }),
      ),
    [paths, read, remembered],
  );
  useEffect(() => {
    paths.forEach((path, index) => {
      const state = read[index];
      if (state?._tag === "Failure") rememberGonePicture(threadKey, path, true);
      if (state?._tag === "Success") rememberGonePicture(threadKey, path, false);
    });
  }, [paths, read, threadKey]);
  return <Report {...props} files={files} />;
}

function Report({
  outcome,
  onOpenTurnDiff,
  onOpenImage,
  settling = false,
  facts,
  files,
}: Omit<TurnReportProps, "files"> & {
  /** The pictures' files; null where there is no workspace to read one from. */
  readonly files: ResultFiles | null;
}) {
  const read = useRunResultFacts(outcome);
  const now = facts ?? read;
  const rows = useMemo(() => resultRows(outcome, now), [now, outcome]);
  const gone = useMemo(
    () =>
      new Set(
        [...(files ?? NO_FILES)].flatMap(([path, state]) =>
          state._tag === "Failure" ? [path] : [],
        ),
      ),
    [files],
  );
  // Every picture of a service stands under its row; the rest in the strip.
  const placed = useMemo(
    () => placeResultPictures(outcome, rows, files === null ? null : gone),
    [files, gone, outcome, rows],
  );
  const pictures = placed.rest;
  // What the strip draws, for the card's steps to leave to it (`resultStripFiles`).
  const drawn = useMemo(() => stripShowsFiles(pictures), [pictures]);
  useEffect(() => publishStripFiles(outcome.turnKey, drawn), [drawn, outcome.turnKey]);
  // The rows the result arrived with, while the person watched, rise once
  // and drop their rise as it ends: a row that turns up later is simply
  // there, and one that moves later (a service stopping tonight moves up to
  // the broken rows) never replays the arrival. The strip rises last.
  const [rising, setRising] = useState<ReadonlySet<string>>(() =>
    settling
      ? new Set([...rows.map((row) => row.key), ...(pictures.length > 0 ? [PICTURES] : [])])
      : NOTHING_RISING,
  );
  const risen = useCallback((key: string) => {
    setRising((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, []);
  if (rows.length === 0 && pictures.length === 0) return null;
  return (
    <section aria-label="What this run left" className="run-result" data-turn-report>
      {rows.map((row, index) => {
        const own = placed.byRow.get(row.key) ?? [];
        return (
          <div
            key={row.key}
            className="run-result-row"
            data-result-row={row.group}
            data-tall={row.sub !== null || own.length > 0 || undefined}
            {...riseOf(row.key, index, rising, risen)}
          >
            <RowMark row={row} />
            <div className="min-w-0">
              <div className="run-result-main">
                <span
                  className="run-result-title"
                  data-broken={row.group === "broken" || undefined}
                >
                  {row.title}
                </span>
                {row.words === null ? null : <span className="run-result-words">{row.words}</span>}
                {row.version === null ? null : (
                  <span className="run-result-version">{row.version}</span>
                )}
                {row.checked === undefined ? null : (
                  <span className="run-result-words run-result-checked">
                    {row.words === null && row.version === null ? "" : "· "}
                    {row.checked}
                  </span>
                )}
              </div>
              <RowSub onOpenTurnDiff={onOpenTurnDiff} row={row} />
              {own.length === 0 ? null : (
                <div className="run-result-row-pictures">
                  <PictureStrip onOpenImage={onOpenImage} pictures={own} files={NO_FILES} />
                </div>
              )}
            </div>
            <RowEnd mate={now.mate} row={row} />
          </div>
        );
      })}
      {pictures.length === 0 ? null : (
        <div className="run-result-pictures" {...riseOf(PICTURES, rows.length, rising, risen)}>
          <PictureStrip files={files ?? NO_FILES} onOpenImage={onOpenImage} pictures={pictures} />
        </div>
      )}
    </section>
  );
}
