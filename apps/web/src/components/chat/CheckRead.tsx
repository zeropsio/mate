/**
 * What a browser check read of the page, drawn where its picture would be —
 * the frame of the device it was checked on is never an empty box (the
 * owner, 2026-09-27: "show the structure output or mock in the space where
 * the window would have been"): the page itself, as a wireframe of its
 * headings, text, links, buttons, fields, pictures and list items, scaled the
 * way a picture of it would be; else each thing it asked of the page with the
 * page's answer; else what it found in its errors, console and requests.
 */
import type { ZeropsBrowserRead } from "@t3tools/client-runtime/zerops/model";
import { useMemo } from "react";

import { cn } from "~/lib/utils";
import { pageBlocks, textBlocks, type PageBlock } from "./pageStructure.logic";

type Page = NonNullable<ZeropsBrowserRead["page"]>;

/** How much of its size the page is drawn at: legible on the stage, a sketch in a take's slot. */
const SCALE = { stage: 0.62, thumbnail: 0.14 } as const;

const HEADING_CLASS: Record<number, string> = {
  1: "text-2xl font-semibold",
  2: "text-xl font-semibold",
};

function Block({ block }: { readonly block: PageBlock }) {
  switch (block.kind) {
    case "heading":
      return (
        <p
          className={cn("text-foreground", HEADING_CLASS[block.level] ?? "text-base font-semibold")}
        >
          {block.text}
        </p>
      );
    case "text":
      return <p className="line-clamp-3 text-foreground/80 text-sm">{block.text}</p>;
    case "link":
      return (
        <p className="truncate text-info-foreground text-sm underline underline-offset-2">
          {block.text}
        </p>
      );
    case "button":
      return (
        <p className="w-fit max-w-full truncate rounded-md border border-border px-3 py-1 text-foreground text-sm">
          {block.text}
        </p>
      );
    case "field":
      return (
        <p className="h-8 w-56 max-w-full truncate rounded-md border border-border px-2 text-muted-foreground text-sm leading-8">
          {block.text}
        </p>
      );
    case "image":
      return (
        <p className="flex h-24 w-40 max-w-full items-center justify-center rounded-md bg-foreground/8 px-2 text-center text-muted-foreground text-xs">
          {block.text}
        </p>
      );
    case "item":
      return (
        <p className="flex gap-2 text-foreground/80 text-sm">
          <span aria-hidden="true">•</span>
          <span className="line-clamp-2 min-w-0">{block.text}</span>
        </p>
      );
    case "code":
      return (
        <p className="w-fit max-w-full truncate rounded bg-foreground/8 px-1.5 font-mono text-foreground/80 text-xs">
          {block.text}
        </p>
      );
  }
}

function PageMock({ page, size }: { readonly page: Page; readonly size: keyof typeof SCALE }) {
  const blocks = useMemo(() => {
    const read = page.kind === "tree" ? pageBlocks(page.text) : textBlocks(page.text);
    const seen = new Map<string, number>();
    return read.map((block) => {
      const id = `${block.kind}:${block.text}`;
      const occurrence = seen.get(id) ?? 0;
      seen.set(id, occurrence + 1);
      return { key: `${id}:${occurrence}`, block };
    });
  }, [page]);
  const scale = SCALE[size];
  return (
    <span
      aria-hidden="true"
      className="block size-full overflow-hidden bg-background"
      data-page-mock={size}
    >
      {/* The page at its own size, shrunk as a picture of it would be. */}
      <span
        className="block origin-top-left"
        style={{ width: `${100 / scale}%`, transform: `scale(${scale})` }}
      >
        <span className="flex flex-col gap-2.5 p-5">
          {blocks.map(({ key, block }) => (
            <Block key={key} block={block} />
          ))}
        </span>
      </span>
    </span>
  );
}

/** What it asked of the page, each with the page's answer. */
function Answers({ answers }: { readonly answers: ZeropsBrowserRead["answers"] }) {
  const seen = new Map<string, number>();
  const keyed = answers.map((answer) => {
    const occurrence = seen.get(answer.asked) ?? 0;
    seen.set(answer.asked, occurrence + 1);
    return { key: `${answer.asked}:${occurrence}`, answer };
  });
  return (
    <span className="flex size-full flex-col gap-2 overflow-hidden p-4" data-check-answers>
      {keyed.map(({ key, answer }) => (
        <span
          key={key}
          className="flex min-w-0 items-baseline justify-between gap-3 border-border/60 border-b pb-2"
        >
          <code className="min-w-0 truncate font-mono text-muted-foreground text-xs">
            {answer.asked}
          </code>
          <span className="shrink-0 font-medium text-foreground text-sm">{answer.answer}</span>
        </span>
      ))}
    </span>
  );
}

export function CheckRead({
  read,
  findings,
  failure,
  size = "stage",
}: {
  readonly read: ZeropsBrowserRead | undefined;
  /** What its errors, console and requests came to: "no errors". */
  readonly findings: string | null;
  /** Why the check failed, when it did. */
  readonly failure: string | null;
  readonly size?: keyof typeof SCALE;
}) {
  if (read?.page !== undefined) return <PageMock page={read.page} size={size} />;
  if (read !== undefined && read.answers.length > 0) {
    return size === "stage" ? (
      <Answers answers={read.answers} />
    ) : (
      <span className="truncate px-1 text-3xs text-muted-foreground" data-check-answers>
        {read.answers[0]!.answer}
      </span>
    );
  }
  if (size !== "stage") return null;
  return (
    <span
      className="flex size-full flex-col items-center justify-center gap-1 px-4 text-center"
      data-check-findings
    >
      <span
        className={cn(
          "font-medium text-sm",
          failure !== null ? "text-status-failed-text" : "text-foreground",
        )}
      >
        {failure ??
          (findings === null ? "Checked" : findings.charAt(0).toUpperCase() + findings.slice(1))}
      </span>
      <span className="text-muted-foreground text-xs">Read its errors, console and requests</span>
    </span>
  );
}
