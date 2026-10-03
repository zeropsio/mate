/**
 * A new Mate's setup as its own server tells it: the facts `GET /setup.json`
 * reports, and the rule that starts the stand-up here rather than in a browser.
 *
 * Pure. `ZeropsSetup` gathers the facts — zcp's status file
 * (`ZCP_STATUS_FILE`), the project's tags, the broker's variables, the durable
 * stand-up record — and these functions decide what they mean.
 *
 * The document is public, so it carries steps and times only: no names, no
 * error text, no ids (the setup contract, pass 28).
 *
 * @module zeropsSetupSteps
 */
import type { OrchestrationCommand, ZeropsAgentId } from "@t3tools/contracts";
import { readSignerTags } from "@t3tools/shared/zeropsAgentAuth";

/* ------------------------------------------------------------ the stand-up */

/** The ask, word for word, as the browser has sent it (`apps/web/src/zerops/mateStandUp.ts`). */
export const STAND_UP_MESSAGE = "Stand up development of the project.";

/** Who asked for the stand-up: `mate:standup:<userId>`, written by the press that made the Mate. */
export const STAND_UP_TAG_PREFIX = "mate:standup:";

const STAND_UP_ID_PREFIX = "mate-standup-";

/**
 * The stand-up's command and message ids — the browser's own for its first
 * attempt, so a browser that sends it too is the same command, which the
 * engine takes once (its receipts).
 */
export const standUpCommandIds = (threadId: string, attempt = 1) => {
  const id = `${STAND_UP_ID_PREFIX}${threadId}-${attempt}`;
  return { commandId: id, messageId: id };
};

/** Whether a command is a browser's stand-up, any attempt of it. */
export const isStandUpCommand = (command: OrchestrationCommand): boolean =>
  command.type === "thread.turn.start" && command.commandId.startsWith(STAND_UP_ID_PREFIX);

export const standUpRequestedBy = (tags: ReadonlyArray<string>): string | undefined => {
  for (const tag of tags) {
    if (!tag.startsWith(STAND_UP_TAG_PREFIX)) continue;
    const userId = tag.slice(STAND_UP_TAG_PREFIX.length);
    if (userId.length > 0) return userId;
  }
  return undefined;
};

/** The order an agent is chosen in when a person signed in both. */
const AGENT_ORDER: ReadonlyArray<ZeropsAgentId> = ["claude-code", "codex"];

/**
 * The agents `userId` alone signed in on this project (`mate:signer:{agent}:{userId}`).
 * An agent recorded for two people is nobody's until signed in again (D6).
 */
export const standUpSigners = (
  tags: ReadonlyArray<string>,
  userId: string,
): ReadonlyArray<ZeropsAgentId> => {
  const signers = readSignerTags(tags, (key) =>
    (AGENT_ORDER as ReadonlyArray<string>).includes(key),
  );
  return AGENT_ORDER.filter((agentId) => signers[agentId] === userId);
};

export type StandUpDecision =
  /** On the agent the asker signed in. */
  | { readonly kind: "start"; readonly userId: string; readonly agentId: ZeropsAgentId }
  /** On an agent Mate signs nobody in to, ready: it runs for the asker as for anybody. */
  | { readonly kind: "start"; readonly userId: string; readonly instanceId: string }
  /** Nobody asked yet, or the asker has no agent to run. */
  | { readonly kind: "wait" }
  /** This server has a record of one: started here or by a browser. */
  | { readonly kind: "done" }
  /** The main conversation was spoken in before: its stand-up happened elsewhere. */
  | { readonly kind: "spoken" };

/**
 * Whether to start the stand-up now: asked for by someone with an agent to run
 * — one they signed in, else one Mate signs nobody in to that is ready — never
 * twice, and never into a conversation already under way. Their own sign-in
 * comes first: it is the agent they chose.
 */
