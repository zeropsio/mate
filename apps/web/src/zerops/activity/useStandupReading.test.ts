import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { describe, expect, it } from "vite-plus/test";

import {
  settledStandupReading,
  standupBuildsDone,
  standupExpected,
  standupReadingFor,
} from "./useStandupReading";

const standup = (overrides: Partial<ZeropsOperation>): ZeropsOperation => ({
  key: "op:s",
  kind: "standup",
  phase: "done",
  anchorAt: "2026-09-02T10:00:00.000Z",
  anchorActivityId: "s",
  turnId: "t1",
  subject: "development",
  kicker: "Stand-up · development",
  voice: "Standing development up.",
  voiceSource: "mate",
  statusWord: "Stood up",
  steps: [],
  links: [],
  callIds: ["s"],
  hasResult: true,
  ...overrides,
});

const step = (label: string, state: ZeropsOperation["steps"][number]["state"]) => ({
  id: label,
  label,
  state,
  stateLabel: state,
});

describe("settledStandupReading — a settled call's services, as its report said them", () => {
  it("reads each service the call built, never a stage it queued for the next call", () => {
    const reading = settledStandupReading(
      standup({
        steps: [
          step("apidev", "done"),
          { ...step("apistage", "queued"), stateLabel: "Next" },
          step("webdev", "failed"),
          step("shopdev", "running"),
        ],
      }),
    );
    expect(reading.rows).toEqual([
      { hostname: "apidev", state: "up" },
      { hostname: "webdev", state: "failed" },
      { hostname: "shopdev", state: "building" },
    ]);
    expect({ up: reading.up, failed: reading.failed }).toEqual({ up: 1, failed: 1 });
  });

  it("reads a stage held back as waiting on what did not stand up, never as failed", () => {
    const reading = settledStandupReading(
      standup({
        subject: "stage",
        phase: "failed",
        steps: [
          step("apistage", "failed"),
          {
            ...step("webstage", "queued"),
            stateLabel: "Waits",
            note: "apistage did not stand up",
          },
        ],
      }),
    );
    expect(reading.rows).toEqual([
      { hostname: "apistage", state: "failed" },
      { hostname: "webstage", state: "waits", note: "apistage did not stand up" },
    ]);
    expect(reading.failed).toBe(1);
  });
});

describe("standupExpected — the services a running call builds, when the report before it named them", () => {
  it.each([
    { name: "the first call: not named", steps: [], expected: undefined },
    {
      name: "the stage call: the stages the call before it queued",
      steps: [
        { ...step("apistage", "queued"), stateLabel: "Next" },
        { ...step("webstage", "queued"), stateLabel: "Next" },
      ],
      expected: ["apistage", "webstage"],
    },
  ])("$name", ({ steps, expected }) => {
    expect(standupExpected(standup({ phase: "running", steps }))).toEqual(expected);
  });
});

describe("standupReadingFor — a settled call never changes once it has settled", () => {
  const SINCE = "2026-09-02T10:00:00.000Z";
  const ENDED = "2026-09-02T10:06:00.000Z";
  const before = "2026-09-02T09:50:00.000Z";
  type Service = Parameters<typeof standupReadingFor>[1]["services"] & object;
  const service = (
    hostname: string,
    group: "data" | "runtimes",
    status: string,
    runsCode: boolean,
    createdAt = before,
  ): Service[number] => ({
    hostname,
    serviceId: `s-${hostname}`,
    group,
    runsCode,
    status,
    createdAt,
  });
  // As the call found them: data and a mail catcher up, two pairs to deploy.
  const atStart = [
    service("db", "data", "ACTIVE", false),
    service("mailer", "runtimes", "ACTIVE", true),
    service("apidev", "runtimes", "READY_TO_DEPLOY", false),
    service("apistage", "runtimes", "READY_TO_DEPLOY", false),
    service("webdev", "runtimes", "READY_TO_DEPLOY", false),
    service("webstage", "runtimes", "READY_TO_DEPLOY", false),
  ];
  // The day after: the db failed, apidev stopped, a service was added.
  const today = [
    service("db", "data", "ACTION_FAILED", false),
    service("mailer", "runtimes", "ACTIVE", true),
    service("apidev", "runtimes", "STOPPED", true),
    service("apistage", "runtimes", "READY_TO_DEPLOY", false),
    service("webdev", "runtimes", "ACTIVE", true),
    service("webstage", "runtimes", "READY_TO_DEPLOY", false),
    service("newdev", "runtimes", "READY_TO_DEPLOY", false, "2026-09-03T08:00:00.000Z"),
  ];
  const built = (serviceId: string) => ({
    id: `p-${serviceId}`,
    projectId: "proj",
    serviceStackIds: [serviceId],
    status: "FINISHED",
    actionName: "stack.build",
    created: "2026-09-02T10:01:00.000Z",
    finished: "2026-09-02T10:05:00.000Z",
  });
  const read = (reading: ReturnType<typeof standupReadingFor>) =>
    reading?.rows.map((row) => `${row.hostname} ${row.state}`);

  it("a watched call keeps its services across its settling: all up, as the call left them", () => {
    const watched = standupReadingFor(standup({ phase: "running", steps: [] }), {
      services: atStart,
      processes: [built("s-apidev"), built("s-webdev")],
      nowMs: Date.parse(ENDED),
    });
    const settled = standupReadingFor(
      standup({ settledAt: ENDED, steps: [step("apidev", "done"), step("webdev", "done")] }),
      { services: today, nowMs: Date.parse("2026-09-03T10:00:00.000Z") },
    );
    expect(read(watched)).toEqual(["db up", "mailer up", "apidev up", "webdev up"]);
    expect(read(settled)).toEqual(read(watched));
  });

  it("a failed call: its runtimes as it reported them, the rest not checked", () => {
    const settled = standupReadingFor(
      standup({
        phase: "failed",
        settledAt: ENDED,
        steps: [step("apidev", "failed"), step("webdev", "done")],
      }),
      { services: today, nowMs: Date.parse("2026-09-03T10:00:00.000Z") },
    );
    expect(read(settled)).toEqual([
      "db unchecked",
      "mailer unchecked",
      "apidev failed",
      "webdev up",
    ]);
  });

  it("without the project read, a settled call is its report alone", () => {
    const settled = standupReadingFor(
      standup({ settledAt: ENDED, steps: [step("apidev", "done")] }),
      { nowMs: Date.parse(ENDED) },
    );
    expect(read(settled)).toEqual(["apidev up"]);
  });

  it("has nothing to read of a running call before the project is read", () => {
    expect(
      standupReadingFor(standup({ phase: "running", anchorAt: SINCE }), { nowMs: 0 }),
    ).toBeNull();
  });
});

