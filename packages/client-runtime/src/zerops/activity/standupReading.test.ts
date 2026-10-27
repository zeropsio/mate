import { describe, expect, it } from "vite-plus/test";

import type { ActivityAppVersion, ActivityProcess } from "./dto.ts";
import { type StandupReading, type StandupService, readStandup } from "./standupReading.ts";

const SINCE = "2026-09-02T10:00:00.000Z";
const NOW = Date.parse("2026-09-02T10:06:00.000Z");
const at = (minute: number, second = 0) =>
  `2026-09-02T10:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`;

type Group = StandupService["group"];

function service(
  hostname: string,
  group: Group,
  status: string,
  runsCode = status === "ACTIVE" && group === "runtimes",
): StandupService {
  return { hostname, serviceId: `s-${hostname}`, group, runsCode, status };
}

/**
 * A made-up environment as the arrival leaves it: three data services up, a
 * mail catcher that keeps its own public build, two pairs that run no code
 * yet, the Mate's own container and a build container of the platform's.
 */
const FRESH: ReadonlyArray<StandupService> = [
  service("apidev", "runtimes", "READY_TO_DEPLOY"),
  service("apistage", "runtimes", "READY_TO_DEPLOY"),
  service("db", "data", "ACTIVE"),
  service("mailer", "runtimes", "ACTIVE"),
  service("cache", "data", "ACTIVE"),
  service("webdev", "runtimes", "READY_TO_DEPLOY"),
  service("webstage", "runtimes", "READY_TO_DEPLOY"),
  service("files", "data", "ACTIVE"),
  service("mate", "infrastructure", "ACTIVE", true),
  service("build-apidev", "infrastructure", "STOPPED"),
];

/** After the development call: its dev halves run code. */
const DEVS_UP = FRESH.map((entry) =>
  entry.hostname.endsWith("dev") && entry.group === "runtimes"
    ? { ...entry, runsCode: true, status: "ACTIVE" }
    : entry,
);

/** What the development call stands up around its runtimes, as the arrival left it. */
const DEV_AROUND = [
  { hostname: "db", state: "up" },
  { hostname: "cache", state: "up" },
  { hostname: "files", state: "up" },
  { hostname: "mailer", state: "up" },
] as const;

