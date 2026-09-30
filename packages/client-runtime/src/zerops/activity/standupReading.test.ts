import { describe, expect, it } from "vite-plus/test";

import type { ActivityAppVersion, ActivityProcess } from "./dto.ts";
import { type StandupService, readStandup } from "./standupReading.ts";

const SINCE = "2026-09-02T10:00:00.000Z";
const NOW = Date.parse("2026-09-02T10:06:00.000Z");
const at = (minute: number, second = 0) =>
  `2026-09-02T10:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`;

/** Two made-up pairs, a utility that runs code, and a managed service. */
const FRESH: ReadonlyArray<StandupService> = [
  { hostname: "apidev", serviceId: "s-apidev", runtime: true, runsCode: false },
  { hostname: "apistage", serviceId: "s-apistage", runtime: true, runsCode: false },
  { hostname: "webdev", serviceId: "s-webdev", runtime: true, runsCode: false },
  { hostname: "webstage", serviceId: "s-webstage", runtime: true, runsCode: false },
  { hostname: "mailer", serviceId: "s-mailer", runtime: true, runsCode: true },
  { hostname: "db", serviceId: "s-db", runtime: false, runsCode: false },
];

/** After the development call: its dev halves run code. */
const DEVS_UP = FRESH.map((service) =>
  service.hostname.endsWith("dev") ? { ...service, runsCode: true } : service,
);

const BUILDING_COMMANDS: ActivityAppVersion = {
  status: "BUILDING",
  build: { pipelineStart: at(1), startDate: at(1, 30) },
};

function build(
  serviceId: string,
  status: string,
  overrides: Partial<ActivityProcess> = {},
): ActivityProcess {
  return {
    id: `p-${serviceId}-${status}`,
    projectId: "proj",
    serviceStackIds: [serviceId, `${serviceId}-build-helper`],
    status,
    actionName: "stack.build",
    created: at(1),
    started: at(1),
    ...(status === "FINISHED" || status === "FAILED" ? { finished: at(5) } : {}),
    ...overrides,
  };
}

