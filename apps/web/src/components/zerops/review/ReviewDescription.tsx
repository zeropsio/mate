/**
 * What a change does, first: the description its Mate wrote, rendered as the Mate's other words
 * are — Markdown, its pictures in it — and the way back to the run that made it, where it is known;
 * where it wrote none, nothing (`reviewDescription`).
 *
 * The description's pictures are the change's own, kept by the organization's HQ. Each is read as
 * the person from HQ's picture projection (`useProjectedHqPicture`). Once read it is drawn from its bytes, at most
 * the column's width; a click opens it large, the description's others beside it. Until then, and
 * wherever it cannot be read, it stands as one quiet line — its words, or "Picture". A picture
 * whose description gives its size (zcp writes `<img alt width height src>`) holds that box from
 * the first paint, its line in it (`reviewPictureBox`), so nothing moves when it arrives or when a
 * read fails; one without a size stands as the line alone. A picture anywhere else stays a plain
 * link, never read with the person's session. A file it names opens in the Git browser at the
 * change's code, on the line it names: the review has no checkout to open it in.
 */
import { useNearViewport } from "../../../hooks/useNearViewport";
import { ImageIcon } from "lucide-react";
import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import ChatMarkdown, {
  MarkdownFileContext,
  MarkdownPictureContext,
  type MarkdownFileElsewhere,
  type MarkdownPicture,
} from "~/components/ChatMarkdown";
import { Button, InlineButton } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  Dialog,
  DialogMediaClose,
  DialogMediaPopup,
  DialogMediaStep,
} from "~/components/ui/dialog";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import { useProjectedHqPicture, type ChangePictureSource } from "~/zerops/useProjectedHqPicture";
import { checkoutPathFor } from "@t3tools/client-runtime/zerops";

import { gitFileLink, useGitLinkProps, type GitRepoAt } from "../gitBrowser/GitBrowserLink";

import {
  absoluteDescription,
  descriptionHeads,
  descriptionPicture,
  keyStaysInReview,
  reviewDescription,
  reviewPictureBox,
} from "./ZeropsReview.logic";
import { ReviewSection, ReviewSkeleton } from "./ZeropsReviewSurface";

/** The section's label, unless the description heads a part of its own with it. */
const WHAT_IT_DOES = "What it does";

/** One picture opened large, among the description's pictures that were read. */
interface PictureView {
  readonly pictures: ReadonlyArray<{ readonly src: string; readonly alt: string }>;
  readonly index: number;
}

/** The commit a change's files are read at, in its repository. */
type ChangeCodeAt = GitRepoAt & { readonly sha: string };

export function ReviewDescription({
  description,
  code,
  reading,
  hqAddress,
  pictures,
  onOpenRun,
}: {
  /** Where a file it names opens; absent, such a file opens nothing. */
  readonly code?: ChangeCodeAt | undefined;
  /** The change's description as its Mate wrote it. */
  readonly description: string | undefined;
  /** The change's record, which may hold its description, is still read. */
  readonly reading: boolean;
  /** The organization's official HQ, which keeps the change's pictures. */
  readonly hqAddress: string | undefined;
  /** Where its pictures are read from, as the person. */
  readonly pictures: ChangePictureSource | undefined;
  /** Opens the run that made it, where one is known. */
  readonly onOpenRun: (() => void) | undefined;
}) {
  // Words once shown stay while the change is read again (a merge reads it anew): the description
  // never gives its place back to a skeleton.
  const [kept, setKept] = useState(description);
  if (description !== undefined && description !== kept) setKept(description);
  const shown = reviewDescription({
    description: description ?? (reading ? kept : undefined),
    reading,
  });
  // A description that was read for and turned out not to exist folds shut: what stood under its
  // lines glides up into their place, never jumps.
  const [was, setWas] = useState(shown.kind);
  const [leaving, setLeaving] = useState(false);
  if (was !== shown.kind) {
    setWas(shown.kind);
    // Less motion: it is simply gone.
    setLeaving(was === "reading" && shown.kind === "none" && !prefersReducedMotion());
  }
  if (shown.kind === "none") {
    return leaving ? (
      <div
        aria-hidden="true"
        className="animate-review-what-folds overflow-hidden [&+*]:animate-review-what-gap"
        onAnimationEnd={() => {
          setLeaving(false);
        }}
      >
        <ReviewSection title={WHAT_IT_DOES}>
          <Card size="sm" variant="inset">
            <ReviewSkeleton lines={2} />
          </Card>
        </ReviewSection>
      </div>
    ) : null;
  }
  return (
    <ReviewSection
      action={
        onOpenRun === undefined ? undefined : (
          <InlineButton onClick={onOpenRun}>The run that made it</InlineButton>
        )
      }
      title={WHAT_IT_DOES}
      // Its own heading says it: the label does not say it twice.
      titleShown={shown.kind !== "body" || !descriptionHeads(shown.text, WHAT_IT_DOES)}
    >
      <Card size="sm" variant="inset">
        {shown.kind === "body" ? (
          <DescriptionBody
            code={code}
            hqAddress={hqAddress}
            pictures={pictures}
            text={shown.text}
          />
        ) : (
          <ReviewSkeleton lines={2} />
        )}
      </Card>
    </ReviewSection>
  );
}

