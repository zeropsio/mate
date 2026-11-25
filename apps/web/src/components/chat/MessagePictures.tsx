/**
 * The person's message with pictures: words and pictures in the order they
 * were written, each picture where it was put with its numbered notes under
 * it, and a line when its untouched original went along.
 *
 * The message's text holds each picture's label and notes
 * (`@t3tools/shared/composerPictures`); this reads them back, so a message
 * that holds no labels (an older one, one from a phone) keeps its pictures
 * above its words as before.
 */
import { AssetImage, ImageUnavailable } from "~/assets/AssetImage";
import { useMateImageDimensions, useImageIntent } from "~/assets/MateImages";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { Fragment, type ReactNode, use } from "react";

import type { AssetUrlState } from "~/assets/assetUrls";
import type { ChatImageAttachment } from "~/types";
import { LocalPreviewRelease } from "../useAttachmentPreviewHandoff";
import { formatPictureBytes, PictureNoteNumber } from "./ComposerPictureView";
import { MessageFile } from "./MessageFiles";
import {
  GALLERY_PICTURE_MAX_HEIGHT,
  messagePictureRows,
  attachedPictureSize,
  reservedPictureBox,
  type MessagePictureSegment,
  type PictureSize,
} from "./messagePictures.logic";
import { Button } from "~/components/ui/button";

/**
 * Each stored picture's size, read from its header by the server, so a picture
 * holds its room before its bytes arrive.
 */
export function useMessagePictureDimensions(
  environmentId: EnvironmentId,
  resources: ReadonlyArray<Extract<AssetResource, { readonly _tag: "attachment" }>>,
): ReadonlyMap<string, PictureSize> {
  return useMateImageDimensions(resources.map((resource) => ({ environmentId, resource })));
}

export function MessagePictureBody(props: {
  readonly segments: ReadonlyArray<MessagePictureSegment>;
  readonly dimensions: ReadonlyMap<string, PictureSize>;
  readonly states?: ReadonlyMap<string, AssetUrlState> | undefined;
  readonly onOpen: (image: ChatImageAttachment) => void;
  /** Each placed file's address, by its id, once the server gives one. */
  readonly fileUrls?: ReadonlyMap<string, string> | undefined;
  readonly renderText: (segment: Extract<MessagePictureSegment, { kind: "text" }>) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {messagePictureRows(props.segments).map((row) => {
        if (row.kind === "text") {
          return <Fragment key={`words-after-${row.after}`}>{props.renderText(row)}</Fragment>;
        }
        const gallery = row.items.length > 1;
        return (
          <div
            key={`attachments:${row.items.map((item) => `${item.kind}${item.kind === "text" ? "" : item.n}`).join()}`}
            // Pictures written one after another: side by side, wrapping, each at most 160 px tall.
            className="flex flex-wrap items-start gap-2.5"
            data-gallery={gallery ? "" : undefined}
          >
            {row.items.map((segment) =>
              segment.kind === "picture" ? (
                <MessagePicture
                  key={`picture:${segment.n}`}
                  segment={segment}
                  dimensions={props.dimensions.get(segment.image.id)}
                  state={props.states?.get(segment.image.id)}
                  maxHeight={gallery ? GALLERY_PICTURE_MAX_HEIGHT : undefined}
                  onOpen={props.onOpen}
                />
              ) : segment.kind === "file" ? (
                <MessageFile
                  key={`file:${segment.n}`}
                  file={segment.file}
                  url={props.fileUrls?.get(segment.file.id) ?? null}
                />
              ) : null,
            )}
          </div>
        );
      })}
    </div>
  );
}

function MessagePicture(props: {
  readonly segment: Extract<MessagePictureSegment, { kind: "picture" }>;
  readonly dimensions: PictureSize | undefined;
  readonly state: AssetUrlState | undefined;
  readonly maxHeight: number | undefined;
  readonly onOpen: (image: ChatImageAttachment) => void;
}) {
  const intent = useImageIntent(props.segment.image.previewUrl);
  const releaseLocalPreview = use(LocalPreviewRelease);
  const { segment, dimensions } = props;
  const localPreviewUrl = segment.image.localPreviewUrl;
  const box = reservedPictureBox(segment.image, dimensions, props.maxHeight) ?? {
    width: `min(100%, ${props.maxHeight ?? 300}px)`,
    aspectRatio: "16 / 9",
  };
  const size = attachedPictureSize(segment.image) ?? dimensions;
  const maxHeight = props.maxHeight ?? 300;
  const reservedWidth =
    size === undefined
      ? maxHeight
      : Math.round(Math.min(size.width, (maxHeight * size.width) / size.height));
  return (
    // Each picture where it was put, its notes under it.
    <figure
      className="m-0 flex min-w-0 flex-col gap-2"
      style={{ width: reservedWidth, maxWidth: "100%" }}
    >
      {props.state?._tag === "Failure" ? (
        <ImageUnavailable
          className="block max-h-75 max-w-full rounded-card ring-1 ring-foreground/14 in-data-gallery:max-h-40"
          reason={props.state.reason}
          style={box}
        />
      ) : segment.image.previewUrl ? (
        <Button
          className="block max-w-full cursor-zoom-in"
          variant="bare"
          style={{ width: "100%" }}
          aria-label={`Open picture ${segment.n}`}
          {...intent}
          onClick={() => props.onOpen(segment.image)}
        >
          <AssetImage
            loading="lazy"
            decoding="async"
            className="block max-h-75 max-w-full rounded-card ring-1 ring-foreground/14 in-data-gallery:max-h-40"
            src={segment.image.previewUrl}
            alt={`Picture ${segment.n}`}
            width={size?.width ?? 300}
            height={size?.height ?? 169}
            style={box}
            underlay={localPreviewUrl}
            onReady={localPreviewUrl ? () => releaseLocalPreview(localPreviewUrl) : undefined}
          />
        </Button>
      ) : (
        // Its room, held until its address arrives: nothing moves when it does.
        <span
          className="block max-h-75 max-w-full rounded-card ring-1 ring-foreground/14 in-data-gallery:max-h-40 bg-muted"
          role="img"
          aria-label={`Picture ${segment.n}`}
          style={box}
        />
      )}
      {segment.notes.length > 0 ? (
        <ol
          className="m-0 flex list-none flex-col gap-1 p-0"
          aria-label={`Notes on picture ${segment.n}`}
        >
          {segment.notes.map((note) => (
            <li key={note.number} className="flex items-start gap-2 text-body">
              <PictureNoteNumber className="mt-px">{note.number}</PictureNoteNumber>
              <span>{note.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {segment.original ? (
        <span className="text-line leading-4.5 tabular-nums text-muted-foreground">
          Original kept · {formatPictureBytes(segment.original.sizeBytes)}
        </span>
      ) : null}
    </figure>
  );
}