describe("standupReadingFor — a running call its Mate relays", () => {
  const relayed = standup({
    phase: "running",
    standUpProgress: {
      phase: "development",
      state: "running",
      services: [
        { hostname: "apidev", step: "deploy", state: "running", processId: "p-1", at: "" },
        { hostname: "webdev", step: "build", state: "pending", processId: "", at: "" },
      ],
    },
  });

  it("reads zcp's own progress, before the project is even read here", () => {
    const reading = standupReadingFor(relayed, { nowMs: Date.parse("2026-09-02T10:02:00Z") });
    expect(reading?.rows.map((row) => [row.hostname, row.state, row.sentence])).toEqual([
      ["apidev", "building", "Deploying"],
      ["webdev", "waits", undefined],
    ]);
  });

  it("a settled call reads as it settled, whatever was relayed", () => {
    const settled = { ...relayed, phase: "done" as const };
    expect(standupReadingFor(settled, { nowMs: 0 })?.rows).toEqual([]);
  });
});

// A stand-up's call returns while its builds run on (pass 35): its report
// froze as it returned, and the store's reading of its services says when
// they are done, so the band lets it go.
describe("standupBuildsDone — a stand-up that ran on after its call returned", () => {
  const services = [
    {
      hostname: "db",
      serviceId: "s-db",
      group: "data" as const,
      runsCode: false,
      status: "ACTIVE",
    },
    {
      hostname: "appdev",
      serviceId: "s-appdev",
      group: "runtimes" as const,
      runsCode: true,
      status: "ACTIVE",
    },
    {
      hostname: "apidev",
      serviceId: "s-apidev",
      group: "runtimes" as const,
      runsCode: false,
      status: "READY_TO_DEPLOY",
    },
  ];
  const build = (
    serviceId: string,
    status: string,
    finished?: string,
    created = "2026-09-02T10:01:00.000Z",
  ) => ({
    id: `p-${serviceId}-${created}`,
    projectId: "proj",
    serviceStackIds: [serviceId],
    status,
    actionName: "stack.build",
    created,
    ...(finished === undefined ? {} : { finished }),
  });
  const ranOn = standup({
    returnedAt: "2026-09-02T10:02:00.000Z",
    steps: [step("appdev", "done"), step("apidev", "running")],
  });
  const nowMs = Date.parse("2026-09-02T10:08:00.000Z");
  it.each([
    {
      name: "its build finished: done",
      processes: [build("s-apidev", "FINISHED", "2026-09-02T10:07:00.000Z")],
      done: true,
    },
    { name: "its build still runs", processes: [build("s-apidev", "RUNNING")], done: false },
    { name: "no build of it seen yet", processes: [], done: false },
    { name: "the project not read yet", processes: undefined, done: false },
    {
      // A later deploy in the same turn is no build of the stand-up's (E1).
      name: "its build finished, then a later deploy builds it again: still done",
      processes: [
        build("s-apidev", "FINISHED", "2026-09-02T10:07:00.000Z"),
        build("s-apidev", "RUNNING", undefined, "2026-09-02T10:07:30.000Z"),
      ],
      done: true,
    },
  ])("$name", ({ processes, done }) => {
    expect(
      standupBuildsDone(ranOn, {
        services,
        ...(processes === undefined ? {} : { processes }),
        nowMs,
      }),
    ).toBe(done);
  });
});
