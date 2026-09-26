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
 * A take the Mate screenshot has its picture. One it did not read the
 * page's structure — its errors, console and requests — and says so: a
 * structure glyph and "structure", never an empty frame (the owner,
 * 2026-09-26, of a frame saying "Screenshot not kept": "when there is no
 * screenshot it means its checking just the structure right? we could somehow
 * reflect as well"). With no picture to stage, the block is its list of takes.
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
  browserCheckFailure,
  browserTakeState,
  formatWorkDuration,
  type BrowserStripModel,
  type BrowserTakeState,
} from "./conversation.logic";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { useTakeThumbnail } from "./takeThumbnail";

type Device = "desktop" | "tablet" | "phone";

/**
 * The device a check looked through: the device it emulated by name, else the
 * viewport it set (CSS pixels), else the picture it took — a phone's picture
 * is tall and, even at three device pixels per CSS pixel, under 1300 wide.
 */
export function browserCheckDevice(check: ZeropsOperation): Device {
  const name = check.deviceName;
  if (name !== undefined) {
    if (/desktop/i.test(name)) return "desktop";
    return /ipad|tablet|\btab\b|kindle|nexus (7|9|10)/i.test(name) ? "tablet" : "phone";
  }
  const viewport = check.viewport;
  if (viewport !== undefined) {
    if (viewport.width <= 480) return "phone";
    return viewport.width <= 1024 && viewport.height > viewport.width ? "tablet" : "desktop";
  }
  const shot = check.screenshot;
  if (shot?.width !== undefined && shot.height !== undefined) {
    const tall = shot.height / shot.width;
    if (shot.width <= 480 || (tall >= 1.6 && shot.width < 1300)) return "phone";
    if (tall >= 1.15 && shot.width < 2100) return "tablet";
  }
  return "desktop";
}

/** The shape of a take's frame, width over height, by device: a thumbnail crops its picture to it. */
export const TAKE_ASPECT: Record<Device, number> = {
  desktop: 1.6,
  tablet: 0.75,
  phone: 0.45,
};

const DEVICE_WORD: Record<Device, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  phone: "Phone",
};

/**
 * Each device's frame on the stage, all the stage's height: its shape carries
 * the device. A narrow column gives the frame the width left under the
 * caption; a wide one keeps it beside the takes.
 */
const FRAME_CLASS: Record<Device, string> = {
  desktop: "w-full rounded-lg @xl/strip:w-96",
  tablet: "w-36 rounded-2xl p-1.5 @xl/strip:w-50",
  phone: "w-24 rounded-3xl p-1 @xl/strip:w-32",
};

const SCREEN_CLASS: Record<Device, string> = {
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
const TAKE_CLASS: Record<Device, string> = {
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
  const thumbnail = useTakeThumbnail(src, aspect);
  return <img alt="" className="block size-full object-cover object-top" src={thumbnail} />;
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
  // Settled, the stage holds the newest take with a picture.
  const onStage =
    picked ?? (running ? latest : (strip.checks.findLast((check) => check.screenshot) ?? latest));
  const device = browserCheckDevice(onStage);
  const stageSrc =
    onStage === latest && running
      ? liveFrame
        ? frameImageSrc(liveFrame)
        : undefined
      : onStage.screenshot?.src;
  const staged = running || stageSrc !== undefined;
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
    if (film) film.scrollTop = film.scrollHeight;
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
  // No picture of a take that passed: it read the page's structure. A take
  // that failed or was retried has no picture because it never got one.
  const structureOnStage = stageState === "passed" && onStage.screenshot === undefined;
  const facts = [
    onStage.deviceName ?? DEVICE_WORD[device],
    viewport && onStage.deviceName === undefined ? `${viewport.width}×${viewport.height}` : null,
    frames > 1 && !running ? caption : null,
    structureOnStage ? "structure" : null,
    structureOnStage ? takeFindings(onStage) : null,
    duration,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "@container/strip min-w-0 overflow-hidden",
        staged ? (bare ? "h-66" : "h-72") : "max-h-66",
        !bare && "rounded-2xl bg-muted/50 p-3",
      )}
      data-browser-strip
      data-browser-strip-device={device}
    >
      <div className="flex size-full min-w-0 flex-col-reverse gap-2 @xl/strip:flex-row @xl/strip:gap-4">
        {staged ? (
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
                    "relative flex min-h-0 flex-1 shrink-0 cursor-pointer flex-col self-center overflow-hidden border border-border bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 @xl/strip:h-66 @xl/strip:flex-none",
                    FRAME_CLASS[device],
                    stageState === "failed" && "border-status-failed",
                    stageState === "retried" && "border-status-attention",
                  )}
                  data-browser-strip-stage={running && onStage === latest ? "live" : "still"}
                  onClick={onStageClick}
                  type="button"
                />
              }
            >
              {device === "desktop" ? (
                <span className="flex h-6 shrink-0 items-center gap-1 border-border border-b px-2">
                  <span className="size-1.5 rounded-full bg-muted-foreground/30" />
                  <span className="size-1.5 rounded-full bg-muted-foreground/30" />
                  <span className="size-1.5 rounded-full bg-muted-foreground/30" />
                  <span className="ms-2 min-w-0 flex-1 truncate rounded-sm bg-muted px-2 text-start text-2xs text-muted-foreground leading-4">
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
                {stageSrc && onStage === latest && running ? (
                  <img alt="" className="block size-full object-cover object-top" src={stageSrc} />
                ) : stageSrc ? (
                  <TakeThumbnail aspect={TAKE_ASPECT[device]} src={stageSrc} />
                ) : (
                  <span className="flex size-full items-center justify-center px-3 text-center text-muted-foreground text-xs">
                    Opening the page…
                  </span>
                )}
              </span>
              {running && onStage === latest ? (
                <span className="absolute end-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 text-2xs text-foreground leading-5 shadow-sm">
                  <span className="size-1.5 animate-status-pulse rounded-full bg-status-failed motion-reduce:animate-none" />
                  Live
                </span>
              ) : null}
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              {running && onStage === latest ? "Open the Browser panel" : "Open the screenshot"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        <div className="flex min-w-0 flex-none flex-col gap-0.5 @xl/strip:flex-1 @xl/strip:py-1">
          <p
            className={cn(
              "truncate font-medium text-sm",
              failedOnStage ? "text-status-failed-text" : "text-foreground",
            )}
            data-browser-strip-title
          >
            {heading}
          </p>
          <p className="truncate text-muted-foreground text-xs">{facts}</p>
          {failedOnStage ? (
            <p className="line-clamp-1 text-status-failed-text text-xs @xl/strip:line-clamp-2">
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
              const structure = state === "passed" && check.screenshot === undefined;
              const takeWords = [
                check.deviceName ?? DEVICE_WORD[takeDevice],
                browserCheckCaption(check),
                structure ? "structure" : state === "passed" || live ? null : state,
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
                    "flex h-10 w-full min-w-0 shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-start text-xs transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                    check === onStage ? "bg-accent/70 text-foreground" : "text-muted-foreground",
                  )}
                  data-browser-strip-frame={live ? "live" : state === "passed" ? "done" : state}
                  disabled={check.screenshot === undefined && !live}
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
                      ) : structure ? (
                        // No screenshot: the take read the page's structure.
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
