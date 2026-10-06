import type { ZeropsService } from "@t3tools/client-runtime/zerops";
import type { HqStructure } from "@t3tools/client-runtime/zerops/hq";
import { describe, expect, it } from "vite-plus/test";

import { hqCardView, type HqCardInput } from "./ZeropsHqCard.logic";

const RUNS = "20261003T080500Z.ba9876543210";
const CARRIED = "20261004T100000Z.0123456789ab";

const LINKS: HqStructure = {
  ungrouped: [],
  apps: [{ id: "a1", name: "Links", projects: [] }],
};

const service = (name: string, status: string, isSystem = false): ZeropsService => ({
  id: `s-${name}`,
  name,
  status,
  isSystem,
});

/** An admin's view of a healthy HQ with nothing else read. */
const input = (overrides: Partial<HqCardInput> = {}): HqCardInput => ({
  admin: true,
  standing: { kind: "healthy", build: RUNS, parts: { quarantined: [] } },
  services: undefined,
  structure: null,
  online: undefined,
  update: undefined,
  updating: false,
  time: (ms) => `t${String(ms)}`,
  ...overrides,
});

describe("hqCardView — the headline", () => {
  it.each<[string, Partial<HqCardInput>, ReturnType<typeof hqCardView>["state"]]>([
    ["before HQ's health is read", { standing: { kind: "unknown" } }, null],
    ["HQ answering as the official HQ", {}, { kind: "healthy", tone: "ok", word: "Healthy" }],
    [
      "HQ not answering as the official HQ",
      { standing: { kind: "unavailable", since: 7 } },
      { kind: "down", tone: "failed", word: "Unavailable since t7" },
    ],
    // Serving inside HQ's grace: no outage, but not all is well either.
    [
      "HQ serving while it cannot check Zerops",
      { standing: { kind: "unchecked", build: RUNS, parts: { quarantined: [] } } },
      { kind: "degraded", tone: "attention", word: "Can't check Zerops right now" },
    ],
    [
      "an admin's HQ with something wrong",
      { standing: { kind: "healthy", build: RUNS, parts: { db: "down", quarantined: [] } } },
      { kind: "degraded", tone: "attention", word: "Needs attention" },
    ],
    // Whoever cannot act on it is told whether HQ serves, nothing more.
    [
      "a developer's HQ with something wrong",
      {
        admin: false,
        standing: { kind: "healthy", build: RUNS, parts: { db: "down", quarantined: [] } },
      },
      { kind: "healthy", tone: "ok", word: "Running" },
    ],
    [
      "an update this tab runs",
      { updating: true },
      { kind: "updating", tone: "busy", word: "Updating" },
    ],
    [
      "an update another started, as the opened card read it",
      { update: { kind: "read", state: { kind: "updating", target: CARRIED } } },
      { kind: "updating", tone: "busy", word: "Updating" },
    ],
    [
      "an update while HQ does not answer",
      { updating: true, standing: { kind: "unavailable", since: 7 } },
      { kind: "down", tone: "failed", word: "Unavailable since t7" },
    ],
  ])("%s", (_name, overrides, state) => {
    expect(hqCardView(input(overrides)).state).toEqual(state);
  });
});

