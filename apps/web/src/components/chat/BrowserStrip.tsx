/**
 * One block per stretch for its browser checks, with the browser itself as
 * the centrepiece: the page in the frame of the device it is checked on — a
 * browser window, a tablet, a phone — streaming while a check runs and
 * holding the take after it. Beside it, what is being checked, on what, and a
 * frame per take; a take picked there takes the stage. Every take keeps its
 * own frame — a retake is a new frame, never a replaced one — and a failed
 * take keeps its frame outlined red, saying why. Fixed height from the first
 * check on: the stage and the takes change inside it, the block never grows.
 *
 * A take the Mate screenshot has its picture. One it did not, the frame
 * draws what it read of the page in the picture's place — the page itself as
 * a wireframe, else what it asked of the page with the answers, else what its
 * errors, console and requests came to — never an empty box (the owner,
 * 2026-09-27: "show the structure output or mock in the space where the
 * window would have been").
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { frameImageSrc } from "@t3tools/client-runtime/zerops/browserStream";
import { CheckIcon, CodeXmlIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { useZeropsBrowserStream } from "../../zerops/useZeropsFeeds";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  browserCheckCaption,
  browserCheckDevice,
  browserCheckFailure,
  browserTakeState,
  formatWorkDuration,
  TAKE_ASPECT,
  type BrowserDevice,
  type BrowserStripModel,
  type BrowserTakeState,
} from "./conversation.logic";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { CheckRead } from "./CheckRead";
import { useNearViewport } from "../../hooks/useNearViewport";
import { useTakeThumbnail } from "./takeThumbnail";
import { followScrollTo } from "~/lib/followScroll";

const DEVICE_WORD: Record<BrowserDevice, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  phone: "Phone",
};

/**
 * Each device's frame on the stage, all the stage's height: its shape carries
 * the device. A narrow column gives the frame the width left under the
 * caption; a wide one keeps it beside the takes.
 */
const FRAME_CLASS: Record<BrowserDevice, string> = {
  desktop: "w-full rounded-lg @xl/strip:w-96",
  tablet: "w-36 rounded-2xl p-1.5 @xl/strip:w-50",
  phone: "w-24 rounded-3xl p-1 @xl/strip:w-32",
};

const SCREEN_CLASS: Record<BrowserDevice, string> = {
  desktop: "rounded-b-lg",
  tablet: "rounded-lg",
  phone: "rounded-2xl",
};

/**
 * A take's frame, by how it ended: a failure red, a failure the same page
 * passed later amber — a retry, as the heading and the report count it.
 */
const TAKE_FRAME: Record<BrowserTakeState, string> = {
  running: "border-status-busy border-dashed",
  passed: "border-border",
  retried: "border-status-attention",
  failed: "border-status-failed",
};

/** A take's thumbnail in the list of takes, in its device's shape. */
const TAKE_CLASS: Record<BrowserDevice, string> = {
  desktop: "w-13 rounded-sm",
  tablet: "w-6 rounded-sm",
  phone: "w-4 rounded-sm",
};

