import { describe, expect, it } from "@effect/vitest";
import type { ServerProvider } from "@t3tools/contracts";

import { usageReportOf } from "./engineAdapters.ts";

const CHECKED = "2026-10-10T09:00:00.000Z";
const WEEKLY_RESET = "2026-10-14T15:00:00.000Z";

const claude = (
  auth: ServerProvider["auth"]["status"],
  usageLimits: ServerProvider["usageLimits"],
): ServerProvider =>
  ({
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    auth: { status: auth },
    ...(usageLimits === undefined ? {} : { usageLimits }),
  }) as unknown as ServerProvider;

const weekly = {
  id: "seven_day",
  kind: "weekly",
  label: "Weekly",
  usedPercent: 24,
  resetsAt: WEEKLY_RESET,
} as const;

describe("what a provider tells the engine of its account's usage", () => {
  it.each<{
    readonly name: string;
    readonly provider: ServerProvider;
    readonly report: ReturnType<typeof usageReportOf>;
  }>([
    {
      name: "a signed-in account's windows, as read when they were read",
      provider: claude("authenticated", { checkedAt: CHECKED, windows: [weekly] }),
      report: {
        instanceId: "claudeAgent",
        usage: {
          checkedAt: Date.parse(CHECKED),
          windows: [{ usedPercent: 24, resetsAt: Date.parse(WEEKLY_RESET) }],
        },
      },
    },
    {
      name: "nothing from an agent that is not signed in",
      provider: claude("unauthenticated", { checkedAt: CHECKED, windows: [weekly] }),
      report: undefined,
    },
    {
      name: "nothing from a probe that failed to read the windows",
      provider: claude("authenticated", {
        checkedAt: CHECKED,
        windows: [],
        unavailable: { reason: "probeFailed" },
      }),
      report: undefined,
    },
    {
      name: "nothing from an account that keeps no windows",
      provider: claude("authenticated", { checkedAt: CHECKED, windows: [] }),
      report: undefined,
    },
    {
      name: "nothing before the usage was read at all",
      provider: claude("authenticated", undefined),
      report: undefined,
    },
  ])("$name", ({ provider, report }) => {
    expect(usageReportOf(provider)).toEqual(report);
  });
});
