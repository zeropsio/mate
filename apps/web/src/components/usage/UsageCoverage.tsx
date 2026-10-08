import type { UsageReport } from "@t3tools/contracts";
import { usageCoverageView } from "./usageCoverage.logic";
export function UsageCoverage({
  report,
  labels,
  now,
}: {
  readonly report: UsageReport;
  readonly labels: ReadonlyMap<string, string>;
  readonly now: number;
}) {
  const view = usageCoverageView(report, labels, now);
  return (
    <section aria-label="Recording coverage" className="text-xs text-muted-foreground">
      <p>{view.summary}</p>
      {view.details.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer">Coverage by Mate</summary>
          <ul className="mt-2 space-y-1">
            {view.details.map((detail) => (
              <li key={detail.id}>
                <span className="font-medium">{detail.name}</span> · {detail.text}
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