export const standUpDecision = (input: {
  readonly recorded: boolean;
  readonly requestedBy: string | undefined;
  readonly signers: ReadonlyArray<ZeropsAgentId>;
  /** The instance of a ready agent outside the sign-in (`pickReadyAgentWithoutSignIn`). */
  readonly ready?: string | undefined;
  readonly spoken: boolean;
}): StandUpDecision => {
  if (input.recorded) return { kind: "done" };
  if (input.requestedBy === undefined) return { kind: "wait" };
  const agentId = AGENT_ORDER.find((agent) => input.signers.includes(agent));
  const start: StandUpDecision | undefined =
    agentId !== undefined
      ? { kind: "start", userId: input.requestedBy, agentId }
      : input.ready !== undefined
        ? { kind: "start", userId: input.requestedBy, instanceId: input.ready }
        : undefined;
  if (start === undefined) return { kind: "wait" };
  return input.spoken ? { kind: "spoken" } : start;
};

/* ------------------------------------------------------------ git */

/** What the broker delivers onto the zcp service once the Mate is registered. */
export const GIT_VARIABLES: ReadonlyArray<string> = ["GITEA_URL", "GITEA_TOKEN", "MATE_BROKER_URL"];

export const hasGitVariables = (keys: Iterable<string>): boolean => {
  const present = new Set(keys);
  return GIT_VARIABLES.every((key) => present.has(key));
};

/* ------------------------------------------------------------ zcp's status file */

export type RuntimesState = "none" | "pending" | "importing" | "done" | "failed";
export type StandUpState = "idle" | "running" | "done" | "failed";
export type StandUpServiceStep = "build" | "deploy" | "verify";
export type StandUpServiceState = "pending" | "running" | "done" | "failed";

export interface StandUpService {
  readonly hostname: string;
  readonly step: StandUpServiceStep;
  readonly state: StandUpServiceState;
  readonly processId: string;
  readonly at: string;
  readonly error: string;
}

/** `ZCP_STATUS_FILE`, version 1, as far as this build reads it. */
export interface ZcpStatus {
  readonly updatedAt: string;
  readonly runtimes:
    | {
        /** A state this build does not know reads as `undefined`. */
        readonly state: RuntimesState | undefined;
        readonly startedAt: string;
        readonly endedAt: string;
      }
    | undefined;
  readonly standup:
    | {
        readonly state: StandUpState | undefined;
        /** zcp's heartbeat for this section; empty from a zcp that writes only the file's. */
        readonly updatedAt: string;
        readonly phase: string;
        readonly startedAt: string;
        readonly endedAt: string;
        readonly services: ReadonlyArray<StandUpService>;
      }
    | undefined;
}

const RUNTIMES_STATES: ReadonlyArray<RuntimesState> = [
  "none",
  "pending",
  "importing",
  "done",
  "failed",
];
const STAND_UP_STATES: ReadonlyArray<StandUpState> = ["idle", "running", "done", "failed"];
const SERVICE_STEPS: ReadonlyArray<StandUpServiceStep> = ["build", "deploy", "verify"];
const SERVICE_STATES: ReadonlyArray<StandUpServiceState> = ["pending", "running", "done", "failed"];

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const oneOf = <T extends string>(values: ReadonlyArray<T>, value: unknown): T | undefined =>
  (values as ReadonlyArray<unknown>).includes(value) ? (value as T) : undefined;

const readService = (value: unknown): StandUpService | undefined => {
  const row = record(value);
  const step = oneOf(SERVICE_STEPS, row?.["step"]);
  const state = oneOf(SERVICE_STATES, row?.["state"]);
  const hostname = text(row?.["hostname"]);
  if (row === undefined || step === undefined || state === undefined || hostname === "") {
    return undefined;
  }
  return {
    hostname,
    step,
    state,
    processId: text(row["processId"]),
    at: text(row["at"]),
    error: text(row["error"]),
  };
};

