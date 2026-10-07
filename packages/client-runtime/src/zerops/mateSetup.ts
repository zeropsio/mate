/**
 * A Mate's setup as its own server tells it: `GET /mate/setup.json`, public, beside
 * `/mate/healthz` (the setup contract, pass 28). The press does every step that needs the person's
 * rights; the container does the rest — zcp imports the tier's runtimes on boot and enrolls the
 * Mate with its HQ, which is its Git access, the server starts the stand-up — and this is how any
 * browser, or none, sees where that stands.
 *
 * ```json
 * { "version": 1, "at": "RFC3339", "steps": [
 *   { "id": "container", "state": "done", "at": "" },
 *   { "id": "git",       "state": "waiting|done|failed", "at": "",
 *                        "reason": "no_hq|refused", "code": "…" },
 *   { "id": "runtimes",  "state": "none|waiting|running|done|failed|unknown", "at": "" },
 *   { "id": "signin",    "state": "waiting|done", "at": "" },
 *   { "id": "standup",   "state": "none|waiting|running|done|failed", "at": "",
 *                        "reason": "send_failed|process_gone|stage_not_built" } ] }
 * ```
 *
 * A failed stand-up says why where its server knows: its ask never went out (`send_failed`, the
 * one failure the server's manual retry is for); the process running it stopped
 * (`process_gone`); its turn ended before the previews were built (`stage_not_built`) —
 * development stands.
 *
 * A step that has not run is never `done`: a Mate nobody asked a stand-up of (a New project's
 * first) says `none`, as its runtimes do with nothing to import.
 *
 * It carries no names, no error text and no secrets. A `404` is a server outside a Zerops project,
 * which has no setup to tell; inside one, a redirect or a refusal, and an answer that is not this
 * document, are failures of their own, never an absence. A step or a state this build does not
 * know is ignored, never guessed at — a field is only ever added with a `version` bump.
 *
 * Read as `containerHealth.ts` reads: a plain header-less GET with `redirect: "manual"`, which
 * forces no CORS preflight.
 *
 * @module mateSetup
 */

export type MateSetupStepId = "container" | "git" | "runtimes" | "signin" | "standup";

export type MateSetupRuntimesState = "none" | "waiting" | "running" | "done" | "failed" | "unknown";

/** Why a stand-up failed, as its server said it. */
export type MateSetupStandUpFailure = "send_failed" | "process_gone" | "stage_not_built";

const STAND_UP_FAILURES: ReadonlySet<string> = new Set<MateSetupStandUpFailure>([
  "send_failed",
  "process_gone",
  "stage_not_built",
]);

/**
 * A failed stand-up's reason as the person reads it; none for an ask that never went out, whose
 * retry says it, or for a failure whose reason is not known.
 */
export function standUpFailureWords(
  failure: MateSetupStandUpFailure | undefined,
): string | undefined {
  switch (failure) {
    case "process_gone":
      return "The stand-up's process stopped.";
    case "stage_not_built":
      return "Development is up; the previews were not built — ask the agent to build them, or deploy them by hand.";
    default:
      return undefined;
  }
}

/**
 * Why the Mate's Git access — its enrollment with HQ — failed, as zcp said: no official HQ in the
 * organization, or HQ's refusal with its code.
 */
export type MateSetupGitFailure =
  | { readonly reason: "no_hq" }
  | { readonly reason: "refused"; readonly code?: string };

export interface MateSetup {
  readonly at: string;
  readonly container?: "done";
  readonly git?: "waiting" | "done" | "failed";
  /** Why, with `git: "failed"` and a reason this build knows; never guessed. */
  readonly gitFailure?: MateSetupGitFailure;
  readonly runtimes?: MateSetupRuntimesState;
  readonly signin?: "waiting" | "done";
  /**
   * Why, with `standup: "failed"` and a reason this build knows; never guessed. Only
   * `send_failed` offers the server's manual retry.
   */
  readonly standupFailure?: MateSetupStandUpFailure;
  readonly standup?: "none" | "waiting" | "running" | "done" | "failed";
}

const STATES: { readonly [Id in MateSetupStepId]: ReadonlySet<string> } = {
  container: new Set(["done"]),
  git: new Set(["waiting", "done", "failed"]),
  runtimes: new Set(["none", "waiting", "running", "done", "failed", "unknown"]),
  signin: new Set(["waiting", "done"]),
  standup: new Set(["none", "waiting", "running", "done", "failed"]),
};

const isStepId = (id: unknown): id is MateSetupStepId =>
  typeof id === "string" && Object.hasOwn(STATES, id);

/** The document, or `undefined` for one this build cannot read as version 1. */
export function parseMateSetup(body: unknown): MateSetup | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { version, at, steps } = body as { version?: unknown; at?: unknown; steps?: unknown };
  // A later version only adds: the steps this build knows read the same.
  if (typeof version !== "number" || version < 1 || !Array.isArray(steps)) return undefined;
  const read: Record<string, unknown> = {};
  for (const step of steps) {
    if (typeof step !== "object" || step === null) continue;
    const { id, state } = step as { id?: unknown; state?: unknown };
    if (!isStepId(id) || typeof state !== "string" || !STATES[id].has(state)) continue;
    read[id] = state;
    if (id === "standup" && state === "failed") {
      const reason = (step as { reason?: unknown }).reason;
      if (typeof reason === "string" && STAND_UP_FAILURES.has(reason))
        read["standupFailure"] = reason;
    }
    if (id === "git" && state === "failed") {
      const failure = gitFailureOf(step as { reason?: unknown; code?: unknown });
      if (failure !== undefined) read["gitFailure"] = failure;
    }
  }
  return { at: typeof at === "string" ? at : "", ...read } as MateSetup;
}

function gitFailureOf(step: {
  readonly reason?: unknown;
  readonly code?: unknown;
}): MateSetupGitFailure | undefined {
  if (step.reason === "no_hq") return { reason: "no_hq" };
  if (step.reason !== "refused") return undefined;
  return typeof step.code === "string"
    ? { reason: "refused", code: step.code }
    : { reason: "refused" };
}

export type MateSetupReading =
  | { readonly kind: "setup"; readonly setup: MateSetup }
  /** `404`: a server outside a Zerops project, which has no setup. */
  | { readonly kind: "absent" }
  /** Turned away: a redirect before the route, or a refusal of the read. */
  | { readonly kind: "refused" }
  /** An answer that is not this document. */
  | { readonly kind: "invalid" }
  /** No answer: down, or still starting. */
  | { readonly kind: "unreachable" };

/** Why a Mate's setup can't be read, where it is served. */
export type MateSetupFailure = Extract<
  MateSetupReading,
  { readonly kind: "refused" | "invalid" }
>["kind"];

export { readMateSetup } from "../data/adapters/mateSetupWire.ts";
