/**
 * Scratch homes for sign-ins.
 *
 * A login's CLI signs in with a home of its own under `~/.mate/pending/<key>`
 * (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`), never the one the login works with:
 * Codex drops the credential it holds the moment its login starts, so an
 * attempt abandoned, cancelled or cut short by a restart would leave the login
 * with none. Only a sign-in that succeeded moves its credential into the
 * login's own home; every other end leaves that home as it was.
 *
 * @module zeropsLoginHomes
 */
import { type ZeropsAgentId, ZeropsAgentLoginError } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import { codexShadowHome } from "../spi/driverHomes.ts";
import { mateLoginCredentialPath, mateLoginEnvironment, seedClaudeConfig } from "./ZeropsLogins.ts";

/** The login a sign-in is for. */
export interface LoginHomeTarget {
  readonly agentId: ZeropsAgentId;
  /** The agent id for a default login, the login's own id for any other. */
  readonly key: string;
  /** A login beyond the defaults: its own environment, the home that makes it that login. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface LoginHomes {
  /** A fresh scratch home for the sign-in, and the environment its CLI runs with. */
  readonly prepare: (
    target: LoginHomeTarget,
  ) => Effect.Effect<Readonly<Record<string, string>>, ZeropsAgentLoginError>;
  /** Moves the credential the sign-in wrote into the login's own home; fails when it wrote none. */
  readonly commit: (target: LoginHomeTarget) => Effect.Effect<void, ZeropsAgentLoginError>;
  /** Drops the login's scratch home, whatever it holds. */
  readonly discard: (key: string) => Effect.Effect<void>;
}

/**
 * How long a success waits for the credential its CLI writes: Codex writes it before it prints its
 * success (measured), Claude stages it and renames it in, and nobody measured which comes first.
 */
export const CREDENTIAL_WAIT = Duration.seconds(5);
const CREDENTIAL_POLL = Duration.millis(200);

export interface LoginHomesOptions {
  /** Defaults to {@link CREDENTIAL_WAIT}; shortened by tests on a live clock. */
  readonly credentialWait?: Duration.Duration;
}

/** Where every sign-in's scratch home lives. */
const pendingRoot = (homeDir: string): string => `${homeDir}/.mate/pending`;

const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The scratch homes under `homeDir`. A server starts with none: whatever an earlier process left
 * there was an attempt it never finished.
 */
export const makeLoginHomes = (
  homeDir: string,
  { credentialWait = CREDENTIAL_WAIT }: LoginHomesOptions = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const pending = (key: string): string => `${pendingRoot(homeDir)}/${key}`;
    /** The home the login works with: the agent's default one, or the one its environment names. */
    const ownHome = (target: LoginHomeTarget): string =>
      target.agentId === "claude-code"
        ? (target.env?.["CLAUDE_CONFIG_DIR"] ?? `${homeDir}/.claude`)
        : (target.env?.["CODEX_HOME"] ?? `${homeDir}/.codex`);
    /** Claude's global config: the default login's beside its home, any other's inside it. */
    const claudeConfig = (target: LoginHomeTarget): string => {
      const dir = target.env?.["CLAUDE_CONFIG_DIR"];
      return dir === undefined ? `${homeDir}/.claude.json` : `${dir}/.claude.json`;
    };
    const unavailable = (detail: string) =>
      new ZeropsAgentLoginError({ reason: "unavailable", detail });

    /** A JSON object on disk; anything else — absent, unreadable, not an object — is undefined. */
    const readRecord = (file: string) =>
      fs.readFileString(file).pipe(
        Effect.flatMap(decodeUnknownJson),
        Effect.map((value) => (isRecord(value) ? value : undefined)),
        Effect.orElseSucceed(() => undefined),
      );
    const drop = (dir: string) =>
      fs.remove(dir, { recursive: true, force: true }).pipe(Effect.ignore);

    yield* drop(pendingRoot(homeDir));

    const prepare: LoginHomes["prepare"] = (target) =>
      Effect.gen(function* () {
        const scratch = pending(target.key);
        yield* drop(scratch);
        yield* fs.makeDirectory(scratch, { recursive: true, mode: 0o700 });
        if (target.agentId === "claude-code") {
          // The login's own MCP servers, trust and finished onboarding, never its account.
          const config = yield* readRecord(claudeConfig(target));
          yield* fs.writeFileString(
            `${scratch}/.claude.json`,
            encodeJson(seedClaudeConfig(config)),
            {
              mode: 0o600,
            },
          );
        } else {
          // Every Codex login shares `~/.codex` but its `auth.json` — so does its sign-in.
          const shared = `${homeDir}/.codex`;
          yield* codexShadowHome({
            mode: "authOverlay",
            sharedHomePath: shared,
            effectiveHomePath: scratch,
            continuationKey: `codex:home:${shared}`,
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
          );
        }
        return { ...target.env, ...mateLoginEnvironment({ agent: target.agentId, home: scratch }) };
      }).pipe(Effect.mapError((error) => unavailable(error.message)));

    const commit: LoginHomes["commit"] = (target) =>
      Effect.gen(function* () {
        const agent = target.agentId;
        const scratch = pending(target.key);
        const written = mateLoginCredentialPath({ agent, home: scratch });
        const landed = yield* fs.exists(written).pipe(
          Effect.repeat({
            until: (exists) => exists,
            schedule: Schedule.spaced(CREDENTIAL_POLL),
          }),
          Effect.timeoutOption(credentialWait),
          Effect.map(Option.isSome),
        );
        if (!landed) {
          return yield* unavailable(
            "The sign-in finished without leaving a credential. Start it again.",
          );
        }
        const home = ownHome(target);
        yield* fs.makeDirectory(home, { recursive: true });
        // One rename: the login holds its old credential or its new one, never neither.
        yield* fs.rename(written, mateLoginCredentialPath({ agent, home }));
        if (agent !== "claude-code") return;
        // Claude keeps the account it signed in with in its global config: that alone moves, into
        // a config that reads as one — the credential is what signs the login in.
        const account = (yield* readRecord(`${scratch}/.claude.json`))?.["oauthAccount"];
        const configPath = claudeConfig(target);
        const config = yield* readRecord(configPath);
        if (account === undefined || config === undefined) return;
        const next = `${configPath}.mate-sign-in`;
        yield* fs.writeFileString(next, encodeJson({ ...config, oauthAccount: account }), {
          mode: 0o600,
        });
        yield* fs.rename(next, configPath);
      }).pipe(
        Effect.catchTags({ PlatformError: (error) => Effect.fail(unavailable(error.message)) }),
      );

    const discard: LoginHomes["discard"] = (key) => drop(pending(key));

    return { prepare, commit, discard } satisfies LoginHomes;
  });
