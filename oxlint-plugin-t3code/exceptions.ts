// @effect-diagnostics nodeBuiltinImport:off -- Oxlint loads ledgers synchronously at module init.
/**
 * Shared exception-ledger support for the design-system guards. Oxlint rules use the AST scope;
 * CSS check scripts produce `css-declaration` findings and reconcile the same rule ledger with
 * the CSS scope.
 */

import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

/** The reviewed metadata stored for one exact guard finding; `path` is repo-relative. */
export interface ExceptionEntry {
  readonly path: string;
  readonly kind: string;
  readonly fingerprint: string;
  readonly owner: string;
  readonly reason: string;
  readonly expires: string;
}

/** Selects AST findings or CSS declarations from a shared per-rule ledger. */
export type ExceptionScope = "ast" | "css";

/** The ledger kind reserved for findings emitted by CSS check scripts. */
export const CSS_KIND = "css-declaration";

/** The complete finding shape passed from guard scanners into reconciliation. */
export interface ExceptionFinding {
  readonly path: string;
  readonly kind: string;
  readonly fingerprint: string;
  readonly ledgered: boolean;
}

/** The triple a rule uses to decide whether one finding is already reviewed. */
export interface ExceptionKey {
  readonly path: string;
  readonly kind: string;
  readonly fingerprint: string;
}

/** A loaded ledger and its absolute-or-repo-relative matching helper. */
export interface ExceptionLedger {
  readonly entries: ReadonlyArray<ExceptionEntry>;
  readonly has: (key: ExceptionKey) => boolean;
}

/** The categorized outcome consumed by both AST and CSS guard drivers. */
export interface ReconcileResult {
  readonly entryCount: number;
  readonly unlisted: ReadonlyArray<ExceptionFinding>;
  readonly dead: ReadonlyArray<ExceptionEntry>;
  readonly changed: ReadonlyArray<ExceptionEntry>;
  readonly expired: ReadonlyArray<ExceptionEntry>;
}

/** The machine payload embedded in every guard diagnostic. */
export interface FindingMessage {
  readonly ruleName: string;
  readonly summary: string;
  readonly kind: string;
  readonly fingerprint: string;
  readonly ledgered: boolean;
}

const EXPIRY_PATTERN = /^(F[0-6][a-c]?|surface:[a-z0-9][a-z0-9-]*|never)$/;
const ENTRY_FIELDS = ["path", "kind", "fingerprint", "owner", "reason", "expires"] as const;
const DEFAULT_EXCEPTION_DIRECTORY = NodePath.join(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "exceptions",
);

const ExceptionEntrySchema = Schema.Struct({
  path: Schema.NonEmptyString,
  kind: Schema.NonEmptyString,
  fingerprint: Schema.NonEmptyString,
  owner: Schema.NonEmptyString,
  reason: Schema.NonEmptyString,
  expires: Schema.NonEmptyString.check(Schema.isPattern(EXPIRY_PATTERN)),
});
const CompletedPhasesSchema = Schema.Struct({
  completed: Schema.Array(Schema.NonEmptyString),
});
const FindingMessageSchema = Schema.Struct({
  ruleName: Schema.NonEmptyString,
  summary: Schema.NonEmptyString,
  kind: Schema.NonEmptyString,
  fingerprint: Schema.NonEmptyString,
  ledgered: Schema.Boolean,
});

const decodeExceptionEntry = Schema.decodeUnknownSync(ExceptionEntrySchema);
const decodeCompletedPhases = Schema.decodeUnknownSync(CompletedPhasesSchema);
const decodeUnknownJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const decodeFindingMessageJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(FindingMessageSchema),
);
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeFindingMessageJson = Schema.encodeUnknownSync(
  Schema.fromJsonString(FindingMessageSchema),
);

/** The fixed delimiter the driver uses to recover a finding from human-readable diagnostics. */
export const FINDING_MESSAGE_MARKER = "T3CODE_GUARD_FINDING:";

/** Collapses source whitespace so formatting-only edits do not invalidate reviewed findings. */
export const normalizeFingerprint = (text: string): string => text.replace(/\s+/gu, " ").trim();