describe("hqCardView — what an admin is told is wrong", () => {
  const parts = (more: object) =>
    ({
      standing: { kind: "healthy", build: RUNS, parts: { quarantined: [], ...more } },
    }) as Partial<HqCardInput>;
  it.each<[string, Partial<HqCardInput>, ReadonlyArray<string>]>([
    ["nothing", parts({ db: "up", keys: "ok" }), []],
    ["its database not answering", parts({ db: "down" }), ["HQ's database isn't answering."]],
    [
      "a repository it withholds, by its project's name",
      { ...parts({ quarantined: ["a1/api"] }), structure: LINKS },
      ["Repository Links/api is closed while HQ retries it."],
    ],
    [
      "repositories it withholds, one in a project the viewer does not see",
      { ...parts({ quarantined: ["a1/api", "a9/web"] }), structure: LINKS },
      ["2 repositories are closed while HQ retries them: Links/api, web."],
    ],
    [
      "no backup bucket",
      parts({ backup: { state: "off" } }),
      ["Backup is off: HQ has no backup bucket."],
    ],
    [
      "a backup that cost an older one the retention keeps",
      parts({
        backup: {
          state: "degraded",
          takenAt: 1,
          usage: { usedBytes: 70e9, neededBytes: 9e9, quotaBytes: 80e9 },
        },
      }),
      ["The backup bucket is nearly full: older backups were removed early. 70 of 80 GB used."],
    ],
    [
      "a backup refused for the bucket's room",
      parts({
        backup: {
          state: "failed",
          reason: "quota",
          usage: { usedBytes: 78e9, neededBytes: 9.4e9, quotaBytes: 80e9 },
        },
      }),
      [
        "The last backup failed: the backup bucket is full. 78 of 80 GB used; a backup needs 9.4 GB.",
      ],
    ],
    [
      "a backup refused for a repository HQ withholds",
      {
        ...parts({
          quarantined: ["a1/api"],
          backup: { state: "failed", reason: "repo_quarantined", repo: "a1/api" },
        }),
        structure: LINKS,
      },
      [
        "Repository Links/api is closed while HQ retries it.",
        "The last backup failed: repository Links/api is closed.",
      ],
    ],
    [
      "a backup refused before it began: its dump might not restore",
      parts({ backup: { state: "failed", reason: "pg_dump_older" } }),
      ["The last backup failed: HQ's backup tool is older than its database."],
    ],
    [
      "a backup that failed for a reason only HQ's log tells",
      parts({ backup: { state: "failed", reason: "digest_mismatch" } }),
      ["The last backup failed. HQ's log in Zerops says why."],
    ],
    [
      "a backup the bucket did not take",
      parts({ backup: { state: "failed", reason: "store" } }),
      ["The last backup failed: the backup bucket didn't take it."],
    ],
    [
      "a backup its database did not answer",
      parts({ backup: { state: "failed", reason: "database" } }),
      ["The last backup failed: HQ's database didn't answer."],
    ],
    // HQ refuses every stage or production deploy it cannot open a token for (`apps/hq/src/deploys.ts`).
    [
      "no key for deploy tokens",
      parts({ keys: "no_secret" }),
      ["HQ has no key for its deploy tokens, so it can't deploy stages or production."],
    ],
    [
      "a key for deploy tokens that is no key",
      parts({ keys: "bad_secret" }),
      ["HQ's key for its deploy tokens is broken, so it can't deploy stages or production."],
    ],
    // After a restore onto an HQ with another key.
    [
      "deploy tokens sealed under another key",
      parts({ keys: "other_secret" }),
      ["Some deploy tokens are sealed under another key: HQ can't deploy with them."],
    ],
    [
      "a service of HQ's Zerops does not run",
      {
        services: [
          service("hq", "ACTIVE"),
          service("db", "STOPPED"),
          service("core", "FAILED", true),
        ],
      },
      ["db isn't active in Zerops: Stopped."],
    ],
    // Down, what Zerops says of HQ's services is what tells why.
    [
      "a service that does not run while HQ does not answer",
      { standing: { kind: "unavailable", since: 7 }, services: [service("hq", "ACTION_FAILED")] },
      ["hq isn't active in Zerops: Action failed."],
    ],
  ])("%s", (_name, overrides, troubles) => {
    expect(hqCardView(input(overrides)).troubles).toEqual(troubles);
  });
});

describe("hqCardView — HQ's services, as Zerops says them", () => {
  const services = [
    service("hq", "ACTIVE"),
    service("db", "STOPPED"),
    service("vol", "UPGRADING"),
    service("backup", "ACTION_FAILED"),
    service("core", "ACTIVE", true),
  ];
  it("to an admin, each with its dot and its word; the system's left out", () => {
    expect(hqCardView(input({ services })).services).toEqual([
      { name: "hq", tone: "ok", word: "Active" },
      { name: "db", tone: "off", word: "Stopped" },
      { name: "vol", tone: "busy", word: "Upgrading" },
      { name: "backup", tone: "failed", word: "Action failed" },
    ]);
  });
});

describe("hqCardView — what HQ holds", () => {
  const mate = { face: "" };
  const STRUCTURE: HqStructure = {
    ungrouped: [{ projectId: "p4", name: "Loose", mate }],
    apps: [
      {
        id: "a1",
        name: "Links",
        projects: [
          { projectId: "p1", name: "links", kind: "mate", mate },
          { projectId: "p2", name: "links-stage", kind: "stage", mate: null },
        ],
      },
      { id: "a2", name: "Shop", projects: [{ projectId: "p3", name: "shop", kind: "mate", mate }] },
    ],
  };
  it.each<[string, Partial<HqCardInput>, string | null]>([
    ["nothing known of its structure", {}, null],
    [
      "its projects and Mates, and those online",
      { structure: STRUCTURE, online: 2 },
      "2 projects · 3 Mates · 2 online",
    ],
    // Remembered, none of them is live: no word of who is online.
    [
      "one of each, their presence not live",
      { structure: { ungrouped: [], apps: [STRUCTURE.apps[1]!] }, online: undefined },
      "1 project · 1 Mate",
    ],
    [
      "a project whose Mate fact is unknown",
      {
        structure: {
          ungrouped: [],
          apps: [
            {
              id: "a1",
              name: "Links",
              projects: [{ projectId: "p1", name: "links", kind: "mate", mate: undefined }],
            },
          ],
        },
      },
      "1 project · Mates unknown",
    ],
  ])("%s", (_name, overrides, counts) => {
    expect(hqCardView(input(overrides)).counts).toBe(counts);
  });
});

