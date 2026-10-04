import { describe, expect, it } from "vite-plus/test";

import type { ActivityProcess } from "../activity/dto.ts";
import { ZeropsApiError } from "../api.ts";
import { hqUpdateOffered, hqUpdateState, runHqUpdate, type HqUpdatePlatform } from "./update.ts";

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

function fakeZerops(options: {
  readonly answering?: string;
  readonly processes?: ReadonlyArray<ActivityProcess>;
  readonly ends?: string;
}) {
  const calls: Array<string> = [];
  let reads = 0;
  const platform: HqUpdatePlatform = {
    listProjectServices: async (projectId) => {
      calls.push(`services ${projectId}`);
      return [
        { id: "svc-db", name: "db", status: "ACTIVE" },
        {
          id: "svc-hq",
          name: "hq",
          status: "ACTIVE",
          activeAppVersion: ACTIVE,
        },
      ];
    },
    listProjectProcesses: async (projectId) => {
      calls.push(`processes ${projectId}`);
      return options.processes ?? [];
    },
    createAppVersion: async (serviceId, name) => {
      calls.push(`app-version ${serviceId} ${name}`);
      return { id: "av-1" };
    },
    uploadAppVersionArchive: async (id, archive) => {
      calls.push(`upload ${id} ${archive.byteLength}`);
    },
    buildAndDeployAppVersion: async (id, input) => {
      calls.push(`deploy ${id} ${input.setup} ${input.zeropsYaml}`);
      return { processId: "process-1" };
    },
    readProcessStatus: async (processId) => {
      reads += 1;
      calls.push(`process ${processId}`);
      return reads >= 2 ? (options.ends ?? "FINISHED") : "RUNNING";
    },
  };
  return { platform, calls, answering: options.answering ?? OLDER };
}

const CORE = { build: CARRIED, archive: new Uint8Array(3), zeropsYaml: "zerops: []" };

function update(zerops: ReturnType<typeof fakeZerops>) {
  let now = 0;
  return runHqUpdate({
    platform: zerops.platform,
    projectId: "hq-project",
    answering: zerops.answering,
    core: async () => CORE,
    sleep: async (ms) => {
      now += ms;
    },
    now: () => now,
  });
}

describe("runHqUpdate", () => {
  it("deploys the carried Core named after it and follows its process to the end", async () => {
    const zerops = fakeZerops({});
    expect(await update(zerops)).toEqual({ ok: true });
    expect(zerops.calls).toEqual([
      "services hq-project",
      "processes hq-project",
      `app-version svc-hq hq-core.${CARRIED}`,
      "upload av-1 3",
      "deploy av-1 hq zerops: []",
      "process process-1",
      "process process-1",
    ]);
  });

  it.each([
    {
      name: "while Zerops shows HQ building",
      zerops: { processes: [build({ status: "RUNNING" })] },
      reason: "HQ is being updated already. Wait for that update to end.",
    },
    {
      name: "when HQ runs the carried Core",
      zerops: { answering: CARRIED },
      reason: "HQ runs this Core already.",
    },
    {
      name: "when HQ runs a newer Core than this tab carries",
      zerops: { answering: "20261009T100000Z.ffffffffffff" },
      reason: "HQ runs this Core already.",
    },
  ])("deploys nothing $name", async ({ zerops: options, reason }) => {
    const zerops = fakeZerops(options);
    expect(await update(zerops)).toEqual({ ok: false, reason });
    expect(zerops.calls.filter((call) => /^(app-version|upload|deploy)/u.test(call))).toEqual([]);
  });

  it("a deploy that fails says HQ still runs its Core", async () => {
    expect(await update(fakeZerops({ ends: "FAILED" }))).toEqual({
      ok: false,
      reason: `HQ's update failed. HQ still runs ${OLDER}.`,
    });
  });

  it("a deploy that never ends stops following it once, with no retry", async () => {
    const zerops = fakeZerops({ ends: "RUNNING" });
    expect(await update(zerops)).toEqual({
      ok: false,
      reason: "HQ's update took too long. Its build in Zerops says where it stands.",
    });
    expect(zerops.calls.filter((call) => call.startsWith("deploy "))).toHaveLength(1);
  });

  it("Zerops refusing the person says whom to ask", async () => {
    const zerops = fakeZerops({});
    const refused: HqUpdatePlatform = {
      ...zerops.platform,
      createAppVersion: async () => {
        throw new ZeropsApiError("Forbidden", "forbidden", 403);
      },
    };
    expect(
      await runHqUpdate({
        platform: refused,
        projectId: "hq-project",
        answering: OLDER,
        core: async () => CORE,
        sleep: async () => {},
        now: () => 0,
      }),
    ).toEqual({
      ok: false,
      reason: "Zerops refused: you need full access to Headquarters. Ask an organization owner.",
    });
  });
});
