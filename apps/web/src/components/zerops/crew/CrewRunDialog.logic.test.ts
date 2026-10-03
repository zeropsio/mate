import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  crewLandingOptions,
  crewResumeCommand,
  crewResumeDraft,
  crewResumeLimit,
  crewRunDraft,
  crewSpendBlocker,
  crewStartCommand,
} from "./CrewRunDialog.logic";

const lastRun = crewSnapshotFixture().run!;

describe("crewRunDraft", () => {
  it.each([
    {
      name: "the first run: no budget chosen, 8 h, stop at 80 %, you land, ask before dev",
      run: null,
      hasLead: true,
      draft: {
        budget: null,
        budgetText: "",
        time: "amount",
        timeText: "8",
        usageStop: true,
        usagePercent: 80,
        landing: "person",
        devGrant: false,
        leadMayStart: false,
      },
    },
    {
      name: "later runs start from the last one",
      run: {
        ...lastRun,
        options: {
          budgetUsd: 12.5,
          timeLimitHours: "unlimited",
          stopAtUsagePercent: 70,
          landing: "lead",
          devGrant: true,
          leadMayStart: true,
        },
      },
      hasLead: true,
      draft: {
        budget: "amount",
        budgetText: "12.5",
        time: "unlimited",
        timeText: "8",
        usageStop: true,
        usagePercent: 70,
        landing: "lead",
        devGrant: true,
        leadMayStart: true,
      },
    },
    {
      name: "a last run without a limit or the usage stop keeps both off",
      run: {
        ...lastRun,
        options: { ...lastRun.options, budgetUsd: "unlimited", stopAtUsagePercent: null },
      },
      hasLead: true,
      draft: {
        budget: "unlimited",
        budgetText: "",
        time: "amount",
        timeText: "8",
        usageStop: false,
        usagePercent: 80,
        landing: "person",
        devGrant: false,
        leadMayStart: false,
      },
    },
    {
      name: "a landing mode the crew no longer offers falls back to you",
      run: { ...lastRun, options: { ...lastRun.options, landing: "lead", leadMayStart: true } },
      hasLead: false,
      draft: {
        budget: "amount",
        budgetText: "20",
        time: "amount",
        timeText: "8",
        usageStop: true,
        usagePercent: 80,
        landing: "person",
        devGrant: false,
        leadMayStart: false,
      },
    },
  ] as const)("$name", ({ run, hasLead, draft }) => {
    expect(crewRunDraft(run, hasLead)).toEqual(draft);
  });
});

describe("crewLandingOptions", () => {
  it.each([
    {
      hasLead: true,
      options: [
        {
          mode: "person",
          label: "Wait for my review",
          line: "It waits in the Crew tab: Review it, try it, add it to Fen's code.",
        },
        {
          mode: "lead",
          label: "Add it to Fen's code once the lead approves it",
          line: "The lead checks each piece and sends back what isn't right.",
        },
      ],
    },
    {
      hasLead: false,
      options: [
        {
          mode: "person",
          label: "Wait for my review",
          line: "It waits in the Crew tab: Review it, try it, add it to Fen's code.",
        },
        {
          mode: "check",
          label: "Add it to Fen's code once its checks pass",
          line: "Nothing goes in while its checks fail.",
        },
      ],
    },
  ] as const)("with a lead: $hasLead", ({ hasLead, options }) => {
    expect(crewLandingOptions(hasLead, "Fen")).toEqual(options);
  });
});

describe("crewStartCommand", () => {
  const draft = {
    budget: "amount",
    budgetText: " 20 ",
    time: "amount",
    timeText: "8",
    usageStop: true,
    usagePercent: 80,
    landing: "person",
    devGrant: false,
    leadMayStart: true,
  } as const;

  it.each([
    {
      name: "a complete draft starts the run",
      draft,
      hasLead: true,
      command: {
        _tag: "start",
        budgetUsd: 20,
        timeLimitHours: 8,
        stopAtUsagePercent: 80,
        landing: "person",
        devGrant: false,
        leadMayStart: true,
      },
    },
    {
      name: "No limit on both, the usage stop off, no lead to start tasks",
      draft: {
        ...draft,
        budget: "unlimited",
        time: "unlimited",
        usageStop: false,
        landing: "check",
      },
      hasLead: false,
      command: {
        _tag: "start",
        budgetUsd: "unlimited",
        timeLimitHours: "unlimited",
        stopAtUsagePercent: null,
        landing: "check",
        devGrant: false,
        leadMayStart: false,
      },
    },
    {
      name: "no budget picked yet",
      draft: { ...draft, budget: null },
      hasLead: true,
      command: null,
    },
    {
      name: "a budget that is not a positive amount",
      draft: { ...draft, budgetText: "0" },
      hasLead: true,
      command: null,
    },
    {
      name: "a time limit that is not a number",
      draft: { ...draft, timeText: "soon" },
      hasLead: true,
      command: null,
    },
    {
      name: "an empty amount",
      draft: { ...draft, budgetText: " " },
      hasLead: true,
      command: null,
    },
  ] as const)("$name", ({ draft, hasLead, command }) => {
    expect(crewStartCommand(draft, hasLead, false)).toEqual(command);
  });

  it("a dollar budget a crewmate's agent can't keep starts nothing; No limit starts", () => {
    expect(crewStartCommand(draft, true, true)).toBeNull();
    expect(crewStartCommand({ ...draft, budget: "unlimited" }, true, true)).toMatchObject({
      _tag: "start",
      budgetUsd: "unlimited",
    });
  });
});

