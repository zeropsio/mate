/**
 * The words of HQ's card on the projects page (`ZeropsHqCard.tsx`), from reads already made: HQ's
 * standing, the Core it runs and how its parts stand (`hqStandingAtom`, off HQ's stream, never
 * polled), the structure and the Mates' presence the same stream keeps.
 */
import type {
  HqBackup,
  HqBackupUsage,
  HqKeys,
  HqParts,
  HqStructure,
} from "@t3tools/client-runtime/zerops/hq";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type { HqStanding } from "~/zerops/accountHq";

const IDENTITY = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}Z\.([0-9a-f]{12})$/u;

/**
 * HQ's build as its details name it: its commit's time and its digest, or the name it carries.
 * People read "version" everywhere else; the digest is only for the details.
 */
function coreLabel(build: string): string {
  if (build === "") return "unnamed";
  const match = IDENTITY.exec(build);
  if (match === null) return build;
  const [, year, month, day, hour, minute, digest] = match;
  return `${year}-${month}-${day} ${hour}:${minute} UTC · ${digest}`;
}

/** HQ's build in a few words, for a line with others: its commit's day, or its name. */
function coreDayLabel(build: string): string | null {
  if (build === "") return null;
  const match = IDENTITY.exec(build);
  if (match === null) return `Version ${build}`;
  const [, year, month, day] = match;
  return `Version of ${year}-${month}-${day}`;
}

export interface HqCardInput {
  /** An owner or an admin of the organization: who keeps HQ running. */
  readonly admin: boolean;
  readonly standing: HqStanding;
  /** The structure HQ's stream last told; `null` while nothing is known. */
  readonly structure:
    | (Pick<HqStructure, "ungrouped"> & {
        readonly apps: ReadonlyArray<Pick<HqStructure["apps"][number], "id" | "name" | "projects">>;
      })
    | null;
  /** How many of the Mates the viewer observes are online; `undefined` while not live. */
  readonly online: number | undefined;
  /** A wall time (ms) as the person reads it. */
  readonly time: (ms: number) => string;
}

export interface HqCardView {
  /** HQ's state as one `StatusDot`; `null` before its health is first read. */
  readonly state: {
    readonly kind: "healthy" | "degraded" | "down";
    readonly tone: ServiceStatusToneId;
    readonly word: string;
  } | null;
  /** Whether the card opens to HQ's Core: an admin's, once HQ was read. */
  readonly opens: boolean;
  /** "2 projects · 3 Mates · 2 online"; `null` while nothing is known of HQ's structure. */
  readonly counts: string | null;
  /** The Core HQ runs by its day, for the header line: an admin's, while HQ serves. */
  readonly coreDay: string | null;
  /** The Core HQ runs, to an admin while HQ serves. */
  readonly core: string | null;
  /**
   * When HQ last took a whole backup, for the header line: an admin's while HQ serves and has one,
   * or has none yet.
   */
  readonly backup: string | null;
  /** What is wrong, a line each: an admin's to act on, so nobody else's to read. */
  readonly troubles: ReadonlyArray<string>;
}

/**
 * A repository as HQ names it, `<appId>/<repo>`, as a person reads it: its project's name and its
 * own, or its own alone where the viewer's structure holds no such project.
 */
function repositoryName(
  repo: string,
  structure:
    | (Pick<HqStructure, "ungrouped"> & {
        readonly apps: ReadonlyArray<Pick<HqStructure["apps"][number], "id" | "name" | "projects">>;
      })
    | null,
): string {
  const slash = repo.indexOf("/");
  const app = structure?.apps.find((entry) => entry.id === repo.slice(0, slash));
  return app === undefined ? repo.slice(slash + 1) : `${app.name}/${repo.slice(slash + 1)}`;
}

function quarantineTrouble(names: ReadonlyArray<string>): ReadonlyArray<string> {
  if (names.length === 0) return [];
  if (names.length === 1) return [`Repository ${names[0]} is closed while HQ retries it.`];
  return [
    `${String(names.length)} repositories are closed while HQ retries them: ${names.join(", ")}.`,
  ];
}