/** Builds the canonical selector/property/value fingerprint emitted by CSS guard scanners. */
export const cssDeclarationFingerprint = ({
  selector,
  property,
  value,
}: {
  readonly selector: string;
  readonly property: string;
  readonly value: string;
}): string => normalizeFingerprint(`${selector}{${property}:${value}}`);

const invalidEntryField = (input: unknown): string => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "entry";

  const candidate = input as Readonly<Record<string, unknown>>;
  for (const field of ENTRY_FIELDS) {
    if (typeof candidate[field] !== "string" || candidate[field].length === 0) return field;
  }
  return EXPIRY_PATTERN.test(candidate.expires as string) ? "entry" : "expires";
};

const readJsonFile = (filePath: string): unknown => {
  let text: string;
  try {
    text = NodeFS.readFileSync(filePath, "utf8");
  } catch (cause) {
    throw new Error(`Failed to read exception ledger ${filePath}.`, { cause });
  }

  try {
    return decodeUnknownJson(text.replace(/^\uFEFF/u, ""));
  } catch (cause) {
    throw new Error(`Invalid JSON in exception ledger ${filePath}.`, { cause });
  }
};

const normalizePath = (path: string): string => path.replaceAll("\\", "/");

const pathMatchesEntry = (path: string, entryPath: string): boolean => {
  const normalizedPath = normalizePath(path);
  return normalizedPath === entryPath || normalizedPath.endsWith(`/${entryPath}`);
};

/**
 * Loads and validates one rule ledger. The optional directory lets tests and external scanners
 * use fixtures; production rules resolve the adjacent `exceptions` directory from `import.meta.url`.
 */
export const loadExceptionLedger = (
  ruleName: string,
  directory: string = DEFAULT_EXCEPTION_DIRECTORY,
): ExceptionLedger => {
  const filePath = NodePath.join(directory, `${ruleName}.json`);
  if (!NodeFS.existsSync(filePath)) return { entries: [], has: () => false };

  const input = readJsonFile(filePath);
  if (!Array.isArray(input)) {
    throw new Error(
      `Invalid exception ledger ${filePath} at index 0, field entries: expected an array.`,
    );
  }

  const entries: Array<ExceptionEntry> = [];
  for (const [index, value] of input.entries()) {
    try {
      entries.push(decodeExceptionEntry(value));
    } catch (cause) {
      const field = invalidEntryField(value);
      throw new Error(`Invalid exception ledger ${filePath} at index ${index}, field ${field}.`, {
        cause,
      });
    }
  }

  return {
    entries,
    has({ path, kind, fingerprint }) {
      return entries.some(
        (candidate) =>
          pathMatchesEntry(path, candidate.path) &&
          kind === candidate.kind &&
          fingerprint === candidate.fingerprint,
      );
    },
  };
};

/** Loads the completed phase IDs used to reject exceptions whose migration deadline passed. */
export const loadCompletedPhases = (
  directory: string = DEFAULT_EXCEPTION_DIRECTORY,
): ReadonlySet<string> => {
  const filePath = NodePath.join(directory, "phases.json");
  if (!NodeFS.existsSync(filePath)) return new Set();

  try {
    return new Set(decodeCompletedPhases(readJsonFile(filePath)).completed);
  } catch (cause) {
    throw new Error(`Invalid completed phases file ${filePath}.`, { cause });
  }
};

const isEntryInScope = (entry: ExceptionEntry, scope: ExceptionScope): boolean =>
  scope === "css" ? entry.kind === CSS_KIND : entry.kind !== CSS_KIND;

const sameFinding = (entry: ExceptionEntry, finding: ExceptionFinding): boolean =>
  pathMatchesEntry(finding.path, entry.path) &&
  entry.kind === finding.kind &&
  entry.fingerprint === finding.fingerprint;

/**
 * Purely reconciles scanner findings with the selected portion of a rule ledger. CSS scripts pass
 * their `css-declaration` findings with `scope: "css"`; the oxlint driver passes AST findings.
 */
