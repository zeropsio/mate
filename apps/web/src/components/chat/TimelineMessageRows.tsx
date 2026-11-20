import { AssetImage, ImageUnavailable } from "~/assets/AssetImage";
import { use, useLayoutEffect, useMemo, useRef, useState } from "react";
import { takeWordsStood } from "./wordsLanding";
import { FoldRoom } from "./timelinePanelStand";
import { CollapsibleUserMessageBody, UserMessageBody } from "./TimelineUserMessageBody";
import {
  createMessageAttachmentPreviewProjector,
  selectMessageImageResources,
} from "../../session-logic";
import { type ChatImageAttachment, type ChatMessage, isImageAttachment } from "../../types";
import ChatMarkdown, { MESSAGE_HEADING_LEVEL } from "../ChatMarkdown";
import { queuedBubbleState } from "../../queuedMessageStore";
import { ArrowUpIcon, ClockIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button";
import { buildExpandedImagePreview } from "./ExpandedImagePreview";
import { MessagePictureBody, useMessagePictureDimensions } from "./MessagePictures";
import { MessageFilesAbove, useMessageFileUrls } from "./MessageFiles";
import {
  placeMessagePictures,
  terminalContextsBySegment,
  unplacedMessageFiles,
} from "./messagePictures.logic";
import { useAssetUrlStates } from "../../assets/assetUrls";
import { MessageCopyButton } from "./MessageCopyButton";
import {
  resolveAssistantMessageCopyState,
  shouldPreserveAssistantLineBreaks,
} from "./MessagesTimeline.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { deriveDisplayedUserMessageState } from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
import { useEngineLiveMessage } from "./useEngineLiveMessage";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../timestampFormat";
import { TimelineRowCtx } from "./timelineContext";
import { HeldMessageLine, MessageReceipt } from "./ConversationRows";
import { ChangeChipMomentContext } from "../zerops/ZeropsChangeLinkChip";
import type { MessagesTimelineRow as TimelineRow } from "./MessagesTimeline.logic";

/**
 * A message waiting for the running turn: a dashed user bubble with icon
 * actions inside it. The dashed outline and the clock carry the state; the
 * timing reads from the clock's tooltip.
 */
export function QueuedMessageTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "queued-message" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const { queuedMessage } = row;
  const attachmentCount = queuedMessage.images.length;
  const contextCount = queuedMessage.terminalContexts.length + queuedMessage.reviewComments.length;
  const text = queuedMessage.prompt.trim();
  const state = queuedBubbleState({
    message: queuedMessage,
    isNext: row.isNext,
    heldAhead: row.heldAhead,
    blockedByAnswer: ctx.queueBlockedByAnswer === true,
  });
  return (
    <div className="flex flex-col items-end" data-queued-message-id={queuedMessage.id}>
      <div className="max-w-[80%] rounded-2xl border border-dashed border-border p-3 text-message-foreground/80">
        {text.length > 0 ? (
          <UserMessageBody
            text={text}
            terminalContexts={[]}
            skills={ctx.skills}
            markdownCwd={ctx.markdownCwd}
          />
        ) : null}
        {attachmentCount > 0 || contextCount > 0 ? (
          <div className={cn("text-secondary-label text-xs", text.length > 0 && "mt-1.5")}>
            {[
              attachmentCount > 0
                ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`
                : null,
              contextCount > 0
                ? `${contextCount} context item${contextCount === 1 ? "" : "s"}`
                : null,
            ]
              .filter(Boolean)
              .join(", ")}
          </div>
        ) : null}
        <div className="mt-2 flex items-center gap-4 text-secondary-label text-xs">
          {/* The clock's place, one line high: what it waits for, or why its send was refused. */}
          {state.line === null ? (
            <Tooltip>
              <TooltipTrigger
                render={<span className="inline-flex h-6 items-center" />}
                aria-label={`Queued. ${state.clockLabel}.`}
              >
                <ClockIcon className="size-3.5" aria-hidden />
              </TooltipTrigger>
              <TooltipPopup side="bottom">{state.clockLabel}</TooltipPopup>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className={cn(
                      "min-w-0 truncate leading-6",
                      state.line.tone === "error" && "text-destructive",
                    )}
                    data-queued-line={state.line.tone}
                  />
                }
              >
                {state.line.text}
              </TooltipTrigger>
              <TooltipPopup side="bottom">{state.line.text}</TooltipPopup>
            </Tooltip>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onPointerDown={(event) => event.preventDefault()}
                    // Held back while an answer is due, never pressed to do nothing: it says why.
                    aria-disabled={state.send.disabled ? true : undefined}
                    onClick={() => {
                      if (!state.send.disabled) ctx.onSteerQueuedMessage(queuedMessage.id);
                    }}
                    aria-label={state.send.label}
                  />
                }
              >
                {state.send.retry ? (
                  <RotateCcwIcon className="size-3.5" aria-hidden />
                ) : (
                  <ArrowUpIcon className="size-3.5" aria-hidden />
                )}
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                {state.send.label}
                {row.isNext && !state.send.disabled && ctx.steerQueuedMessageShortcutLabel
                  ? ` (${ctx.steerQueuedMessageShortcutLabel})`
                  : null}
              </TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => ctx.onRemoveQueuedMessage(queuedMessage.id)}
                    aria-label="Cancel and return to the composer"
                  />
                }
              >
                <XIcon className="size-3.5" aria-hidden />
              </TooltipTrigger>
              <TooltipPopup side="bottom">Cancel and return to the composer</TooltipPopup>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageAuthorHeading({ children }: { children: string }) {
  return <h3 className="sr-only select-none">{children}</h3>;
}

export function UserTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  const ctx = use(TimelineRowCtx);
  const resources = useMemo(
    () => selectMessageImageResources(row.message.attachments),
    [row.message.attachments],
  );
  const previewStates = useAssetUrlStates(ctx.activeThreadEnvironmentId, resources);
  const pictureStates = useMemo(
    () =>
      new Map(resources.map((resource, index) => [resource.attachmentId, previewStates[index]!])),
    [previewStates, resources],
  );
  const [projectPreviews] = useState(createMessageAttachmentPreviewProjector);
  const messageWithPreviews = useMemo(() => {
    const urlsById = new Map(
      resources.flatMap((resource, index) => {
        const state = previewStates[index];
        return state?._tag === "Success" ? [[resource.attachmentId, state.url] as const] : [];
      }),
    );
    return projectPreviews(row.message, (attachment) => urlsById.get(attachment.id));
  }, [previewStates, projectPreviews, resources, row.message]);
  const userImages = (messageWithPreviews.attachments ?? []).filter(isImageAttachment);
  // The client's own placeholder for an image-only message is nothing the person wrote.
  const displayedUserMessage = deriveDisplayedUserMessageState(
    row.imageOnly ? "" : row.message.text,
  );
  const terminalContexts = displayedUserMessage.contexts;
  // Pictures sit where the person put them; images no label places stay above the words.
  const placedPictures = useMemo(
    () =>
      placeMessagePictures(displayedUserMessage.visibleText, messageWithPreviews.attachments ?? []),
    [displayedUserMessage.visibleText, messageWithPreviews.attachments],
  );
  const pictureContexts = useMemo(
    () =>
      placedPictures ? terminalContextsBySegment(placedPictures.segments, terminalContexts) : null,
    [placedPictures, terminalContexts],
  );
  const pictureDimensions = useMessagePictureDimensions(ctx.activeThreadEnvironmentId, resources);
  const imagesAbove = placedPictures?.unplaced ?? userImages;
  // Files sit where their labels stand; a phone's, with none, above the words.
  const messageAttachments = messageWithPreviews.attachments;
  const filesAbove = useMemo(
    () =>
      placedPictures?.unplacedFiles ??
      unplacedMessageFiles(displayedUserMessage.visibleText, messageAttachments ?? []),
    [displayedUserMessage.visibleText, messageAttachments, placedPictures],
  );
  const shownFiles = useMemo(
    () =>
      (messageAttachments ?? []).filter(
        (attachment) =>
          filesAbove.includes(attachment) ||
          (placedPictures?.segments.some(
            (segment) => segment.kind === "file" && segment.file === attachment,
          ) ??
            false),
      ),
    [filesAbove, messageAttachments, placedPictures],
  );
  const fileUrls = useMessageFileUrls(ctx.activeThreadEnvironmentId, shownFiles);
  const expandImage = (image: ChatImageAttachment) => {
    const preview = buildExpandedImagePreview(userImages, image.id);
    if (preview) ctx.onImageExpand(preview);
  };

  const heldRunId = row.message.heldRunId;
  const withdrawHeld =
    heldRunId !== undefined && ctx.onWithdrawHeldMessage
      ? () => ctx.onWithdrawHeldMessage?.(heldRunId)
      : null;
  const held = row.receipt === "held";

  return (
    <>
      {/* The time and actions sit beside the bubble's foot rather than under it:
        a hover-only strip in flow would add a blank line under every message.
        The receipt stays: it is how the person knows the Mate read it. */}
      <div className="group flex flex-row-reverse items-end gap-2">
        {/* One bubble for every message: a message sent as a turn ended can
          become the next turn's opener, and it must not change its size. */}
        <div
          className="relative max-w-4/5 rounded-2xl bg-message px-3.5 py-2.5 text-prose text-message-foreground"
          data-message-aside={row.aside ? "true" : undefined}
        >
          <MessageAuthorHeading>{ctx.asker ?? "You"}</MessageAuthorHeading>
          {imagesAbove.length > 0 && (
            <div className="mb-2 grid max-w-[420px] grid-cols-2 gap-2">
              {imagesAbove.map((image: ChatImageAttachment) => {
                const state = pictureStates.get(image.id);
                return (
                  <div
                    key={image.id}
                    className="overflow-hidden rounded-lg border border-border/80 bg-background/70"
                  >
                    {state?._tag === "Failure" ? (
                      <ImageUnavailable reason={state.reason} />
                    ) : image.previewUrl ? (
                      <button
                        type="button"
                        className="h-full w-full cursor-zoom-in"
                        aria-label={`Preview ${image.name}`}
                        onClick={() => expandImage(image)}
                      >
                        <AssetImage
                          loading="lazy"
                          decoding="async"
                          src={image.previewUrl}
                          alt={image.name}
                          className="block max-h-[220px] w-full object-contain"
                          style={{ aspectRatio: `${image.width ?? 16} / ${image.height ?? 9}` }}
                        />
                      </button>
                    ) : (
                      <div className="flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-secondary-label text-2xs">
                        {image.name}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <MessageFilesAbove files={filesAbove} urls={fileUrls} />
          {placedPictures ? (
            <MessagePictureBody
              segments={placedPictures.segments}
              dimensions={pictureDimensions}
              states={pictureStates}
              onOpen={expandImage}
              fileUrls={fileUrls}
              renderText={(segment) => (
                <CollapsibleUserMessageBody
                  text={segment.text}
                  terminalContexts={[...(pictureContexts?.get(segment.after) ?? [])]}
                  skills={ctx.skills}
                  markdownCwd={ctx.markdownCwd}
                />
              )}
            />
          ) : (
            <CollapsibleUserMessageBody
              text={displayedUserMessage.visibleText}
              terminalContexts={terminalContexts}
              skills={ctx.skills}
              markdownCwd={ctx.markdownCwd}
            />
          )}
        </div>
        {row.receipt ? (
          <span className="flex shrink-0 pb-1.5">
            <MessageReceipt
              receipt={row.receipt}
              speaker={ctx.speaker}
              resetsAt={ctx.limit?.kind === "limited" ? ctx.limit.resetsAt : null}
              timestampFormat={ctx.timestampFormat}
            />
          </span>
        ) : null}
        <div className="flex shrink-0 items-center pb-1 text-xs tabular-nums opacity-0 transition-opacity duration-200 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover:opacity-100">
          <div className="flex shrink-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger render={<p className="text-muted-foreground text-xs tabular-nums" />}>
                {formatDayAwareTimestamp(row.message.createdAt, ctx.timestampFormat)}
              </TooltipTrigger>
              <TooltipPopup>
                {formatChatTimestampTooltip(row.message.createdAt, ctx.timestampFormat)}
              </TooltipPopup>
            </Tooltip>
            <div className="flex items-center gap-0.5">
              {displayedUserMessage.copyText && (
                <MessageCopyButton text={displayedUserMessage.copyText} variant="ghost" />
              )}
              {/* Held, Don't send stands in the line under the message. */}
              {withdrawHeld !== null && !held ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Don't send"
                        onClick={withdrawHeld}
                      />
                    }
                  >
                    <XIcon className="size-3.5" aria-hidden />
                  </TooltipTrigger>
                  <TooltipPopup>Don't send</TooltipPopup>
                </Tooltip>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {held ? (
        <HeldMessageLine
          onWithdraw={withdrawHeld}
          resetsAt={ctx.limit?.kind === "limited" ? ctx.limit.resetsAt : null}
          timestampFormat={ctx.timestampFormat}
        />
      ) : null}
    </>
  );
}

/** The Mate's answer to a settled turn, set for reading. */
export function AssistantTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  return (
    <>
      <FoldRoom fold={row.foldsFrom} words={row.message.id} />
      <MateProse message={row.message} showMeta={row.showAssistantMeta} />
    </>
  );
}

/**
 * The Mate talking to the person — its answer, or the words the person
 * answered: prose on the conversation's text edge, one hand for both, with
 * no bubble and no face (the person's words are the bubbles). Its copy and
 * its time stand on a line of their own under it, shown on hover — reserved,
 * so showing them moves nothing, and under the words, so they cover none
 * and no edge clips them (the owner, 2026-09-26: "placement of this utterly
 * sucks + its even cut of overflow").
 */
/** The Mate's words in its prose hand: the answer's type, links and chips. */
function MateProseWords({
  text,
  at,
  streaming,
}: {
  readonly text: string;
  /** When they were said: the moment a change chip reads its state at. */
  readonly at: string;
  readonly streaming: boolean;
}) {
  const ctx = use(TimelineRowCtx);
  return (
    <>
      <MessageAuthorHeading>{ctx.speaker.name}</MessageAuthorHeading>
      <ChangeChipMomentContext value={at}>
        <ChatMarkdown
          variant="answer"
          text={text}
          cwd={ctx.markdownCwd}
          threadRef={ctx.threadRef ?? undefined}
          isStreaming={streaming}
          lineBreaks={shouldPreserveAssistantLineBreaks(text)}
          skills={ctx.skills}
          headingLevelOffset={MESSAGE_HEADING_LEVEL}
          onOpenImage={ctx.onImageExpand}
          onRunShellCommand={ctx.onRunShellCommand}
        />
      </ChangeChipMomentContext>
    </>
  );
}

function MateProse({
  message: recorded,
  showMeta,
}: {
  readonly message: ChatMessage;
  readonly showMeta: boolean;
}) {
  const ctx = use(TimelineRowCtx);
  const message = useEngineLiveMessage(recorded);
  const messageText = message.text || (message.streaming ? "" : "(empty response)");
  // Landing from the run's slot, where its words were being read: its last line stands there.
  const wordsRef = useRef<HTMLDivElement>(null);
  const { onAnswerLands } = ctx;
  const { id } = message;
  useLayoutEffect(() => {
    const words = wordsRef.current;
    const stood = takeWordsStood(id);
    if (words !== null && stood !== null) onAnswerLands?.(words, stood);
  }, [id, onAnswerLands]);
  const copy = resolveAssistantMessageCopyState({
    text: message.text ?? null,
    showCopyButton: showMeta,
    streaming: Boolean(message.streaming),
  });
  return (
    <div className="min-w-0">
      <div ref={wordsRef}>
        <MateProseWords
          at={message.createdAt}
          streaming={Boolean(message.streaming)}
          text={messageText}
        />
      </div>
      {showMeta ? (
        <div
          className="-ms-1.5 mt-1 flex h-6 items-center gap-1 text-muted-foreground text-xs tabular-nums opacity-0 transition-opacity duration-200 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover/assistant:opacity-100"
          data-mate-prose-actions
        >
          {copy.visible ? <MessageCopyButton text={copy.text ?? ""} variant="ghost" /> : null}
          <Tooltip>
            <TooltipTrigger render={<p className="text-muted-foreground text-xs tabular-nums" />}>
              {formatDayAwareTimestamp(message.updatedAt, ctx.timestampFormat)}
            </TooltipTrigger>
            <TooltipPopup>
              {formatChatTimestampTooltip(message.updatedAt, ctx.timestampFormat)}
            </TooltipPopup>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}
