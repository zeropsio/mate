/**
 * An activity entry in a person's words: who acted (by the names the organization's members and
 * projects carry, else what HQ named), what they did, what it was done to, and how it ended.
 */
import type { HqActivityActor, HqActivityEntry } from "@t3tools/shared/hqActivity";

export interface ActivityNames {
  /** A person's name by their Zerops user id. */
  readonly person: (userId: string) => string | undefined;
  /** A project's name by its id. */
  readonly project: (projectId: string) => string | undefined;
}

export interface ActivityLine {
  readonly key: string;
  readonly at: string;
  readonly who: string;
  readonly what: string;
  /** What it was done to; `code` when it is a command to show as typed. */
  readonly subject: { readonly text: string; readonly code: boolean } | null;
  /** How it ended, when not as asked: `null` for an act that took effect. */
  readonly outcome: string | null;
}

const READS: Readonly<Record<string, string>> = {
  "chief.projects": "the organization's projects",
  "chief.services": "the services",
  "chief.members": "the organization's members",
};

const OUTCOMES: Readonly<Record<HqActivityEntry["outcome"], string | null>> = {
  ok: null,
  refused: "Refused",
  failed: "Failed",
  unknown: "No result: it may have run",
};

const personName = (names: ActivityNames, userId: string) =>
  names.person(userId) ?? `Person ${userId}`;
const projectName = (names: ActivityNames, projectId: string) =>
  names.project(projectId) ?? `Project ${projectId}`;

export function activityWho(actor: HqActivityActor, names: ActivityNames): string {
  switch (actor.kind) {
    case "person":
      return personName(names, actor.userId);
    case "mate": {
      const mate = names.project(actor.mateProjectId) ?? `Mate ${actor.mateProjectId}`;
      return actor.forUserId === null ? mate : `${mate} for ${personName(names, actor.forUserId)}`;
    }
    case "github":
      return "GitHub";
    case "core":
      return "HQ";
    case "operator":
      return "A Zerops operator";
  }
}

function activityWhat(entry: HqActivityEntry, names: ActivityNames): string {
  const change = entry.number === null ? "a change" : `change #${entry.number}`;
  switch (entry.action) {
    case "opened":
      return `opened ${change}`;
    case "merged":
      return `merged ${change}`;
    case "closed":
      return `closed ${change}`;
    case "handed":
      return `handed ${change} to a Mate`;
    case "git_password_issued":
      return "made a Git password";
    case "git_password_revoked":
      return "revoked a Git password";
    case "mate_git_credential_issued":
      return "got a Git credential";
    case "mate_git_credential_revoked":
      return "revoked a Mate's Git credential";
    case "project_key_revoked":
      return "revoked a project's key";
    case "value_revealed":
      return "showed a hidden value";
    case "escalated_read": {
      const read = (entry.subjectLabel !== null && READS[entry.subjectLabel]) || "the organization";
      return `read ${read} with a person's rights`;
    }
    case "mate_command_run":
      return entry.subjectId === null
        ? "ran a command on a Mate"
        : `ran a command on ${projectName(names, entry.subjectId)}`;
    default:
      return entry.action.replaceAll("_", " ");
  }
}

function activitySubject(entry: HqActivityEntry, names: ActivityNames): ActivityLine["subject"] {
  switch (entry.action) {
    case "opened":
    case "merged":
    case "closed":
    case "handed": {
      const where = entry.repo ?? "";
      const title = entry.subjectLabel ?? "";
      const text = [where, title].filter((part) => part.length > 0).join(": ");
      return text.length > 0 ? { text, code: false } : null;
    }
    case "mate_command_run":
      return entry.subjectLabel === null ? null : { text: entry.subjectLabel, code: true };
    case "escalated_read":
    case "mate_git_credential_issued":
    case "mate_git_credential_revoked":
    case "project_key_revoked":
    case "value_revealed":
      return entry.subjectId === null
        ? null
        : { text: projectName(names, entry.subjectId), code: false };
    default:
      return entry.subjectLabel === null ? null : { text: entry.subjectLabel, code: false };
  }
}

export function activityLine(entry: HqActivityEntry, names: ActivityNames): ActivityLine {
  return {
    key: entry.id,
    at: entry.at,
    who: activityWho(entry.actor, names),
    what: activityWhat(entry, names),
    subject: activitySubject(entry, names),
    outcome: OUTCOMES[entry.outcome],
  };
}