describe("hqCardView — the Core HQ runs and its last backup", () => {
  it.each<[string, Partial<HqCardInput>, Pick<ReturnType<typeof hqCardView>, "core" | "backup">]>([
    [
      "an admin's, the newest backup kept",
      {
        standing: {
          kind: "healthy",
          build: RUNS,
          parts: { quarantined: [], backup: { state: "ok", takenAt: 42 } },
        },
      },
      { core: "Core 2026-10-03 08:05 UTC · ba9876543210", backup: "Last backup t42" },
    ],
    [
      "an admin's, before HQ's first backup",
      {
        standing: {
          kind: "healthy",
          build: RUNS,
          parts: { quarantined: [], backup: { state: "pending" } },
        },
      },
      { core: "Core 2026-10-03 08:05 UTC · ba9876543210", backup: "No backup yet" },
    ],
    // A failed or switched-off backup is a trouble line's to say.
    [
      "an admin's, the last backup failed",
      {
        standing: {
          kind: "healthy",
          build: RUNS,
          parts: { quarantined: [], backup: { state: "failed", reason: "store" } },
        },
      },
      { core: "Core 2026-10-03 08:05 UTC · ba9876543210", backup: null },
    ],
    [
      "an admin's, HQ not answering",
      { standing: { kind: "unavailable", since: 7 } },
      { core: null, backup: null },
    ],
    ["a developer's", { admin: false }, { core: null, backup: null }],
  ])("%s", (_name, overrides, rows) => {
    const view = hqCardView(input(overrides));
    expect({ core: view.core, backup: view.backup }).toEqual(rows);
  });
});

describe("hqCardView — HQ's builds, as the opened card read them", () => {
  it.each<
    [string, Partial<HqCardInput>, Pick<ReturnType<typeof hqCardView>, "coreNote" | "troubles">]
  >([
    ["not read", {}, { coreNote: null, troubles: [] }],
    [
      "an update under way",
      { update: { kind: "read", state: { kind: "updating", target: CARRIED } } },
      {
        coreNote: "HQ is being updated to Core 2026-10-04 10:00 UTC · 0123456789ab.",
        troubles: [],
      },
    ],
    [
      "this tab's own update, before anything is read",
      { updating: true },
      { coreNote: "HQ is being updated.", troubles: [] },
    ],
    // No hidden retry: the read failed, and says so.
    [
      "a read that failed",
      { update: { kind: "failed", reason: "Zerops could not be reached." } },
      {
        coreNote: "Couldn't read HQ from Zerops: Zerops could not be reached.",
        troubles: [],
      },
    ],
    [
      "HQ's last update failed",
      {
        update: {
          kind: "read",
          state: {
            kind: "failed",
            running: RUNS,
            carried: CARRIED,
            reason: "Readiness check failed.",
          },
        },
      },
      {
        coreNote: null,
        troubles: [
          "HQ's last update failed: Readiness check failed. HQ still runs Core 2026-10-03 08:05 UTC · ba9876543210.",
        ],
      },
    ],
  ])("%s", (_name, overrides, rows) => {
    const view = hqCardView(input(overrides));
    expect({ coreNote: view.coreNote, troubles: view.troubles }).toEqual(rows);
  });
});

describe("hqCardView — whether the card opens", () => {
  it.each<[string, Partial<HqCardInput>, boolean]>([
    ["an admin's, HQ's health read", {}, true],
    ["an admin's, HQ not answering", { standing: { kind: "unavailable", since: 7 } }, true],
    ["an admin's, before HQ's health is read", { standing: { kind: "unknown" } }, false],
    ["a developer's: the line and what HQ holds", { admin: false }, false],
  ])("%s", (_name, overrides, opens) => {
    expect(hqCardView(input(overrides)).opens).toBe(opens);
  });
});

describe("hqCardView — the Core on the header line, the day it was committed", () => {
  const runs = (build: string) =>
    ({ standing: { kind: "healthy", build, parts: { quarantined: [] } } }) as Partial<HqCardInput>;
  it.each<[string, Partial<HqCardInput>, string | null]>([
    ["an admin's", {}, "Core 2026-10-03"],
    [
      "an admin's, a legacy stamp",
      runs("b6e65699e0.20261003T120000"),
      "Core b6e65699e0.20261003T120000",
    ],
    ["an admin's, a Core HQ names no build of", runs(""), null],
    ["an admin's, HQ not answering", { standing: { kind: "unavailable", since: 7 } }, null],
    ["a developer's", { admin: false }, null],
  ])("%s", (_name, overrides, coreDay) => {
    expect(hqCardView(input(overrides)).coreDay).toBe(coreDay);
  });
});