/** Bytes as HQ's backup counts them (`mate-hq apps/hq/src/backup.ts`, 1 GB = 10⁹), in whole GB past 10. */
function gigabytes(bytes: number): string {
  const gb = bytes / 1e9;
  return gb >= 10 ? String(Math.round(gb)) : gb.toFixed(1).replace(/\.0$/u, "");
}

const used = (usage: HqBackupUsage) =>
  `${gigabytes(usage.usedBytes)} of ${gigabytes(usage.quotaBytes)} GB used`;

/** HQ's reasons a person can act on or report, in words; any other is HQ's log's to say. */
const BACKUP_FAILURES: Readonly<Record<string, string>> = {
  pg_dump_older: "HQ's backup tool is older than its database.",
  store: "the backup bucket didn't take it.",
  database: "HQ's database didn't answer.",
};

/**
 * Why HQ's newest set failed, by HQ's reason (`mate-hq apps/hq/src/backup.ts` `BackupStatus`); `undefined`
 * where only HQ's log says it.
 */
function backupFailure(
  backup: Extract<HqBackup, { readonly state: "failed" }>,
  structure:
    | (Pick<HqStructure, "ungrouped"> & {
        readonly apps: ReadonlyArray<Pick<HqStructure["apps"][number], "id" | "name" | "projects">>;
      })
    | null,
): string | undefined {
  if (backup.reason === "quota" && backup.usage !== undefined) {
    return `the backup bucket is full. ${used(backup.usage)}; a backup needs ${gigabytes(backup.usage.neededBytes)} GB.`;
  }
  if (backup.reason === "repo_quarantined" && backup.repo !== undefined) {
    return `repository ${repositoryName(backup.repo, structure)} is closed.`;
  }
  return BACKUP_FAILURES[backup.reason];
}

function backupTrouble(
  backup: HqBackup | undefined,
  structure:
    | (Pick<HqStructure, "ungrouped"> & {
        readonly apps: ReadonlyArray<Pick<HqStructure["apps"][number], "id" | "name" | "projects">>;
      })
    | null,
): ReadonlyArray<string> {
  switch (backup?.state) {
    case "off":
      return ["Backup is off: HQ has no backup bucket."];
    case "degraded":
      return [
        `The backup bucket is nearly full: older backups were removed early. ${used(backup.usage)}.`,
      ];
    case "failed": {
      const why = backupFailure(backup, structure);
      return [
        why === undefined
          ? "The last backup failed. HQ's log in Zerops says why."
          : `The last backup failed: ${why}`,
      ];
    }
    default:
      return [];
  }
}

/**
 * Where HQ's key for deploy tokens stands, where that is wrong: HQ refuses every stage or
 * production deploy whose token it cannot open (`mate-hq apps/hq/src/deploys.ts`).
 */
const KEYS_TROUBLES: Readonly<Partial<Record<HqKeys, string>>> = {
  no_secret: "HQ has no key for its deploy tokens, so it can't deploy stages or production.",
  bad_secret: "HQ's key for its deploy tokens is broken, so it can't deploy stages or production.",
  other_secret: "Some deploy tokens are sealed under another key: HQ can't deploy with them.",
};

/** What HQ's own health says is wrong with its parts. */
function partsTroubles(
  parts: HqParts,
  structure:
    | (Pick<HqStructure, "ungrouped"> & {
        readonly apps: ReadonlyArray<Pick<HqStructure["apps"][number], "id" | "name" | "projects">>;
      })
    | null,
): ReadonlyArray<string> {
  const keys = parts.keys === undefined ? undefined : KEYS_TROUBLES[parts.keys];
  return [
    ...(parts.db === "down" ? ["HQ's database isn't answering."] : []),
    ...quarantineTrouble(parts.quarantined.map((repo) => repositoryName(repo, structure))),
    ...backupTrouble(parts.backup, structure),
    ...(keys === undefined ? [] : [keys]),
  ];
}

