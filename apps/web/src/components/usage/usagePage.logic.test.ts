import { describe, expect, it } from "vite-plus/test";
import { USAGE_AUTOMATED_OWNER } from "@t3tools/contracts";
import { AUTOMATED_MATES_OWNER } from "../../zerops/usageEnvironmentIdentities";
import { createUsageIdentityIndex, usagePageState } from "./usagePage.logic";
import { recordedReport, statistics } from "./usageTestFixtures";
const projects = new Map([
  ["a", "Shop"],
  ["b", "Shop"],
]);
describe("Usage claims require scope and source evidence", () => {
  it.each([
    { name: "cold HQ discovery", read: { kind: "reading" }, kind: "reading" },
    {
      name: "partial reports",
      read: { kind: "read", stale: false, report: recordedReport({ state: "partial" }) },
      kind: "partial",
    },
    {
      name: "no completed turn means no recorded data, never an estimate",
      read: {
        kind: "read",
        stale: false,
        report: recordedReport({ totals: statistics("0", "0"), recordedSince: null }),
      },
      kind: "empty",
    },
    {
      name: "refused HQ report",
      read: { kind: "unavailable", reason: "HQ denied access" },
      kind: "unavailable",
    },
    {
      name: "warm reconnect with retained answer",
      read: { kind: "read", stale: true, report: recordedReport() },
      kind: "ready",
    },
    {
      name: "unsupported exact boundary",
      read: {
        kind: "read",
        stale: false,
        report: recordedReport({ state: "unsupported-exact-boundary" }),
      },
      kind: "unavailable",
    },
  ] as const)("$name", ({ read, kind }) =>
    expect(usagePageState({ read, projects, scope: {} }).kind).toBe(kind),
  );
  it("explains ambiguous bookmarks", () =>
    expect(
      usagePageState({ read: { kind: "reading" }, projects, scope: { legacyProject: "Shop" } })
        .message,
    ).toContain("ambiguous"));
  it("a historical scope is read by HQ without requiring a current Mate registration", () =>
    expect(
      usagePageState({
        read: { kind: "read", report: recordedReport(), stale: false },
        projects: new Map(),
        scope: { project: "deleted-app" },
      }).kind,
    ).toBe("ready"));
});

describe("Automated work is its own line", () => {
  it("HQ's automated owner reads as the Automated Mates, with the Mate's project for its tasks", () => {
    const report = recordedReport();
    const { identities } = createUsageIdentityIndex({
      report: {
        ...report,
        coverage: report.coverage.map((entry) => ({
          ...entry,
          ownerUserId: USAGE_AUTOMATED_OWNER,
        })),
      },
      registered: new Map(),
      people: new Map(),
      projects: new Map([["app-a", "Tea Shop"]]),
    });
    expect([...identities.values()]).toEqual([
      {
        mateName: "A",
        projectId: "app-a",
        projectName: "Tea Shop",
        ownerState: "known",
        owner: AUTOMATED_MATES_OWNER,
        mateProjectId: "project-a",
      },
    ]);
  });
});