describe("crewSpendBlocker", () => {
  const provider = (instanceId: string, displayName: string, reportsSpend: boolean | null) =>
    ({
      instanceId,
      displayName,
      ...(reportsSpend === null ? {} : { threadProfile: { tools: true, reportsSpend } }),
    }) as unknown as ServerProvider;
  const providers = [
    provider("claudeAgent", "Claude", true),
    provider("grok", "Grok", false),
    provider("cursor", "Cursor", null),
  ];
  it.each([
    { name: "every agent reports its spend", logins: ["claudeAgent"], blocker: null },
    {
      name: "an agent that doesn't, named",
      logins: ["claudeAgent", "grok"],
      blocker: "Grok doesn't report what it spends, so this crew can't keep a budget.",
    },
    {
      name: "an agent that carries no crew at all",
      logins: ["cursor"],
      blocker: "Cursor doesn't report what it spends, so this crew can't keep a budget.",
    },
    {
      name: "a login the catalog doesn't list yet: the server decides",
      logins: ["gone"],
      blocker: null,
    },
  ])("$name", ({ logins, blocker }) => {
    expect(crewSpendBlocker(logins, providers)).toBe(blocker);
    expect(crewSpendBlocker(logins, undefined)).toBeNull();
  });
});

describe("crewResumeLimit", () => {
  it.each([
    { name: "its budget", reason: "budget", limit: "budget" },
    { name: "its time", reason: "time", limit: "time" },
    { name: "the usage stop", reason: "usage", limit: "usage" },
    { name: "an older client's Pause", reason: "person", limit: null },
    { name: "a refused turn", reason: "refused", limit: null },
  ] as const)("a run stopped by $name", ({ reason, limit }) => {
    expect(crewResumeLimit({ ...lastRun, state: "paused", reason })).toBe(limit);
  });

  it("is nothing for a run that is not stopped", () => {
    expect(crewResumeLimit({ ...lastRun, reason: "budget" })).toBeNull();
    expect(crewResumeLimit(null)).toBeNull();
  });
});

describe("Keep going: more of what stopped it", () => {
  // $6.40 spent of $20, 1 h 12 m of 8 h, stop at 80 %, the plan at 54 %.
  const stopped = (reason: "budget" | "time" | "usage" | "person") => ({
    ...lastRun,
    state: "paused" as const,
    reason,
  });

  it("offers as much again as the limit it reached, and the usage stop ten points up", () => {
    expect(crewResumeDraft(stopped("budget"))).toEqual({
      more: "amount",
      moreText: "20",
      usageStop: true,
      usagePercent: 90,
    });
    expect(crewResumeDraft(stopped("time")).moreText).toBe("8");
  });

  it.each([
    [
      "more money on top of what it spent",
      stopped("budget"),
      { more: "amount", moreText: "5" },
      { _tag: "resume", runId: "run-3", budgetUsd: 11.4 },
    ],
    [
      "no spending limit",
      stopped("budget"),
      { more: "unlimited", moreText: "5" },
      { _tag: "resume", runId: "run-3", budgetUsd: "unlimited" },
    ],
    [
      "more time on top of the time it ran",
      stopped("time"),
      { more: "amount", moreText: "2" },
      { _tag: "resume", runId: "run-3", timeLimitHours: 3.2 },
    ],
    [
      "no time limit",
      stopped("time"),
      { more: "unlimited", moreText: "" },
      { _tag: "resume", runId: "run-3", timeLimitHours: "unlimited" },
    ],
    [
      "the usage stop raised",
      stopped("usage"),
      { usageStop: true, usagePercent: 95 },
      { _tag: "resume", runId: "run-3", stopAtUsagePercent: 95 },
    ],
    [
      "the usage stop off",
      stopped("usage"),
      { usageStop: false },
      { _tag: "resume", runId: "run-3", stopAtUsagePercent: null },
    ],
    [
      "an older client's Pause goes on as it was",
      stopped("person"),
      {},
      { _tag: "resume", runId: "run-3" },
    ],
  ] as const)("%s", (_, run, fields, command) => {
    expect(crewResumeCommand({ ...crewResumeDraft(run), ...fields }, run)).toEqual(command);
  });

  it.each([
    ["no amount", stopped("budget"), { moreText: "" }],
    ["nothing more", stopped("time"), { moreText: "0" }],
    ["a usage stop where the plan already stands", stopped("usage"), { usagePercent: 54 }],
  ] as const)("holds %s", (_, run, fields) => {
    expect(crewResumeCommand({ ...crewResumeDraft(run), ...fields }, run)).toBeNull();
  });

  it("never asks the run to go on under a limit it reached", () => {
    const run = { ...stopped("time"), elapsedMs: 8 * 3_600_000 + 1 };
    const command = crewResumeCommand({ ...crewResumeDraft(run), moreText: "0.01" }, run);
    expect(command).toMatchObject({ timeLimitHours: 8.02 });
  });
});