const counted = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

/**
 * What HQ holds, as far as the viewer sees it: its projects, their Mates and those in no project,
 * and how many of them are online while that is live.
 */
function holdings(
  structure:
    | (Pick<HqStructure, "ungrouped"> & {
        readonly apps: ReadonlyArray<Pick<HqStructure["apps"][number], "id" | "name" | "projects">>;
      })
    | null,
  online: number | undefined,
): string | null {
  if (structure === null) return null;
  const unknown = structure.apps.some((app) =>
    app.projects.some((project) => project.mate === undefined),
  );
  const mates =
    structure.ungrouped.length +
    structure.apps.reduce(
      (sum, app) => sum + app.projects.filter((project) => project.mate != null).length,
      0,
    );
  return [
    counted(structure.apps.length, "project", "projects"),
    unknown ? "Mates unknown" : counted(mates, "Mate", "Mates"),
    ...(online === undefined ? [] : [`${String(online)} online`]),
  ].join(" · ");
}

/** When HQ last took a whole backup, where it has. */
function lastBackup(backup: HqBackup | undefined, time: (ms: number) => string): string | null {
  switch (backup?.state) {
    case "ok":
    case "degraded":
      return `Last backup ${time(backup.takenAt)}`;
    case "pending":
      return "No backup yet";
    default:
      return null;
  }
}

/**
 * HQ's state in one dot and word: an admin's weighs `troubles`; anybody else's says whether HQ
 * serves, and never reads as degraded.
 */
function headline(input: HqCardInput, troubles: ReadonlyArray<string>): HqCardView["state"] {
  const { standing } = input;
  switch (standing.kind) {
    case "unknown":
      return null;
    case "unavailable":
      return {
        kind: "down",
        tone: "failed",
        word: `Unavailable since ${input.time(standing.since)}`,
      };
    case "refused":
      return { kind: "down", tone: "failed", word: "Refused your sign-in" };
    case "unchecked":
      return { kind: "degraded", tone: "attention", word: "Can't check Zerops right now" };
    case "healthy":
      // Running, the glossary's word for healthy, to everybody (design system copy glossary).
      if (!input.admin) return { kind: "healthy", tone: "ok", word: "Running" };
      return troubles.length === 0
        ? { kind: "healthy", tone: "ok", word: "Running" }
        : { kind: "degraded", tone: "attention", word: "Needs attention" };
  }
}

export function hqCardView(input: HqCardInput): HqCardView {
  const { admin, standing } = input;
  const serving = admin && (standing.kind === "healthy" || standing.kind === "unchecked");
  // The Core it runs, once HQ's stream or its health has named it.
  const build = serving ? standing.build : undefined;
  const troubles =
    admin &&
    (standing.kind === "healthy" || standing.kind === "unchecked") &&
    standing.parts !== undefined
      ? partsTroubles(standing.parts, input.structure)
      : [];
  return {
    state: headline(input, troubles),
    opens: admin && standing.kind !== "unknown",
    counts: holdings(input.structure, input.online),
    coreDay: build === undefined ? null : coreDayLabel(build),
    core: build === undefined ? null : coreLabel(build),
    backup: serving ? lastBackup(standing.parts?.backup, input.time) : null,
    troubles,
  };
}

/**
 * What the HQ line says while HQ's navigation is not read: a refusal, or that HQ is unavailable —
 * never that it is still being read, which a reload would paint in amber and take back a beat
 * later.
 */
export function hqNavigationTrouble(navigation: {
  readonly refusal: string | null;
  readonly capped: boolean;
  readonly reconnecting: boolean;
}): string | null {
  if (navigation.refusal !== null) return `HQ read refused: ${navigation.refusal}`;
  if (navigation.capped || navigation.reconnecting) {
    return "HQ is unavailable. Restore its connection or retry.";
  }
  return null;
}
