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
import { useAtomValue } from "@effect/atom-react";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { Fragment, useMemo, type ReactNode } from "react";

import { assetEnvironment } from "~/state/assets";
import type { ChatImageAttachment } from "~/types";
import { formatPictureBytes } from "./ComposerPictureView";
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
  const results = useAtomValue(assetEnvironment.createUrls({ environmentId, resources }));
  return useMemo(() => {
    const dimensions = new Map<string, PictureSize>();
    results.forEach((result, index) => {
      const resource = resources[index];
      if (resource && AsyncResult.isSuccess(result) && result.value.imageDimensions) {
        dimensions.set(resource.attachmentId, result.value.imageDimensions);
      }
    });
    return dimensions;
  }, [resources, results]);
}

export function MessagePictureBody(props: {
  readonly segments: ReadonlyArray<MessagePictureSegment>;
  readonly dimensions: ReadonlyMap<string, PictureSize>;
  readonly onOpen: (image: ChatImageAttachment) => void;
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
            key={`pictures:${row.items.map((item) => (item.kind === "picture" ? item.n : 0)).join()}`}
            className="message-picture-row"
            data-gallery={gallery ? "" : undefined}
          >
            {row.items.map((segment) =>
              segment.kind === "picture" ? (
                <MessagePicture
                  key={`picture:${segment.n}`}
                  segment={segment}
                  dimensions={props.dimensions.get(segment.image.id)}
                  maxHeight={gallery ? GALLERY_PICTURE_MAX_HEIGHT : undefined}
                  onOpen={props.onOpen}
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
  readonly maxHeight: number | undefined;
  readonly onOpen: (image: ChatImageAttachment) => void;
}) {
  const { segment, dimensions } = props;
  const box = reservedPictureBox(segment.image, dimensions, props.maxHeight);
  return (
    <figure className="message-picture">
      {segment.image.previewUrl ? (
        <button
          type="button"
          className="message-picture-open"
          aria-label={`Open picture ${segment.n}`}
          onClick={() => props.onOpen(segment.image)}
        >
          <img
            className="message-picture-img"
            src={segment.image.previewUrl}
            alt={`Picture ${segment.n}`}
            style={box ?? undefined}
          />
        </button>
      ) : box ? (
        // Its room, held until its address arrives: nothing moves when it does.
        <span
          className="message-picture-img message-picture-pending"
          role="img"
          aria-label={`Picture ${segment.n}`}
          style={box}
        />
      ) : (
        <span className="message-picture-original">{segment.image.name}</span>
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
