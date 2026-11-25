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

import { Button } from "../ui/button";
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
    // 80 px tall on the control radius, its edge a hairline that lights under the pointer and when
    // picked; amber when its upload did not go through. Dragged, it fades where it stood.
    <span
      className="group/picture relative block w-fit max-w-full rounded-control data-dragging:opacity-35"
      draggable
      data-composer-picture={id}
      data-preparing={picture.preparing ? "true" : undefined}
      data-failed={picture.failed ? "true" : undefined}
    >
      <Button
        className="group/press block"
        variant="bare"
        aria-label={`Picture ${picture.number}, ${picture.name}. Opens it to crop or add notes.`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onOpenPicture(id)}
        onKeyDown={onKeyDown}
      >
        {picture.src ? (
          <AssetImage
            loading="lazy"
            decoding="async"
            className="block h-20 max-w-full rounded-control bg-muted object-cover outline-1 outline-foreground/14 transition-[box-shadow,outline-color] duration-150 ease-out-strong group-hover/press:ring-4 group-hover/press:ring-ring/20 in-data-composer-chip-selected:outline-2 in-data-composer-chip-selected:outline-ring group-data-failed/picture:outline-2 group-data-failed/picture:outline-warning"
            src={picture.src}
            alt=""
            draggable={false}
            width={picture.width}
            height={picture.height}
          />
        ) : (
          <span
            className="block h-20 max-w-full rounded-control bg-muted object-cover outline-1 outline-foreground/14 transition-[box-shadow,outline-color] duration-150 ease-out-strong group-hover/press:ring-4 group-hover/press:ring-ring/20 in-data-composer-chip-selected:outline-2 in-data-composer-chip-selected:outline-ring group-data-failed/picture:outline-2 group-data-failed/picture:outline-warning"
            style={{ width: picture.width, height: picture.height }}
          />
        )}
      </Button>
      {/* Over the picture, on the stage's dark ground: the untouched file goes along. */}
      {picture.keepOriginal ? (
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 h-4.5 rounded-mark bg-stage/66 px-1.5 text-caption leading-4.5 font-medium text-stage-foreground">
          Original
        </span>
      ) : null}
      {picture.unsaved ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                role="img"
                aria-label="Not kept for a reload"
                className="absolute top-1.5 left-1.5 flex rounded-mark bg-popover p-0.5 text-warning-foreground [&_svg]:size-3"
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
        <span className="absolute right-1.5 bottom-1.5 flex">
          <Button
            variant="secondary"
            size="icon-2xs"
            shape="round"
            aria-label={`Upload picture ${picture.number} again`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onRetryPicture(id)}
          >
            <RotateCcwIcon aria-hidden="true" className="text-warning-foreground" />
          </Button>
        </span>
      ) : null}
      {/* Remove on its top corner, shown with hover or focus, always under a finger. */}
      <span className="absolute -top-2 -right-2 flex opacity-0 transition-opacity duration-150 ease-out-strong group-focus-within/picture:opacity-100 group-hover/picture:opacity-100 pointer-coarse:opacity-100">
        <Button
          variant="secondary"
          size="icon-2xs"
          shape="round"
          tabIndex={-1}
          aria-label={`Remove picture ${picture.number}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onRemovePicture(id)}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </span>
    </span>
  );
}
