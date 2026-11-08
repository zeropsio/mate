/**
 * codexAccount — whether Codex itself accepts the login in a home: its app-server's answer to
 * `account/read`, the same account Codex runs turns on. `codex login status` only reads the login
 * file, so it says "Logged in" over a login whose token OpenAI no longer refreshes (live on a
 * Mate idle for a month: `account/read` answered no account, `requiresOpenaiAuth`, while
 * `codex login status` printed "Logged in using ChatGPT").
 *
 * This module is the one place `zerops/**` reaches the Codex app-server client.
 *
 * @module codexAccount
 */
import type { ServerProviderAuthStatus } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as CodexSchema from "effect-codex-app-server/schema";

import { withCodexAppServerClient } from "../provider/Layers/CodexProvider.ts";

/** An app-server start and one account read; Codex refreshes a stale token inside it. */
const CODEX_ACCOUNT_READ_TIMEOUT = Duration.seconds(20);

export interface CodexAccountAnswer {
  readonly status: ServerProviderAuthStatus;
  /** Why the answer is `unknown`: a fixed line, never Codex's own output. */
  readonly reason?: string;
}

/**
 * An account is a login Codex accepts; none while it requires an OpenAI login is a login it
 * refuses. None without that requirement runs on a provider that needs no OpenAI login.
 */
export const codexAccountAuthStatus = (
  response: CodexSchema.V2GetAccountResponse,
): ServerProviderAuthStatus =>
  response.account || !response.requiresOpenaiAuth ? "authenticated" : "unauthenticated";

/** Codex's own answer for the login in `homePath` (`CODEX_HOME`; absent, Codex's default home). */
export const readCodexAccountAuth = (input: {
  readonly cwd: string;
  readonly homePath?: string;
}): Effect.Effect<CodexAccountAnswer, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const { client } = yield* withCodexAppServerClient({
      binaryPath: "codex",
      cwd: input.cwd,
      ...(input.homePath === undefined ? {} : { homePath: input.homePath }),
    });
    return yield* client.request("account/read", {});
  }).pipe(
    Effect.scoped,
    Effect.timeoutOption(CODEX_ACCOUNT_READ_TIMEOUT),
    Effect.map(
      Option.match({
        onNone: (): CodexAccountAnswer => ({
          status: "unknown",
          reason: "The login check timed out.",
        }),
        onSome: (response): CodexAccountAnswer => ({ status: codexAccountAuthStatus(response) }),
      }),
    ),
    Effect.catch((cause) =>
      Effect.logWarning("zerops agent auth: Codex account read failed", { cause }).pipe(
        Effect.as<CodexAccountAnswer>({
          status: "unknown",
          reason: "The login check could not be started.",
        }),
      ),
    ),
  );
