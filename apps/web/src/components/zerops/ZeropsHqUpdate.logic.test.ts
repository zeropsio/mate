import { describe, expect, it } from "vite-plus/test";

import { coreLabel, hqUpdateTrigger, hqUpdateWords } from "./ZeropsHqUpdate.logic";

const CARRIED = "20261004T100000Z.0123456789ab";
const OLDER = "20261003T080500Z.ba9876543210";

describe("coreLabel", () => {
  it.each([
    { build: CARRIED, label: "Core 2026-10-04 10:00 UTC · 0123456789ab" },
    { build: "b6e65699e0.20261003T120000", label: "Core b6e65699e0.20261003T120000" },
    { build: "hq-core", label: "Core hq-core" },
    { build: "", label: "an unnamed Core" },
  ])("$build", ({ build, label }) => {
    expect(coreLabel(build)).toBe(label);
  });
});

describe("hqUpdateWords", () => {
  it.each([
    {
      name: "an update on offer",
      state: { kind: "available", running: OLDER, carried: CARRIED } as const,
      words: {
        line: "HQ runs Core 2026-10-03 08:05 UTC · ba9876543210. This app carries Core 2026-10-04 10:00 UTC · 0123456789ab.",
        action: "Update HQ",
      },
    },
    {
      name: "an update under way",
      state: { kind: "updating", target: CARRIED } as const,
      words: {
        line: "HQ is being updated to Core 2026-10-04 10:00 UTC · 0123456789ab.",
        action: null,
      },
    },
    {
      name: "a build under way that names no Core",
      state: { kind: "updating", target: undefined } as const,
      words: { line: "HQ is being updated.", action: null },
    },
    {
      name: "a failed update",
      state: {
        kind: "failed",
        running: OLDER,
        carried: CARRIED,
        reason: "readiness check failed",
      } as const,
      words: {
        line: "HQ's last update failed: readiness check failed. HQ still runs Core 2026-10-03 08:05 UTC · ba9876543210.",
        action: "Update again",
      },
    },
  ])("$name", ({ state, words }) => {
    expect(hqUpdateWords(state, OLDER)).toEqual(words);
  });

  it.each([
    {
      name: "HQ answering with the Core it runs",
      answering: CARRIED,
      line: "HQ runs Core 2026-10-04 10:00 UTC · 0123456789ab. It is up to date.",
    },
    {
      name: "HQ's health not read",
      answering: undefined,
      line: "HQ runs Core 2026-10-04 10:00 UTC · 0123456789ab. It is up to date.",
    },
    {
      name: "a finished deploy HQ does not answer with yet",
      answering: OLDER,
      line: "HQ's update to Core 2026-10-04 10:00 UTC · 0123456789ab finished. Waiting for HQ to answer with it.",
    },
  ])("nothing to offer: $name", ({ answering, line }) => {
    expect(hqUpdateWords({ kind: "current", running: CARRIED }, answering)).toEqual({
      line,
      action: null,
    });
  });
});

describe("hqUpdateTrigger", () => {
  it.each([
    {
      name: "an admin, HQ on an older Core",
      admin: true,
      standing: { kind: "healthy", build: OLDER, parts: { quarantined: [] } },
      carried: CARRIED,
      trigger: "Update available",
    },
    {
      name: "an admin, HQ on a legacy stamp",
      admin: true,
      standing: {
        kind: "healthy",
        build: "b6e65699e0.20261003T120000",
        parts: { quarantined: [] },
      },
      carried: CARRIED,
      trigger: "Update available",
    },
    {
      name: "an admin, HQ serving unchecked",
      admin: true,
      standing: { kind: "unchecked", build: OLDER, parts: { quarantined: [] } },
      carried: CARRIED,
      trigger: "Update available",
    },
    {
      name: "an admin, HQ on this Core",
      admin: true,
      standing: { kind: "healthy", build: CARRIED, parts: { quarantined: [] } },
      carried: CARRIED,
      trigger: "Up to date",
    },
    {
      name: "an admin, HQ unavailable",
      admin: true,
      standing: { kind: "unavailable", since: 1 },
      carried: CARRIED,
      trigger: null,
    },
    {
      name: "an admin, health not read yet",
      admin: true,
      standing: { kind: "unknown" },
      carried: CARRIED,
      trigger: null,
    },
    {
      name: "an admin, this app's Core not read yet",
      admin: true,
      standing: { kind: "healthy", build: OLDER, parts: { quarantined: [] } },
      carried: undefined,
      trigger: null,
    },
    {
      name: "a developer",
      admin: false,
      standing: { kind: "healthy", build: OLDER, parts: { quarantined: [] } },
      carried: CARRIED,
      trigger: null,
    },
  ] as const)("$name", ({ admin, standing, carried, trigger }) => {
    expect(hqUpdateTrigger({ admin, standing, carried })).toBe(trigger);
  });
});
