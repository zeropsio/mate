/**
 * `knownPresentation`: the one place a `Shown` fact becomes region, copy and affordance
 * (DESIGN §3.4). Web and mobile render its output; neither writes knowledge copy of its own.
 *
 * A message names the cause only (R-K3); the affordance is a separate field the component renders
 * exactly once. Negative domain copy comes only from a complete known value (R-K1).
 */
import type {
  FailureReason,
  Known,
  Prerequisite,
  Shown,
  StaleReason,
  WithheldReason,
  WithholdingCause,
} from "./known.ts";

/** The system that answers for a region's fact, named in its failure copy. */
export type KnowledgeSource = "zerops" | "gitea" | "mate";

export interface KnownSurface<T> {
  /** What the region reads, as the object of "Couldn't read …": "pull requests", "this project". */
  readonly subject: string;
  /** What `gone` proves absent, as "This … is no longer available": "project", "service". */
  readonly entity: string;
  readonly source: KnowledgeSource;
  /** The region's own checking phrase, e.g. "Checking what runs here…"; `null` for "Checking…". */
  readonly checking: string | null;
  /** The domain-negative copy for a value, e.g. "No open pull requests"; `null` when it has none. */
  readonly negative: ((value: T) => string | null) | null;
}

export interface PresentationContext {
  readonly nowMs: number;
  /** The Mate's descriptor offers an update (MU-1). */
  readonly updateOffered: boolean;
}

export const KNOWN_AFFORDANCE_LABELS = [
  "Try again",
  "Try now",
  "Update",
  "Go to projects",
] as const;

export type KnownAffordance =
  | { readonly kind: "retry"; readonly label: "Try again" }
  | { readonly kind: "retry-now"; readonly label: "Try now" }
  /** `access: renew-now` — a grant round at once. */
  | { readonly kind: "renew-access"; readonly label: "Try now" }
  | { readonly kind: "update"; readonly label: "Update" }
  | { readonly kind: "go-to-projects"; readonly label: "Go to projects" };

export interface KnownMessage {
  readonly text: string;
  /** How long the region waits before it shows the message; a quick answer never flickers. */
  readonly afterMs: number;
  readonly tone: "quiet" | "notice" | "alert";
}

/** An app-level banner: one per key, however many regions it covers. */
export interface KnownBanner {
  readonly key: WithheldReason;
  readonly message: KnownMessage;
  readonly affordance: KnownAffordance | null;
}

export interface KnownPresentation {
  /** A placeholder at the region's final height, a region-level message, or the value. */
  readonly region: "placeholder" | "message" | "value";
  readonly message: KnownMessage | null;
  readonly affordance: KnownAffordance | null;
  /**
   * The value is current. Currency-dependent verbs (Merge, Release, Roll back) run only while it
   * is; when it is not, `message` is the reason.
   */
  readonly current: boolean;
  /** The value's domain-negative copy, only from a complete known value. */
  readonly negative: string | null;
  readonly banner: KnownBanner | null;
}

const RETRY: KnownAffordance = { kind: "retry", label: "Try again" };
const RETRY_NOW: KnownAffordance = { kind: "retry-now", label: "Try now" };
const RENEW_ACCESS: KnownAffordance = { kind: "renew-access", label: "Try now" };
const UPDATE: KnownAffordance = { kind: "update", label: "Update" };
const GO_TO_PROJECTS: KnownAffordance = { kind: "go-to-projects", label: "Go to projects" };

const PLACEHOLDER_DELAY_MS = 400;
const REVALIDATING_DELAY_MS = 1_000;

const NOTHING: KnownPresentation = {
  region: "placeholder",
  message: null,
  affordance: null,
  current: false,
  negative: null,
  banner: null,
};

const say = (text: string, tone: KnownMessage["tone"], afterMs = 0): KnownMessage => ({
  text,
  afterMs,
  tone,
});

const WAITING_FOR: Record<Prerequisite, string> = {
  "zerops-session": "Signing in to Zerops…",
  "access-grant": "Checking your Zerops access…",
  "gitea-session": "Signing in to Gitea…",
  "mate-session": "Waiting for this Mate to connect…",
  presence: "Looking for this Mate…",
  visible: "Paused while this tab is in the background.",
  online: "Waiting for a connection…",
};

const SOURCE_NAME: Record<KnowledgeSource, { readonly subject: string; readonly object: string }> =
  {
    zerops: { subject: "Zerops", object: "Zerops" },
    gitea: { subject: "Gitea", object: "Gitea" },
    mate: { subject: "This Mate", object: "this Mate" },
  };

const TOO_OLD = "This Mate is too old for this.";

const sentence = (words: string): string => (/[.!?…]$/.test(words) ? words : `${words}.`);

/**
 * The cause of a failure, as one sentence. `ongoing` describes a condition that is still being
 * retried ("isn't answering"); `past` one finished attempt ("didn't answer").
 */
function cause(source: KnowledgeSource, failure: FailureReason, tense: "past" | "ongoing"): string {
  const { subject, object } = SOURCE_NAME[source];
  switch (failure.kind) {
    case "offline":
      return "You're offline.";
    case "timeout":
    case "transport":
    case "server":
      return tense === "past" ? `${subject} didn't answer.` : `${subject} isn't answering.`;
    case "throttled":
      return `${subject} is busy.`;
    case "unauthorized":
      return `Your sign-in to ${object} ended.`;
    case "refused":
      return failure.words.trim() === "" ? `${subject} said no.` : sentence(failure.words.trim());
    case "malformed":
      return `${subject} sent an answer that couldn't be read.`;
    case "unsupported":
      return source === "mate" ? TOO_OLD : `${subject} doesn't support this.`;
  }
}

