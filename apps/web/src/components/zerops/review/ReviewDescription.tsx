/**
 * What a change does, first: the description its author wrote, rendered as the Mate's other words
 * are — Markdown, its pictures in it — or, where it wrote none, what the run that made it said of
 * it; and the way back to that run, where it is known (`reviewDescription`).
 *
 * The description's pictures are attachments of a private repository: each is read as the person
 * from the app's own Gitea (`useGiteaPicture`) and shown from its bytes, holding its room from the
 * first frame (`pictureFrame`), so nothing under it moves when it arrives. One that cannot be read
 * says so quietly, with its words. A picture anywhere else stays a plain link, never read with the
 * person's token. A click opens a picture large, the description's others beside it.
 */
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ChevronLeftIcon, ChevronRightIcon, ImageOffIcon, XIcon } from "lucide-react";
import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import ChatMarkdown, {
  MarkdownPictureContext,
  type MarkdownPicture,
} from "~/components/ChatMarkdown";
import { gatedPortal } from "~/components/ui/portal-gate";
import { useGiteaPicture, type GiteaPictureSource } from "~/zerops/useGiteaPicture";

import {
  absoluteDescription,
  descriptionPicture,
  keyStaysInReview,
  pictureFrame,
  reviewDescription,
} from "./ZeropsReview.logic";
import { ReviewSection, ReviewSkeleton } from "./ZeropsReviewSurface";

const ViewerPortal = gatedPortal(DialogPrimitive.Portal);

/** One picture opened large, among the description's pictures that were read. */
interface PictureView {
  readonly pictures: ReadonlyArray<{ readonly src: string; readonly alt: string }>;
  readonly index: number;
}

export function ReviewDescription({
  description,
  run,
  giteaOrigin,
  pictures,
  onOpenRun,
}: {
  /** The change's description as its author wrote it. */
  readonly description: string | undefined;
  /** What the run that made it said of it, while its conversation is read. */
  readonly run: { readonly words: string | undefined; readonly reading: boolean };
  readonly giteaOrigin: string | undefined;
  /** Where its pictures are read from, as the person. */
  readonly pictures: GiteaPictureSource | undefined;
  /** Opens the run that made it, where one is known. */
  readonly onOpenRun: (() => void) | undefined;
}) {
  const shown = reviewDescription({ description, run });
  if (shown.kind === "none") return null;
  return (
    <ReviewSection
      aside={
        onOpenRun === undefined ? undefined : (
          <button className="rv-link" onClick={onOpenRun} type="button">
            The run that made it
          </button>
        )
      }
      title={shown.kind === "body" ? "Description" : "What it does"}
    >
      {shown.kind === "body" ? (
        <DescriptionBody giteaOrigin={giteaOrigin} pictures={pictures} text={shown.text} />
      ) : shown.kind === "run" ? (
        <p className="rv-words">{shown.words}</p>
      ) : (
        <ReviewSkeleton lines={2} />
      )}
    </ReviewSection>
  );
}

function DescriptionBody({
  text,
  giteaOrigin,
  pictures,
}: {
  readonly text: string;
  readonly giteaOrigin: string | undefined;
  readonly pictures: GiteaPictureSource | undefined;
}) {
  const [view, setView] = useState<PictureView | null>(null);
  const written = useMemo(() => absoluteDescription(text, giteaOrigin), [giteaOrigin, text]);
  const draw = useCallback(
    (picture: MarkdownPicture): ReactNode => (
      <ReviewPicture
        giteaOrigin={giteaOrigin}
        onOpen={setView}
        picture={picture}
        source={pictures}
      />
    ),
    [giteaOrigin, pictures],
  );
  return (
    <div className="rv-desc" data-review-description="">
      <MarkdownPictureContext value={draw}>
        <ChatMarkdown cwd={undefined} text={written} variant="answer" />
      </MarkdownPictureContext>
      {view === null ? null : (
        <PictureViewer
          onClose={() => {
            setView(null);
          }}
          view={view}
        />
      )}
    </div>
  );
}

/** One of the description's pictures: read as the person where it is the Gitea's, a link where not. */
function ReviewPicture({
  picture,
  giteaOrigin,
  source,
  onOpen,
}: {
  readonly picture: MarkdownPicture;
  readonly giteaOrigin: string | undefined;
  readonly source: GiteaPictureSource | undefined;
  readonly onOpen: (view: PictureView) => void;
}) {
  const where = descriptionPicture(picture.uri, giteaOrigin);
  if (where.kind === "elsewhere") {
    return (
      <a className="rv-link" href={where.url} rel="noopener noreferrer" target="_blank">
        {picture.alt.length > 0 ? picture.alt : where.url}
      </a>
    );
  }
  const frame = pictureFrame(picture.width, picture.height);
  const width = Number(picture.width);
  const style = {
    aspectRatio: frame,
    ...(Number.isFinite(width) && width > 0 ? { maxWidth: `${String(width)}px` } : {}),
  };
  if (where.kind === "none") {
    return (
      <span className="rv-pic" data-state="failed" style={style}>
        <PictureMissing alt={picture.alt} />
      </span>
    );
  }
  return (
    <GiteaPicture alt={picture.alt} onOpen={onOpen} source={source} style={style} url={where.url} />
  );
}

