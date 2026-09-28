/**
 * The run dialog's choices (PRD §4.8, Δ16): a budget and a time limit that
 * each take an amount or *No limit*, the usage-window stop, who lands, whether
 * the crew may show work on dev, and whether the lead starts tasks unasked.
 *
 * The first run preselects no budget, so spending without a limit is never an
 * accident; every later run starts from the last one's options.
 *
 * A run its budget or time limit paused resumes through the same dialog with
 * new limits (`crewResumeCommand`): a budget above what is spent and a time
 * limit past the time already run, or *No limit*. Any other pause resumes with
 * one press.
 */
import type { CrewCommand, CrewLandingMode, CrewRun } from "@t3tools/contracts";

/** A limit is an amount or *No limit*; the amount keeps its text while *No limit* is picked. */
export type CrewLimitKind = "amount" | "unlimited";

export interface CrewRunDraft {
  /** `null` until the person picks an amount or *No limit*. */
  readonly budget: CrewLimitKind | null;
  /** Dollars, as typed. */
  readonly budgetText: string;
  readonly time: CrewLimitKind;
  /** Hours, as typed. */
  readonly timeText: string;
  readonly usageStop: boolean;
  /** The percent the usage stop names, kept while the stop is off. */
  readonly usagePercent: number;
  readonly landing: CrewLandingMode;
  readonly devGrant: boolean;
  readonly leadMayStart: boolean;
}

const DEFAULT_HOURS = 8;
const DEFAULT_USAGE_PERCENT = 80;

const LANDING_LABELS: Readonly<Record<CrewLandingMode, string>> = {
  person: "I land everything",
  lead: "The lead lands after its review",
  check: "Land when the check passes",
};

/** Who may land in this crew: the lead only with a lead, the check only without one. */
function crewLandingModes(hasLead: boolean): ReadonlyArray<CrewLandingMode> {
  return hasLead ? ["person", "lead"] : ["person", "check"];
}

export function crewLandingOptions(
  hasLead: boolean,
): ReadonlyArray<{ readonly mode: CrewLandingMode; readonly label: string }> {
  return crewLandingModes(hasLead).map((mode) => ({ mode, label: LANDING_LABELS[mode] }));
}

export function crewRunDraft(lastRun: CrewRun | null, hasLead: boolean): CrewRunDraft {
  if (lastRun === null) {
    return {
      budget: null,
      budgetText: "",
      time: "amount",
      timeText: String(DEFAULT_HOURS),
      usageStop: true,
      usagePercent: DEFAULT_USAGE_PERCENT,
      landing: "person",
      devGrant: false,
      leadMayStart: false,
    };
  }
  const { options } = lastRun;
  return {
    budget: options.budgetUsd === "unlimited" ? "unlimited" : "amount",
    budgetText: options.budgetUsd === "unlimited" ? "" : String(options.budgetUsd),
    time: options.timeLimitHours === "unlimited" ? "unlimited" : "amount",
    timeText: String(
      options.timeLimitHours === "unlimited" ? DEFAULT_HOURS : options.timeLimitHours,
    ),
    usageStop: options.stopAtUsagePercent !== null,
    usagePercent: options.stopAtUsagePercent ?? DEFAULT_USAGE_PERCENT,
    landing: crewLandingModes(hasLead).includes(options.landing) ? options.landing : "person",
    devGrant: options.devGrant,
    leadMayStart: hasLead && options.leadMayStart,
  };
}

/** A positive amount, `unlimited`, or `null` for anything else. */
function limitOf(kind: CrewLimitKind, typed: string): number | "unlimited" | null {
  if (kind === "unlimited") return "unlimited";
  const text = typed.trim();
  const amount = Number(text);
  return text === "" || !Number.isFinite(amount) || amount <= 0 ? null : amount;
}

/** The dialog's *Start*; `null` until a budget is picked and both limits read. */
export function crewStartCommand(draft: CrewRunDraft, hasLead: boolean): CrewCommand | null {
  const budgetUsd = draft.budget === null ? null : limitOf(draft.budget, draft.budgetText);
  const timeLimitHours = limitOf(draft.time, draft.timeText);
  if (budgetUsd === null || timeLimitHours === null) return null;
  return {
    _tag: "start",
    budgetUsd,
    timeLimitHours,
    stopAtUsagePercent: draft.usageStop ? draft.usagePercent : null,
    landing: draft.landing,
    devGrant: draft.devGrant,
    leadMayStart: hasLead && draft.leadMayStart,
  };
}

/** A paused run whose budget or time limit stopped it: resuming it needs a new limit. */
export function crewResumeNeedsDialog(run: CrewRun | null): boolean {
  return (
    run !== null && run.state === "paused" && (run.reason === "budget" || run.reason === "time")
  );
}

/**
 * The dialog's *Resume*: the run's limits as the dialog holds them. `null`
 * while a limit would stop the run again at once — a budget at or under what
 * is spent, a time limit within the time already run — or reads as nothing.
 */
export function crewResumeCommand(draft: CrewRunDraft, run: CrewRun): CrewCommand | null {
  const budgetUsd = draft.budget === null ? null : limitOf(draft.budget, draft.budgetText);
  const timeLimitHours = limitOf(draft.time, draft.timeText);
  if (budgetUsd === null || timeLimitHours === null) return null;
  if (budgetUsd !== "unlimited" && budgetUsd <= run.spentUsd) return null;
  if (timeLimitHours !== "unlimited" && timeLimitHours * 3_600_000 <= run.elapsedMs) return null;
  return {
    _tag: "resume",
    runId: run.id,
    budgetUsd,
    timeLimitHours,
    stopAtUsagePercent: draft.usageStop ? draft.usagePercent : null,
  };
}
