/**
 * A picture where it sits in the composer's text: an 80 px tall thumbnail on a
 * line of its own, with the marks drawn in. Clicking it opens the picture to
 * mark or crop, a drag moves it, its corner removes it. It is a Lexical
 * decorator's content, so it reads what it shows from the composer, by the
 * picture's id.
 */
import { AssetImage } from "~/assets/AssetImage";
import { CircleAlertIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { createContext, use, type KeyboardEvent } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** What the text shows of a picture: everything but the file. */
export interface ComposerPictureView {
  readonly id: string;
  /** Its number among the pictures, in the order they sit. */
  readonly number: number;
  readonly name: string;
  /** The thumbnail: the picture with its marks, or its copy after a reload. */
  readonly src: string | null;
  readonly width: number;
  readonly height: number;
  readonly keepOriginal: boolean;
  /** The copy is being made; the picture cannot go yet. */
  readonly preparing: boolean;
  /** Its upload failed; the corner offers to try again. */
  readonly failed: boolean;
  /** This browser could not keep it for a reload. */
  readonly unsaved?: boolean;
}

export interface ComposerPicturesValue {
  readonly pictures: ReadonlyMap<string, ComposerPictureView>;
  readonly onOpenPicture: (id: string) => void;
  readonly onRemovePicture: (id: string) => void;
  readonly onRetryPicture: (id: string) => void;
}

const NO_PICTURES: ComposerPicturesValue = {
  pictures: new Map(),
  onOpenPicture: () => {},
  onRemovePicture: () => {},
  onRetryPicture: () => {},
};

export const ComposerPicturesContext = createContext<ComposerPicturesValue>(NO_PICTURES);

export function ComposerPicture({ id }: { readonly id: string }) {
  const { pictures, onOpenPicture, onRemovePicture, onRetryPicture } = use(ComposerPicturesContext);
  const picture = pictures.get(id);
  if (!picture) return null;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // The editor listens on its root: keys meant for the picture stop here.
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      onOpenPicture(id);
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation();
      onRemovePicture(id);
    }
  };
  return (
    <span
      className="composer-picture"
      draggable
      data-composer-picture={id}
      data-preparing={picture.preparing ? "true" : undefined}
      data-failed={picture.failed ? "true" : undefined}
    >
      <button
        type="button"
        className="composer-picture-open"
        aria-label={`Picture ${picture.number}, ${picture.name}. Opens it to crop or add notes.`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onOpenPicture(id)}
        onKeyDown={onKeyDown}
      >
        {picture.src ? (
          <AssetImage
            loading="lazy"
            decoding="async"
            className="composer-picture-img"
            src={picture.src}
            alt=""
            draggable={false}
            width={picture.width}
            height={picture.height}
          />
        ) : (
          <span
            className="composer-picture-img"
            style={{ width: picture.width, height: picture.height }}
          />
        )}
      </button>
      {picture.keepOriginal ? <span className="composer-picture-tag">Original</span> : null}
      {picture.unsaved ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                role="img"
                aria-label="Not kept for a reload"
                className="composer-picture-unsaved"
              />
            }
          >
            <CircleAlertIcon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            This browser could not keep the picture, so it would be lost on a reload.
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {picture.failed ? (
        <button
          type="button"
          className="composer-picture-retry"
          aria-label={`Upload picture ${picture.number} again`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onRetryPicture(id)}
        >
          <RotateCcwIcon aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        className="composer-picture-remove"
        tabIndex={-1}
        aria-label={`Remove picture ${picture.number}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onRemovePicture(id)}
      >
        <XIcon aria-hidden="true" />
      </button>
    </span>
  );
}
