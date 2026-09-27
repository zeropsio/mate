/**
 * crewVersions — which prompt versions a save bumps, and when a crewmate's
 * conversation is behind them (PRD §5.6).
 *
 * A crewmate's system prompt is the crew rules, the brief at version N and its
 * job at version M. Both integers live in the crew tables, not in the files;
 * every saved change to the brief bumps N and marks every crewmate pending,
 * every saved change to one job bumps that job's M and marks one. Each stint
 * records the versions its session started with, so "pending" is simply
 * recorded < current.
 *
 * @module crewVersions
 */
import type { CrewApplyChoice } from "@t3tools/contracts";
import type { CrewDefinition } from "@t3tools/shared/crewHome";

export interface PromptVersions {
  readonly brief: number;
  readonly job: number;
}

/** True when a conversation started on older brief or job text than the current one. */
export const isPromptPending = (running: PromptVersions, current: PromptVersions): boolean =>
  running.brief < current.brief || running.job < current.job;

/** The stored versions of one crew: the brief's and each crewmate's job. */
export interface CrewVersions {
  readonly brief: number;
  readonly jobs: Readonly<Record<string, number>>;
}

export interface CrewSave {
  readonly versions: CrewVersions;
  /** Crewmates of the previous save whose prompt text changed: "v5 at next turn". */
  readonly pending: ReadonlyArray<string>;
  /**
   * Crewmates whose login, Read only switch or host changed. Their conversation
   * cannot carry on: a login's transcript lives in its own home, and the kind
   * and the copy are written into the crew rules. The editor offers only
   * *Save and start fresh* for them (PRD §2.3).
   */
  readonly freshOnly: ReadonlyArray<string>;
}

const briefChanged = (previous: CrewDefinition, next: CrewDefinition): boolean =>
  previous.brief.title !== next.brief.title || previous.brief.text !== next.brief.text;

/**
 * The versions after saving `next` over `previous` (both undefined on the
 * first save). Model, effort and the display name reach the next turn in the
 * same conversation and bump nothing.
 */
export const versionsAfterSave = (
  previous: CrewDefinition | undefined,
  stored: CrewVersions | undefined,
  next: CrewDefinition,
): CrewSave => {
  if (previous === undefined || stored === undefined) {
    return {
      versions: {
        brief: 1,
        jobs: Object.fromEntries(next.members.map((member) => [member.handle, 1])),
      },
      pending: [],
      freshOnly: [],
    };
  }
  const bumpBrief = briefChanged(previous, next);
  const before = new Map(previous.members.map((member) => [member.handle, member]));
  const jobs: Record<string, number> = {};
  const pending: Array<string> = [];
  const freshOnly: Array<string> = [];
  for (const member of next.members) {
    const old = before.get(member.handle);
    const version = stored.jobs[member.handle];
    if (old === undefined || version === undefined) {
      jobs[member.handle] = 1;
      continue;
    }
    const bumpJob = old.job !== member.job;
    jobs[member.handle] = bumpJob ? version + 1 : version;
    if (old.login !== member.login || old.kind !== member.kind || old.host !== member.host) {
      freshOnly.push(member.handle);
    } else if (bumpBrief || bumpJob) {
      pending.push(member.handle);
    }
  }
  return {
    versions: { brief: bumpBrief ? stored.brief + 1 : stored.brief, jobs },
    pending,
    freshOnly,
  };
};

const meaningfulLines = (text: string): ReadonlyArray<string> =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const unmatched = (from: ReadonlyArray<string>, against: ReadonlyArray<string>): number => {
  const left = new Map<string, number>();
  for (const line of against) left.set(line, (left.get(line) ?? 0) + 1);
  let count = 0;
  for (const line of from) {
    const remaining = left.get(line) ?? 0;
    if (remaining > 0) left.set(line, remaining - 1);
    else count += 1;
  }
  return count;
};

/**
 * The save choice the job editor pre-selects: *Start fresh* when more than
 * half of the job's lines changed ("A large change to the job — a fresh
 * conversation follows it better"), otherwise the default. Lines compare
 * trimmed, blank lines ignored.
 */
export const suggestedApplyChoice = (previous: string, next: string): CrewApplyChoice => {
  const before = meaningfulLines(previous);
  const after = meaningfulLines(next);
  const changed = Math.max(unmatched(before, after), unmatched(after, before));
  return changed * 2 > Math.max(before.length, after.length) ? "fresh" : "nextTurn";
};