function countdown(retryAtMs: number | null, nowMs: number): string | null {
  if (retryAtMs === null) return null;
  const seconds = Math.ceil((retryAtMs - nowMs) / 1_000);
  return seconds > 0 ? `Trying again in ${seconds} s.` : "Trying again now.";
}

const joined = (...parts: ReadonlyArray<string | null>): string =>
  parts.filter((part) => part !== null).join(" ");

export function knownPresentation<T>(
  shown: Shown<T>,
  surface: KnownSurface<T>,
  context: PresentationContext,
): KnownPresentation {
  switch (shown.state) {
    case "unread":
      return shown.waitingFor === null
        ? checking(surface)
        : { ...NOTHING, message: say(WAITING_FOR[shown.waitingFor], "quiet") };
    case "reading":
      return checking(surface);
    case "failed":
      return failed(shown.failure, surface, context);
    case "known":
      return knownValue(shown, surface, context);
    case "gone":
      return {
        ...NOTHING,
        region: "message",
        message: say(
          `This ${surface.entity} is no longer available. It was deleted, or you no longer have access.`,
          "notice",
        ),
        affordance: GO_TO_PROJECTS,
      };
    case "withheld":
      return withheld(shown.reason, shown.cause, context);
  }
}

const checking = <T>(surface: KnownSurface<T>): KnownPresentation => ({
  ...NOTHING,
  message: say(surface.checking ?? "Checking…", "quiet", PLACEHOLDER_DELAY_MS),
});

function failed<T>(
  failure: FailureReason,
  surface: KnownSurface<T>,
  context: PresentationContext,
): KnownPresentation {
  const unsupported = failure.kind === "unsupported";
  return {
    ...NOTHING,
    region: "message",
    message: say(
      unsupported && surface.source === "mate"
        ? `${TOO_OLD} Updating it adds it.`
        : `Couldn't read ${surface.subject}. ${cause(surface.source, failure, "past")}`,
      "alert",
    ),
    affordance: unsupported ? updateIfOffered(context) : RETRY,
  };
}

/** An unsupported capability is never retried automatically; an update, when offered, adds it. */
const updateIfOffered = (context: PresentationContext): KnownAffordance | null =>
  context.updateOffered ? UPDATE : null;

function knownValue<T>(
  shown: Extract<Known<T>, { state: "known" }>,
  surface: KnownSurface<T>,
  context: PresentationContext,
): KnownPresentation {
  const complete = shown.coverage === "complete";
  const value: KnownPresentation = {
    ...NOTHING,
    region: "value",
    current: true,
    negative: complete && surface.negative !== null ? surface.negative(shown.value) : null,
    message: complete ? null : say("Still reading…", "quiet"),
  };
  const freshness = shown.freshness;
  switch (freshness.kind) {
    case "live":
    case "settled":
      return value;
    case "revalidating":
      return complete
        ? { ...value, message: say("Updating…", "quiet", REVALIDATING_DELAY_MS) }
        : value;
    case "paused":
      return {
        ...value,
        current: false,
        message: say(
          freshness.by === "background"
            ? "Paused while this tab is in the background."
            : "Paused while you're offline.",
          "notice",
        ),
      };
    case "stale":
      return {
        ...value,
        current: false,
        ...staleMarker(freshness.reason, surface, context),
      };
  }
}

function staleMarker<T>(
  reason: StaleReason,
  surface: KnownSurface<T>,
  context: PresentationContext,
): Pick<KnownPresentation, "message" | "affordance"> {
  switch (reason.kind) {
    case "source-recovering":
      return { message: say("Reconnecting…", "notice"), affordance: RETRY_NOW };
    case "revalidation-failed": {
      const unsupported = reason.failure.kind === "unsupported";
      return {
        message: say(
          joined(
            "Not up to date.",
            cause(surface.source, reason.failure, "past"),
            unsupported ? null : countdown(reason.retryAtMs, context.nowMs),
          ),
          "notice",
        ),
        affordance: unsupported ? updateIfOffered(context) : RETRY_NOW,
      };
    }
    case "invalidated":
    case "superseded":
      return { message: say("Not up to date.", "notice"), affordance: RETRY_NOW };
  }
}

function withheld(
  reason: WithheldReason,
  withholding: WithholdingCause,
  context: PresentationContext,
): KnownPresentation {
  switch (reason) {
    case "access-lapsed":
      return {
        ...NOTHING,
        banner:
          withholding === null
            ? {
                key: reason,
                message: say("Checking your Zerops access…", "quiet"),
                affordance: null,
              }
            : {
                key: reason,
                message: say(
                  joined(
                    cause("zerops", withholding.failure, "ongoing"),
                    countdown(withholding.retryAtMs, context.nowMs),
                  ),
                  "alert",
                ),
                affordance: RENEW_ACCESS,
              },
      };
    case "access-unverified":
      return { ...NOTHING, message: say("Checking your access to this project…", "quiet") };
    case "access-denied":
      return {
        ...NOTHING,
        message: say("Your access to this project changed.", "alert"),
        affordance: GO_TO_PROJECTS,
      };
  }
}
