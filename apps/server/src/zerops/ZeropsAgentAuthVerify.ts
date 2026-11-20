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
 * - Cursor: `cursor-agent status --format json`, one line of JSON whose
 *   `isAuthenticated` is a boolean (live-verified signed out:
 *   `{"status":"unauthenticated","isAuthenticated":false,…}`).
 * - Grok: `grok models`, which exits 0 either way and says so in words:
 *   "You are logged in with grok.com." or "You are not authenticated."
 *   (the signed-out line live-verified), read as the Grok driver reads it.
 * - Antigravity: `agy models`, read as the Antigravity driver reads it
 *   (signed out it exits 1 with "Please sign in", live-verified on agy
 *   1.5.13), and run without the Gemini and Google Cloud variables the
 *   driver never passes on: a project's API key would sign it in to that
 *   key's bill instead of the person's Google account.
 *
 * Both readings come from `spi/agentSignInChecks.ts`.
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
import {
  GOOGLE_BILLING_VARIABLES,
  parseAgyModelsAuth,
  parseGrokModelsCliOutput,
} from "../spi/agentSignInChecks.ts";
import type { CodexAccountAnswer } from "../spi/codexAccount.ts";

/** Generous for a local CLI status check — it answers from a cached login file, no network round trip. */
const AGENT_AUTH_PROBE_TIMEOUT = Duration.seconds(10);
/** The output is a few short lines; the cap only guards a pathological answer. */
const AGENT_AUTH_PROBE_MAX_OUTPUT_BYTES = 16 * 1024;

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

/** `cursor-agent status --format json`: only a boolean `isAuthenticated` is an answer. */
const parseCursorAuthStatus = (stdout: string): ServerProviderAuthStatus => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return "unknown";
  }
  if (typeof parsed !== "object" || parsed === null) {
    return "unknown";
  }
  const isAuthenticated = (parsed as { isAuthenticated?: unknown }).isAuthenticated;
  if (typeof isAuthenticated !== "boolean") {
    return "unknown";
  }
  return isAuthenticated ? "authenticated" : "unauthenticated";
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
  timeout?: Duration.Duration,
  /** Variables of the server's own environment the command runs without. */
  without?: ReadonlyArray<string>,
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
     * Added to the server's own environment: a login beyond the defaults, or
     * a sign-in still in its scratch home, checks that home
     * (`ZeropsLogins.mateLoginEnvironment`). The defaults pass none.
     */
    env?: Readonly<Record<string, string>>,
  ): AgentAuthProbeSpawn =>
  (command, args, timeout = AGENT_AUTH_PROBE_TIMEOUT, without = []) =>
    processRunner
      .run({
        command,
        args,
        cwd,
        // An `undefined` variable is removed from the inherited environment.
        ...(env === undefined && without.length === 0
          ? {}
          : { env: { ...env, ...Object.fromEntries(without.map((name) => [name, undefined])) } }),
        timeout,
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
  /** Runs each agent's status command but Codex's; {@link spawnAgentAuthProbe} in production. */
  readonly spawn: AgentAuthProbeSpawn;
  /** Codex's own account answer; `spi/codexAccount.ts`'s `readCodexAccountAuth` in production. */
  readonly codexAccount: Effect.Effect<CodexAccountAnswer>;
}

/** One agent's own login check: an argv list, never a shell string, and how to read its answer. */
interface AgentAuthProbe {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** Grok and Antigravity ask their service over the network before answering. */
  readonly timeout: Duration.Duration;
  readonly without?: ReadonlyArray<string>;
  readonly parse: (outcome: AgentAuthProbeOutcome) => ServerProviderAuthStatus;
}

const AGENT_AUTH_PROBES: Readonly<Record<Exclude<ZeropsAgentId, "codex">, AgentAuthProbe>> = {
  "claude-code": {
    command: "claude",
    args: ["auth", "status"],
    timeout: AGENT_AUTH_PROBE_TIMEOUT,
    parse: (outcome) => parseClaudeAuthStatus(outcome.stdout),
  },
  antigravity: {
    command: "agy",
    args: ["models"],
    timeout: Duration.seconds(30),
    without: GOOGLE_BILLING_VARIABLES,
    parse: (outcome) => parseAgyModelsAuth(`${outcome.stdout}\n${outcome.stderr}`, outcome.code),
  },
  grok: {
    command: "grok",
    args: ["models"],
    timeout: Duration.seconds(20),
    parse: (outcome) => {
      const { authenticated } = parseGrokModelsCliOutput(`${outcome.stdout}\n${outcome.stderr}`);
      return authenticated === null
        ? "unknown"
        : authenticated
          ? "authenticated"
          : "unauthenticated";
    },
  },
  cursor: {
    command: "cursor-agent",
    args: ["status", "--format", "json"],
    timeout: Duration.seconds(15),
    parse: (outcome) => parseCursorAuthStatus(outcome.stdout),
  },
};

const probeAnswer = (
  spawn: AgentAuthProbeSpawn,
  probe: AgentAuthProbe,
): Effect.Effect<Omit<AgentAuthVerification, "checkedAt">> =>
  spawn(probe.command, probe.args, probe.timeout, probe.without).pipe(
    Effect.map((outcome) => {
      const status = outcome.timedOut || outcome.reason ? "unknown" : probe.parse(outcome);
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
    const answer = yield* agentId === "codex"
      ? checks.codexAccount
      : probeAnswer(checks.spawn, AGENT_AUTH_PROBES[agentId]);
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
