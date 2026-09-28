import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { describe, expect, it } from "vite-plus/test";

import {
  crewLandingOptions,
  crewResumeCommand,
  crewResumeNeedsDialog,
  crewRunDraft,
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
        { mode: "person", label: "I land everything" },
        { mode: "lead", label: "The lead lands after its review" },
      ],
    },
    {
      hasLead: false,
      options: [
        { mode: "person", label: "I land everything" },
        { mode: "check", label: "Land when the check passes" },
      ],
    },
  ] as const)("with a lead: $hasLead", ({ hasLead, options }) => {
    expect(crewLandingOptions(hasLead)).toEqual(options);
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
    expect(crewStartCommand(draft, hasLead)).toEqual(command);
  });
});

describe("crewResumeNeedsDialog", () => {
  it.each([
    { name: "a budget stop asks for a new budget", reason: "budget", dialog: true },
    { name: "a time stop asks for a new time limit", reason: "time", dialog: true },
    { name: "your own pause resumes with one press", reason: "person", dialog: false },
    { name: "a usage stop resumes with one press", reason: "usage", dialog: false },
    { name: "a refused dispatch resumes with one press", reason: "refused", dialog: false },
  ] as const)("$name", ({ reason, dialog }) => {
    expect(crewResumeNeedsDialog({ ...lastRun, state: "paused", reason })).toBe(dialog);
  });

  it("is never for a run that is not paused", () => {
    expect(crewResumeNeedsDialog({ ...lastRun, reason: "budget" })).toBe(false);
    expect(crewResumeNeedsDialog(null)).toBe(false);
  });
});

describe("crewResumeCommand", () => {
  // $6.40 spent of $20, 1 h 12 m of 8 h, stop at 80 %.
  const paused = { ...lastRun, state: "paused" as const, reason: "budget" as const };
  const draft = crewRunDraft(paused, true);

  it("resumes with the limits as they stand, changed or not", () => {
    expect(crewResumeCommand({ ...draft, budgetText: "40" }, paused)).toEqual({
      _tag: "resume",
      runId: "run-3",
      budgetUsd: 40,
      timeLimitHours: 8,
      stopAtUsagePercent: 80,
    });
    expect(crewResumeCommand({ ...draft, budget: "unlimited", usageStop: false }, paused)).toEqual({
      _tag: "resume",
      runId: "run-3",
      budgetUsd: "unlimited",
      timeLimitHours: 8,
      stopAtUsagePercent: null,
    });
  });

  it.each([
    { name: "a budget at what is spent", fields: { budgetText: "6.4" } },
    { name: "a budget under what is spent", fields: { budgetText: "5" } },
    { name: "a time limit within the time already run", fields: { timeText: "1" } },
    { name: "no amount", fields: { budgetText: "" } },
  ])("holds $name", ({ fields }) => {
    expect(crewResumeCommand({ ...draft, ...fields }, paused)).toBeNull();
  });
});