function checkDuration(check: ZeropsOperation): string | null {
  if (check.settledAt === undefined) return null;
  const ms = Date.parse(check.settledAt) - Date.parse(check.anchorAt);
  return Number.isFinite(ms) ? formatWorkDuration(ms) : null;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What a structure check found, in words: "no errors", "2 errors · 1 failed request". */
function takeFindings(check: ZeropsOperation): string | null {
  const summary = check.browserSummary;
  if (summary === undefined) return null;
  const errors = summary.errorCount;
  const requests = summary.failedRequestCount;
  if (errors === 0 && requests === 0) return "no errors";
  return [
    errors > 0 ? plural(errors, "error", "errors") : null,
    requests > 0 ? plural(requests, "failed request", "failed requests") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A take's picture, its content cropped in when the page is mostly empty. */
function TakeThumbnail({ src, aspect }: { readonly src: string; readonly aspect: number }) {
  const { ref, near } = useNearViewport<HTMLImageElement>();
  const thumbnail = useTakeThumbnail(near ? src : undefined, aspect);
  return (
    <img
      ref={ref}
      loading="lazy"
      decoding="async"
      alt=""
      className="block size-full object-cover object-top"
      src={thumbnail}
    />
  );
}

export function BrowserStrip({
  strip,
  environmentId,
  threadRef,
  onOpenImage,
  bare = false,
}: {
  readonly strip: BrowserStripModel;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly onOpenImage: (preview: ExpandedImagePreview) => void;
  /** Drawn in a surface of its own, or bare inside the Mate at work's tray. */
  readonly bare?: boolean;
}) {
  const latest = strip.checks.at(-1)!;
  const running = latest.phase === "running";
  // A picked take holds the stage until a new check starts.
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const picked = running
    ? undefined
    : strip.checks.find((check) => check.key === pickedKey && check !== latest);
  const stream = useZeropsBrowserStream(running ? environmentId : null);
  const liveFrame = stream !== undefined && stream !== "unavailable" ? stream.frame : undefined;
  // Settled, the stage holds the newest take with a page to show — its
  // picture, else what it read of the page — else the newest take.
  const onStage =
    picked ??
    (running
      ? latest
      : (strip.checks.findLast((check) => check.screenshot || check.browserRead) ?? latest));
  const device = browserCheckDevice(onStage);
  const stageSrc =
    onStage === latest && running
      ? liveFrame
        ? frameImageSrc(liveFrame)
        : undefined
      : onStage.screenshot?.src;
  // A settled take with no picture: what it read stands in the picture's place.
  const readOnStage = stageSrc === undefined && onStage.phase !== "running";
  const staged = running || stageSrc !== undefined || readOnStage;
  const caption = browserCheckCaption(onStage);
  const stageState = browserTakeState(onStage, strip.checks);
  const failedOnStage = stageState === "failed";
  const settledCount = strip.checks.filter((check) => check.phase !== "running").length;

  const filmRef = useRef<HTMLDivElement>(null);
  const shownFramesRef = useRef(0);
  const frames = strip.checks.length;
  useLayoutEffect(() => {
    // The newest take is last; keep it in view as takes arrive.
    if (shownFramesRef.current === frames) return;
    shownFramesRef.current = frames;
    setPickedKey(null);
    const film = filmRef.current;
    if (film) followScrollTo(film, film.scrollHeight);
  });

  const shots = strip.checks.flatMap((check) =>
    check.screenshot
      ? [{ key: check.key, src: check.screenshot.src, name: browserCheckCaption(check) }]
      : [],
  );
  const openShot = (key: string) => {
    const index = shots.findIndex((shot) => shot.key === key);
    if (index < 0) return;
    onOpenImage({ images: shots.map(({ src, name }) => ({ src, name })), index });
  };
  const openPanel = () => {
    if (threadRef !== null) useRightPanelStore.getState().open(threadRef, "browser");
  };
  const onStageClick = () => {
    if (onStage === latest && running) openPanel();
    else openShot(onStage.key);
  };

  const heading = running
    ? `Checking ${caption}`
    : frames === 1
      ? failedOnStage
        ? `${caption} failed`
        : `Checked ${caption}`
      : [
          plural(frames, "check", "checks"),
          strip.failures > 0
            ? plural(strip.failures, "failed", "failed")
            : settledCount === frames
              ? "all passed"
              : null,
        ]
          .filter(Boolean)
          .join(" · ");
  const viewport = onStage.viewport;
  const duration = checkDuration(onStage);
  const facts = [
    onStage.deviceName ?? DEVICE_WORD[device],
    viewport && onStage.deviceName === undefined ? `${viewport.width}×${viewport.height}` : null,
    frames > 1 && !running ? caption : null,
    readOnStage && stageState === "passed" ? takeFindings(onStage) : null,
    duration,
  ]
    .filter(Boolean)
    .join(" · ");

  const frameClass = cn(
    "relative flex min-h-0 flex-1 shrink-0 flex-col self-center overflow-hidden border border-border bg-card @xl/strip:h-66 @xl/strip:flex-none",
    FRAME_CLASS[device],
    stageState === "failed" && "border-status-failed",
    stageState === "retried" && "border-status-attention",
  );
  const frameBody = (
    <>
      {device === "desktop" ? (
        <span className="flex h-6 shrink-0 items-center gap-1 border-border border-b px-2">
          <span className="size-1.5 rounded-full bg-muted-foreground/30" />
          <span className="size-1.5 rounded-full bg-muted-foreground/30" />
          <span className="size-1.5 rounded-full bg-muted-foreground/30" />
          <span className="ms-2 min-w-0 flex-1 truncate rounded-sm bg-foreground/8 px-2 text-start text-muted-foreground text-xs leading-4">
            {caption}
          </span>
        </span>
      ) : null}
      <span
        className={cn(
          "relative block min-h-0 flex-1 overflow-hidden bg-background",
          SCREEN_CLASS[device],
        )}
      >
        {readOnStage ? (
          <CheckRead
            failure={stageState === "failed" ? browserCheckFailure(onStage) : null}
            findings={takeFindings(onStage)}
            read={onStage.browserRead}
          />
        ) : stageSrc && onStage === latest && running ? (
          <img
            loading="lazy"
            decoding="async"
            alt=""
            className="block size-full object-cover object-top"
            src={stageSrc}
          />
        ) : stageSrc ? (
          <TakeThumbnail aspect={TAKE_ASPECT[device]} src={stageSrc} />
        ) : (
          <span className="flex size-full items-center justify-center px-3 text-center text-line text-muted-foreground">
            Opening the page…
          </span>
        )}
      </span>
      {running && onStage === latest ? (
        // Live is busy, never failure: the blue its take pulses in the
        // list. A hairline, not a shadow, keeps it off the page under it.
        <span className="absolute end-2 bottom-2 inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/90 px-2 font-medium text-foreground text-xs leading-5">
          <span className="size-1.5 animate-status-pulse rounded-full bg-status-busy motion-reduce:animate-none" />
          Live
        </span>
      ) : null}
    </>
  );

  return (
    <div
      className={cn(
        "@container/strip min-w-0 overflow-hidden",
        staged ? (bare ? "h-66" : "h-72") : "max-h-66",
        // A light share of the ink, both palettes show it: `muted` all but
        // vanishes on the dark card, and a surface this large sits a step
        // under the Mate's bubble.
        !bare && "rounded-2xl bg-foreground/5 p-3",
      )}
      data-browser-strip
      data-browser-strip-device={device}
    >
      <div className="flex size-full min-w-0 flex-col-reverse gap-2 @xl/strip:flex-row @xl/strip:gap-4">
        {staged ? (
          readOnStage ? (
            // What it read has nothing to open: a frame, not a button.
            <div
              aria-label={`${caption} as the check read it on ${DEVICE_WORD[device].toLowerCase()}`}
              className={frameClass}
              data-browser-strip-stage="read"
              role="img"
            >
              {frameBody}
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    aria-label={
                      stageSrc
                        ? `${running && onStage === latest ? "Live view of" : "View of"} ${caption} on ${DEVICE_WORD[device].toLowerCase()}`
                        : "Open the Browser panel"
                    }
                    className={cn(
                      frameClass,
                      "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                    )}
                    data-browser-strip-stage={running && onStage === latest ? "live" : "still"}
                    onClick={onStageClick}
                    type="button"
                  />
                }
              >
                {frameBody}
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                {running && onStage === latest ? "Open the Browser panel" : "Open the screenshot"}
              </TooltipPopup>
            </Tooltip>
          )
        ) : null}
        <div className="flex min-w-0 flex-none flex-col gap-0.5 @xl/strip:flex-1 @xl/strip:py-1">
          <p
            className={cn(
              "truncate font-medium text-line",
              failedOnStage ? "text-status-failed-text" : "text-foreground",
            )}
            data-browser-strip-title
          >
            {heading}
          </p>
          <p className="truncate text-line text-muted-foreground">{facts}</p>
          {failedOnStage ? (
            <p className="line-clamp-1 text-line text-status-failed-text @xl/strip:line-clamp-2">
              {browserCheckFailure(onStage)}
            </p>
          ) : null}
          <div
            ref={filmRef}
            className={cn(
              "mt-2 min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto scrollbar-none",
              staged ? "hidden @xl/strip:flex" : "flex",
            )}
            data-browser-strip-film
          >
            {strip.checks.map((check) => {
              const state = browserTakeState(check, strip.checks);
              const live = state === "running";
              const takeDevice = browserCheckDevice(check);
              // No picture and no page read: it looked only at errors, the
              // console and requests.
              const unseen =
                state === "passed" &&
                check.screenshot === undefined &&
                check.browserRead === undefined;
              const takeWords = [
                check.deviceName ?? DEVICE_WORD[takeDevice],
                browserCheckCaption(check),
                state === "passed" || live ? null : state,
                live ? "running" : checkDuration(check),
              ]
                .filter(Boolean)
                .join(" · ");
              const label = `${browserCheckCaption(check)} on ${DEVICE_WORD[takeDevice].toLowerCase()}${
                state === "failed"
                  ? ` — ${browserCheckFailure(check)}`
                  : state === "retried"
                    ? ` — retried: ${browserCheckFailure(check)}`
                    : live
                      ? " — running"
                      : ""
              }`;
              return (
                <button
                  key={check.key}
                  aria-label={label}
                  aria-pressed={check === onStage}
                  className={cn(
                    "flex h-10 w-full min-w-0 shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-start text-line transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                    check === onStage ? "bg-accent/70 text-foreground" : "text-muted-foreground",
                  )}
                  data-browser-strip-frame={live ? "live" : state === "passed" ? "done" : state}
                  onClick={() => (live ? openPanel() : setPickedKey(check.key))}
                  type="button"
                >
                  {/* Every take's words start on one edge: its thumbnail, in its
                      device's shape, sits in a slot as wide as a desktop's. */}
                  <span className="flex w-13 shrink-0 justify-center" data-browser-strip-take-slot>
                    <span
                      className={cn(
                        "relative flex h-8 shrink-0 items-center justify-center overflow-hidden border bg-card",
                        TAKE_CLASS[takeDevice],
                        TAKE_FRAME[state],
                      )}
                    >
                      {check.screenshot ? (
                        <TakeThumbnail
                          aspect={TAKE_ASPECT[takeDevice]}
                          src={check.screenshot.src}
                        />
                      ) : check.browserRead !== undefined ? (
                        <CheckRead
                          failure={null}
                          findings={null}
                          read={check.browserRead}
                          size="thumbnail"
                        />
                      ) : unseen ? (
                        <CodeXmlIcon aria-hidden="true" className="size-3 text-muted-foreground" />
                      ) : null}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 truncate">{takeWords}</span>
                  {live ? (
                    <span className="size-1.5 shrink-0 animate-status-pulse rounded-full bg-status-busy motion-reduce:animate-none" />
                  ) : state === "failed" ? (
                    <XIcon aria-hidden="true" className="size-3.5 shrink-0 text-status-failed" />
                  ) : state === "retried" ? (
                    <RotateCcwIcon
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-status-attention"
                    />
                  ) : (
                    <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-status-ok" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A take among a run's pictures, in the shape of the device it was taken on. */
const TAKE_PICTURE_CLASS: Record<BrowserDevice, string> = {
  desktop: "w-32",
  tablet: "w-15",
  phone: "w-9",
};

/**
 * The pictures a run's checks took, side by side in their devices' shapes — a
 * failed take outlined red, a retried one amber — each opening the picture
 * viewer with the others beside it; the one being taken now, the page as the
 * browser streams it; one that failed with no picture, its frame outlined red
 * saying what went wrong. Any other check with no picture is left out: what
 * it read is the stage's to show.
 */
export function BrowserTakes({
  takes,
  onOpenImage,
  environmentId = null,
}: {
  readonly takes: ReadonlyArray<ZeropsOperation>;
  readonly onOpenImage: (preview: ExpandedImagePreview) => void;
  /** Where the browser streams from, for a take still being taken. */
  readonly environmentId?: EnvironmentId | null;
}) {
  const shots = takes.flatMap((take) =>
    take.screenshot
      ? [{ key: take.key, src: take.screenshot.src, name: browserCheckCaption(take) }]
      : [],
  );
  const failedBare = (take: ZeropsOperation) =>
    take.screenshot === undefined && browserTakeState(take, takes) === "failed";
  if (shots.length === 0 && !takes.some((take) => take.phase === "running" || failedBare(take)))
    return null;
  return (
    // The first take on the text edge: the room its scroller keeps for a
    // take's ring and the focus ring hangs outside it.
    <div
      className="-m-1 flex min-w-0 items-end gap-2 overflow-x-auto p-1 scrollbar-none"
      data-report-takes
    >
      {takes.map((take) => {
        if (take.phase === "running") {
          return <LiveTake key={take.key} environmentId={environmentId} take={take} />;
        }
        if (failedBare(take)) return <FailedTake key={take.key} take={take} />;
        const src = take.screenshot?.src;
        if (src === undefined) return null;
        const state = browserTakeState(take, takes);
        const device = browserCheckDevice(take);
        const index = shots.findIndex((shot) => shot.key === take.key);
        return (
          <button
            key={take.key}
            aria-label={`${browserCheckCaption(take)}${take.deviceName ? ` on ${take.deviceName}` : ""}${state === "failed" ? ", failed" : state === "retried" ? ", retried" : ""}. Open the screenshot`}
            className={cn(
              "h-20 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
              TAKE_PICTURE_CLASS[device],
              state === "failed"
                ? "border-status-failed ring-1 ring-status-failed"
                : state === "retried"
                  ? "border-status-attention"
                  : "border-border",
            )}
            data-report-take={device}
            onClick={() =>
              onOpenImage({ images: shots.map(({ src, name }) => ({ src, name })), index })
            }
            type="button"
          >
            <TakeThumbnail aspect={TAKE_ASPECT[device]} src={src} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The take being taken now: the page as the browser streams it, in the frame
 * its picture will stand in, so the row keeps its height when the picture
 * comes. Busy, never failure: the blue dot the stage's Live wears.
 */
function LiveTake({
  take,
  environmentId,
}: {
  readonly take: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
}) {
  const device = browserCheckDevice(take);
  const stream = useZeropsBrowserStream(environmentId);
  const frame = stream !== undefined && stream !== "unavailable" ? stream.frame : undefined;
  return (
    <span
      aria-label={`Checking ${browserCheckCaption(take)}`}
      className={cn(
        "relative block h-20 shrink-0 overflow-hidden rounded-lg border border-border bg-background",
        TAKE_PICTURE_CLASS[device],
      )}
      data-report-take={device}
      data-report-take-live
      role="img"
    >
      {frame === undefined ? null : (
        <img
          loading="lazy"
          decoding="async"
          alt=""
          className="block size-full object-cover object-top"
          src={frameImageSrc(frame)}
        />
      )}
      <span
        aria-hidden="true"
        className="absolute end-1.5 bottom-1.5 size-1.5 animate-status-pulse rounded-full bg-status-busy motion-reduce:animate-none"
      />
    </span>
  );
}

/**
 * A take that failed and took no picture: its frame all the same, outlined red
 * as a failed picture is, with what went wrong — so a row saying a check
 * failed shows which (Nova, 2026-09-28: port 9 refused, and the row's only
 * picture was of the page that passed). A phone's frame is too narrow for
 * words: its mark says it.
 */
function FailedTake({ take }: { readonly take: ZeropsOperation }) {
  const device = browserCheckDevice(take);
  const reason = browserCheckFailure(take);
  return (
    <span
      aria-label={`${browserCheckCaption(take)} failed${reason === null ? "" : `: ${reason}`}`}
      className={cn(
        "flex h-20 shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-status-failed bg-card px-2 text-center ring-1 ring-status-failed",
        TAKE_PICTURE_CLASS[device],
      )}
      data-report-take={device}
      data-report-take-failed
      role="img"
    >
      <XIcon aria-hidden="true" className="size-3.5 shrink-0 text-status-failed-text" />
      {device === "desktop" && reason !== null ? (
        <span className="line-clamp-3 break-words text-status-failed-text text-xs leading-4">
          {reason}
        </span>
      ) : null}
    </span>
  );
}
