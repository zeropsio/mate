import type { UsageReport } from "@t3tools/contracts";
import { InlineButton } from "../ui/button";
import { usageCoverageView } from "./usageCoverage.logic";
export function UsageCoverage({
  report,
  labels,
  now,
  onMate,
}: {
  readonly report: UsageReport;
  readonly labels: ReadonlyMap<string, string>;
  readonly now: number;
  readonly onMate: (mateId: string) => void;
}) {
  const view = usageCoverageView(report, labels, now);
  return (
    <section aria-label="Recording coverage" className="text-xs text-muted-foreground">
      {view.summary ? <p>{view.summary}</p> : null}
      {view.details.length > 0 ? <p>Totals include only recorded activity.</p> : null}
      {view.details.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer">Coverage by Mate</summary>
          <ul className="mt-2 space-y-1">
            {view.details.map((detail) => (
              <li key={detail.id}>
                {detail.mateId === undefined ? (
                  <span className="font-medium">{detail.name}</span>
                ) : (
                  <InlineButton
                    aria-label={`Show usage for ${detail.name}`}
                    onClick={() => onMate(detail.mateId!)}
                  >
                    {detail.name}
                  </InlineButton>
                )}{" "}
                · {detail.text}
              </li>
            ))}
          </ul>
          {report.coverageMore ? (
            <p>
              More Mates are covered than can be listed. Choose a project or Mate to see its
              details.
            </p>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}
