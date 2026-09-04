/**
 * One object per thing Mate does to the project — the Operations layer.
 *
 * `ZeropsCallEntry` is what the transcript hands the reducer: one row per
 * recognized or unrecognized tool call, after the transcript's own lifecycle
 * collapse (started/updated/completed folded to one row per `toolCallId`).
 * `reduceZeropsOperations` folds those entries into `ZeropsOperation`s —
 * bootstrap, deploy, import, mount, verify, subdomain, delete, scale, manage,
 * env, error — the domain objects a card renders.
 *
 * See `../../../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md` §3.
 */

export type ZeropsCallStatus = "inProgress" | "completed" | "failed" | "declined" | "stopped";

export interface ZeropsCallEntry {
  /** The FIRST activity id of the call — the transcript's anchor. */
  readonly id: string;
  /** First observation, ISO. */
  readonly createdAt: string;
  readonly startedAt?: string;
  /** Latest lifecycle activity's `createdAt`, once the call is no longer `inProgress`. */
  readonly settledAt?: string;
  readonly turnId: string | null;
  readonly toolCallId?: string;
  /** Normalized: `"zerops_deploy"`, `"ToolSearch"`, `"Skill"`, … */
  readonly toolName: string;
  /** The call's arguments. */
  readonly input?: Record<string, unknown>;
  readonly status: ZeropsCallStatus;
  /** Raw result text of a `zerops_*` tool, when carried. */
  readonly resultText?: string;
  /** The server dropped the result as oversized. */
  readonly truncated?: boolean;
}

export type ZeropsOperationKind =
  | "bootstrap"
  | "deploy"
  | "import"
  | "mount"
  | "verify"
  | "subdomain"
  | "delete"
  | "scale"
  | "manage"
  | "env"
  | "devServer"
  | "browser"
  | "error";

export type ZeropsOperationPhase = "running" | "done" | "failed";

export type ZeropsOperationStepState = "queued" | "running" | "done" | "failed";

export interface ZeropsOperationStep {
  readonly id: string;
  readonly label: string;
  readonly state: ZeropsOperationStepState;
  /** A word for people: "Done", "Running", "Failed", "Skipped", "Waiting". */
  readonly stateLabel: string;
  /** e.g. the step's attestation, "weatherdash created". */
  readonly note?: string;
}

export interface ZeropsOperationLink {
  readonly label: string;
  readonly url: string;
}

export interface ZeropsOperation {
  /** Domain key: `call:<entryId>`, `bootstrap:<sessionId>`. */
  readonly key: string;
  readonly kind: ZeropsOperationKind;
  readonly phase: ZeropsOperationPhase;
  /** First call's entry id — the transcript position this operation renders under. */
  readonly anchorEntryId: string;
  /** First call's `createdAt`. */
  readonly createdAt: string;
  readonly startedAt: string;
  readonly settledAt?: string;
  readonly turnId: string | null;
  /** Hostname / project / session target. */
  readonly subject: string;
  /** e.g. "Deploy · weatherdash", "New service · weatherdash", "Verify · s3git1". */
  readonly kicker: string;
  /**
   * Opening line: for `bootstrap`, the session's own `intent` verbatim when
   * present, else the phrase producer; every other kind is always the phrase
   * producer — zcp ships no per-call `intent` on any other tool.
   */
  readonly voice: string;
  readonly voiceSource: "agent" | "mate";
  /** e.g. "Deploying" | "Deployed" | "Failed" | "Checking" | … */
  readonly statusWord: string;
  /** Closing line, present once `phase !== "running"`. */
  readonly closing?: string;
  readonly steps: ReadonlyArray<ZeropsOperationStep>;
  readonly links: ReadonlyArray<ZeropsOperationLink>;
  /** Agent-facing text for a "Details" disclosure; never card copy. */
  readonly detail?: string;
  /** Every call folded into this operation. */
  readonly entryIds: ReadonlyArray<string>;
  /** For the observation layer. */
  readonly target?: { readonly hostname: string };
  /** Decoded result `status`, e.g. "BUILD_TRIGGERED". */
  readonly resultStatus?: string;
  readonly hasResult: boolean;
}

export interface ZeropsOperationsReduction {
  /** In anchor order. */
  readonly operations: ReadonlyArray<ZeropsOperation>;
  /**
   * Entries the transcript must drop: every entry that became/joined an
   * operation, plus every `hidden`-classified entry (`classifyZeropsCall`),
   * whether or not it ends up contributing to one — a route-menu `start`
   * never anchors or joins an operation itself, but it is still consumed, so
   * the caller can pass every `zerops_*` call through unfiltered and let the
   * reduction alone decide what the transcript keeps.
   */
  readonly consumedEntryIds: ReadonlySet<string>;
}
