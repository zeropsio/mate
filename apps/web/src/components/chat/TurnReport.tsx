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
import { useImageIntent } from "~/assets/MateImages";
import { AssetImage, ImageUnavailable } from "~/assets/AssetImage";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ArrowUpRightIcon, GitPullRequestIcon, TriangleAlertIcon, UsersIcon } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnimationEvent,
  type CSSProperties,
} from "react";

import { useAssetUrlStates, type AssetUrlState } from "../../assets/assetUrls";
import { formatDayAwareTimestamp } from "../../timestampFormat";
import { FixAction } from "./FixAction";
import { RestartAction } from "./RestartAction";
import { useOpenReview } from "../../zerops/review";
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
import { Button } from "~/components/ui/button";
import { PictureFrame } from "~/components/ui/picture-frame";
import { cn } from "~/lib/utils";
import { Badge, type BadgeTone } from "~/components/ui/badge";

const NOTHING_RISING: ReadonlySet<string> = new Set();

/** The strip's key among what rises: the rows' are theirs. */
const PICTURES = "pictures";

/** A row's dot in the status tone its state means: running, waiting on the person, broken, at rest. */
const DOT_TONE: Record<ResultRow["tone"], { readonly tone: BadgeTone; readonly label: string }> = {
  ok: { tone: "success", label: "Running" },
  attention: { tone: "warning", label: "Waits on you" },
  failed: { tone: "danger", label: "Broken" },
  muted: { tone: "neutral", label: "At rest" },
};

