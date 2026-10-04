import { describe, expect, it } from "vite-plus/test";

import { coreLabel, hqUpdateWords, offersHqUpdate } from "./ZeropsHqUpdate.logic";

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
    {
      name: "nothing to offer",
      state: { kind: "current", running: CARRIED } as const,
      words: { line: "HQ is up to date.", action: null },
    },
  ])("$name", ({ state, words }) => {
    expect(hqUpdateWords(state)).toEqual(words);
  });
});

describe("offersHqUpdate", () => {
  it.each([
    {
      name: "an admin, HQ on an older Core",
      admin: true,
      standing: { kind: "healthy", build: OLDER },
      carried: CARRIED,
      offered: true,
    },
    {
      name: "an admin, HQ on a legacy stamp",
      admin: true,
      standing: { kind: "healthy", build: "b6e65699e0.20261003T120000" },
      carried: CARRIED,
      offered: true,
    },
    {
      name: "an admin, HQ serving unchecked",
      admin: true,
      standing: { kind: "unchecked", build: OLDER },
      carried: CARRIED,
      offered: true,
    },
    {
      name: "an admin, HQ on this Core",
      admin: true,
      standing: { kind: "healthy", build: CARRIED },
      carried: CARRIED,
      offered: false,
    },
    {
      name: "an admin, HQ unavailable",
      admin: true,
      standing: { kind: "unavailable", since: 1 },
      carried: CARRIED,
      offered: false,
    },
    {
      name: "an admin, health not read yet",
      admin: true,
      standing: { kind: "unknown" },
      carried: CARRIED,
      offered: false,
    },
    {
      // HQ serves, but neither its stream nor its health has named its Core yet.
      name: "an admin, HQ's Core not named yet",
      admin: true,
      standing: { kind: "healthy" },
      carried: CARRIED,
      offered: false,
    },
    {
      name: "an admin, this app's Core not read yet",
      admin: true,
      standing: { kind: "healthy", build: OLDER },
      carried: undefined,
      offered: false,
    },
    {
      name: "a developer",
      admin: false,
      standing: { kind: "healthy", build: OLDER },
      carried: CARRIED,
      offered: false,
    },
  ] as const)("$name", ({ admin, standing, carried, offered }) => {
    expect(offersHqUpdate({ admin, standing, carried })).toBe(offered);
  });
});