/** A file the description names, its chip a link to it in the Git browser. */
function DescriptionFile({
  at,
  file,
}: {
  readonly at: ChangeCodeAt;
  readonly file: MarkdownFileElsewhere;
}) {
  const link = useGitLinkProps(gitFileLink(at, at.sha, file.path, file.line));
  return (
    <a {...link} className={file.className} data-markdown-copy={file.copyMarkdown}>
      {file.chip}
    </a>
  );
}

function DescriptionBody({
  text,
  code,
  hqAddress,
  pictures,
}: {
  readonly text: string;
  readonly code: ChangeCodeAt | undefined;
  readonly hqAddress: string | undefined;
  readonly pictures: ChangePictureSource | undefined;
}) {
  const [view, setView] = useState<PictureView | null>(null);
  const written = useMemo(() => absoluteDescription(text, hqAddress), [hqAddress, text]);
  const draw = useCallback(
    (picture: MarkdownPicture): ReactNode => (
      <ReviewPicture hqAddress={hqAddress} onOpen={setView} picture={picture} source={pictures} />
    ),
    [hqAddress, pictures],
  );
  const openFile = useCallback(
    (file: MarkdownFileElsewhere): ReactNode =>
      code === undefined ? null : <DescriptionFile at={code} file={file} />,
    [code],
  );
  return (
    <div data-review-description="">
      <MarkdownPictureContext value={draw}>
        <MarkdownFileContext value={code === undefined ? null : openFile}>
          {/* Its paths are the Mate's, written in its checkout of the change's repository. */}
          <ChatMarkdown
            cwd={code === undefined ? undefined : checkoutPathFor(code.repo)}
            text={written}
            variant="answer"
          />
        </MarkdownFileContext>
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

/** One of the description's pictures: read as the person where it is the HQ's, a link where not. */
function ReviewPicture({
  picture,
  hqAddress,
  source,
  onOpen,
}: {
  readonly picture: MarkdownPicture;
  readonly hqAddress: string | undefined;
  readonly source: ChangePictureSource | undefined;
  readonly onOpen: (view: PictureView) => void;
}) {
  const where = descriptionPicture(picture.uri, hqAddress);
  if (where.kind === "elsewhere") {
    return (
      <InlineButton render={<a href={where.url} rel="noopener noreferrer" target="_blank" />}>
        {picture.alt.length > 0 ? picture.alt : where.url}
      </InlineButton>
    );
  }
  if (where.kind === "none") return <PictureLine alt={picture.alt} />;
  return (
    <HqPicture
      alt={picture.alt}
      height={picture.height}
      onOpen={onOpen}
      source={source}
      url={where.url}
      width={picture.width}
    />
  );
}

function HqPicture({
  url,
  alt,
  width,
  height,
  source,
  onOpen,
}: {
  readonly url: string;
  readonly alt: string;
  /** Its size as the description gives it, where it does. */
  readonly width: string | number | undefined;
  readonly height: string | number | undefined;
  readonly source: ChangePictureSource | undefined;
  readonly onOpen: (view: PictureView) => void;
}) {
  const { ref, near } = useNearViewport<HTMLSpanElement>();
  const state = useProjectedHqPicture(source, url, near);
  // Only a picture seen arriving fades in: one already read stands as it was.
  const [arriving] = useState(state.kind === "reading");
  const box = reviewPictureBox(width, height);
  if (box === null && state.kind !== "read")
    return (
      <span ref={ref}>
        <PictureLine alt={alt} />
      </span>
    );
  return (
    <span
      ref={ref}
      // At most the column's width, its own shape; a hairline over it, so a screenshot's white
      // edge still meets the page. One its description sizes holds that box from the first paint
      // (`reviewPictureBox`): its line fills it while it is read or when it cannot be, the picture
      // once read, so nothing moves either way.
      className="relative my-3 block w-fit max-w-full rounded-card after:pointer-events-none after:absolute after:inset-0 after:rounded-card after:ring-1 after:ring-foreground/10 after:ring-inset"
      style={box === null ? undefined : { aspectRatio: box.aspectRatio, width: box.width }}
    >
      {state.kind === "read" ? (
        <Button
          aria-label={alt.length > 0 ? `Open ${alt}` : "Open the picture"}
          className={box === null ? "block" : "block size-full"}
          onClick={(event) => {
            const view = pictureView(event.currentTarget);
            if (view !== null) onOpen(view);
          }}
          variant="bare"
        >
          <img
            loading="lazy"
            decoding="async"
            alt={alt}
            className={
              box === null
                ? arriving
                  ? "block h-auto max-h-[560px] w-auto max-w-full cursor-zoom-in rounded-card motion-safe:animate-zerops-appear"
                  : "block h-auto max-h-[560px] w-auto max-w-full cursor-zoom-in rounded-card"
                : arriving
                  ? "block size-full cursor-zoom-in rounded-card motion-safe:animate-zerops-appear"
                  : "block size-full cursor-zoom-in rounded-card"
            }
            data-review-picture=""
            draggable={false}
            height={box === null ? undefined : height}
            src={state.src}
            width={box === null ? undefined : width}
          />
        </Button>
      ) : (
        <PictureLine alt={alt} fills />
      )}
    </span>
  );
}

/**
 * A picture not drawn here — being read, or unreadable: its words. One line, the same while it is
 * read and after a read failed.
 */
function PictureLine({ alt, fills = false }: { readonly alt: string; readonly fills?: boolean }) {
  return (
    <span
      className={
        fills
          ? "flex h-full min-h-10 items-center gap-2 rounded-card bg-foreground/4 px-3 py-2.5 text-body leading-4.5 text-muted-foreground"
          : "my-2 flex min-h-10 items-center gap-2 rounded-card bg-foreground/4 px-3 py-2.5 text-body leading-4.5 text-muted-foreground"
      }
    >
      <ImageIcon aria-hidden="true" className="size-4 flex-none" />
      <span className="min-w-0 flex-1">{alt.length > 0 ? alt : "Picture"}</span>
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
    // The kit's media dialog does the modal work; the picture, its words and its arrows are the
    // review's, over a press that closes it wherever the picture is not.
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogMediaPopup
        aria-label={picture.alt.length > 0 ? picture.alt : "The picture"}
        onKeyDown={onKeyDown}
      >
        <div className="flex size-full items-center justify-center px-18 py-14">
          <Button
            aria-label="Close the picture"
            className="absolute inset-0"
            onClick={onClose}
            tabIndex={-1}
            variant="bare"
          />
          <div className="relative flex max-h-full max-w-full flex-col items-center gap-3">
            <img
              loading="lazy"
              decoding="async"
              alt={picture.alt}
              className="max-h-[calc(100dvh-160px)] min-h-0 max-w-full rounded-card object-contain shadow-popup"
              src={picture.src}
            />
            {picture.alt.length > 0 || count > 1 ? (
              <p className="flex gap-3 text-body leading-4.5 text-stage-foreground">
                {picture.alt}
                {count > 1 ? (
                  <span className="text-stage-foreground/62 tabular-nums">
                    {index + 1} of {count}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
          <DialogMediaClose />
          {count > 1 ? (
            <>
              <DialogMediaStep
                label="The picture before"
                onClick={() => {
                  step(-1);
                }}
                side="before"
              />
              <DialogMediaStep
                label="The picture after"
                onClick={() => {
                  step(1);
                }}
                side="after"
              />
            </>
          ) : null}
        </div>
      </DialogMediaPopup>
    </Dialog>
  );
}
