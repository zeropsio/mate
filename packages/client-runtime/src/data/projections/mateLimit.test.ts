import { describe, expect, it } from "vite-plus/test";
import { engineRow } from "../__fixtures__/mateEngine.ts";
import { projectMateLimit, type MateLimitSource } from "./mateLimit.ts";

const startedAt = "2026-10-08T10:00:00.000Z";
const resetsAt = "2026-10-10T02:00:00.000Z";
const now = Date.parse(startedAt);
const refused: MateLimitSource = {
  latestTurn: { turnId: "refused", state: "running", startedAt, completedAt: null },
  session: {
    lastError: "You've hit your weekly limit",
    providerName: "claudeAgent",
    usageLimitResetAt: resetsAt,
    updatedAt: startedAt,
  },
  usagePause: { resetsAt, pausedAt: startedAt },
};
describe("one current-turn provider limit reading", () => {
  it.each([
    {
      name: "old HQ's error field preserves the provider deadline to the millisecond",
      source: {
        ...refused,
        usagePause: null,
        latestTurn: { ...refused.latestTurn!, startedAt: null },
        session: {
          lastError: `Claude usage limit reached. |${Date.parse("2026-10-10T02:00:00.123Z") / 1000}`,
        },
      },
      clock: Date.parse("2026-10-10T02:00:00.123Z") - 1,
      kind: "limited",
    },
    {
      name: "old HQ's provider deadline expires exactly, even without a notice timestamp",
      source: {
        ...refused,
        usagePause: null,
        latestTurn: { ...refused.latestTurn!, startedAt: null },
        session: { lastError: "Claude usage limit reached. |1791597600.123" },
      },
      clock: Date.parse("2026-10-10T02:00:00.123Z"),
      kind: "expired",
    },
    ...[
      { name: "a paused engine row before reset", clock: now, state: "paused", kind: "limited" },
      {
        name: "a paused engine row at reset",
        clock: Date.parse(resetsAt),
        state: "paused",
        kind: "expired",
      },
      {
        name: "a newer admitted engine run supersedes V1 refusal evidence",
        clock: now,
        state: "working",
        kind: "none",
      },
      {
        name: "an engine recovery clears V1 refusal evidence before reset",
        clock: now,
        state: "idle",
        kind: "none",
      },
    ].map(({ name, clock, state, kind }) => ({
      name,
      clock,
      kind,
      source: {
        ...refused,
        engineRow: engineRow("Ada", "chat", {
          state:
            state === "paused"
              ? { kind: "paused", resetsAt: Date.parse(resetsAt) }
              : state === "working"
                ? { kind: "working", since: now, waitsOnHelpers: false }
                : { kind: "idle" },
        }),
      },
    })),
    { name: "no source", source: null, clock: now, kind: "none" },
    {
      name: "warning telemetry is not refused admission",
      source: {
        ...refused,
        usagePause: null,
        session: {
          lastError: "allowed_warning: 99% used",
          providerName: "claudeAgent",
          usageLimitResetAt: resetsAt,
        },
      },
      clock: now,
      kind: "none",
    },
    { name: "a parked running SDK before reset", source: refused, clock: now, kind: "limited" },
    {
      name: "a parked running SDK at reset",
      source: refused,
      clock: Date.parse(resetsAt),
      kind: "expired",
    },
    {
      name: "a parked running SDK after reset",
      source: refused,
      clock: Date.parse(resetsAt) + 1,
      kind: "expired",
    },
    {
      name: "an unknown reset cannot expire",
      source: {
        ...refused,
        usagePause: null,
        session: { lastError: "You've hit your weekly limit", providerName: "claudeAgent" },
      },
      clock: Date.parse(resetsAt),
      kind: "limited",
    },
    {
      name: "an undated row uses the retained provider deadline after the pause clears",
      source: { ...refused, usagePause: null },
      clock: Date.parse(resetsAt),
      kind: "expired",
    },
    {
      name: "early recovery does not inherit a historical future deadline",
      source: {
        ...refused,
        usagePause: null,
        session: { lastError: null, usageLimitResetAt: resetsAt },
      },
      clock: now,
      kind: "none",
    },
    {
      name: "a newer admitted turn does not inherit the previous pause or error",
      source: {
        ...refused,
        latestTurn: {
          ...refused.latestTurn!,
          turnId: "admitted",
          startedAt: "2026-10-08T11:00:00.000Z",
        },
      },
      clock: now,
      kind: "none",
    },
    {
      name: "a newer admitted turn does not inherit an old error without a pause",
      source: {
        ...refused,
        usagePause: null,
        latestTurn: {
          ...refused.latestTurn!,
          turnId: "admitted",
          startedAt: "2026-10-08T11:00:00.000Z",
        },
      },
      clock: now,
      kind: "none",
    },
    {
      name: "a repeated refused attempt has its own current error evidence",
      source: {
        ...refused,
        latestTurn: {
          ...refused.latestTurn!,
          turnId: "refused",
          startedAt: "2026-10-08T11:00:00.000Z",
        },
        session: { ...refused.session!, updatedAt: "2026-10-08T11:01:00.000Z" },
      },
      clock: now,
      kind: "limited",
    },
    {
      name: "a completed admitted turn clears refusal evidence",
      source: {
        ...refused,
        usagePause: null,
        session: { lastError: null, usageLimitResetAt: resetsAt },
        latestTurn: { ...refused.latestTurn!, state: "completed" },
      },
      clock: now,
      kind: "none",
    },
    {
      name: "cold HQ retains a named weekly refusal",
      source: {
        ...refused,
        session: {
          lastError: "Claude usage limit reached. You've hit your weekly limit",
          usageLimitResetAt: resetsAt,
        },
      },
      clock: now,
      kind: "limited",
    },
  ])("$name", ({ source, clock, kind }) => {
    const limit = projectMateLimit(source, clock);
    expect(limit.kind).toBe(kind);
    if (limit.kind !== "none") {
      expect(limit.provider).toBe("Claude");
      expect(limit.turnId).toBe("refused");
    }
  });
});
