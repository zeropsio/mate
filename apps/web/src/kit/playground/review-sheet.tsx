import { useState } from "react";

import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { ZeropsReviewDialog } from "~/components/zerops/review/ZeropsReviewDialog";

import { definePlayground, jsxElement } from "../kitPlayground";

/** How much the sheet holds: a short change, or one long enough that its body scrolls. */
const LENGTHS = ["short", "long"] as const;
const FILES = Array.from(
  { length: 80 },
  (_, index) =>
    `apps/docs/src/pages/changelog/${String(2026 - Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, "0")}.md`,
);

function Opener({
  title,
  line,
  length,
}: {
  readonly title: string;
  readonly line: string;
  readonly length: (typeof LENGTHS)[number];
}) {
  const [open, setOpen] = useState(false);
  // What opened it, held as state: the sheet grows from it once it is drawn.
  const [from, setFrom] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <Button onClick={() => setOpen(true)} ref={setFrom} variant="secondary">
        Review a change
      </Button>
      <ZeropsReviewDialog
        from={from}
        labelledBy="kit-review-play-title"
        onClosed={() => {}}
        onOpenChange={setOpen}
        open={open}
      >
        <ScrollArea scrollFade>
          <div className="flex flex-col gap-2 p-8">
            <h2 className="m-0 font-semibold text-title" id="kit-review-play-title">
              {title}
            </h2>
            <p className="m-0 text-body text-muted-foreground">{line}</p>
            {length === "long" ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 font-mono text-caption">
                {FILES.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </ScrollArea>
      </ZeropsReviewDialog>
    </>
  );
}

export default definePlayground({
  section: "review-sheet",
  name: "ZeropsReviewDialog",
  imports: 'import { ZeropsReviewDialog } from "~/components/zerops/review/ZeropsReviewDialog";',
  controls: {
    title: { kind: "text", note: "the change's title: it labels the sheet" },
    line: { kind: "text", note: "one line under it" },
    length: {
      kind: "enum",
      options: LENGTHS,
      note: "long: taller than the window; the sheet clips, its ScrollArea scrolls",
    },
  },
  initial: {
    title: "Add the changelog page",
    line: "Fen's change to Acme Docs, ready to merge.",
    length: "short",
  },
  render: ({ title, line, length }) => <Opener length={length} line={line} title={title} />,
  jsx: ({ title }) =>
    jsxElement(
      "ZeropsReviewDialog",
      {
        "open={open}": true,
        "onOpenChange={setOpen}": true,
        "onClosed={forget}": true,
        "from={pressed}": true,
        labelledBy: "review-title",
      },
      `<ScrollArea scrollFade>\n  <h2 id="review-title">${title}</h2>\n  …\n</ScrollArea>`,
    ),
  usage: {
    do: [
      "Review and release a change in it: it grows from the press that opened it.",
      "Label it with the change's title (labelledBy).",
      "Scroll what it holds in a ScrollArea: the sheet clips at the window's height.",
      "Press Review a change to open it; Escape steps back a layer before it closes.",
    ],
    dont: [
      "Open it by itself: the person opens a review.",
      "Use it for a form or a question: those are a Dialog.",
    ],
  },
});
