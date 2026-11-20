import { use, useMemo } from "react";
import { AssetImage } from "~/assets/AssetImage";
import { cn } from "~/lib/utils";
import { useAssetUrls } from "../../assets/assetUrls";
import { selectMessageImageResources } from "../../session-logic";
import type { ChatImageAttachment, ChatAttachment } from "../../types";
import { MessageFilesAbove, useMessageFileUrls } from "./MessageFiles";
import { echoOfMessage } from "./messagePictures.logic";
import type { RecordItem } from "./MessagesTimeline.logic";
import { BUBBLE_PAD, BUBBLE_SHAPE, WORDS } from "./RunBubble";
import { TimelineRowCtx } from "./timelineContext";

/**
 * Where the person's words reached the Mate, on their side, in their bubble:
 * an answer to its question whole — it stands nowhere else; a message they
 * sent into the run in short, one line — the message itself stands on the
 * page above the card (the owner, 2026-09-28) — and its pictures small under
 * it, each opening the viewer: never a picture's label standing in for its
 * words (2026-10-01: "it also swallows the text it had").
 */
export function PersonMark({ item }: { readonly item: Extract<RecordItem, { kind: "person" }> }) {
  const bubble = cn("max-w-4/5 bg-message text-message-foreground", BUBBLE_SHAPE, BUBBLE_PAD);
  if (item.words !== undefined) {
    return (
      <p className={cn(bubble, "whitespace-pre-wrap break-words", WORDS)} data-chat-kind="person">
        {item.words}
      </p>
    );
  }
  // The client's own placeholder for an image-only message is nothing they wrote.
  const echo = echoOfMessage(
    item.imageOnly ? "" : (item.message?.text ?? ""),
    item.message?.attachments ?? [],
  );
  return (
    <div className={cn(bubble, "grid min-w-0 gap-2")} data-chat-kind="person">
      {echo.line.length > 0 ? <p className={cn("truncate", WORDS)}>{echo.line}</p> : null}
      {echo.pictures.length > 0 ? <PersonPictures pictures={echo.pictures} /> : null}
    </div>
  );
}

/** Files recorded with a question response, beside the answer's own words. */
export function AnswerFiles({
  attachments,
}: {
  readonly attachments: ReadonlyArray<ChatAttachment>;
}) {
  const { activeThreadEnvironmentId } = use(TimelineRowCtx);
  const pictures = attachments.filter(
    (attachment): attachment is ChatImageAttachment => attachment.type === "image",
  );
  const files = attachments.filter((attachment) => attachment.type !== "image");
  const urls = useMessageFileUrls(activeThreadEnvironmentId, files);
  return (
    <div className="grid gap-2">
      <PersonPictures pictures={pictures} />
      <MessageFilesAbove files={files} urls={urls} />
    </div>
  );
}

/** The pictures of a message the person sent into the run: a compact strip, each opening the viewer on all of them. */
function PersonPictures({ pictures }: { readonly pictures: ReadonlyArray<ChatImageAttachment> }) {
  const { activeThreadEnvironmentId, onImageExpand } = use(TimelineRowCtx);
  const resources = useMemo(() => selectMessageImageResources(pictures), [pictures]);
  const urls = useAssetUrls(activeThreadEnvironmentId, resources);
  const byId = new Map(
    resources.flatMap((resource, index) => {
      const url = urls[index];
      return resource._tag === "attachment" && url ? [[resource.attachmentId, url] as const] : [];
    }),
  );
  const shown = pictures.map((picture) => ({
    picture,
    src: byId.get(picture.id) ?? picture.previewUrl ?? null,
  }));
  const viewable = shown.flatMap(({ picture, src }) =>
    src === null ? [] : [{ src, name: picture.name }],
  );
  return (
    <span className="flex min-w-0 flex-wrap gap-1.5" data-person-pictures>
      {shown.map(({ picture, src }) =>
        src === null ? (
          <span
            key={picture.id}
            aria-label={`Loading ${picture.name}`}
            className="block h-16 w-24 rounded-lg bg-foreground/5"
            role="status"
          />
        ) : (
          <button
            key={picture.id}
            aria-label={`Open ${picture.name}`}
            className="block h-16 w-32 cursor-zoom-in overflow-hidden rounded-lg border border-border/60 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            onClick={() =>
              onImageExpand({
                images: viewable,
                index: Math.max(
                  0,
                  viewable.findIndex((view) => view.src === src),
                ),
              })
            }
            type="button"
          >
            <AssetImage
              loading="lazy"
              decoding="async"
              alt={picture.name}
              className="block size-full object-contain"
              src={src}
            />
          </button>
        ),
      )}
    </span>
  );
}