/**
 * zcp's status file, tolerantly: unknown fields are ignored, and a file of
 * another version is not read at all — a field only ever arrives with a
 * version bump.
 */
export const parseZcpStatus = (raw: unknown): ZcpStatus | undefined => {
  const file = record(raw);
  if (file === undefined || file["version"] !== 1) return undefined;
  const runtimes = record(file["runtimes"]);
  const standup = record(file["standup"]);
  return {
    updatedAt: text(file["updatedAt"]),
    runtimes:
      runtimes === undefined
        ? undefined
        : {
            state: oneOf(RUNTIMES_STATES, runtimes["state"]),
            startedAt: text(runtimes["startedAt"]),
            endedAt: text(runtimes["endedAt"]),
          },
    standup:
      standup === undefined
        ? undefined
        : {
            state: oneOf(STAND_UP_STATES, standup["state"]),
            updatedAt: text(standup["updatedAt"]),
            phase: text(standup["phase"]),
            startedAt: text(standup["startedAt"]),
            endedAt: text(standup["endedAt"]),
            services: (Array.isArray(standup["services"]) ? standup["services"] : []).flatMap(
              (service) => {
                const read = readService(service);
                return read === undefined ? [] : [read];
              },
            ),
          },
  };
};

/**
 * zcp refreshes its file's `updatedAt` every 15 s while a stand-up runs; one
 * left `running` and not refreshed for longer than this lost its MCP server.
 */
export const STAND_UP_STALE_AFTER_MS = 2 * 60_000;

/** A stand-up the file says runs, from a zcp that stopped writing it. */
export const isStaleStandUp = (status: ZcpStatus | undefined, nowMs: number): boolean => {
  if (status?.standup?.state !== "running") return false;
  // The section's own heartbeat, else the file's.
  const updated = Date.parse(status.standup.updatedAt || status.updatedAt);
  return Number.isFinite(updated) && nowMs - updated > STAND_UP_STALE_AFTER_MS;
};

/* ------------------------------------------------------------ the document */

export type SetupStepId = "container" | "git" | "runtimes" | "signin" | "standup";

export interface SetupStep {
  readonly id: SetupStepId;
  readonly state: string;
  /** When the step reached its state, RFC 3339; empty when not known. */
  readonly at: string;
}

export interface SetupDocument {
  readonly version: 1;
  readonly at: string;
  readonly steps: ReadonlyArray<SetupStep>;
}

export interface SetupFacts {
  readonly now: string;
  /** When this server started: the container is up. */
  readonly startedAt: string;
  /** When the broker's variables were first seen on the zcp service. */
  readonly gitAt: string | undefined;
  /** zcp's status file; `undefined` when absent (an older zcp) or unreadable. */
  readonly status: ZcpStatus | undefined;
  /** Whether the project's tags have been read at all. */
  readonly tagsRead: boolean;
  /** Who asked for the stand-up, by the project's tags. */
  readonly requestedBy: string | undefined;
  /**
   * When the asker's sign-in — anybody's, when nobody asked — was first seen recorded, or an
   * agent Mate signs nobody in to (Cursor, OpenCode…) first seen ready.
   */
  readonly signinAt: string | undefined;
  /**
   * The durable record of the stand-up: `ran`, started here or by a browser;
   * else settled as never due (nobody asked, or the conversation was under way).
   */
  readonly record:
    | {
        readonly startedAt: string;
        readonly ran: boolean;
        /** Claimed, its send not confirmed out yet: its turn may not exist yet. */
        readonly claimed?: boolean;
      }
    | undefined;
  /** Steps this server cannot say: left out of the document rather than guessed. */
  readonly unknown?: ReadonlyArray<"signin" | "standup">;
  /**
   * The recorded stand-up's own turn — the one its ask started, never a later one: whether it
   * runs, or how it ended; `undefined` where it is not read (no record that ran, its thread gone).
   */
  readonly standUpTurn: "running" | "done" | "failed" | undefined;
}