export const reconcileExceptions = ({
  entries,
  findings,
  completedPhases,
  scope,
}: {
  readonly entries: ReadonlyArray<ExceptionEntry>;
  readonly findings: ReadonlyArray<ExceptionFinding>;
  readonly completedPhases: ReadonlySet<string>;
  readonly scope: ExceptionScope;
}): ReconcileResult => {
  const scopedEntries = entries.filter((candidate) => isEntryInScope(candidate, scope));
  const unlisted = findings.filter((candidate) => !candidate.ledgered);
  const expired = scopedEntries.filter((candidate) => completedPhases.has(candidate.expires));
  const activeEntries = scopedEntries.filter((candidate) => !expired.includes(candidate));
  const unmatchedEntries = activeEntries.filter(
    (candidate) => !findings.some((item) => sameFinding(candidate, item)),
  );
  const changed = unmatchedEntries.filter((candidate) =>
    unlisted.some(
      (item) => pathMatchesEntry(item.path, candidate.path) && candidate.kind === item.kind,
    ),
  );
  const dead = unmatchedEntries.filter((candidate) => !changed.includes(candidate));

  return {
    entryCount: scopedEntries.length,
    unlisted,
    dead,
    changed,
    expired,
  };
};

const suggestedEntry = ({
  path,
  kind,
  fingerprint,
}: {
  readonly path: string;
  readonly kind: string;
  readonly fingerprint: string;
}) =>
  encodeUnknownJson({
    path,
    kind,
    fingerprint,
    owner: "…",
    reason: "…",
    expires: "…",
  });

/** Formats the human instruction and the final machine marker emitted by all three AST rules. */
export const formatFindingMessage = (finding: FindingMessage): string =>
  `${finding.summary}\nto except it, add to oxlint-plugin-t3code/exceptions/${finding.ruleName}.json: ${suggestedEntry(
    { path: "<repo path>", kind: finding.kind, fingerprint: finding.fingerprint },
  )}\n${FINDING_MESSAGE_MARKER}${encodeFindingMessageJson(finding)}`;

/** Recovers a guard finding from its fixed final marker, or returns undefined for other messages. */
export const parseFindingMessage = (message: string): FindingMessage | undefined => {
  const markerIndex = message.lastIndexOf(FINDING_MESSAGE_MARKER);
  if (markerIndex < 0) return undefined;

  try {
    const payload = message.slice(markerIndex + FINDING_MESSAGE_MARKER.length).trim();
    return decodeFindingMessageJson(payload);
  } catch {
    return undefined;
  }
};

/**
 * Tells rules when the reconciliation driver needs suppressed hits. A rule computes its filename,
 * kind, and fingerprint for every finding. It reports nothing when the ledger matches and this is
 * false, reports a `ledgered: true` message when both match and this is true, and otherwise reports
 * a `ledgered: false` message.
 */
export const shouldReportLedgered = (): boolean => process.env.T3CODE_GUARD_REPORT_LEDGERED === "1";

/** Formats one actionable line per reconciliation problem, or a counted success line. */
export const formatReconcileReport = ({
  ruleName,
  result,
}: {
  readonly ruleName: string;
  readonly result: ReconcileResult;
}): string => {
  const lines = [
    ...result.unlisted.map(
      (finding) =>
        `${ruleName}: unlisted ${finding.path}:${finding.kind} — add to oxlint-plugin-t3code/exceptions/${ruleName}.json: ${suggestedEntry(finding)}`,
    ),
    ...result.dead.map(
      (candidate) =>
        `${ruleName}: ${candidate.path}:${candidate.kind} — entry no longer matches anything — delete it`,
    ),
    ...result.changed.map(
      (candidate) =>
        `${ruleName}: ${candidate.path}:${candidate.kind} — the code under this entry changed — re-review, then update the fingerprint or delete`,
    ),
    ...result.expired.map(
      (candidate) =>
        `${ruleName}: ${candidate.path}:${candidate.kind} — phase ${candidate.expires} is complete — the exception must go`,
    ),
  ];

  return lines.length > 0
    ? lines.join("\n")
    : `${ruleName}: ledger reconciled (${result.entryCount} entries)`;
};
