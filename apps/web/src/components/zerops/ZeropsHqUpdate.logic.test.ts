import { hqUpdateState } from "@t3tools/client-runtime/zerops/hq";
import { describe, expect, it } from "vite-plus/test";

import {
  coreLabel,
  hqUpdateMount,
  hqUpdateTrigger,
  hqUpdateTriggerLabel,
  hqUpdateWords,
  type HqUpdateMount,
} from "./ZeropsHqUpdate.logic";

const CARRIED = "20261004T100000Z.0123456789ab";
const OLDER = "20261003T080500Z.ba9876543210";

describe("coreLabel", () => {
  it.each([
    { build: CARRIED, label: "2026-10-04 10:00 UTC · 0123456789ab" },
    { build: "b6e65699e0.20261003T120000", label: "b6e65699e0.20261003T120000" },
    { build: "hq-core", label: "hq-core" },
    { build: "", label: "unnamed" },
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
        line: "HQ runs the version from 2026-10-03 08:05 UTC; this update brings the version from 2026-10-04 10:00 UTC.",
        action: "Update HQ",
      },
    },
    {
      name: "an update under way",
      state: { kind: "updating", target: CARRIED } as const,
      words: {
        line: "HQ is updating to the version from 2026-10-04 10:00 UTC.",
        action: null,
      },
    },
    {
      name: "a build under way that names no Core",
      state: { kind: "updating", target: undefined } as const,
      words: { line: "HQ is updating.", action: null },
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
        line: "HQ's last update failed: readiness check failed. HQ still runs the version from 2026-10-03 08:05 UTC.",
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
      line: "HQ runs the version from 2026-10-04 10:00 UTC. It is up to date.",
    },
    {
      name: "HQ's health not read",
      answering: undefined,
      line: "HQ runs the version from 2026-10-04 10:00 UTC. It is up to date.",
    },
    {
      name: "a finished deploy HQ does not answer with yet",
      answering: OLDER,
      line: "HQ's update to the version from 2026-10-04 10:00 UTC finished. Waiting for HQ to answer with it.",
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
      // HQ serves, but neither its stream nor its health has named its Core yet.
      name: "an admin, HQ's Core not named yet",
      admin: true,
      standing: { kind: "healthy" },
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

  // A stream that names no Core: the running Core is a Zerops fact — the `hq` service's active app
  // version, `hq-core.<identity>`, named by the build that deployed it — read when the card opens.
  const zerops = (running: string) =>
    hqUpdateState({
      service: { id: "svc-hq", activeAppVersion: { id: "av-active", status: "ACTIVE" } },
      processes: [
        {
          id: "p1",
          projectId: "hq-project",
          serviceStackIds: ["svc-hq"],
          status: "FINISHED",
          actionName: "stack.build",
          created: "2026-10-04T10:00:00Z",
          appVersion: { id: "av-active", name: `hq-core.${running}` },
        },
      ],
      carried: CARRIED,
      answering: undefined,
    });
  it.each([
    {
      name: "an admin, Zerops runs an older Core",
      admin: true,
      read: OLDER,
      trigger: "Update available",
    },
    { name: "an admin, Zerops runs this Core", admin: true, read: CARRIED, trigger: "Up to date" },
    { name: "an admin, Zerops not read yet", admin: true, read: undefined, trigger: null },
    { name: "a developer, Zerops runs an older Core", admin: false, read: OLDER, trigger: null },
  ] as const)("a stream naming no Core — $name", ({ admin, read, trigger }) => {
    expect(
      hqUpdateTrigger({
        admin,
        standing: { kind: "healthy" },
        carried: CARRIED,
        zerops: read === undefined ? undefined : zerops(read),
      }),
    ).toBe(trigger);
  });
});

// The rollout, 2026-10-05: an HQ Core update's own switch answered the card's health read 503 once;
// the card said "Unavailable since …" and the Update dialog the owner followed vanished with it.
describe("hqUpdateMount — the update control, mounted through HQ's own switch", () => {
  const HEALTHY = { kind: "healthy", build: OLDER, parts: { quarantined: [] } } as const;
  const DOWN = { kind: "unavailable", since: 1 } as const;
  const SHOWN: HqUpdateMount = { trigger: "Update available", answering: OLDER, carried: CARRIED };

  it.each<[string, Parameters<typeof hqUpdateMount>[0], HqUpdateMount | null]>([
    [
      "HQ healthy: what it answers now",
      { admin: true, standing: HEALTHY, carried: CARRIED, following: false, last: null },
      SHOWN,
    ],
    [
      "HQ healthy, its stream naming no Core: as Zerops says it stands",
      {
        admin: true,
        standing: { kind: "healthy", parts: { quarantined: [] } },
        carried: CARRIED,
        zerops: { kind: "available", running: OLDER, carried: CARRIED },
        following: false,
        last: null,
      },
      { trigger: "Update available", answering: undefined, carried: CARRIED },
    ],
    [
      "HQ not answering while the person follows an update: as it was last shown",
      { admin: true, standing: DOWN, carried: CARRIED, following: true, last: SHOWN },
      SHOWN,
    ],
    [
      "HQ not answering, nobody following: none",
      { admin: true, standing: DOWN, carried: CARRIED, following: false, last: SHOWN },
      null,
    ],
    [
      "HQ not answering, never shown: none",
      { admin: true, standing: DOWN, carried: CARRIED, following: true, last: null },
      null,
    ],
    [
      "a developer: none",
      { admin: false, standing: HEALTHY, carried: CARRIED, following: false, last: null },
      null,
    ],
  ])("%s", (_, input, expected) => {
    expect(hqUpdateMount(input)).toEqual(expected);
  });
});

describe("hqUpdateTriggerLabel", () => {
  it.each([
    ["an update waiting", "Update available", false, "Update HQ"],
    ["HQ current", "Up to date", false, "Up to date"],
    ["an update pressed here running", "Update available", true, "Show progress"],
    [
      "HQ answering with the new version while Zerops still builds",
      "Up to date",
      true,
      "Show progress",
    ],
  ] as const)(
    "HQ's row offers the update, then the way back to its progress, never Up to date beside a running update: %s",
    (_case, trigger, busy, label) => {
      expect(hqUpdateTriggerLabel(trigger, busy)).toBe(label);
    },
  );
});
