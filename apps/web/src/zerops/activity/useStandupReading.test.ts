import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { describe, expect, it } from "vite-plus/test";

import { settledStandupReading, standupExpected, standupReadingFor } from "./useStandupReading";

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
  // Yesterday's call, read today: its data service failed since, a runtime
  // stopped, a service was added. The call's bar says what it reported.
  const today = [
    {
      hostname: "db",
      serviceId: "s-db",
      group: "data" as const,
      runsCode: false,
      status: "ACTION_FAILED",
    },
    {
      hostname: "apidev",
      serviceId: "s-apidev",
      group: "runtimes" as const,
      runsCode: true,
      status: "STOPPED",
    },
    {
      hostname: "webdev",
      serviceId: "s-webdev",
      group: "runtimes" as const,
      runsCode: true,
      status: "ACTIVE",
    },
    {
      hostname: "newdev",
      serviceId: "s-newdev",
      group: "runtimes" as const,
      runsCode: false,
      status: "READY_TO_DEPLOY",
    },
  ];
  it("reads a settled call from its report alone, whatever the project says now", () => {
    const reading = standupReadingFor(
      standup({ steps: [step("apidev", "done"), step("webdev", "done")] }),
      { services: today, processes: [], nowMs: Date.parse("2026-09-03T10:00:00.000Z") },
    );
    expect(reading?.rows).toEqual([
      { hostname: "apidev", state: "up" },
      { hostname: "webdev", state: "up" },
    ]);
  });

  it("reads a running call from the project, its data included", () => {
    const reading = standupReadingFor(standup({ phase: "running", steps: [] }), {
      services: today,
      processes: [],
      nowMs: Date.parse("2026-09-02T10:01:00.000Z"),
    });
    expect(reading?.rows.map((row) => row.hostname)).toContain("db");
  });

  it("has nothing to read of a running call before the project is read", () => {
    expect(standupReadingFor(standup({ phase: "running" }), undefined)).toBeNull();
  });
});
