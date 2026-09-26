/**
 * One block per stretch for its browser checks, with the browser itself as
 * the centrepiece: the page in the frame of the device it is checked on — a
 * browser window, a tablet, a phone — streaming while a check runs and
 * holding the take after it. Beside it, what is being checked, on what, and a
 * frame per take; a take picked there takes the stage. Every take keeps its
 * own frame — a retake is a new frame, never a replaced one — and a failed
 * take keeps its frame outlined red, saying why. Fixed height from the first
 * check on: the stage and the takes change inside it, the block never grows.
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { frameImageSrc } from "@t3tools/client-runtime/zerops/browserStream";
import { CheckIcon, ImageOffIcon, XIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { useZeropsBrowserStream } from "../../zerops/useZeropsFeeds";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  browserCheckCaption,
  browserCheckFailed,
  browserCheckFailure,
  formatWorkDuration,
  type BrowserStripModel,
} from "./conversation.logic";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";

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
  const onStage = picked ?? latest;
  const device = browserCheckDevice(onStage);
  const stream = useZeropsBrowserStream(running ? environmentId : null);
  const liveFrame = stream !== undefined && stream !== "unavailable" ? stream.frame : undefined;
  const stageSrc =
    onStage === latest && running
      ? liveFrame
        ? frameImageSrc(liveFrame)
        : undefined
      : onStage.screenshot?.src;
  const caption = browserCheckCaption(onStage);
  const failedOnStage = browserCheckFailed(onStage);
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
  const facts = [
    onStage.deviceName ?? DEVICE_WORD[device],
    viewport && onStage.deviceName === undefined ? `${viewport.width}×${viewport.height}` : null,
    frames > 1 && !running ? caption : null,
    duration,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "@container/strip min-w-0 overflow-hidden",
        bare ? "h-66" : "h-72 rounded-2xl bg-muted/50 p-3",
      )}
      data-browser-strip
      data-browser-strip-device={device}
    >
      <div className="flex size-full min-w-0 flex-col-reverse gap-2 @xl/strip:flex-row @xl/strip:gap-4">
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
                  failedOnStage && "border-status-failed",
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
              {stageSrc ? (
                <img alt="" className="block size-full object-cover object-top" src={stageSrc} />
              ) : (
                <span className="flex size-full items-center justify-center px-3 text-center text-muted-foreground text-xs">
                  {running ? "Opening the page…" : "Screenshot not kept"}
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
            className="mt-2 hidden min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto scrollbar-none @xl/strip:flex"
            data-browser-strip-film
          >
            {strip.checks.map((check) => {
              const failed = browserCheckFailed(check);
              const live = check.phase === "running";
              const takeDevice = browserCheckDevice(check);
              const takeWords = [
                check.deviceName ?? DEVICE_WORD[takeDevice],
                browserCheckCaption(check),
                live ? "running" : checkDuration(check),
              ]
                .filter(Boolean)
                .join(" · ");
              const label = `${browserCheckCaption(check)} on ${DEVICE_WORD[takeDevice].toLowerCase()}${failed ? ` — ${browserCheckFailure(check)}` : live ? " — running" : ""}`;
              return (
                <button
                  key={check.key}
                  aria-label={label}
                  aria-pressed={check === onStage}
                  className={cn(
                    "flex h-10 w-full min-w-0 shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-start text-xs transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                    check === onStage ? "bg-accent/70 text-foreground" : "text-muted-foreground",
                  )}
                  data-browser-strip-frame={failed ? "failed" : live ? "live" : "done"}
                  disabled={check.screenshot === undefined && !live}
                  onClick={() => (live ? openPanel() : setPickedKey(check.key))}
                  type="button"
                >
                  <span
                    className={cn(
                      "relative flex h-8 shrink-0 items-center justify-center overflow-hidden border bg-card",
                      TAKE_CLASS[takeDevice],
                      failed
                        ? "border-status-failed"
                        : live
                          ? "border-status-busy border-dashed"
                          : "border-border",
                    )}
                  >
                    {check.screenshot ? (
                      <img
                        alt=""
                        className="block size-full object-cover object-top"
                        src={check.screenshot.src}
                      />
                    ) : live ? null : (
                      // The take ran, its picture was not kept: say so rather than draw a blank.
                      <ImageOffIcon
                        aria-hidden="true"
                        className="size-3 text-muted-foreground/60"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{takeWords}</span>
                  {live ? (
                    <span className="size-1.5 shrink-0 animate-status-pulse rounded-full bg-status-busy motion-reduce:animate-none" />
                  ) : failed ? (
                    <XIcon aria-hidden="true" className="size-3.5 shrink-0 text-status-failed" />
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
