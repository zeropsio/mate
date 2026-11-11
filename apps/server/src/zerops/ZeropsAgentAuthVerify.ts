/**
 * Each agent CLI's OWN authentication check — S7 follow-up F1.
 *
 * `ProviderRegistry.refreshInstance` (upstream's own provider probe) reports
 * `authenticated` for Claude Code off `~/.claude.json`'s account section
 * alone, even when the credential artifact itself
 * (`~/.claude/.credentials.json`) is absent. Gating the
 * platform flag write on that probe would upsert the platform OAuth flag for
 * a session that is not actually usable.
 *
 * This module asks each agent itself instead, and reduces the answer to the
 * {@link ServerProviderAuthStatus} vocabulary:
 *
 * - Claude: `claude auth status`, spawned as an argv list ({@link ZeropsCli}'s
 *   shape for `zcp`, no shell), prints one line of JSON, `{"loggedIn": boolean,
 *   "authMethod": string}` (live-verified, CLI 2.1.251). `loggedIn` is the
 *   only field this module reads.
 * - Codex: its app-server's account (`spi/codexAccount.ts`) — not
 *   `codex login status`, which reads only the login file and says
 *   "Logged in" over a login Codex itself no longer accepts.
 *
 * `unknown` is the result for every failure mode that is not a confirmed
 * "signed in" / "signed out" answer: the binary is missing, the process
 * could not be spawned or timed out, or the output does not parse — never a
 * thrown error. The receipt retains a fixed, sanitized reason without CLI output.
 */
import type { ServerProviderAuthStatus, ZeropsAgentId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import * as ProcessRunner from "../processRunner.ts";
import type { CodexAccountAnswer } from "../spi/codexAccount.ts";

/** Generous for a local CLI status check — it answers from a cached login file, no network round trip. */
const AGENT_AUTH_PROBE_TIMEOUT = Duration.seconds(10);
/** The output is one short line; the cap only guards a pathological answer. */
const AGENT_AUTH_PROBE_MAX_OUTPUT_BYTES = 16 * 1024;

/** `claude auth status` — an argv list, never a shell string. */
const CLAUDE_AUTH_PROBE = { command: "claude", args: ["auth", "status"] } as const;

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

export interface AgentAuthProbeOutcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly timedOut?: boolean;
  readonly reason?: string;
}

/**
 * Runs one probe command and reports what it printed. Never fails — see the
 * module header for why every process-runner error reduces to the same
 * sanitized outcome here rather than a distinct error channel.
 */
export type AgentAuthProbeSpawn = (
  command: string,
  args: ReadonlyArray<string>,
) => Effect.Effect<AgentAuthProbeOutcome>;

/**
 * The real spawn: {@link ProcessRunner}, an argv list, never a shell. A
 * missing binary or spawn failure has a sanitized reason; timeouts retain
 * their own outcome. Raw output and exception text never enter the receipt.
 */
export const spawnAgentAuthProbe =
  (
    processRunner: ProcessRunner.ProcessRunner["Service"],
    cwd: string,
    /**
     * Added to the server's own environment: a login beyond the defaults
     * checks its own home (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`). The defaults
     * pass none.
     */
    env?: Readonly<Record<string, string>>,
  ): AgentAuthProbeSpawn =>
  (command, args) =>
    processRunner
      .run({
        command,
        args,
        cwd,
        ...(env === undefined ? {} : { env: { ...env } }),
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
        Effect.orElseSucceed(() => ({
          stdout: "",
          stderr: "",
          code: null,
          reason: "The login check could not be started.",
        })),
      );

/** How each agent is asked: injected so this stays testable against canned answers. */
export interface AgentAuthChecks {
  /** Runs `claude auth status`; {@link spawnAgentAuthProbe} in production. */
  readonly spawn: AgentAuthProbeSpawn;
  /** Codex's own account answer; `spi/codexAccount.ts`'s `readCodexAccountAuth` in production. */
  readonly codexAccount: Effect.Effect<CodexAccountAnswer>;
}

const claudeAuthAnswer = (
  spawn: AgentAuthProbeSpawn,
): Effect.Effect<Omit<AgentAuthVerification, "checkedAt">> =>
  spawn(CLAUDE_AUTH_PROBE.command, CLAUDE_AUTH_PROBE.args).pipe(
    Effect.map((outcome) => {
      const status =
        outcome.timedOut || outcome.reason ? "unknown" : parseClaudeAuthStatus(outcome.stdout);
      return status !== "unknown"
        ? { status }
        : {
            status,
            reason: outcome.timedOut
              ? "The login check timed out."
              : (outcome.reason ??
                (outcome.code === null
                  ? "The login check did not finish."
                  : "The login check returned an unrecognized answer.")),
          };
    }),
  );

/** Asks `agentId` whether it accepts its login ({@link AgentAuthChecks}). */
export const verifyAgentAuth = (
  agentId: ZeropsAgentId,
  checks: AgentAuthChecks,
): Effect.Effect<AgentAuthVerification> =>
  Effect.gen(function* () {
    const answer = yield* agentId === "claude-code"
      ? claudeAuthAnswer(checks.spawn)
      : checks.codexAccount;
    return {
      status: answer.status,
      checkedAt: yield* Clock.currentTimeMillis,
      ...(answer.reason === undefined ? {} : { reason: answer.reason }),
    };
  });

export interface AgentAuthVerification {
  readonly status: ServerProviderAuthStatus;
  readonly checkedAt: number;
  readonly reason?: string;
}
