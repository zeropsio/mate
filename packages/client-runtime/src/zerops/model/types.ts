import type { RestartReading } from "../../data/projections/restart.ts";
import type { ImageOccurrence } from "@t3tools/contracts";
/**
 * The session and operation model — one object per thing Mate does to the
 * project, identity a domain fact (the provider's tool-call id) rather than a
 * transcript accident. See
 * `../../../../../../../zcp/plans/mate-session-model-2026-09-05.md` §2.2 and
 * `mate-session-model-2026-09-05-designs/C-client-domain.md` §1.
 */
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type { StandUpProgress } from "../activity/standupProgress.ts";

/**
 * `inProgress` is the only non-terminal value. `interrupted` is the client
 * form of R10: a call still `inProgress` whose turn is not the thread's
 * running turn (rule §2.3 R10) — never regresses back to `inProgress`.
 */
export type ZeropsCallStatus =
  | "inProgress"
  | "completed"
  | "failed"
  | "declined"
  | "stopped"
  | "interrupted";

/** One image content block a `zerops_*` result carried (e.g. a `zerops_browser` screenshot). */
export interface ZeropsCallImage {
  readonly asset?: ImageOccurrence;
  readonly mimeType: string;
  readonly data?: string;
  readonly width?: number;
  readonly height?: number;
}