function GiteaPicture({
  url,
  alt,
  source,
  style,
  onOpen,
}: {
  readonly url: string;
  readonly alt: string;
  readonly source: GiteaPictureSource | undefined;
  readonly style: React.CSSProperties;
  readonly onOpen: (view: PictureView) => void;
}) {
  const state = useGiteaPicture(source, url);
  // Only a picture seen arriving fades in: one already read stands as it was.
  const [arriving] = useState(state.kind === "reading");
  return (
    <span
      className="rv-pic"
      data-fresh={arriving ? "" : undefined}
      data-state={state.kind}
      style={style}
    >
      {state.kind === "read" ? (
        <button
          aria-label={alt.length > 0 ? `Open ${alt}` : "Open the picture"}
          className="rv-pic-open"
          onClick={(event) => {
            const view = pictureView(event.currentTarget);
            if (view !== null) onOpen(view);
          }}
          type="button"
        >
          <img alt={alt} data-review-picture="" draggable={false} src={state.src} />
        </button>
      ) : state.kind === "failed" ? (
        <PictureMissing alt={alt} />
      ) : null}
    </span>
  );
}

/** A picture that could not be read, said quietly with its own words. */
function PictureMissing({ alt }: { readonly alt: string }) {
  return (
    <span className="rv-pic-missing">
      <ImageOffIcon aria-hidden="true" />
      {alt.length > 0 ? alt : "A picture that could not be read"}
    </span>
  );
}

/** The picture pressed, among every picture of its description that was read. */
function pictureView(button: HTMLElement): PictureView | null {
  const clicked = button.querySelector("img");
  const description = button.closest("[data-review-description]") ?? button;
  const images = [...description.querySelectorAll<HTMLImageElement>("img[data-review-picture]")];
  const index = clicked === null ? -1 : images.indexOf(clicked);
  if (index < 0) return null;
  return {
    pictures: images.map((image) => ({ src: image.src, alt: image.alt })),
    index,
  };
}

/**
 * A picture opened large, over the review: arrows move through the description's pictures, Esc
 * and a press outside close it and only it.
 */
function PictureViewer({
  view,
  onClose,
}: {
  readonly view: PictureView;
  readonly onClose: () => void;
}) {
  const [index, setIndex] = useState(view.index);
  const count = view.pictures.length;
  const picture = view.pictures[index];
  const step = (by: -1 | 1) => {
    setIndex((current) => (current + by + count) % count);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Nothing typed here reaches the review behind it: ⌘↵ never presses its button.
    if (keyStaysInReview(event.key)) event.stopPropagation();
    if (count > 1 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    }
  };
  if (picture === undefined) return null;
  return (
    <DialogPrimitive.Root
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <ViewerPortal>
        <DialogPrimitive.Backdrop className="rv-viewer-backdrop" />
        <DialogPrimitive.Viewport className="rv-viewer">
          <DialogPrimitive.Popup
            aria-label={picture.alt.length > 0 ? picture.alt : "The picture"}
            aria-modal="true"
            className="rv-viewer-popup"
            data-slot="dialog-popup"
            onKeyDown={onKeyDown}
          >
            <img alt={picture.alt} src={picture.src} />
            {picture.alt.length > 0 || count > 1 ? (
              <p className="rv-viewer-words">
                {picture.alt}
                {count > 1 ? (
                  <span>
                    {index + 1} of {count}
                  </span>
                ) : null}
              </p>
            ) : null}
            <DialogPrimitive.Close aria-label="Close" className="rv-viewer-x">
              <XIcon aria-hidden="true" />
            </DialogPrimitive.Close>
            {count > 1 ? (
              <>
                <button
                  aria-label="The picture before"
                  className="rv-viewer-step"
                  data-side="before"
                  onClick={() => {
                    step(-1);
                  }}
                  type="button"
                >
                  <ChevronLeftIcon aria-hidden="true" />
                </button>
                <button
                  aria-label="The picture after"
                  className="rv-viewer-step"
                  data-side="after"
                  onClick={() => {
                    step(1);
                  }}
                  type="button"
                >
                  <ChevronRightIcon aria-hidden="true" />
                </button>
              </>
            ) : null}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </ViewerPortal>
    </DialogPrimitive.Root>
  );
}
