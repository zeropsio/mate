/**
 * What a finished run left, as its result: rows in the card's grid under its
 * worked line, most important first — anything still broken, then what waits
 * for the person, then what runs because of the run with its checks attached
 * (K5). Not pills and not a log: a failure the run came back from, a retry,
 * and what its calls came to are the work's, one click away (K6, K9).
 *
 * A row's mark stands in the card's 28 px column — a state's dot, or a glyph
 * for what the thing is — its words one column in, and its actions on the
 * card's right edge: the pictures its checks took, a blue text action, a way
 * to open what it runs. The rows rise in once, 40 ms apart, when the run
 * finished while the person watched (T5); read later, they are simply there.
 */
import type { TurnId } from "@t3tools/contracts";
import { ArrowUpRightIcon, FileDiffIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";

import { ServiceBrowserLink } from "../ServiceBrowserLink";
import { browserCheckCaption, type OutcomeModel } from "./conversation.logic";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { resultRows, type ResultRow } from "./runResult.logic";

function compactCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);
}

function RowMark({ row }: { readonly row: ResultRow }) {
  return (
    <span
      aria-hidden="true"
      className="run-result-mark"
      data-result-mark={row.mark}
      data-tone={row.tone}
    >
      {row.mark === "dot" ? (
        <span className="run-result-dot" />
      ) : row.mark === "alert" ? (
        <TriangleAlertIcon className="size-4" />
      ) : (
        <FileDiffIcon className="size-4" />
      )}
    </span>
  );
}

function RowSub({ row }: { readonly row: ResultRow }) {
  const { sub } = row;
  if (sub === null) return null;
  if (sub.kind === "text") return <span className="run-result-sub">{sub.text}</span>;
  return (
    <span className="run-result-sub">
      {sub.files === null ? null : `${sub.files === 1 ? "1 file" : `${sub.files} files`} · `}
      <span className="run-result-add">+{compactCount(sub.additions)}</span>{" "}
      <span className="run-result-del">−{compactCount(sub.deletions)}</span>
    </span>
  );
}

function RowEnd({
  row,
  onOpenTurnDiff,
  onOpenImage,
}: {
  readonly row: ResultRow;
  readonly onOpenTurnDiff: (turnId: TurnId) => void;
  readonly onOpenImage: (preview: ExpandedImagePreview) => void;
}) {
  const { action, pictures, url } = row;
  if (pictures.length === 0 && action === null && url === null) return <span />;
  const images = pictures.flatMap((take) =>
    take.screenshot ? [{ src: take.screenshot.src, name: browserCheckCaption(take) }] : [],
  );
  return (
    <span className="run-result-end">
      {pictures.map((take, index) =>
        take.screenshot ? (
          <button
            key={take.key}
            aria-label={`${browserCheckCaption(take)}${take.deviceName ? ` on ${take.deviceName}` : ""}. Open the screenshot`}
            className="run-result-picture"
            data-result-picture
            data-scroll-anchor-ignore
            onClick={() => onOpenImage({ images, index })}
            type="button"
          >
            <img alt="" src={take.screenshot.src} />
          </button>
        ) : null,
      )}
      {action?.kind === "diff" ? (
        <button
          aria-label={`Review the ${row.title}`}
          className="run-result-action"
          data-scroll-anchor-ignore
          onClick={() => onOpenTurnDiff(action.turnId)}
          type="button"
        >
          Review
        </button>
      ) : null}
      {url === null ? null : (
        <ServiceBrowserLink
          aria-label={`Open ${row.title}`}
          className="run-result-open"
          href={url}
          rel="noreferrer"
          showIndicator={false}
          target="_blank"
        >
          <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
        </ServiceBrowserLink>
      )}
    </span>
  );
}

export function TurnReport({
  outcome,
  onOpenTurnDiff,
  onOpenImage,
  settling = false,
}: {
  readonly outcome: OutcomeModel;
  readonly onOpenTurnDiff: (turnId: TurnId) => void;
  readonly onOpenImage: (preview: ExpandedImagePreview) => void;
  /** The person watched the turn run: its result rises in, once. */
  readonly settling?: boolean;
}) {
  const rows = useMemo(() => resultRows(outcome), [outcome]);
  // Once: rows that change later (a merge, a service that stops) never
  // replay the arrival.
  const [rising] = useState(settling);
  if (rows.length === 0) return null;
  return (
    <section aria-label="What this run left" className="run-result" data-turn-report>
      {rows.map((row, index) => (
        <div
          key={row.key}
          className="run-result-row"
          data-result-row={row.group}
          data-rising={rising || undefined}
          data-tall={row.sub !== null || undefined}
          style={rising ? ({ "--row-index": index } as CSSProperties) : undefined}
        >
          <RowMark row={row} />
          <div className="min-w-0">
            <div className="run-result-main">
              <span className="run-result-title" data-broken={row.group === "broken" || undefined}>
                {row.title}
              </span>
              {row.words === null ? null : <span className="run-result-words">{row.words}</span>}
              {row.version === null ? null : (
                <span className="run-result-version">{row.version}</span>
              )}
            </div>
            <RowSub row={row} />
          </div>
          <RowEnd onOpenImage={onOpenImage} onOpenTurnDiff={onOpenTurnDiff} row={row} />
        </div>
      ))}
    </section>
  );
}
