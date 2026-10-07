import { describe, expect, it } from "vite-plus/test";

import type { ActivityProcess } from "../activity/dto.ts";
import { hqUpdateOffered, hqUpdateState } from "./update.ts";

const CARRIED = "20261004T100000Z.0123456789ab";

describe("hqUpdateOffered", () => {
  it.each([
    { name: "the same Core", running: CARRIED, offered: false },
    {
      name: "the same digest, built from an older commit",
      running: "20261001T080000Z.0123456789ab",
      offered: false,
    },
    {
      name: "the same digest, built from a newer commit",
      running: "20261005T080000Z.0123456789ab",
      offered: false,
    },
    {
      name: "another digest from an older commit",
      running: "20261003T100000Z.ba9876543210",
      offered: true,
    },
    {
      name: "another digest from a newer commit",
      running: "20261005T100000Z.ba9876543210",
      offered: false,
    },
    { name: "a legacy stamp", running: "b6e65699e0.20261003T120000", offered: true },
    { name: "a dirty legacy stamp", running: "b6e65699e0-dirty.20261003T120000", offered: true },
    { name: "a bundle nobody stamped", running: "unstamped", offered: true },
    { name: "no stamp at all", running: "", offered: true },
  ])("HQ running $name", ({ running, offered }) => {
    expect(hqUpdateOffered(running, CARRIED)).toBe(offered);
  });

  it.each([
    { name: "carries no Core", carried: "" },
    { name: "carries a legacy stamp", carried: "b6e65699e0.20261003T120000" },
  ])("a web that $name offers nothing", ({ carried }) => {
    expect(hqUpdateOffered("b6e65699e0.20261001T120000", carried)).toBe(false);
  });
});

const OLDER = "20261003T100000Z.ba9876543210";

/** The active version as the service list embeds it, measured on KRLS 2026-10-04: no `name`. */
const ACTIVE = { id: "av-active", status: "ACTIVE", source: "CLI" };

const build = (over: Partial<ActivityProcess> = {}): ActivityProcess => ({
  id: "p1",
  projectId: "hq-project",
  serviceStackIds: ["svc-hq"],
  status: "FINISHED",
  actionName: "stack.build",
  created: "2026-10-04T10:00:00Z",
  ...over,
});

describe("hqUpdateState", () => {
  it("names the Core HQ answers with, though its active version carries no name (KRLS, 2026-10-04)", () => {
    expect(
      hqUpdateState({
        service: {
          id: "svc-hq",
          activeAppVersion: {
            id: "av-0c5",
            status: "ACTIVE",
            source: "CLI",
            created: "2026-10-04T18:00:41Z",
          },
        },
        processes: [],
        carried: "20261004T181300Z.3fdef992e7cb",
        answering: "20261004T175946Z.0c5cc4d71f07",
      }),
    ).toEqual({
      kind: "available",
      running: "20261004T175946Z.0c5cc4d71f07",
      carried: "20261004T181300Z.3fdef992e7cb",
    });
  });

  it.each([
    {
      name: "runs the carried Core",
      answering: CARRIED,
      processes: [build()],
      state: { kind: "current", running: CARRIED },
    },
    {
      name: "runs an older Core",
      answering: OLDER,
      processes: [],
      state: { kind: "available", running: OLDER, carried: CARRIED },
    },
    {
      name: "answers with a legacy stamp",
      answering: "b6e65699e0.20261003T120000",
      processes: [],
      state: { kind: "available", running: "b6e65699e0.20261003T120000", carried: CARRIED },
    },
    {
      name: "is not answering, with nothing Zerops names",
      answering: undefined,
      processes: [],
      state: { kind: "available", running: "", carried: CARRIED },
    },
    {
      name: "is not answering, its active version deployed by a build Zerops still lists",
      answering: undefined,
      processes: [build({ appVersion: { id: "av-active", name: `hq-core.${OLDER}` } })],
      state: { kind: "available", running: OLDER, carried: CARRIED },
    },
    {
      // No id is no match: a build that failed, its version without one, never names what runs.
      name: "is not answering, its active version without an id",
      answering: undefined,
      active: { status: "ACTIVE", source: "CLI" },
      processes: [
        build({ status: "FAILED", failReason: "boom", appVersion: { name: `hq-core.${OLDER}` } }),
      ],
      state: { kind: "failed", running: "", carried: CARRIED, reason: "boom" },
    },
    {
      // HQ's health may name the new Core a few seconds before Zerops ends the build (KRLS).
      name: "already answers with the Core a build still under way deploys",
      answering: CARRIED,
      processes: [build({ status: "RUNNING", appVersion: { name: `hq-core.${CARRIED}` } })],
      state: { kind: "current", running: CARRIED },
    },
    {
      name: "is building",
      answering: OLDER,
      processes: [build({ status: "RUNNING", appVersion: { name: `hq-core.${CARRIED}` } })],
      state: { kind: "updating", target: CARRIED },
    },
    {
      name: "has a build waiting",
      answering: OLDER,
      processes: [build({ status: "PENDING", actionName: "stack.deploy" })],
      state: { kind: "updating", target: undefined },
    },
    {
      name: "failed its newest build",
      answering: OLDER,
      processes: [
        build({ status: "FAILED", failReason: "readiness check failed" }),
        build({ id: "p0", created: "2026-10-03T10:00:00Z" }),
      ],
      state: {
        kind: "failed",
        running: OLDER,
        carried: CARRIED,
        reason: "readiness check failed",
      },
    },
    {
      name: "failed its newest build without a reason",
      answering: OLDER,
      processes: [build({ status: "CANCELED" })],
      state: {
        kind: "failed",
        running: OLDER,
        carried: CARRIED,
        reason: "Zerops did not say why.",
      },
    },
    {
      name: "failed a build but runs the carried Core",
      answering: CARRIED,
      processes: [build({ status: "FAILED" })],
      state: { kind: "current", running: CARRIED },
    },
    {
      name: "finished after an older build that still reads running",
      answering: OLDER,
      processes: [build({ id: "p0", status: "RUNNING", created: "2026-10-03T10:00:00Z" }), build()],
      state: { kind: "available", running: OLDER, carried: CARRIED },
    },
    {
      // Measured on KRLS, 2026-10-04: the build FINISHED while HQ still answered with the old Core.
      name: "finished deploying the carried Core before HQ answers with it",
      answering: OLDER,
      processes: [build({ appVersion: { name: `hq-core.${CARRIED}` } })],
      state: { kind: "current", running: CARRIED },
    },
    {
      name: "finished deploying an older Core than it answers with",
      answering: CARRIED,
      processes: [build({ appVersion: { name: `hq-core.${OLDER}` } })],
      state: { kind: "current", running: CARRIED },
    },
    {
      name: "has another service building",
      answering: OLDER,
      processes: [build({ status: "RUNNING", serviceStackIds: ["svc-db"] })],
      state: { kind: "available", running: OLDER, carried: CARRIED },
    },
    {
      name: "is restarting, which is no build",
      answering: OLDER,
      processes: [build({ status: "RUNNING", actionName: "stack.restart" })],
      state: { kind: "available", running: OLDER, carried: CARRIED },
    },
  ])("HQ that $name", ({ answering, active = ACTIVE, processes, state }) => {
    expect(
      hqUpdateState({
        // As `GET /project/{id}/service-stack` embeds it: no name (KRLS, 2026-10-04).
        service: { id: "svc-hq", activeAppVersion: active },
        processes,
        carried: CARRIED,
        answering,
      }),
    ).toEqual(state);
  });
});