describe("readStandup — each service a stand-up call builds, from the project's processes", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly half: "development" | "stage";
    readonly expected?: ReadonlyArray<string>;
    readonly services: ReadonlyArray<StandupService>;
    readonly processes: ReadonlyArray<ActivityProcess>;
    readonly rows: ReadonlyArray<{ hostname: string; state: string; sentence?: string }>;
    readonly counts: { building: number; built: number; failed: number };
  }> = [
    {
      name: "no build yet: every dev half that runs no code waits, the stages are the next call's",
      half: "development",
      services: FRESH,
      processes: [],
      rows: [
        { hostname: "apidev", state: "waits" },
        { hostname: "webdev", state: "waits" },
      ],
      counts: { building: 0, built: 0, failed: 0 },
    },
    {
      name: "the stage call before its first build: only the stages wait",
      half: "stage",
      services: DEVS_UP,
      processes: [],
      rows: [
        { hostname: "apistage", state: "waits" },
        { hostname: "webstage", state: "waits" },
      ],
      counts: { building: 0, built: 0, failed: 0 },
    },
    {
      name: "the stage call told which stages it builds: those wait, whatever their names",
      half: "stage",
      expected: ["apistage", "preview"],
      services: [
        ...DEVS_UP,
        { hostname: "preview", serviceId: "s-preview", runtime: true, runsCode: false },
      ],
      processes: [],
      rows: [
        { hostname: "apistage", state: "waits" },
        { hostname: "preview", state: "waits" },
      ],
      counts: { building: 0, built: 0, failed: 0 },
    },
    {
      name: "one building: its row says the pipeline's step",
      half: "development",
      services: FRESH,
      processes: [build("s-apidev", "RUNNING", { appVersion: BUILDING_COMMANDS })],
      rows: [
        {
          hostname: "apidev",
          state: "building",
          sentence: "Running build commands from zerops.yml",
        },
        { hostname: "webdev", state: "waits" },
      ],
      counts: { building: 1, built: 0, failed: 0 },
    },
    {
      name: "several building at once",
      half: "development",
      services: FRESH,
      processes: [build("s-apidev", "RUNNING"), build("s-webdev", "PENDING")],
      rows: [
        { hostname: "apidev", state: "building" },
        { hostname: "webdev", state: "building" },
      ],
      counts: { building: 2, built: 0, failed: 0 },
    },
    {
      name: "one built: it runs code now and stays the call's",
      half: "development",
      services: FRESH.map((service) =>
        service.hostname === "apidev" ? { ...service, runsCode: true } : service,
      ),
      processes: [build("s-apidev", "FINISHED"), build("s-webdev", "RUNNING")],
      rows: [
        { hostname: "apidev", state: "built" },
        { hostname: "webdev", state: "building" },
      ],
      counts: { building: 1, built: 1, failed: 0 },
    },
    {
      name: "one failed and the rest go on",
      half: "stage",
      services: DEVS_UP,
      processes: [build("s-apistage", "FAILED"), build("s-webstage", "RUNNING")],
      rows: [
        { hostname: "apistage", state: "failed" },
        { hostname: "webstage", state: "building" },
      ],
      counts: { building: 1, built: 0, failed: 1 },
    },
    {
      name: "all built",
      half: "development",
      services: DEVS_UP,
      processes: [build("s-apidev", "FINISHED"), build("s-webdev", "FINISHED")],
      rows: [
        { hostname: "apidev", state: "built" },
        { hostname: "webdev", state: "built" },
      ],
      counts: { building: 0, built: 2, failed: 0 },
    },
    {
      name: "a service already running code, with no build in the call, is not the call's",
      half: "development",
      services: FRESH.map((service) =>
        service.hostname === "webdev" ? { ...service, runsCode: true } : service,
      ),
      processes: [],
      rows: [{ hostname: "apidev", state: "waits" }],
      counts: { building: 0, built: 0, failed: 0 },
    },
    {
      name: "a build from before the call ended before it: not the call's; one still running is",
      half: "development",
      services: DEVS_UP,
      processes: [
        build("s-apidev", "FINISHED", { created: "2026-09-02T09:50:00.000Z", finished: at(0) }),
        build("s-webdev", "RUNNING", { created: "2026-09-02T09:58:00.000Z" }),
      ],
      rows: [{ hostname: "webdev", state: "building" }],
      counts: { building: 1, built: 0, failed: 0 },
    },
    {
      name: "a service built twice in the call reads its latest build",
      half: "development",
      services: FRESH,
      processes: [
        build("s-apidev", "FAILED", { id: "first", created: at(1) }),
        build("s-apidev", "RUNNING", { id: "second", created: at(3) }),
      ],
      rows: [
        { hostname: "apidev", state: "building" },
        { hostname: "webdev", state: "waits" },
      ],
      counts: { building: 1, built: 0, failed: 0 },
    },
    {
      name: "a process that is no build (a restart) says nothing",
      half: "development",
      services: DEVS_UP,
      processes: [build("s-apidev", "RUNNING", { actionName: "stack.restart" })],
      rows: [],
      counts: { building: 0, built: 0, failed: 0 },
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const reading = readStandup({
        half: testCase.half,
        ...(testCase.expected === undefined ? {} : { expected: testCase.expected }),
        services: testCase.services,
        processes: testCase.processes,
        since: SINCE,
        nowMs: NOW,
      });
      expect(
        reading.rows.map((row) => ({
          hostname: row.hostname,
          state: row.state,
          ...(row.sentence === undefined ? {} : { sentence: row.sentence }),
        })),
      ).toEqual(testCase.rows.map((row) => ({ ...row })));
      expect({
        building: reading.building,
        built: reading.built,
        failed: reading.failed,
      }).toEqual(testCase.counts);
    });
  }

  it("a row carries its build's own span: from its start, until it ended", () => {
    const reading = readStandup({
      half: "development",
      services: FRESH,
      processes: [
        build("s-apidev", "FINISHED", { started: at(1, 5), finished: at(4, 10) }),
        build("s-webdev", "RUNNING", { started: at(2) }),
      ],
      since: SINCE,
      nowMs: NOW,
    });
    expect(reading.rows).toEqual([
      expect.objectContaining({ hostname: "apidev", startedAt: at(1, 5), endedAt: at(4, 10) }),
      expect.objectContaining({ hostname: "webdev", startedAt: at(2) }),
    ]);
    expect(reading.rows[1]).not.toHaveProperty("endedAt");
  });
});
