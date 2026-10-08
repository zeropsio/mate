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
import { Fragment, type ReactNode } from "react";

import type { AssetUrlState } from "~/assets/assetUrls";
import type { ChatImageAttachment } from "~/types";
import { formatPictureBytes } from "./ComposerPictureView";
import { MessageFile } from "./MessageFiles";
import {
  GALLERY_PICTURE_MAX_HEIGHT,
  messagePictureRows,
  reservedPictureBox,
  type MessagePictureSegment,
  type PictureSize,
} from "./messagePictures.logic";

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
    <div className="message-pictures">
      {messagePictureRows(props.segments).map((row) => {
        if (row.kind === "text") {
          return <Fragment key={`words-after-${row.after}`}>{props.renderText(row)}</Fragment>;
        }
        const gallery = row.items.length > 1;
        return (
          <div
            key={`attachments:${row.items.map((item) => `${item.kind}${item.kind === "text" ? "" : item.n}`).join()}`}
            className="message-picture-row"
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
  const { segment, dimensions } = props;
  const box = reservedPictureBox(segment.image, dimensions, props.maxHeight) ?? {
    width: `min(100%, ${props.maxHeight ?? 300}px)`,
    aspectRatio: "16 / 9",
  };
  const size =
    segment.image.width !== undefined && segment.image.height !== undefined
      ? { width: segment.image.width, height: segment.image.height }
      : dimensions;
  const maxHeight = props.maxHeight ?? 300;
  const reservedWidth =
    size === undefined
      ? maxHeight
      : Math.round(Math.min(size.width, (maxHeight * size.width) / size.height));
  return (
    <figure className="message-picture" style={{ width: reservedWidth, maxWidth: "100%" }}>
      {props.state?._tag === "Failure" ? (
        <ImageUnavailable className="message-picture-img" reason={props.state.reason} style={box} />
      ) : segment.image.previewUrl ? (
        <button
          type="button"
          className="message-picture-open"
          style={{ width: "100%" }}
          aria-label={`Open picture ${segment.n}`}
          {...intent}
          onClick={() => props.onOpen(segment.image)}
        >
          <AssetImage
            loading="lazy"
            decoding="async"
            className="message-picture-img"
            src={segment.image.previewUrl}
            alt={`Picture ${segment.n}`}
            width={segment.image.width ?? dimensions?.width ?? 300}
            height={segment.image.height ?? dimensions?.height ?? 169}
            style={box}
          />
        </button>
      ) : (
        // Its room, held until its address arrives: nothing moves when it does.
        <span
          className="message-picture-img message-picture-pending"
          role="img"
          aria-label={`Picture ${segment.n}`}
          style={box}
        />
      )}
      {segment.notes.length > 0 ? (
        <ol className="message-picture-notes" aria-label={`Notes on picture ${segment.n}`}>
          {segment.notes.map((note) => (
            <li key={note.number}>
              <span className="picture-note-badge" aria-hidden="true">
                {note.number}
              </span>
              <span>{note.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {segment.original ? (
        <span className="message-picture-original">
          Original kept · {formatPictureBytes(segment.original.sizeBytes)}
        </span>
      ) : null}
    </figure>
  );
}