function RowMark({ row }: { readonly row: ResultRow }) {
  return (
    <span
      aria-hidden="true"
      // The mark in the card's 28 px column: a broken row's glyph is red, a thing's stays muted;
      // its dot is a Badge in its tone.
      className="flex h-full items-center justify-center text-muted-foreground in-data-tall:h-5 data-[tone=failed]:text-status-failed"
      data-result-mark={row.mark}
      data-tone={row.tone}
    >
      {row.mark === "dot" ? (
        <Badge aria-label={DOT_TONE[row.tone].label} dot tone={DOT_TONE[row.tone].tone} />
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

function RowSub({ row }: { readonly row: ResultRow }) {
  const timeline = useContext(TimelineRowCtx) as TimelineRowSharedState | null;
  const { sub } = row;
  if (sub === null) return null;
  if (sub.kind === "text")
    return (
      <span className="mt-px block text-body leading-4.5 tabular-nums wrap-anywhere text-muted-foreground">
        {sub.text}
      </span>
    );
  return (
    <span className="mt-px block text-body leading-4.5 tabular-nums wrap-anywhere text-muted-foreground">
      Since {formatDayAwareTimestamp(sub.at, timeline?.timestampFormat ?? "locale")}
    </span>
  );
}

type MateOfRun = ResultFacts["mate"];

function RowEnd({ row, mate }: { readonly row: ResultRow; readonly mate: MateOfRun }) {
  const openReview = useOpenReview();
  const { action, url, tryIt } = row;
  const review = action?.kind === "review" ? action.target : null;
  const fix = action?.kind === "fix" ? action.problem : null;
  const restart = action?.kind === "restart" ? action.services : null;
  if (action === null && url === null) return <span />;
  return (
    <span className="flex items-center gap-1.5">
      {fix === null ? null : <FixAction mate={mate} problem={fix} />}
      {restart === null ? null : <RestartAction services={restart} />}
      {tryIt === undefined ? null : (
        <CrewTryIt environmentId={tryIt.environmentId} handle={tryIt.handle} title={row.title} />
      )}
      {review === null ? null : (
        <Button
          aria-label={`Review ${row.title}`}
          size="xs"
          variant="secondary"
          onClick={(event) => openReview(review, { from: event.currentTarget })}
        >
          Review
        </Button>
      )}
      {url === null ? null : (
        <Button
          aria-label={`Open ${row.title}`}
          render={
            <ServiceBrowserLink href={url} rel="noreferrer" showIndicator={false} target="_blank" />
          }
          size="icon-xs"
          variant="ghost-muted"
        >
          <ArrowUpRightIcon aria-hidden="true" />
        </Button>
      )}
    </span>
  );
}

/** The pictures' files, by path: as the workspace read them, or as a harness gives them. */
export type ResultFiles = ReadonlyMap<string, AssetUrlState>;

const LOADING: AssetUrlState = { _tag: "Loading" };
const NO_FILES: ResultFiles = new Map();

/**
 * One picture of the strip, in its tile: the picture whole, in its own shape
 * at the strip's one height — a phone's screenshot narrow, a desktop's wide —
 * and, past what a tile can hold, its top (`tileRatio`). The shape is known
 * before the bytes: a check's from the check, a file's from the size the
 * workspace read off its header with its address, else as it loads. While
 * its file is read, a quiet tile in a desktop's room; a file that is gone
 * keeps that room and says why. The last tile of a run with more says
 * how many more over its picture.
 */
/**
 * A tile: one height for every tile, each as wide as its picture's own shape makes it, set from its
 * first frame (`tileRatio`): the kit's picture frame, unpainted while its file is read, so nothing
 * under the strip moves when the picture comes or never does; red when the page's check stayed
 * failed. Under a service's row, what its checks took: the open card's thumbnails' 80 px.
 */
const TILE_CLASS_NAME = "h-24 max-w-full flex-none";
const TILE_COMPACT_CLASS_NAME = "h-20 max-w-full flex-none";

function PictureTile({
  picture,
  state,
  more,
  onOpen,
  compact,
}: {
  readonly compact: boolean;
  readonly picture: ResultPicture;
  readonly state: AssetUrlState;
  /** The pictures past the strip's last tile. */
  readonly more: number;
  /** Opens the viewer here; null where nothing here can be opened yet. */
  readonly onOpen: (() => void) | null;
}) {
  const intent = useImageIntent(state._tag === "Success" ? state.url : undefined);
  // Its picture could not be shown, and why, as the picture said it (`AssetImage`).
  const [unread, setUnread] = useState<{ readonly url: string; readonly reason?: string }>();
  const failedUrl = unread?.url;
  const unavailable =
    state._tag === "Failure" || (state._tag === "Success" && failedUrl === state.url);
  const status = unavailable ? "unavailable" : state._tag === "Success" ? "ready" : "loading";
  const reason =
    state._tag === "Failure"
      ? state.reason
      : unread !== undefined && state._tag === "Success" && unread.url === state.url
        ? unread.reason
        : undefined;
  const said =
    (more > 0 ? `${picture.label}, and ${more} more` : picture.label) +
    (unavailable ? `. Image unavailable${reason ? ` · ${reason}` : ""}` : "");
  const failed = (picture.kind === "check" && picture.failed) || undefined;
  const size =
    picture.kind === "file"
      ? (picture.dimensions ?? (state._tag === "Success" ? state.imageDimensions : undefined))
      : undefined;
  const known = picture.kind === "check" ? picture.ratio : size ? size.width / size.height : null;
  // A legacy file without dimensions keeps its reserved shape after decode.
  const shape: CSSProperties = { aspectRatio: tileRatio(known) };
  const content = (
    <>
      {unavailable ? (
        // The count stands alone over a picture that cannot be shown: its words never sit
        // under it (Rhea's imported run printed "+9" over "Image unavailable").
        more > 0 ? null : (
          <ImageUnavailable className="size-full" reason={reason} />
        )
      ) : state._tag === "Success" ? (
        <AssetImage
          alt=""
          className="block size-full object-cover object-top"
          width={size?.width}
          height={size?.height}
          src={state.url}
          onError={() => setUnread({ url: state.url })}
          onUnavailable={(why) => setUnread({ url: state.url, ...(why ? { reason: why } : {}) })}
        />
      ) : null}
      {/* The last tile of a run with more: how many more, over its picture sunk into the tray. */}
      {more > 0 ? (
        <span className="absolute inset-0 flex items-center justify-center bg-run-tray/72 text-body font-medium tabular-nums text-foreground in-data-[result-picture=unavailable]:inset-auto in-data-[result-picture=unavailable]:right-1 in-data-[result-picture=unavailable]:bottom-1 in-data-[result-picture=unavailable]:rounded-mark in-data-[result-picture=unavailable]:px-1">
          +{more}
        </span>
      ) : null}
    </>
  );
  const pressless = onOpen === null || (unavailable && more === 0);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          pressless ? (
            <PictureFrame
              aria-label={said}
              className={compact ? TILE_COMPACT_CLASS_NAME : TILE_CLASS_NAME}
              data-result-picture={status}
              role="img"
              style={shape}
              tone={failed ? "failed" : "default"}
              waiting={status === "loading"}
            />
          ) : (
            // The tile is the press's content: its corners, edge and fill are the picture's.
            <Button
              aria-label={`${said}. Open ${more > 0 ? "the pictures" : "the picture"}`}
              className="block max-w-full shrink-0 cursor-zoom-in"
              {...intent}
              onClick={onOpen}
              variant="bare"
            />
          )
        }
      >
        {pressless ? (
          content
        ) : (
          <PictureFrame
            className={compact ? TILE_COMPACT_CLASS_NAME : TILE_CLASS_NAME}
            data-result-picture={status}
            style={shape}
            tone={failed ? "failed" : "default"}
            waiting={status === "loading"}
          >
            {content}
          </PictureFrame>
        )}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{said}</TooltipPopup>
    </Tooltip>
  );
}

/** Where a picture is read from now: a check's own pixels, a file once its address is known. */
function pictureUrl(picture: ResultPicture, files: ResultFiles): string | null {
  const state = files.get(picture.kind === "check" ? picture.src : picture.path);
  if (state?._tag === "Success") return state.url;
  return picture.kind === "check" && !picture.src.startsWith("mate-asset:") ? picture.src : null;
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
  compact = false,
}: {
  readonly compact?: boolean;
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
    <div className="col-start-2 flex flex-wrap gap-2" data-result-strip>
      {shown.map((picture, index) => {
        const last = index === shown.length - 1 && more > 0;
        return (
          <PictureTile
            key={picture.key}
            compact={compact}
            more={last ? more : 0}
            onOpen={opener(index, last ? pictures.length - index : 1)}
            picture={picture}
            state={
              picture.kind === "file"
                ? (files.get(picture.path) ?? LOADING)
                : (files.get(picture.src) ??
                  (picture.src.startsWith("mate-asset:")
                    ? LOADING
                    : { _tag: "Success", url: picture.src }))
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
    // Row by row, 40 ms apart.
    style: { animationDelay: `${index * 40}ms` },
    onAnimationEnd: (event) => {
      if (event.target === event.currentTarget) risen(key);
    },
  };
}

type TurnReportProps = {
  readonly outcome: OutcomeModel;
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
        picture.kind === "file"
          ? [picture.path]
          : picture.src.startsWith("mate-asset:")
            ? [picture.src]
            : [],
      ),
    [props.outcome],
  );
  const resources = useMemo(
    () => paths.map((path) => ({ _tag: "workspace-file" as const, threadId, path })),
    [paths, threadId],
  );
  const read = useAssetUrlStates(environmentId, resources);
  const files = useMemo<ResultFiles>(
    () => new Map(paths.map((path, index) => [path, read[index] ?? LOADING])),
    [paths, read],
  );
  return <Report {...props} files={files} />;
}

function Report({
  outcome,
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
  // Every picture of a service stands under its row; the rest in the strip.
  const hasWorkspace = files !== null;
  const placed = useMemo(
    () => placeResultPictures(outcome, rows, hasWorkspace),
    [hasWorkspace, outcome, rows],
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
    // What a finished run left, as rows in the card's grid: the mark in the card's 28 px column,
    // the words one column in, the actions on its right edge; 14/20 the row, 13/18 under it.
    <section aria-label="What this run left" className="flex flex-col" data-turn-report>
      {rows.map((row, index) => {
        const own = placed.byRow.get(row.key) ?? [];
        return (
          <div
            key={row.key}
            // A row with a line under it hangs from its first line. Arriving while the person
            // watched, the rows rise in once, 40 ms apart; reduced motion fades them.
            className="grid min-h-8.5 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-2 pe-3.5 text-body data-rising:animate-result-rise data-tall:items-start data-tall:py-1.75 motion-reduce:data-rising:animate-run-fade"
            data-result-row={row.group}
            data-tall={row.sub !== null || own.length > 0 || undefined}
            {...riseOf(row.key, index, rising, risen)}
          >
            <RowMark row={row} />
            <div className="min-w-0">
              {/* Nothing is cut off: a long name or reason wraps. */}
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 *:min-w-0 *:wrap-anywhere">
                <span
                  className="font-medium text-foreground data-broken:text-status-failed-text"
                  data-broken={row.group === "broken" || undefined}
                >
                  {row.title}
                </span>
                {row.words === null ? null : (
                  <span className="text-muted-foreground">{row.words}</span>
                )}
                {/* The hash keeps to the row's 20 px. */}
                {row.version === null ? null : (
                  <span className="font-mono text-line leading-none text-muted-foreground">
                    {row.version}
                  </span>
                )}
                {/* What a service's checks found stays on its line: it keeps the line while 12
                    characters of room are left, and gives way at its end past its room. */}
                {row.checked === undefined ? null : (
                  <span className="min-w-[min(12ch,100%)] flex-[1_1_12ch] truncate text-muted-foreground">
                    {row.words === null && row.version === null ? "" : "· "}
                    {row.checked}
                  </span>
                )}
              </div>
              <RowSub row={row} />
              {own.length === 0 ? null : (
                <div className="mt-2">
                  <PictureStrip
                    compact
                    onOpenImage={onOpenImage}
                    pictures={own}
                    files={files ?? NO_FILES}
                  />
                </div>
              )}
            </div>
            <RowEnd mate={now.mate} row={row} />
          </div>
        );
      })}
      {pictures.length === 0 ? null : (
        // The run's pictures, one strip under its rows on the card's words edge: 20 px under the
        // rows; alone, 14 px under the hairline, where a first row's words stand.
        <div
          className={cn(
            "grid grid-cols-[28px_minmax(0,1fr)] gap-x-2 pe-3.5 pb-1.5",
            rows.length === 0 ? "pt-1.75" : "pt-3.25",
          )}
          {...riseOf(PICTURES, rows.length, rising, risen)}
        >
          <PictureStrip files={files ?? NO_FILES} onOpenImage={onOpenImage} pictures={pictures} />
        </div>
      )}
    </section>
  );
}
