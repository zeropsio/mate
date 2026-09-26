/**
 * One strip per stretch for its browser checks: a small stage that streams
 * the check running now and holds the last frame after it, and a filmstrip
 * with a frame per take, newest at the right. Every take keeps its own frame —
 * a retake is a new frame, never a replaced one — and a failed take keeps its
 * slot outlined red, saying why. Fixed height from the first check on: the
 * stage and the filmstrip change inside it, the strip never grows.
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { frameImageSrc } from "@t3tools/client-runtime/zerops/browserStream";
import { ImageOffIcon } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

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
}: {
  readonly strip: BrowserStripModel;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly onOpenImage: (preview: ExpandedImagePreview) => void;
}) {
  const latest = strip.checks.at(-1)!;
  const running = latest.phase === "running";
  const stream = useZeropsBrowserStream(running ? environmentId : null);
  const liveFrame = stream !== undefined && stream !== "unavailable" ? stream.frame : undefined;
  const stageSrc = running
    ? liveFrame
      ? frameImageSrc(liveFrame)
      : undefined
    : latest.screenshot?.src;
  const caption = browserCheckCaption(latest);
  const settledCount = strip.checks.filter((check) => check.phase !== "running").length;

  const filmRef = useRef<HTMLDivElement>(null);
  const shownFramesRef = useRef(0);
  const frames = strip.checks.length;
  useLayoutEffect(() => {
    // The newest take is at the right; keep it in view as takes arrive.
    if (shownFramesRef.current === frames) return;
    shownFramesRef.current = frames;
    const film = filmRef.current;
    if (film) film.scrollLeft = film.scrollWidth;
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

  const title = [
    plural(frames, "check", "checks"),
    plural(strip.views, "view", "views"),
    strip.failures > 0
      ? plural(strip.failures, "failed", "failed")
      : settledCount === frames
        ? "all passed"
        : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const duration = checkDuration(latest);

  return (
    <div
      className="flex h-30 min-w-0 gap-3 overflow-hidden rounded-xl border border-border bg-card p-2.5"
      data-browser-strip
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label={
                stageSrc
                  ? `${running ? "Live view of" : "Last view of"} ${caption}. Open the Browser panel`
                  : "Open the Browser panel"
              }
              className="relative h-25 w-44 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
              data-browser-strip-stage={running ? "live" : "still"}
              onClick={openPanel}
              type="button"
            />
          }
        >
          {stageSrc ? (
            <img alt="" className="block size-full object-cover object-top" src={stageSrc} />
          ) : (
            <span className="flex size-full items-center justify-center px-3 text-center text-muted-foreground text-xs">
              {running ? "Opening the page" : "Screenshot not kept"}
            </span>
          )}
          {running ? (
            <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-background/85 px-1.5 text-2xs text-foreground">
              <span className="size-1.5 rounded-full bg-status-failed" />
              Live
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="bottom">Open the Browser panel</TooltipPopup>
      </Tooltip>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate font-medium text-foreground text-sm" data-browser-strip-title>
          {title}
        </p>
        <p className="truncate text-muted-foreground text-xs">
          {running
            ? `Checking ${caption}`
            : browserCheckFailed(latest)
              ? `${caption} · ${browserCheckFailure(latest)}`
              : `Last: ${caption}${duration ? ` · ${duration}` : ""}`}
        </p>
        <div
          ref={filmRef}
          className="mt-auto flex min-w-0 items-end gap-1.5 overflow-x-auto overflow-y-hidden px-0.5 pt-1 pb-0.5 scrollbar-none"
          data-browser-strip-film
        >
          {strip.checks.map((check) => {
            const failed = browserCheckFailed(check);
            const live = check.phase === "running";
            const label = `${browserCheckCaption(check)}${failed ? ` — ${browserCheckFailure(check)}` : live ? " — running" : ""}`;
            return (
              <Tooltip key={check.key}>
                <TooltipTrigger
                  render={
                    <button
                      aria-label={label}
                      className={cn(
                        "relative h-7.5 w-13.5 shrink-0 cursor-pointer overflow-hidden rounded-sm border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                        failed
                          ? "border-status-failed ring-1 ring-status-failed"
                          : live
                            ? "border-status-busy border-dashed"
                            : "border-border",
                        check === latest && !failed && !live && "ring-1 ring-info",
                      )}
                      data-browser-strip-frame={failed ? "failed" : live ? "live" : "done"}
                      disabled={check.screenshot === undefined && !live}
                      onClick={() => (live ? openPanel() : openShot(check.key))}
                      type="button"
                    />
                  }
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
                      className="mx-auto size-3 text-muted-foreground/60"
                    />
                  )}
                </TooltipTrigger>
                <TooltipPopup side="top">{label}</TooltipPopup>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}
