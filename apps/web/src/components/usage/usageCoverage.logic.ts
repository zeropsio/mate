import type { UsageReport } from "@t3tools/contracts";
import { formatDayShort } from "@t3tools/shared/usageFormat";
const relative = new Intl.RelativeTimeFormat("en", { numeric: "always" });
function ago(at: string, now: number) {
  const seconds = (Date.parse(at) - now) / 1000;
  if (Math.abs(seconds) < 60) return "just now";
  if (Math.abs(seconds) < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86400) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86400), "day");
}
/** Coverage comes from the report, including authorized Mates with no recorded origin. */
export function usageCoverageView(
  report: UsageReport,
  labels: ReadonlyMap<string, string>,
  now: number,
) {
  const mates = new Map<string, UsageReport["coverage"][number][]>();
  for (const source of report.coverage) {
    const id = source.mateId ?? source.originId;
    if (id === undefined) continue;
    mates.set(id, [...(mates.get(id) ?? []), source]);
  }
  let waiting = 0;
  const details = [...mates].map(([id, sources]) => {
    const first = sources[0]!;
    const dates = sources
      .flatMap((source) => (source.value.since === null ? [] : [source.value.since]))
      .sort();
    const unreported = sources.every((source) => source.originId === undefined && !source.deleted);
    if (unreported) waiting++;
    const text = [
      first.deleted ? "Deleted Mate; its recorded usage is retained." : null,
      unreported
        ? "No usage from this Mate is recorded in this report."
        : dates[0] === undefined
          ? "Recording start is unknown."
          : `First recorded ${ago(dates[0], now)}.`,
      sources.some((source) => source.value.gaps.includes("before-first-recorded-turn"))
        ? "Activity before recording began is excluded."
        : null,
      sources.some((source) => source.value.gaps.includes("codex-resumed-turns-unavailable"))
        ? "Usage from resumed Codex threads is unavailable."
        : null,
    ]
      .filter((value) => value !== null)
      .join(" ");
    return {
      id,
      mateId: first.mateId,
      name: labels.get(id) ?? first.label ?? "Unnamed Mate",
      text,
    };
  });
  const since = report.recordedSince;
  const summary = [
    since == null ? null : `Recorded since ${formatDayShort(since.slice(0, 10))}`,
    waiting === 0
      ? null
      : `${waiting}${report.coverageMore ? "+" : ""} ${waiting === 1 ? "Mate has" : "Mates have"} no recorded usage`,
  ]
    .filter((value) => value !== null)
    .join(" · ");
  return { summary, details };
}
