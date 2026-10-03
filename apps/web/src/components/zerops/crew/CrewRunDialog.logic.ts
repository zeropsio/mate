/**
 * The run dialog's choices (PRD §4.8, Δ16) — *Let the crew work on its own*:
 * how much it may spend and for how long (each an amount or *No limit*), the
 * stop before the Claude plan's limit, what happens to a finished piece of
 * work, whether the lead may start its own tasks and whether crewmates may
 * show their work at the Mate's dev address.
 *
 * The first run picks no budget, so spending without a limit is never an
 * accident; every later run starts from the last one's options.
 *
 * *Keep going* goes on after a stop. When a limit stopped the run, the
 * dialog sets that limit apart and asks for more money or more time rather
 * than a new figure: what is typed is added to what the run has spent or
 * run, so it never asks the run to go on under a limit it has reached
 * (`resumeRefusal` on the server); the usage stop is raised or turned off.
 */
import { crewLandingWords } from "@t3tools/client-runtime/zerops/crew/phrases";

import { crewCatalogNamesCapability } from "./CrewEditors.logic";
import type { CrewCommand, CrewLandingMode, CrewRun, ServerProvider } from "@t3tools/contracts";

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

/** Who may land in this crew: the lead only with a lead, the check only without one. */
function crewLandingModes(hasLead: boolean): ReadonlyArray<CrewLandingMode> {
  return hasLead ? ["person", "lead"] : ["person", "check"];
}

/** "When a piece of work is done": each choice, and the line under it. */
export function crewLandingOptions(
  hasLead: boolean,
  mateName: string,
): ReadonlyArray<{
  readonly mode: CrewLandingMode;
  readonly label: string;
  readonly line: string;
}> {
  return crewLandingModes(hasLead).map((mode) => ({ mode, ...crewLandingWords(mode, mateName) }));
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

/**
 * Why this crew can't keep a dollar budget, when a crewmate's agent doesn't
 * report what it spends (`threadProfile.reportsSpend`); `null` when every one
 * does, the catalog isn't read yet, or it comes from a server older than the
 * capability (the server refuses such a budget itself).
 */
export function crewSpendBlocker(
  loginIds: ReadonlyArray<string>,
  providers: ReadonlyArray<ServerProvider> | undefined,
): string | null {
  // A server older than the capability kept every budget; so does its dialog.
  if (providers === undefined || !crewCatalogNamesCapability(providers)) return null;
  for (const loginId of loginIds) {
    const provider = providers?.find((candidate) => candidate.instanceId === loginId);
    if (provider !== undefined && provider.threadProfile?.reportsSpend !== true) {
      return `${provider.displayName ?? loginId} doesn't report what it spends, so this crew can't keep a budget.`;
    }
  }
  return null;
}

/**
 * The dialog's *Start*; `null` until a budget is picked and both limits read,
 * and for a dollar budget the crew can't keep (`spendBlocked`).
 */
export function crewStartCommand(
  draft: CrewRunDraft,
  hasLead: boolean,
  spendBlocked: boolean,
): CrewCommand | null {
  const budgetUsd = draft.budget === null ? null : limitOf(draft.budget, draft.budgetText);
  const timeLimitHours = limitOf(draft.time, draft.timeText);
  if (budgetUsd === null || timeLimitHours === null) return null;
  if (spendBlocked && budgetUsd !== "unlimited") return null;
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

/** The limit that stopped a paused run, which *Keep going* asks more of; `null` for any other stop. */
export type CrewResumeLimit = "budget" | "time" | "usage";

export function crewResumeLimit(run: CrewRun | null): CrewResumeLimit | null {
  if (run?.state !== "paused") return null;
  return run.reason === "budget" || run.reason === "time" || run.reason === "usage"
    ? run.reason
    : null;
}

export interface CrewResumeDraft {
  /** More money or more time: an amount, or *No limit*. */
  readonly more: CrewLimitKind;
  /** Dollars or hours more, as typed. */
  readonly moreText: string;
  /** The usage stop, for a run it stopped: raised, or turned off. */
  readonly usageStop: boolean;
  readonly usagePercent: number;
}

/** Keep going offers as much again as the limit it reached, and a usage stop ten points up. */
export function crewResumeDraft(run: CrewRun): CrewResumeDraft {
  const { budgetUsd, timeLimitHours, stopAtUsagePercent } = run.options;
  const again =
    crewResumeLimit(run) === "time"
      ? timeLimitHours === "unlimited"
        ? DEFAULT_HOURS
        : timeLimitHours
      : budgetUsd === "unlimited"
        ? run.spentUsd
        : budgetUsd;
  return {
    more: "amount",
    moreText: String(again),
    usageStop: true,
    usagePercent: Math.min(100, (stopAtUsagePercent ?? DEFAULT_USAGE_PERCENT) + 10),
  };
}

const HOUR_MS = 3_600_000;

/** Up to the next cent, or the next hundredth of an hour: never short of what was asked. */
const upTo = (value: number): number => Math.ceil(value * 100 - 1e-9) / 100;

/**
 * *Keep going*: the run goes on with more of the limit that stopped it — the
 * money it spent or the time it ran, plus what was typed — or with its usage
 * stop raised past where the plan stands, or turned off; after any other
 * stop, as it was. `null` while the draft reads as nothing it could go on
 * with.
 */
export function crewResumeCommand(draft: CrewResumeDraft, run: CrewRun): CrewCommand | null {
  const resume = { _tag: "resume", runId: run.id } as const;
  const limit = crewResumeLimit(run);
  if (limit === null) return resume;
  if (limit === "usage") {
    if (!draft.usageStop) return { ...resume, stopAtUsagePercent: null };
    const now = run.usagePercent ?? 0;
    return draft.usagePercent > now && draft.usagePercent <= 100
      ? { ...resume, stopAtUsagePercent: draft.usagePercent }
      : null;
  }
  const more = limitOf(draft.more, draft.moreText);
  if (more === null) return null;
  if (limit === "budget") {
    return { ...resume, budgetUsd: more === "unlimited" ? more : upTo(run.spentUsd + more) };
  }
  return {
    ...resume,
    timeLimitHours: more === "unlimited" ? more : upTo(run.elapsedMs / HOUR_MS + more),
  };
}
