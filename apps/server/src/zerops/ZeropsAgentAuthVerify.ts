/**
 * Each agent CLI's OWN authentication check — S7 follow-up F1.
 *
 * `ProviderRegistry.refreshInstance` (upstream's own provider probe) reports
 * `authenticated` for Claude Code off `~/.claude.json`'s account section
 * alone, even when the credential artifact itself
 * (`~/.claude/.credentials.json`) is absent — live-verified false positive
 * (docs/internals/zerops/verified.md, S7 agent-auth findings). Gating the
 * platform flag write on that probe would upsert the platform OAuth flag for
 * a session that is not actually usable.
 *
 * This module runs each agent CLI's own status command instead — the same
 * argv-list spawn shape {@link ZeropsCli} uses for `zcp` (a command plus a
 * fixed argument list, no shell to interpret metacharacters) — and reduces
 * its output to the {@link ServerProviderAuthStatus} vocabulary:
 *
 * - `claude auth status` prints one line of JSON, `{"loggedIn": boolean,
 *   "authMethod": string}` (live-verified, CLI 2.1.251). `loggedIn` is the
 *   only field this module reads.
 * - `codex login status` prints plain text — `Not logged in` when signed
 *   out, `Logged in using ChatGPT` (or another method) when signed in.
 *   Live-verified only for the two lines above; the exact vocabulary of
 *   every success/failure line Codex can print, and whether its exit code
 *   ever disambiguates a case the text alone cannot, is unconfirmed pending
 *   a live-rig check (S7-3) — this module treats unrecognized text as
 *   `unknown` rather than guessing.
 *
 * `unknown` is the result for every failure mode that is not a confirmed
 * "signed in" / "signed out" answer: the binary is missing, the process
 * could not be spawned or timed out, or the output does not parse — never a
 * thrown error. {@link spawnAgentAuthProbe} is what collapses every
 * process-runner failure into that same empty-output shape, so
 * {@link verifyAgentAuth} has exactly one failure mode to reduce, not two.
 */
import type { ServerProviderAuthStatus, ZeropsAgentId } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import * as ProcessRunner from "../processRunner.ts";

/** Generous for a local CLI status check — both commands answer from a cached login file, no network round trip. */
const AGENT_AUTH_PROBE_TIMEOUT = Duration.seconds(10);
/** The output is one short line; the cap only guards a pathological answer. */
const AGENT_AUTH_PROBE_MAX_OUTPUT_BYTES = 16 * 1024;

/** One command+args invocation per agent — an argv list, never a shell string. */
const AGENT_AUTH_PROBE_COMMAND: Readonly<
  Record<ZeropsAgentId, { readonly command: string; readonly args: ReadonlyArray<string> }>
> = {
  "claude-code": { command: "claude", args: ["auth", "status"] },
  codex: { command: "codex", args: ["login", "status"] },
};

/**
 * `claude auth status`'s one-line JSON. Unparsable text, a non-object
 * document, or a `loggedIn` that is not a boolean all read as `unknown` —
 * never a guess.
 */
export const parseClaudeAuthStatus = (stdout: string): ServerProviderAuthStatus => {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return "unknown";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return "unknown";
  }
  if (typeof parsed !== "object" || parsed === null) {
    return "unknown";
  }
  const loggedIn = (parsed as { loggedIn?: unknown }).loggedIn;
  if (typeof loggedIn !== "boolean") {
    return "unknown";
  }
  return loggedIn ? "authenticated" : "unauthenticated";
};

/** Checked before {@link CODEX_LOGGED_IN_PATTERN}: "Not logged in" itself contains "logged in", so order matters. */
const CODEX_NOT_LOGGED_IN_PATTERN = /not\s+logged\s+in/i;
/** Matches "Logged in using ChatGPT", "Logged in using API key", etc. — the method name is not this module's concern. */
const CODEX_LOGGED_IN_PATTERN = /logged\s+in\s+using/i;

/**
 * `codex login status`'s plain-text answer. Checked against stdout and
 * stderr together — which stream Codex actually writes to is one of the
 * live-rig unknowns noted in the module header. Text that matches neither
 * known phrase reads as `unknown`.
 */
export const parseCodexLoginStatus = (stdout: string, stderr: string): ServerProviderAuthStatus => {
  const text = `${stdout}\n${stderr}`;
  if (CODEX_NOT_LOGGED_IN_PATTERN.test(text)) {
    return "unauthenticated";
  }
  if (CODEX_LOGGED_IN_PATTERN.test(text)) {
    return "authenticated";
  }
  return "unknown";
};

export interface AgentAuthProbeOutcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

/**
 * Runs one probe command and reports what it printed. Never fails — see the
 * module header for why every process-runner error reduces to the same
 * empty-output outcome here rather than a distinct error channel.
 */
export type AgentAuthProbeSpawn = (
  command: string,
  args: ReadonlyArray<string>,
) => Effect.Effect<AgentAuthProbeOutcome>;

/** An outcome no probe command would ever legitimately print — every parser reduces it to `unknown`. */
const EMPTY_PROBE_OUTCOME: AgentAuthProbeOutcome = { stdout: "", stderr: "", code: null };

/**
 * The real spawn: {@link ProcessRunner}, an argv list, never a shell. A
 * missing binary, a timeout, or any other process-runner failure all reduce
 * to {@link EMPTY_PROBE_OUTCOME} — logged as a warning here, since the
 * caller only ever sees "no usable output" and cannot distinguish "the
 * binary is missing" from "the process failed some other way" on its own.
 */
export const spawnAgentAuthProbe =
  (processRunner: ProcessRunner.ProcessRunner["Service"], cwd: string): AgentAuthProbeSpawn =>
  (command, args) =>
    processRunner
      .run({
        command,
        args,
        cwd,
        timeout: AGENT_AUTH_PROBE_TIMEOUT,
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: AGENT_AUTH_PROBE_MAX_OUTPUT_BYTES,
        outputMode: "truncate",
      })
      .pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("zerops agent auth: verification probe failed to run", {
            command,
            cause,
          }),
        ),
        Effect.orElseSucceed(() => EMPTY_PROBE_OUTCOME),
      );

/**
 * Runs `agentId`'s own status command through `spawn` and maps its output to
 * {@link ServerProviderAuthStatus}. `spawn` is injected so this stays
 * testable against canned outcomes — see `ZeropsAgentAuthVerify.test.ts` —
 * without a real process for every case; {@link spawnAgentAuthProbe} is the
 * only production implementation.
 */
export const verifyAgentAuth = (
  agentId: ZeropsAgentId,
  spawn: AgentAuthProbeSpawn,
): Effect.Effect<ServerProviderAuthStatus> =>
  Effect.gen(function* () {
    const { command, args } = AGENT_AUTH_PROBE_COMMAND[agentId];
    const outcome = yield* spawn(command, args);
    return agentId === "claude-code"
      ? parseClaudeAuthStatus(outcome.stdout)
      : parseCodexLoginStatus(outcome.stdout, outcome.stderr);
  });
