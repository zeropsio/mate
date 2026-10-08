/**
 * HQ's card in each of its states, drawn from the words `hqCardView` gives it: what everybody reads
 * on the line, what an admin is told is wrong, and what an admin's opened card holds.
 */
import type { HqStructure } from "@t3tools/client-runtime/zerops/hq";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsHqCardView } from "./ZeropsHqCard";
import { hqCardView, type HqCardInput } from "./ZeropsHqCard.logic";

const RUNS = "20261003T080500Z.ba9876543210";

const LINKS: HqStructure = {
  ungrouped: [],
  apps: [
    {
      id: "a1",
      name: "Links",
      projects: [{ projectId: "p1", name: "links", kind: "mate", mate: { face: "" } }],
    },
  ],
};

const card = (overrides: Partial<HqCardInput> = {}, open = false) =>
  renderToStaticMarkup(
    <ZeropsHqCardView
      onOpenChange={() => undefined}
      open={open}
      projectUrl="https://app.zerops.io/project/hq1"
      update={<span data-test-update="true" />}
      view={hqCardView({
        admin: true,
        standing: { kind: "healthy", build: RUNS, parts: { quarantined: [] } },
        services: undefined,
        structure: null,
        online: undefined,
        update: undefined,
        updating: false,
        time: (ms) => `t${String(ms)}`,
        ...overrides,
      })}
    />,
  ).replaceAll("&#x27;", "'");

describe("ZeropsHqCardView — its state", () => {
  it("is HQ alone before HQ's health is read", () => {
    const html = card({ standing: { kind: "unknown" } });
    expect(html).toContain('data-zerops-surface="hq-card"');
    expect(html).toContain('data-hq-state="unknown"');
    expect(html).not.toContain('data-zerops-primitive="status-dot"');
  });

  it("is healthy, with its Core's day, its last backup, what HQ holds and its update on the line", () => {
    const html = card({
      standing: {
        kind: "healthy",
        build: RUNS,
        parts: { quarantined: [], backup: { state: "ok", takenAt: 42 } },
      },
      structure: LINKS,
      online: 1,
    });
    expect(html).toContain('data-hq-state="healthy"');
    expect(html).toContain('data-zerops-status-tone="ok"');
    expect(html).toContain("Healthy");
    expect(html).toContain(">Core 2026-10-03<");
    expect(html).toContain(">Last backup t42<");
    expect(html).toContain("1 project · 1 Mate · 1 online");
    expect(html).toContain('data-test-update="true"');
    expect(html).not.toContain("data-hq-trouble");
  });

  it("reports a failed update separately from the serving HQ's health", () => {
    const html = card({
      update: {
        kind: "read",
        state: { kind: "failed", running: RUNS, carried: RUNS, reason: "Build failed." },
      },
    });
    expect(html).toContain('data-hq-state="healthy"');
    expect(html).toContain("HQ's last update failed: Build failed.");
  });

  const parts = (more: object) =>
    ({
      standing: { kind: "healthy", build: RUNS, parts: { quarantined: [], ...more } },
    }) as Partial<HqCardInput>;
  it.each<[string, Partial<HqCardInput>, string]>([
    ["its database", parts({ db: "down" }), "HQ's database isn't answering."],
    [
      "a repository it withholds",
      { ...parts({ quarantined: ["a1/api"] }), structure: LINKS },
      "Repository Links/api is closed while HQ retries it.",
    ],
    [
      "its backup off",
      parts({ backup: { state: "off" } }),
      "Backup is off: HQ has no backup bucket.",
    ],
    [
      "its backup bucket nearly full",
      parts({
        backup: {
          state: "degraded",
          takenAt: 1,
          usage: { usedBytes: 70e9, neededBytes: 9e9, quotaBytes: 80e9 },
        },
      }),
      "The backup bucket is nearly full: older backups were removed early. 70 of 80 GB used.",
    ],
    [
      "its last backup failed",
      parts({ backup: { state: "failed", reason: "store" } }),
      "The last backup failed: the backup bucket didn't take it.",
    ],
    [
      "its key for deploy tokens",
      parts({ keys: "other_secret" }),
      "Some deploy tokens are sealed under another key: HQ can't deploy with them.",
    ],
    [
      "a service Zerops does not run",
      { services: [{ id: "s1", name: "db", status: "STOPPED" }] },
      "db isn't active in Zerops: Stopped.",
    ],
  ])("needs attention for %s, and says what in a line of its own", (_name, overrides, line) => {
    const html = card(overrides);
    expect(html).toContain('data-hq-state="degraded"');
    expect(html).toContain('data-zerops-status-tone="attention"');
    expect(html).toContain("Needs attention");
    expect(html).toContain(`data-hq-trouble="true">${line}</li>`);
  });

  it("is down since HQ stopped answering, Zerops saying why", () => {
    const html = card({
      standing: { kind: "unavailable", since: 7 },
      services: [{ id: "s1", name: "hq", status: "ACTION_FAILED" }],
    });
    expect(html).toContain('data-hq-state="down"');
    expect(html).toContain('data-zerops-status-tone="failed"');
    expect(html).toContain("Unavailable since t7");
    expect(html).toContain(`data-hq-trouble="true">hq isn't active in Zerops: Action failed.</li>`);
  });

  it("is updating while an update runs, its dot stepping", () => {
    const html = card({ updating: true });
    expect(html).toContain('data-hq-state="updating"');
    expect(html).toContain('data-zerops-status-tone="busy"');

    expect(html).toContain("Updating");
  });
});

describe("ZeropsHqCardView — who reads what", () => {
  it("opens to an admin", () => {
    const html = card();
    expect(html).toContain('aria-expanded="false"');
  });

  it("is the line and what HQ holds to anybody else, and never opens", () => {
    const html = card({
      admin: false,
      standing: { kind: "healthy", build: RUNS, parts: { db: "down", quarantined: [] } },
      services: [{ id: "s1", name: "db", status: "STOPPED" }],
      structure: LINKS,
      online: 1,
    });
    expect(html).toContain("Running");
    expect(html).not.toContain("Healthy");
    expect(html).toContain("1 project · 1 Mate · 1 online");
    expect(html).not.toContain("data-hq-trouble");
    expect(html).not.toContain("aria-expanded");
  });
});

describe("ZeropsHqCardView — opened", () => {
  it("holds the Core HQ runs, its services and the way to it in Zerops; its backup stays on the line", () => {
    const html = card(
      {
        standing: {
          kind: "healthy",
          build: RUNS,
          parts: { quarantined: [], backup: { state: "ok", takenAt: 42 } },
        },
        services: [
          { id: "s1", name: "hq", status: "ACTIVE" },
          { id: "s2", name: "db", status: "ACTIVE" },
        ],
      },
      true,
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Core 2026-10-03 08:05 UTC · ba9876543210");
    expect(html.split("Last backup t42")).toHaveLength(2);
    expect(html).toContain("hq · Active");
    expect(html).toContain("db · Active");
    expect(html).toContain(
      'href="https://app.zerops.io/project/hq1" rel="noreferrer" target="_blank"',
    );
    expect(html).toContain("Open in Zerops");
  });

  it("says where an update stands beside the Core", () => {
    const html = card(
      {
        update: {
          kind: "read",
          state: { kind: "updating", target: "20261004T100000Z.0123456789ab" },
        },
      },
      true,
    );
    expect(html).toContain("HQ is being updated to Core 2026-10-04 10:00 UTC · 0123456789ab.");
  });

  it("holds nothing more while closed", () => {
    expect(card()).not.toContain("Open in Zerops");
  });
});
