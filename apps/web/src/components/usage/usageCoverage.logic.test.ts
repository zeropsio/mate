import { describe, expect, it } from "vite-plus/test";
import { usageCoverageView } from "./usageCoverage.logic";
import { recordedReport } from "./usageTestFixtures";
const now = Date.parse("2026-10-08T12:00:00.000Z");
describe("Recorded coverage is human and quiet until requested", () => {
  it("Recorded since Oct 8 · 2 Mates haven't reported yet", () => {
    const coverage = Array.from({ length: 30 }, (_, i) => ({
      ...(i < 28 ? { originId: `origin-${i}` } : {}),
      mateId: `mate-${i}`,
      label: `Mate ${i}`,
      deleted: false,
      value: {
        state: i < 28 ? ("partial" as const) : ("unknown" as const),
        since: i < 28 ? "2026-10-08T10:00:00.000Z" : null,
        through: null,
        gaps: i < 28 ? ["before-first-recorded-turn", "codex-resumed-turns-unavailable"] : [],
      },
    }));
    const view = usageCoverageView(
      recordedReport({
        recordedSince: "2026-10-08T10:00:00.000Z",
        coverage: [...coverage, { ...coverage[0]!, originId: "codex-0" }],
      }),
      new Map(),
      now,
    );
    expect(view.summary).toBe("Recorded since Oct 8 · 2 Mates haven't reported yet");
    expect(view.details).toHaveLength(30);
    expect(view.details[0]!.text).toContain("First recorded 2 hours ago");
    expect(view.details[28]!.text).toBe("Hasn't reported usage yet.");
    expect(JSON.stringify(view)).not.toMatch(
      /2026-10-08T|transcript|pricing cached|before-first-recorded-turn|codex-resumed/,
    );
  });
  it.each([
    { name: "no turns", since: null, expected: "No recorded usage yet" },
    { name: "recorded turns", since: "2026-10-08T10:00:00.000Z", expected: "Recorded since Oct 8" },
  ])("$name does not infer silence as missing participation", ({ since, expected }) => {
    const view = usageCoverageView(
      recordedReport({ recordedSince: since, coverage: [] }),
      new Map(),
      now,
    );
    expect(view.summary).toBe(expected);
  });
  it("deleted Mates retain evidence without being counted as waiting to report", () => {
    const row = recordedReport().coverage[0]!;
    const view = usageCoverageView(
      recordedReport({
        coverage: [
          {
            ...row,
            deleted: true,
            value: { state: "unknown", since: null, through: null, gaps: [] },
          },
        ],
      }),
      new Map(),
      now,
    );
    expect(view.summary).not.toContain("haven't reported");
    expect(view.details[0]!.text).toContain("Deleted Mate");
  });
});
