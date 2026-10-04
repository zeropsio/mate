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
  it.each([
    {
      name: "runs the carried Core",
      active: `hq-core.${CARRIED}`,
      processes: [build()],
      state: { kind: "current", running: CARRIED },
    },
    {
      name: "runs an older Core",
      active: `hq-core.${OLDER}`,
      processes: [],
      state: { kind: "available", running: OLDER, carried: CARRIED },
    },
    {
      name: "runs its birth's unnamed Core",
      active: "hq-core",
      processes: [],
      state: { kind: "available", running: "hq-core", carried: CARRIED },
    },
    {
      name: "runs a hand deploy's Core",
      active: "hq-b6e65699e0.20261003T120000",
      processes: [],
      state: { kind: "available", running: "hq-b6e65699e0.20261003T120000", carried: CARRIED },
    },
    {
      name: "runs nothing Zerops names",
      active: undefined,
      processes: [],
      state: { kind: "available", running: "", carried: CARRIED },
    },
    {
      name: "is building",
      active: `hq-core.${OLDER}`,
      processes: [build({ status: "RUNNING", appVersion: { name: `hq-core.${CARRIED}` } })],
      state: { kind: "updating", target: CARRIED },
    },
    {
      name: "has a build waiting",
      active: `hq-core.${OLDER}`,
      processes: [build({ status: "PENDING", actionName: "stack.deploy" })],
      state: { kind: "updating", target: undefined },
    },
    {
      name: "failed its newest build",
      active: `hq-core.${OLDER}`,
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
      active: `hq-core.${OLDER}`,
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
      active: `hq-core.${CARRIED}`,
      processes: [build({ status: "FAILED" })],
      state: { kind: "current", running: CARRIED },
    },
    {
      name: "finished after an older build that still reads running",
      active: `hq-core.${OLDER}`,
      processes: [build({ id: "p0", status: "RUNNING", created: "2026-10-03T10:00:00Z" }), build()],
      state: { kind: "available", running: OLDER, carried: CARRIED },
    },
    {
      name: "has another service building",
      active: `hq-core.${OLDER}`,
      processes: [build({ status: "RUNNING", serviceStackIds: ["svc-db"] })],
      state: { kind: "available", running: OLDER, carried: CARRIED },
    },
    {
      name: "is restarting, which is no build",
      active: `hq-core.${OLDER}`,
      processes: [build({ status: "RUNNING", actionName: "stack.restart" })],
      state: { kind: "available", running: OLDER, carried: CARRIED },
    },
  ])("HQ that $name", ({ active, processes, state }) => {
    expect(
      hqUpdateState({
        service: {
          id: "svc-hq",
          ...(active === undefined ? {} : { activeAppVersion: { name: active } }),
        },
        processes,
        carried: CARRIED,
      }),
    ).toEqual(state);
  });
});

function fakeZerops(options: {
  readonly active?: string;
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
          activeAppVersion: { name: options.active ?? `hq-core.${OLDER}` },
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
  return { platform, calls };
}

const CORE = { build: CARRIED, archive: new Uint8Array(3), zeropsYaml: "zerops: []" };

function update(zerops: ReturnType<typeof fakeZerops>) {
  let now = 0;
  return runHqUpdate({
    platform: zerops.platform,
    projectId: "hq-project",
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
      zerops: { active: `hq-core.${CARRIED}` },
      reason: "HQ runs this Core already.",
    },
    {
      name: "when HQ runs a newer Core than this tab carries",
      zerops: { active: "hq-core.20261009T100000Z.ffffffffffff" },
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