const RUNTIMES_STEP: Readonly<Record<RuntimesState, string>> = {
  none: "none",
  pending: "waiting",
  importing: "running",
  done: "done",
  failed: "failed",
};

const runtimesStep = (status: ZcpStatus | undefined): SetupStep => {
  const runtimes = status?.runtimes;
  if (runtimes?.state === undefined) return { id: "runtimes", state: "unknown", at: "" };
  const state = RUNTIMES_STEP[runtimes.state];
  const at =
    state === "done" || state === "failed"
      ? runtimes.endedAt
      : state === "running"
        ? runtimes.startedAt
        : "";
  return { id: "runtimes", state, at };
};

/**
 * What zcp's stand-up section says of the whole stand-up. A zcp before its stage-call fix ends
 * its first call `done` and leaves the stage halves `pending` for a second call; while the
 * stand-up this server recorded still runs its own turn, that is not the stand-up's end. Anywhere
 * else — a stand-up settled as never due, its own turn over or not read — zcp's word stands: a
 * newer zcp keeps its section `running` between the two calls itself.
 */
const zcpStandUpState = (facts: SetupFacts): Exclude<StandUpState, "idle"> | undefined => {
  if (isStaleStandUp(facts.status, Date.parse(facts.now))) return "failed";
  const standup = facts.status?.standup;
  const state = standup?.state;
  if (state !== "running" && state !== "done" && state !== "failed") return undefined;
  const halvesLeft = standup!.services.some((service) => service.state === "pending");
  const ownTurnRuns = facts.record?.ran === true && facts.standUpTurn === "running";
  return state === "done" && halvesLeft && ownTurnRuns ? "running" : state;
};

const standUpStep = (facts: SetupFacts): SetupStep | null => {
  const standup = facts.status?.standup;
  const zcpState = zcpStandUpState(facts);
  // Settled as never due: nothing ran here, so nothing is done — unless zcp ran one.
  if (facts.record !== undefined && !facts.record.ran) {
    return { id: "standup", state: zcpState ?? "none", at: "" };
  }
  if (facts.record === undefined) {
    if (zcpState !== undefined)
      return { id: "standup", state: zcpState, at: standup?.startedAt ?? "" };
    // Nothing asked and nothing started: a Mate with no stand-up to run — once
    // the tags have been read to say so.
    return facts.tagsRead && facts.requestedBy === undefined
      ? { id: "standup", state: "none", at: "" }
      : { id: "standup", state: "waiting", at: "" };
  }
  // zcp's word, else its own turn's; with neither — its thread gone, its turn not found, and a
  // zcp that writes nothing — the server cannot say, and says nothing rather than running for good.
  const state = zcpState ?? facts.standUpTurn;
  // Claimed and not sent yet, its turn is still to come; only a stand-up confirmed out whose turn
  // is gone leaves the step out.
  if (state === undefined)
    return facts.record.claimed === true ? { id: "standup", state: "waiting", at: "" } : null;
  const ended = state === "done" || state === "failed";
  const at =
    (ended ? standup?.endedAt : standup?.startedAt) || (ended ? "" : facts.record.startedAt);
  return { id: "standup", state, at };
};

export const setupDocument = (facts: SetupFacts): SetupDocument => ({
  version: 1,
  at: facts.now,
  steps: (
    [
      { id: "container", state: "done", at: facts.startedAt },
      facts.gitAt === undefined
        ? { id: "git", state: "waiting", at: "" }
        : { id: "git", state: "done", at: facts.gitAt },
      runtimesStep(facts.status),
      facts.signinAt === undefined
        ? { id: "signin", state: "waiting", at: "" }
        : { id: "signin", state: "done", at: facts.signinAt },
      standUpStep(facts),
    ] satisfies ReadonlyArray<SetupStep | null>
  ).filter(
    (step): step is SetupStep =>
      step !== null && !(facts.unknown ?? []).some((id) => id === step.id),
  ),
});