/** What the stage call stands up around its runtimes: the data they share. */
const STAGE_AROUND = [
  { hostname: "db", state: "up" },
  { hostname: "cache", state: "up" },
  { hostname: "files", state: "up" },
] as const;

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
    readonly rows: ReadonlyArray<{
      hostname: string;
      state: string;
      sentence?: string;
      note?: string;
      reason?: string;
    }>;
    readonly counts: { building: number; up: number; failed: number };
  }> = [
    {
      name: "just started: the data and the utility up, every dev half that runs no code waits",
      half: "development",
      services: FRESH,
      processes: [],
      rows: [
        ...DEV_AROUND,
        { hostname: "apidev", state: "waits" },
        { hostname: "webdev", state: "waits" },
      ],
      counts: { building: 0, up: 4, failed: 0 },
    },
    {
      name: "one building: its row says the pipeline's step",
      half: "development",
      services: FRESH,
      processes: [build("s-apidev", "RUNNING", { appVersion: BUILDING_COMMANDS })],
      rows: [
        ...DEV_AROUND,
        {
          hostname: "apidev",
          state: "building",
          sentence: "Running build commands from zerops.yml",
        },
        { hostname: "webdev", state: "waits" },
      ],
      counts: { building: 1, up: 4, failed: 0 },
    },
    {
      name: "several building at once",
      half: "development",
      services: FRESH,
      processes: [build("s-apidev", "RUNNING"), build("s-webdev", "PENDING")],
      rows: [
        ...DEV_AROUND,
        { hostname: "apidev", state: "building" },
        { hostname: "webdev", state: "building" },
      ],
      counts: { building: 2, up: 4, failed: 0 },
    },
    {
      name: "one runtime up: its build finished, the other still builds",
      half: "development",
      services: FRESH.map((entry) =>
        entry.hostname === "apidev" ? { ...entry, runsCode: true, status: "ACTIVE" } : entry,
      ),
      processes: [build("s-apidev", "FINISHED"), build("s-webdev", "RUNNING")],
      rows: [
        ...DEV_AROUND,
        { hostname: "apidev", state: "up" },
        { hostname: "webdev", state: "building" },
      ],
      counts: { building: 1, up: 5, failed: 0 },
    },
    {
      name: "all up",
      half: "development",
      services: DEVS_UP,
      processes: [build("s-apidev", "FINISHED"), build("s-webdev", "FINISHED")],
      rows: [
        ...DEV_AROUND,
        { hostname: "apidev", state: "up" },
        { hostname: "webdev", state: "up" },
      ],
      counts: { building: 0, up: 6, failed: 0 },
    },
    {
      name: "a data service still starting builds, in its own word",
      half: "development",
      services: FRESH.map((entry) =>
        entry.hostname === "files" ? { ...entry, status: "CREATING" } : entry,
      ),
      processes: [],
      rows: [
        { hostname: "db", state: "up" },
        { hostname: "cache", state: "up" },
        { hostname: "files", state: "building", sentence: "Starting" },
        { hostname: "mailer", state: "up" },
        { hostname: "apidev", state: "waits" },
        { hostname: "webdev", state: "waits" },
      ],
      counts: { building: 1, up: 3, failed: 0 },
    },
    {
      name: "a utility still on its own public build, begun before the call, builds",
      half: "development",
      services: FRESH.map((entry) =>
        entry.hostname === "mailer"
          ? { ...entry, runsCode: false, status: "READY_TO_DEPLOY" }
          : entry,
      ),
      processes: [build("s-mailer", "RUNNING", { created: "2026-09-02T09:58:00.000Z" })],
      rows: [
        { hostname: "db", state: "up" },
        { hostname: "cache", state: "up" },
        { hostname: "files", state: "up" },
        { hostname: "mailer", state: "building" },
        { hostname: "apidev", state: "waits" },
        { hostname: "webdev", state: "waits" },
      ],
      counts: { building: 1, up: 3, failed: 0 },
    },
    {
      name: "a failed data service and a stopped utility say so",
      half: "development",
      services: FRESH.map((entry) =>
        entry.hostname === "cache"
          ? { ...entry, status: "SERVICE_ACTION_FAILED" }
          : entry.hostname === "mailer"
            ? { ...entry, status: "STOPPED" }
            : entry,
      ),
      processes: [],
      rows: [
        { hostname: "db", state: "up" },
        { hostname: "cache", state: "failed" },
        { hostname: "files", state: "up" },
        { hostname: "mailer", state: "waits", note: "stopped" },
        { hostname: "apidev", state: "waits" },
        { hostname: "webdev", state: "waits" },
      ],
      counts: { building: 0, up: 2, failed: 1 },
    },
    {
      name: "the stage call before its first build: the data, and the stages wait",
      half: "stage",
      services: DEVS_UP,
      processes: [],
      rows: [
        ...STAGE_AROUND,
        { hostname: "apistage", state: "waits" },
        { hostname: "webstage", state: "waits" },
      ],
      counts: { building: 0, up: 3, failed: 0 },
    },
    {
      name: "the stage call told which stages it builds: those, whatever their names",
      half: "stage",
      expected: ["apistage", "preview"],
      services: [...DEVS_UP, service("preview", "runtimes", "READY_TO_DEPLOY")],
      processes: [],
      rows: [
        ...STAGE_AROUND,
        { hostname: "apistage", state: "waits" },
        { hostname: "preview", state: "waits" },
      ],
      counts: { building: 0, up: 3, failed: 0 },
    },
    {
      name: "one stage failed and the rest go on: the platform's reason on its row",
      half: "stage",
      services: DEVS_UP,
      processes: [
        build("s-apistage", "FAILED", { failReason: "Build commands exited 1" }),
        build("s-webstage", "RUNNING"),
      ],
      rows: [
        ...STAGE_AROUND,
        { hostname: "apistage", state: "failed", reason: "Build commands exited 1" },
        { hostname: "webstage", state: "building" },
      ],
      counts: { building: 1, up: 3, failed: 1 },
    },
    {
      name: "a dev half named like its stage's stem (api beside apistage) is a runtime of development",
      half: "development",
      services: [
        service("api", "runtimes", "READY_TO_DEPLOY"),
        service("apistage", "runtimes", "READY_TO_DEPLOY"),
        service("db", "data", "ACTIVE"),
      ],
      processes: [],
      rows: [
        { hostname: "db", state: "up" },
        { hostname: "api", state: "waits" },
      ],
      counts: { building: 0, up: 1, failed: 0 },
    },
    {
      name: "a stage with no partner is of neither half; one a build of the call names is the call's",
      half: "stage",
      services: [...DEVS_UP, service("docsstage", "runtimes", "READY_TO_DEPLOY")],
      processes: [build("s-mailer", "RUNNING")],
      rows: [
        ...STAGE_AROUND,
        { hostname: "apistage", state: "waits" },
        { hostname: "mailer", state: "building" },
        { hostname: "webstage", state: "waits" },
      ],
      counts: { building: 1, up: 3, failed: 0 },
    },
    {
      name: "a dev half already running code, with no build in the call, is up",
      half: "development",
      services: FRESH.map((entry) =>
        entry.hostname === "webdev" ? { ...entry, runsCode: true, status: "ACTIVE" } : entry,
      ),
      processes: [],
      rows: [
        ...DEV_AROUND,
        { hostname: "apidev", state: "waits" },
        { hostname: "webdev", state: "up" },
      ],
      counts: { building: 0, up: 5, failed: 0 },
    },
    {
      name: "a build that ended before the call is not the call's: its service stands as it is",
      half: "development",
      services: DEVS_UP,
      processes: [
        build("s-apidev", "FINISHED", { created: "2026-09-02T09:50:00.000Z", finished: at(0) }),
        build("s-webdev", "RUNNING", { created: "2026-09-02T09:58:00.000Z" }),
      ],
      rows: [
        ...DEV_AROUND,
        { hostname: "apidev", state: "up" },
        { hostname: "webdev", state: "building" },
      ],
      counts: { building: 1, up: 5, failed: 0 },
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
        ...DEV_AROUND,
        { hostname: "apidev", state: "building" },
        { hostname: "webdev", state: "waits" },
      ],
      counts: { building: 1, up: 4, failed: 0 },
    },
    {
      name: "a process that is no build (a restart) says nothing: the halves stand as they are",
      half: "development",
      services: DEVS_UP,
      processes: [build("s-apidev", "RUNNING", { actionName: "stack.restart" })],
      rows: [
        ...DEV_AROUND,
        { hostname: "apidev", state: "up" },
        { hostname: "webdev", state: "up" },
      ],
      counts: { building: 0, up: 6, failed: 0 },
    },
  ];

  it.each(Array.from(cases, (testCase) => ({ title: testCase.name, testCase })))(
    "$title",
    ({ testCase }) => {
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
          ...(row.note === undefined ? {} : { note: row.note }),
          ...(row.reason === undefined ? {} : { reason: row.reason }),
        })),
      ).toEqual(testCase.rows.map((row) => ({ ...row })));
      expect({
        building: reading.building,
        up: reading.up,
        failed: reading.failed,
      }).toEqual(testCase.counts);
    },
  );

  it("a row's start never moves later: a queued build counts from when it was made", () => {
    const { started: _started, ...pending } = build("s-apidev", "PENDING", { created: at(1) });
    const queued = readStandup({
      half: "development",
      services: FRESH,
      processes: [pending],
      since: SINCE,
      nowMs: NOW,
    });
    const started = readStandup({
      half: "development",
      services: FRESH,
      processes: [build("s-apidev", "RUNNING", { created: at(1), started: at(2) })],
      since: SINCE,
      nowMs: NOW,
    });
    const apidev = (reading: StandupReading) =>
      reading.rows.find((row) => row.hostname === "apidev");
    expect(apidev(queued)?.startedAt).toBe(at(1));
    expect(apidev(started)?.startedAt).toBe(at(1));
  });

  it("a row carries its build's own span: from its start, until it ended", () => {
    const reading = readStandup({
      half: "development",
      services: FRESH,
      processes: [
        build("s-apidev", "FINISHED", { created: at(1, 5), finished: at(4, 10) }),
        build("s-webdev", "RUNNING", { created: at(2) }),
      ],
      since: SINCE,
      nowMs: NOW,
    });
    const runtimes = reading.rows.filter((row) => row.hostname.endsWith("dev"));
    expect(runtimes).toEqual([
      expect.objectContaining({ hostname: "apidev", startedAt: at(1, 5), endedAt: at(4, 10) }),
      expect.objectContaining({ hostname: "webdev", startedAt: at(2) }),
    ]);
    expect(runtimes[1]).not.toHaveProperty("endedAt");
  });
});