/** One provider tool call of a `zerops_*` tool. Identity = `id` (§2.1 principle 1). */
export interface ZeropsCall {
  /** `payload.toolCallId`, or `anon:<activityId>` when a driver sends none. */
  readonly id: string;
  /** Placement only — never part of identity (§2.3 R1). */
  readonly turnId: string | null;
  /** Normalized: `"zerops_deploy"`, never `mcp__<server>__zerops_deploy`. */
  readonly toolName: string;
  /** The richest row's arguments; `{}` until they stream in. */
  readonly input: Record<string, unknown>;
  readonly status: ZeropsCallStatus;
  /** Carried forward from whichever row has it (§2.3 R3). */
  readonly resultText?: string;
  /** The server dropped the result as oversized, and no row carries text. */
  readonly truncated: boolean;
  /** Image content blocks the result carried (e.g. a `zerops_browser` screenshot), carried forward like `resultText` (§2.3 R3). */
  readonly images?: ReadonlyArray<ZeropsCallImage>;
  /** `min createdAt` over the call's rows. */
  readonly startedAt: string;
  /** The row whose `createdAt` is `startedAt` — tiebreak only, never identity. */
  readonly anchorActivityId: string;
  /** `createdAt` of the terminal row; absent while `inProgress` or `interrupted`. */
  readonly settledAt?: string;
  /** Every activity id folded into this call. */
  readonly rowIds: ReadonlySet<string>;
  /** Any row carried a non-empty `payload.agentId` — the whole call is a subagent's. */
  readonly agentInternal: boolean;
  /** A stand-up call's progress as its Mate relays it (`standupProgress.ts`); absent from an older Mate. */
  readonly standUpProgress?: StandUpProgress;
  /** The model response it was written in; absent where the provider names none. */
  readonly responseId?: string;
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
  | "logs"
  | "events"
  | "process"
  | "discover"
  | "standup"
  | "error";

/**
 * `declined` and `stopped` are their own outcomes, never folded into `done`
 * (the bug §2.6 fixes with one `phaseFor`). `interrupted` and `reset` never
 * come from `phaseFor` alone — `interrupted` mirrors an orphaned call's own
 * status, `reset` is a bootstrap session's own closure (§2.3 R7). `uncertain`
 * is a deploy whose triggered build cannot be read — its result named none, or
 * the platform cannot be asked about it (`builders/deploy.ts`).
 */
export type ZeropsOperationPhase =
  | "running"
  | "done"
  | "failed"
  | "declined"
  | "stopped"
  | "interrupted"
  | "reset"
  | "uncertain";

export type ZeropsOperationStepState = "queued" | "running" | "done" | "failed";

export interface ZeropsOperationStep {
  readonly id: string;
  readonly label: string;
  readonly state: ZeropsOperationStepState;
  /** A word for people: "Done", "Running", "Failed", "Skipped", "Waiting". */
  readonly stateLabel: string;
  readonly note?: string;
  /**
   * `"tail"` marks a `browser` step as the canonical reporting plumbing
   * (`screenshot`, `errors`, `console`, `network requests`, `close` —
   * `internal/ops/browser.go`'s `buildCanonicalBatch`) rather than something
   * the agent actually did on the page. Absent for every other step.
   */
  readonly kind?: "tail";
}

/** A change in HQ: its repository's name in the application, and its number. */
export interface ZeropsOperationPullRequest {
  readonly repository: string;
  readonly number: number;
}

export interface ZeropsOperationLink {
  readonly label: string;
  readonly url: string;
}

/**
 * `browser` only: the condensed viewport summary — `viewport`/`media` read
 * off a `set viewport <w> <h>` / `set media dark|light` step when the agent
 * issued one, `stepCount` the number of non-tail steps, `failedStep` the
 * first non-tail step that failed (always shown even with the step list
 * collapsed), `errorCount` the console and page errors together and
 * `failedRequestCount` the failed network requests — what the card tones its
 * figures by. `line` is the ready-made figures text (`phrases.ts`'s
 * `browserFiguresLine`) — the card renders it verbatim, the same way it
 * already renders `closing`.
 */
/** A browser viewport in CSS pixels; both sides are positive. */
export interface ZeropsBrowserViewport {
  readonly width: number;
  readonly height: number;
}

/**
 * What a browser check read of the page besides a picture: the page itself —
 * its accessibility tree, else its text — and each thing it asked of it with
 * the page's answer ("main h3" → "6 found").
 */
export interface ZeropsBrowserRead {
  readonly page?: { readonly kind: "tree" | "text"; readonly text: string };
  readonly answers: ReadonlyArray<{ readonly asked: string; readonly answer: string }>;
}

export interface ZeropsOperationBrowserSummary {
  readonly viewport?: ZeropsBrowserViewport;
  readonly media?: "dark" | "light";
  readonly stepCount: number;
  readonly failedStep?: ZeropsOperationStep;
  readonly errorCount: number;
  readonly failedRequestCount: number;
  readonly line: string;
}

/**
 * `deploy` only: what zcp says the deploy shipped. `id` is the platform
 * appVersion (filled once the build resolves, never on a failed or timed-out
 * build) — the exact key for attributing the card's processes and build log;
 * `name` is the `--version-name` passed to the push (the commit sha).
 */
export interface ZeropsOperationVersion {
  readonly id?: string;
  readonly name?: string;
}

/**
 * Why a card failed or timed out, read off the result's own evidence — never
 * composed copy. `logTail` is the last lines of the log zcp attached for the
 * failing phase, capped (`EXPLANATION_LOG_TAIL_LINES`).
 */
export interface ZeropsOperationExplanation {
  readonly reason: string;
  readonly logTail?: ReadonlyArray<string>;
}
/** A status a read card draws beside a row: the word, and the tone of its dot. */
export interface ZeropsReadStatus {
  readonly word: string;
  readonly tone: ServiceStatusToneId;
}

/** One log line, oldest first. `at` is the entry's own ISO timestamp. */
export interface ZeropsLogLine {
  readonly id: string;
  readonly at?: string;
  readonly severity: "error" | "warning" | "info";
  readonly text: string;
}

/** One platform event, newest first. */
export interface ZeropsEventRow {
  readonly id: string;
  readonly at?: string;
  readonly service?: string;
  readonly action: string;
  readonly status: ZeropsReadStatus;
}

/** One service `zerops_discover` listed. */
export interface ZeropsDiscoverRow {
  readonly hostname: string;
  readonly type?: string;
  readonly status: ZeropsReadStatus;
  readonly note?: string;
}

/**
 * What a `zerops_env` call changed and where, read off its input: the
 * project's variables or a service's, and how many it named. Never a value —
 * these can be secrets.
 */
export interface ZeropsEnvChange {
  /**
   * `generate-dotenv` writes a local `.env`, or with `preview` only reads what
   * it would change; an action it does not know updates.
   */
  readonly action: "get" | "set" | "delete" | "request" | "dotenv" | "dotenvPreview" | "update";
  readonly scope: "project" | "service";
  /** The service by its hostname, or the setup block a `.env` is written for. */
  readonly service?: string;
  /** How many variables the call named, when it named any. */
  readonly count?: number;
  /**
   * `dotenv` only: zcp's safety gate refused to write the `.env`, which holds
   * this many variables nothing sets — set by hand, lost on a write.
   */
  readonly refused?: number;
  /** `request` only, when it named a key: the value it asked the person for. */
  readonly request?: ZeropsVaultRequest;
}

/**
 * A value the agent asked the person for (`zerops_env action=request`): one only they have, typed
 * into Mate and written straight to the vault — it never crosses the conversation. There is no
 * value here, only its name, how it is kept, and why it is asked.
 */
export interface ZeropsVaultRequest {
  readonly key: string;
  /** zcp's answer, else the input's flag, else by name — as zcp decides it. */
  readonly sensitive: boolean;
  /** One sentence for the person: what it is for and where to find it. */
  readonly reason?: string;
  /** zcp found the key in that vault already: nothing was asked. */
  readonly alreadySet: boolean;
}

/**
 * What a read tool's card draws (`logs` · `events` · `process` · `discover`).
 * `pending` while the call runs with no result yet: the card draws its final
 * shape empty, so nothing moves when the result lands. `process` rows are the
 * operation's own `steps`. Absent once the call failed or settled without a
 * result — the card then reads like any other.
 */
export type ZeropsReadResult =
  | {
      readonly kind: "logs";
      readonly pending: boolean;
      readonly service: string;
      /** The filter the agent asked for: "errors · since 5m · “timeout”". */
      readonly filter?: string;
      readonly lines: ReadonlyArray<ZeropsLogLine>;
      /** "2 errors · 1 warning", over every line zcp returned. */
      readonly counts?: string;
      /** Why fewer lines are drawn than exist, or why there are none. */
      readonly note?: string;
    }
  | {
      readonly kind: "events";
      readonly pending: boolean;
      readonly rows: ReadonlyArray<ZeropsEventRow>;
      /** "5 more" past the cap. */
      readonly more?: string;
    }
  | {
      readonly kind: "process";
      readonly pending: boolean;
    }
  | {
      readonly kind: "discover";
      readonly pending: boolean;
      readonly rows: ReadonlyArray<ZeropsDiscoverRow>;
    };

export interface ZeropsOperation {
  /** `op:<callId>` for every per-call kind; `bootstrap:<founderCallId>` for a session. Never re-keyed. */
  readonly key: string;
  readonly kind: ZeropsOperationKind;
  readonly phase: ZeropsOperationPhase;
  /** The founder call's `startedAt` — the transcript position this operation renders under. */
  readonly anchorAt: string;
  readonly anchorActivityId: string;
  readonly settledAt?: string;
  /**
   * When its call returned — a session's latest call — absent while the Mate
   * waits on it. A stand-up's call returns while its builds run on: the
   * operation still runs, but the Mate is no longer waiting on it.
   */
  readonly returnedAt?: string;
  /**
   * When the call the Mate waits on now started — a session's open follow-up
   * call, not its founder's — absent while it waits on none.
   */
  readonly openedAt?: string;
  /**
   * The model response of its call the Mate waits on, else of the call that
   * started it; absent where the provider names none.
   */
  readonly responseId?: string;
  readonly turnId: string | null;
  /** Hostname / project / session target. */
  readonly subject: string;
  readonly kicker: string;
  readonly voice: string;
  readonly voiceSource: "agent" | "mate";
  readonly statusWord: string;
  readonly closing?: string;
  readonly steps: ReadonlyArray<ZeropsOperationStep>;
  readonly links: ReadonlyArray<ZeropsOperationLink>;
  /** The operation's calls, anchor first: one per per-call kind, a bootstrap session's members and joined imports. */
  readonly callIds: ReadonlyArray<string>;
  /** `standup` only: its call's progress as its Mate relays it; absent from an older Mate. */
  readonly standUpProgress?: StandUpProgress;
  readonly target?: { readonly hostname: string };
  /** `deploy` only: a `zerops_deploy_batch` — one step per target, no single service to observe or name. */
  readonly batch?: true;
  /** `deploy` only: the call delivered by pushing to a git remote (zcp's git-push strategy). */
  readonly strategy?: "git-push";
  /**
   * `deploy` with the git-push strategy only: the change the push lands through
   * in HQ — the change a run's result follows — by its repository's name and its
   * number.
   */
  readonly pullRequest?: ZeropsOperationPullRequest;
  readonly resultStatus?: string;
  readonly hasResult: boolean;
  /** `deploy` only, once the result names one. */
  readonly version?: ZeropsOperationVersion;
  /** `import` only: the platform processes the result says it started — exact attribution keys. */
  readonly processIds?: ReadonlyArray<string>;
  /** The same restart evidence that determines phase, words and steps. */
  readonly restartReading?: RestartReading;
  /** A batch `deploy` only: the app versions its entries' results named — exact attribution keys. */
  readonly appVersionIds?: ReadonlyArray<string>;
  /** A failed or timed-out card's reason and log tail. */
  readonly explanation?: ZeropsOperationExplanation;
  /** `browser` only: the last call's screenshot, as a data URI ready for an `<img src>`. Absent when the result carried none, or the provider dropped the image content block. */
  readonly screenshot?: { readonly src: string; readonly width?: number; readonly height?: number };
  /** `browser` only. */
  readonly browserSummary?: ZeropsOperationBrowserSummary;
  /**
   * `browser` only: what the check read of the page when it took no picture —
   * the page (its accessibility tree, else its text) and what it asked of it
   * with the answers — drawn where the picture would be.
   */
  readonly browserRead?: ZeropsBrowserRead;
  /**
   * `browser` only: the viewport the agent set — read from the call's own
   * commands once its arguments arrive, else from the result's steps — so the
   * frame takes its final shape before any pixel does.
   */
  readonly viewport?: ZeropsBrowserViewport;
  /** `browser` only: the device the agent emulated (`set device "iPhone 14"`), as agent-browser names it. */
  readonly deviceName?: string;
  /** `logs` · `events` · `process` · `discover` only. */
  readonly readResult?: ZeropsReadResult;
  /** `env` only. */
  readonly envChange?: ZeropsEnvChange;
  /** bootstrap only. */
  readonly session?: {
    readonly sessionIds: ReadonlyArray<string>;
    readonly intent?: string;
    readonly completed: number;
    readonly total: number;
  };
}

export type ZeropsTimelineEntry =
  | {
      readonly kind: "operation";
      readonly key: string;
      readonly anchorAt: string;
      readonly anchorActivityId: string;
      readonly operation: ZeropsOperation;
    }
  | {
      readonly kind: "generic-call";
      readonly key: string;
      readonly anchorAt: string;
      readonly anchorActivityId: string;
      readonly call: ZeropsCall;
    };

/**
 * One work-session attempt — zcp's own per-host count and reading of it
 * (`workflow.AttemptInfo`), which a failed deploy/verify card may cite.
 */
export interface ZeropsWorkAttempt {
  readonly success: boolean;
  /** zcp's per-work-session, per-host count. */
  readonly iteration: number;
  readonly reason?: string;
  /** zcp's coarse failure class, e.g. `build`, `start`, `credential`. */
  readonly failureClass?: string;
  readonly summary?: string;
}

/**
 * `envelope.phase` composed with what this layer derives — the strip, the
 * map's running state and the band all read this instead of the raw envelope
 * (§2.1 principle 5).
 */
export interface ZeropsSessionView {
  readonly phase?: string;
  /** `phase === "idle"` only. */
  readonly idleScenario?: string;
  readonly serviceCount?: number;
  /** The open (or latest) bootstrap session, client-derived — `envelope.bootstrap` is nil on the wire. */
  readonly bootstrap?: {
    readonly key: string;
    readonly sessionIds: ReadonlyArray<string>;
    readonly intent?: string;
    readonly step?: string;
    readonly completed: number;
    readonly total: number;
    readonly phase: ZeropsOperationPhase;
  };
  /** `envelope.workSession`, keyed by its `createdAt` (constant for one session). */
  readonly work?: {
    readonly key: `work:${string}`;
    readonly intent: string;
    readonly services: ReadonlyArray<string>;
    readonly deploys?: Record<string, ReadonlyArray<ZeropsWorkAttempt>>;
    readonly verifies?: Record<string, ReadonlyArray<ZeropsWorkAttempt>>;
  };
}
