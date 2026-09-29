/**
 * What a change does, first: the description its author wrote, rendered as the Mate's other words
 * are — Markdown, its pictures in it — or, where it wrote none, what the run that made it said of
 * it; and the way back to that run, where it is known (`reviewDescription`).
 *
 * The description's pictures are attachments of a private repository. Each is read as the person
 * through the broker of the app's own Gitea (`useGiteaPicture`, `GiteaClient.picture`): Gitea
 * answers a browser's preflight of `/attachments/{uuid}` with a 303, not its CORS headers
 * (measured on 1.27.2, 2026-09-29), and the broker's `/person/attachments/{uuid}` reads it for
 * the person. Once read it is drawn from its bytes, at most the column's width; a click opens it
 * large, the description's others beside it. Until then, and wherever it cannot be read, it stands
 * as one quiet line — its words, or "Picture", and *Open on Gitea*, where the change's own page
 * shows it. A picture whose description gives its size (zcp writes `<img alt width height src>`)
 * holds that box from the first paint, its line in it (`reviewPictureBox`), so nothing moves when
 * it arrives or when a read fails; one without a size stands as the line alone. A picture
 * anywhere else stays a plain link, never read with the person's token.
 */
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  ArrowUpRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  XIcon,
} from "lucide-react";
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
  reviewDescription,
  reviewPictureBox,
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
  giteaPage,
  pictures,
  onOpenRun,
}: {
  /** The change's description as its author wrote it. */
  readonly description: string | undefined;
  /** The change's own page on Gitea, which shows a picture that cannot be read here. */
  readonly giteaPage: string | undefined;
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
        <DescriptionBody
          giteaOrigin={giteaOrigin}
          giteaPage={giteaPage}
          pictures={pictures}
          text={shown.text}
        />
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
  giteaPage,
  pictures,
}: {
  readonly text: string;
  readonly giteaOrigin: string | undefined;
  readonly giteaPage: string | undefined;
  readonly pictures: GiteaPictureSource | undefined;
}) {
  const [view, setView] = useState<PictureView | null>(null);
  const written = useMemo(() => absoluteDescription(text, giteaOrigin), [giteaOrigin, text]);
  const draw = useCallback(
    (picture: MarkdownPicture): ReactNode => (
      <ReviewPicture
        giteaOrigin={giteaOrigin}
        giteaPage={giteaPage}
        onOpen={setView}
        picture={picture}
        source={pictures}
      />
    ),
    [giteaOrigin, giteaPage, pictures],
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
  giteaPage,
  source,
  onOpen,
}: {
  readonly picture: MarkdownPicture;
  readonly giteaOrigin: string | undefined;
  readonly giteaPage: string | undefined;
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
  if (where.kind === "none") return <PictureLine alt={picture.alt} giteaPage={giteaPage} />;
  return (
    <GiteaPicture
      alt={picture.alt}
      giteaPage={giteaPage}
      height={picture.height}
      onOpen={onOpen}
      source={source}
      url={where.url}
      width={picture.width}
    />
  );
}

function GiteaPicture({
  url,
  alt,
  width,
  height,
  giteaPage,
  source,
  onOpen,
}: {
  readonly url: string;
  readonly alt: string;
  /** Its size as the description gives it, where it does. */
  readonly width: string | number | undefined;
  readonly height: string | number | undefined;
  readonly giteaPage: string | undefined;
  readonly source: GiteaPictureSource | undefined;
  readonly onOpen: (view: PictureView) => void;
}) {
  const state = useGiteaPicture(source, url);
  // Only a picture seen arriving fades in: one already read stands as it was.
  const [arriving] = useState(state.kind === "reading");
  const box = reviewPictureBox(width, height);
  if (box === null && state.kind !== "read") return <PictureLine alt={alt} giteaPage={giteaPage} />;
  return (
    <span
      className="rv-pic"
      data-box={box === null ? undefined : ""}
      data-fresh={arriving && state.kind === "read" ? "" : undefined}
      style={box === null ? undefined : { aspectRatio: box.aspectRatio, width: box.width }}
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
          <img
            alt={alt}
            data-review-picture=""
            draggable={false}
            height={box === null ? undefined : height}
            src={state.src}
            width={box === null ? undefined : width}
          />
        </button>
      ) : (
        <PictureLine alt={alt} giteaPage={giteaPage} />
      )}
    </span>
  );
}

/**
 * A picture not drawn here — being read, or unreadable: its words, and the change's page on
 * Gitea, where it is shown. One line, the same while it is read and after a read failed.
 */
function PictureLine({
  alt,
  giteaPage,
}: {
  readonly alt: string;
  readonly giteaPage: string | undefined;
}) {
  return (
    <span className="rv-pic-line">
      <ImageIcon aria-hidden="true" />
      <span className="rv-pic-alt">{alt.length > 0 ? alt : "Picture"}</span>
      {giteaPage === undefined ? null : (
        <a className="rv-link" href={giteaPage} rel="noopener noreferrer" target="_blank">
          Open on Gitea
          <ArrowUpRightIcon aria-hidden="true" />
        </a>
      )}
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
