/**
 * The agent authorization feed: whether Claude Code and Codex are signed in,
 * from inside this Zerops project (docs/spec-welcome-mode.md §3 W-STATE, z3
 * S7-1 plan §1 D1).
 *
 * Two independent inputs compose a five-value matrix, never a boolean union
 * (§3): the platform flag (`ZCP_AGENT_OAUTH_<SUFFIX>` / `ZCP_AGENT_TOKEN_<SUFFIX>`
 * in the zembed env store, `/etc/zerops-zembed/env.json`) and the local
 * credential artifact (`~/.claude/.credentials.json`, `~/.codex/auth.json`) —
 * presence only, never read for content. `computeAgentAuthState` mirrors
 * `vscode-bootstrap-welcome.js`'s `computeAgentState` verbatim.
 *
 * Credential presence is not proof of a working login — Claude stages the
 * file then atomically renames it, and a stale/expired credential can exist
 * on disk. So every credential event (the file appearing, OR an existing
 * one being replaced) coalesces into ONE targeted, single-flight check of
 * that agent's own login state; only once that check reads back
 * `"authenticated"` does this feed spawn `zcp agent mark-oauth <agent-id>`
 * (through {@link ZeropsCli}). An OAuth or token flag appearing in the
 * zembed env store triggers the same targeted check (to keep `providerAuth`
 * current) without ever spawning `mark-oauth` itself.
 *
 * ## How it verifies (S7 follow-up F1)
 *
 * The targeted check does NOT trust `ProviderRegistry`'s own probe —
 * live-verified to report `authenticated` for Claude Code off
 * `~/.claude.json`'s account section alone, even with the credential
 * artifact itself absent. Instead `refreshProviderAuth` (injected at
 * {@link layer}, composed by {@link layerVerifyAgentAuth}) runs each agent
 * CLI's OWN status command (`ZeropsAgentAuthVerify.verifyAgentAuth` —
 * `claude auth status` / `codex login status`, the same argv-list spawn
 * shape {@link ZeropsCli} uses for `zcp`) and reduces its answer to
 * `providerAuth`; that is what gates `mark-oauth`. Nothing else runs
 * alongside that probe (audit C3): the provider driver picker's own cache
 * may lag up to `CAPABILITIES_PROBE_TTL` (~5 min) behind a logout, and that
 * lag is upstream's own concern, accepted as-is — spec-mate.md §8.1.
 */
import * as NodeOS from "node:os";

import type {
  ServerProviderAuthStatus,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentAuthState,
  ZeropsAgentId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { subscribeBeforeSnapshot } from "../utils/subscribeBeforeSnapshot.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsCliModule from "./ZeropsCli.ts";
import { ZeropsCli, type ZeropsCliError } from "./ZeropsCli.ts";
import { watchWithFallback, type WatcherHandle } from "./ZeropsAgentAuthWatcher.ts";
import {
  spawnAgentAuthProbe,
  verifyAgentAuth,
  type AgentAuthProbeSpawn,
} from "./ZeropsAgentAuthVerify.ts";

/** The two agents this feed reports on (docs/spec-welcome-mode.md §3: only agents with a verified probe). */
export const KNOWN_AGENT_IDS: ReadonlyArray<ZeropsAgentId> = ["claude-code", "codex"];

/**
 * `ZCP_AGENT_OAUTH_<SUFFIX>` / `ZCP_AGENT_TOKEN_<SUFFIX>` suffixes, mirroring
 * `internal/ops/agent_oauth.go`'s `agentOAuthSuffixes` map — one intentional
 * duplication across the Go/TS boundary, like welcome.js's own CRED_PROBE
 * duplication (that file's header comment). Only the two agents this feed
 * supports; the Go map also carries antigravity/grok/cursor, out of scope here.
 */
export const AGENT_OAUTH_SUFFIX: Readonly<Record<ZeropsAgentId, string>> = {
  "claude-code": "CLAUDE_CODE",
  codex: "CODEX",
};

/**
 * The §3 W-STATE matrix, verbatim from `vscode-bootstrap-welcome.js`'s
 * `computeAgentState`. That function also takes `credVerifiable`, but both
 * agents this feed reports on always have a verified probe (welcome.js's own
 * `CRED_PROBE` table), so every row here is already fully determined by these
 * three fields — the same reduction the matrix's spec table documents.
 */
export const computeAgentAuthState = (inputs: {
  readonly flagOAuth: boolean;
  readonly flagToken: boolean;
  readonly credPresent: boolean;
}): ZeropsAgentAuthState => {
  if (inputs.flagToken) {
    return "authorized-token";
  }
  if (inputs.flagOAuth) {
    return inputs.credPresent ? "authorized" : "reconnect";
  }
  return inputs.credPresent ? "local-only" : "not-authorized";
};

/** The agent flag keys of the zembed env store — never any other key of that file (spec §0, MA-7). */
export type ZembedEnv = Readonly<Record<string, string>>;

/**
 * Assembles the full snapshot from already-collected inputs — pure, no I/O of
 * its own (the service does the reading). `env` absent means the store could
 * not be read (missing or invalid file): every flag reads as unset, never a
 * fallback that treats absence as authorized. `providerAuth` is carried
 * through verbatim (the provider registry's own probe result); it never
 * feeds `computeAgentAuthState` — the §3 W-STATE matrix stays exactly the
 * five values welcome.js computes, unchanged by this addition.
 */
export const buildSnapshot = (
  env: ZembedEnv | undefined,
  credPresence: Readonly<Record<ZeropsAgentId, boolean>>,
  providerAuth: Readonly<Record<ZeropsAgentId, ServerProviderAuthStatus>>,
): ZeropsAgentAuthSnapshot => {
  const agents = KNOWN_AGENT_IDS.map((agentId) => {
    const suffix = AGENT_OAUTH_SUFFIX[agentId];
    const flagOAuth = env?.[`ZCP_AGENT_OAUTH_${suffix}`] === "true";
    const flagToken = !!env?.[`ZCP_AGENT_TOKEN_${suffix}`];
    const credPresent = credPresence[agentId];
    return {
      agentId,
      credPresent,
      flagOAuth,
      flagToken,
      providerAuth: providerAuth[agentId],
      state: computeAgentAuthState({ flagOAuth, flagToken, credPresent }),
    };
  });
  return { available: true, agents };
};

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/**
 * The path segments (relative to `homeDir`) of each agent's credential
 * artifact. Presence only, never read for content — and, since S7 follow-up
 * F4, also the credential WATCHER's own target: `watchWithFallback` watches
 * a file target via its parent directory filtered by basename, so pointing
 * the watcher at the file itself (rather than its containing `.claude` /
 * `.codex` directory) is what keeps every OTHER write under that directory
 * — Claude's own `backups/`, `sessions/` — from re-triggering a check.
 */
const CRED_PROBE_SEGMENTS: Readonly<Record<ZeropsAgentId, ReadonlyArray<string>>> = {
  "claude-code": [".claude", ".credentials.json"],
  codex: [".codex", "auth.json"],
};

/**
 * The zembed env store zcp's sidecar writes (duplicated deliberately from
 * `internal/content/templates/vscode-bootstrap-welcome.js`'s own
 * `ZEMBED_DIR`/`ZEMBED_ENV_FILE` — the Go/JS/TS runtimes share no module
 * boundary to hang a single constant off).
 */
const ZEMBED_ENV_FILE = "/etc/zerops-zembed/env.json";

/** Shared debounce for every watcher below — a single write can emit more than one fs event (welcome.js's own STATE_PUSH_DEBOUNCE_MS). */
const STATE_PUSH_DEBOUNCE_MS = 400;

/**
 * How long a burst of credential events (a single atomic-rename write is
 * observed as more than one fs event, and "file replaced" re-checks on every
 * write) coalesces into ONE targeted provider refresh. Deliberately longer
 * than {@link STATE_PUSH_DEBOUNCE_MS}: this gates a real probe against the
 * provider's SDK/app-server, not a repaint.
 */
const PROVIDER_CHECK_DEBOUNCE_MS = 1000;

/** `ZeropsCliFailed` gets up to 3 attempts total (the initial try plus 2 retries) with a short exponential backoff; `ZeropsCliNotFound` is never retried. */
const MARK_OAUTH_RETRY_SCHEDULE = Schedule.exponential(Duration.millis(50));
const MARK_OAUTH_RETRY_ATTEMPTS = 2;

export class ZeropsAgentAuth extends Context.Service<
  ZeropsAgentAuth,
  {
    readonly latest: Effect.Effect<ZeropsAgentAuthSnapshot>;
    readonly changes: Stream.Stream<ZeropsAgentAuthSnapshot>;
    readonly subscribe: Effect.Effect<
      {
        readonly latest: ZeropsAgentAuthSnapshot;
        readonly changes: Stream.Stream<ZeropsAgentAuthSnapshot>;
      },
      never,
      Scope.Scope
    >;
    /**
     * Requests the same coalesced, mark-oauth-eligible provider check a
     * credential-file event would (S7 follow-up F8: `ZeropsAgentLogin` calls
     * this once its output parser sees the CLI's own success line, so a
     * server-driven login re-uses this feed's existing verification +
     * single-flight + latch machinery instead of duplicating it). A no-op
     * when the feed is off (`isZeropsEnvironment: false`).
     */
    readonly recheckNow: (agentId: ZeropsAgentId) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsAgentAuth") {}

export interface ZeropsAgentAuthOptions {
  readonly cli: Pick<ZeropsCli["Service"], "markAgentOAuth">;
  /**
   * The agent's own verified login status (`ZeropsAgentAuthVerify.verifyAgentAuth`
   * at {@link layer} — see the module header's "How it verifies"), NOT the
   * provider registry's probe. Presence of the credential FILE is not proof
   * of a working login (a stale or unusable credential can exist on disk),
   * so this — not `credPresent` — is what gates the `mark-oauth` spawn.
   * Coalescing a burst of credential events into one call here is `make`'s
   * own job (see `PROVIDER_CHECK_DEBOUNCE_MS`), not this function's.
   */
  readonly refreshProviderAuth: (agentId: ZeropsAgentId) => Effect.Effect<ServerProviderAuthStatus>;
  /** Resolved the same way the provider drivers do by default: `os.homedir()`, never `CLAUDE_CONFIG_DIR`. */
  readonly homeDir: string;
  readonly envStorePath: string;
  readonly isZeropsEnvironment: boolean;
  /**
   * Watches `target`, tolerating it not existing yet (falls back to
   * `fallbackDir` until it appears, then re-attaches — see
   * {@link watchWithFallback}). `onChange` may fire more than once per real
   * change; debouncing is this module's job. Injected — defaults to the real
   * `watchWithFallback` at {@link layer} — so `make` stays testable without
   * touching a real OS file watcher.
   */
  readonly watch: (target: string, fallbackDir: string, onChange: () => void) => WatcherHandle;
}

interface FeedState {
  readonly credPresence: Readonly<Record<ZeropsAgentId, boolean>>;
  /** The provider's own auth probe result, per agent. `"unknown"` until the first targeted check runs. */
  readonly providerAuth: Readonly<Record<ZeropsAgentId, ServerProviderAuthStatus>>;
  /** Set once a `mark-oauth` spawn actually SUCCEEDED for an agent, so a later re-check of an already-authenticated agent does not spawn again. Never set on failure — a genuine failure is eligible to retry on the next coalesced check. */
  readonly markedOAuth: Readonly<Record<ZeropsAgentId, boolean>>;
  /**
   * Whether the NEXT coalesced provider check for this agent was requested
   * (at least in part) by a credential event, versus only by the env-store
   * flag appearing. `mark-oauth` is only ever eligible to spawn when this is
   * true: the env-store path keeps `providerAuth` current but never spawns
   * `mark-oauth` itself — that flag is what it would be writing. Consumed
   * (reset to false) by the check it gates.
   */
  readonly pendingCredentialCheck: Readonly<Record<ZeropsAgentId, boolean>>;
  readonly env: ZembedEnv | undefined;
  /** Set once `zcp` is known to be absent: `mark-oauth` is never spawned again. */
  readonly cliOff: boolean;
  /** The last snapshot actually published, so an event that changes nothing does not repaint. */
  readonly lastPublished: ZeropsAgentAuthSnapshot | undefined;
}

/** Only these prefixes leave the file: the store also carries `ZCP_API_KEY` and `VSCODE_PASSWORD`, which mate never reads (spec §0 touchpoints, MA-7). */
const ZEMBED_FLAG_PREFIXES = ["ZCP_AGENT_OAUTH_", "ZCP_AGENT_TOKEN_"] as const;

export const toZembedEnv = (parsed: unknown): ZembedEnv | undefined => {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      typeof value === "string" &&
      ZEMBED_FLAG_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      out[key] = value;
    }
  }
  return out;
};

const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/** Missing file, unreadable JSON, or a non-object document all read as "no store" — never a fallback that treats absence as authorized. */
const readZembedEnv = (
  fs: FileSystem.FileSystem,
  envStorePath: string,
): Effect.Effect<ZembedEnv | undefined> =>
  fs.readFileString(envStorePath).pipe(
    Effect.flatMap(decodeUnknownJson),
    Effect.map(toZembedEnv),
    Effect.orElseSucceed(() => undefined),
  );

const agentAuthEqual = (
  a: ZeropsAgentAuthSnapshot["agents"][number],
  b: ZeropsAgentAuthSnapshot["agents"][number],
): boolean =>
  a.agentId === b.agentId &&
  a.credPresent === b.credPresent &&
  a.flagOAuth === b.flagOAuth &&
  a.flagToken === b.flagToken &&
  a.providerAuth === b.providerAuth &&
  a.state === b.state;

/** Field-by-field equality — avoids a JSON round-trip for what is only ever an internal dedup check. */
const snapshotsEqual = (a: ZeropsAgentAuthSnapshot, b: ZeropsAgentAuthSnapshot): boolean =>
  a.available === b.available &&
  a.reason === b.reason &&
  a.agents.length === b.agents.length &&
  a.agents.every((agent, index) => agentAuthEqual(agent, b.agents[index]!));

export const make = (options: ZeropsAgentAuthOptions) =>
  Effect.gen(function* () {
    const {
      cli,
      refreshProviderAuth,
      homeDir,
      envStorePath,
      watch,
      isZeropsEnvironment: enabled,
    } = options;
    const changes = yield* PubSub.sliding<ZeropsAgentAuthSnapshot>(4);
    const subscribeMutex = yield* Semaphore.make(1);

    if (!enabled) {
      const off: ZeropsAgentAuthSnapshot = {
        available: false,
        reason: "Not a Zerops environment",
        agents: [],
      };
      const latest = Effect.succeed(off);
      return {
        latest,
        changes: Stream.fromPubSub(changes),
        subscribe: subscribeBeforeSnapshot(changes, latest, subscribeMutex),
        recheckNow: () => Effect.void,
      } satisfies ZeropsAgentAuth["Service"];
    }

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const state = yield* Ref.make<FeedState>({
      credPresence: { "claude-code": false, codex: false },
      providerAuth: { "claude-code": "unknown", codex: "unknown" },
      markedOAuth: { "claude-code": false, codex: false },
      pendingCredentialCheck: { "claude-code": false, codex: false },
      env: undefined,
      cliOff: false,
      lastPublished: undefined,
    });

    const probeCredential = (agentId: ZeropsAgentId): Effect.Effect<boolean> =>
      fs
        .exists(path.join(homeDir, ...CRED_PROBE_SEGMENTS[agentId]))
        .pipe(Effect.orElseSucceed(() => false));

    const publish = Effect.gen(function* () {
      const current = yield* Ref.get(state);
      const snapshot = buildSnapshot(current.env, current.credPresence, current.providerAuth);
      if (current.lastPublished !== undefined && snapshotsEqual(snapshot, current.lastPublished)) {
        return;
      }
      yield* Ref.update(state, (previous) => ({ ...previous, lastPublished: snapshot }));
      yield* PubSub.publish(changes, snapshot);
    });

    /**
     * Spawns `zcp agent mark-oauth <agentId>` once. `ZeropsCliNotFound`
     * latches `cliOff` for good; `ZeropsCliFailed` gets
     * {@link MARK_OAUTH_RETRY_SCHEDULE}. Only ever called from
     * {@link checkProviderAuth} once a targeted refresh has confirmed the
     * provider itself is authenticated — never from credential presence
     * alone.
     */
    const markOAuthOnce = (agentId: ZeropsAgentId) =>
      Effect.gen(function* () {
        if ((yield* Ref.get(state)).cliOff) {
          return;
        }
        const outcome = yield* Effect.result(
          cli.markAgentOAuth(agentId).pipe(
            Effect.retry({
              schedule: MARK_OAUTH_RETRY_SCHEDULE,
              times: MARK_OAUTH_RETRY_ATTEMPTS,
              while: (error: ZeropsCliError) => error._tag === "ZeropsCliFailed",
            }),
          ),
        );
        if (outcome._tag === "Failure") {
          if (outcome.failure._tag === "ZeropsCliNotFound") {
            yield* Ref.update(state, (current) => ({ ...current, cliOff: true }));
          }
          yield* Effect.logWarning("zerops agent auth: mark-oauth failed", {
            agentId,
            error: outcome.failure,
          });
          return;
        }
        yield* Ref.update(state, (current) => ({
          ...current,
          markedOAuth: { ...current.markedOAuth, [agentId]: true },
        }));
        // S7 follow-up F5: the success path previously logged nothing —
        // `changed`/`migrated` are the two facts worth a record, never a
        // credential value.
        yield* Effect.logInfo("zerops agent auth: mark-oauth spawned", {
          agentId,
          key: outcome.success.key,
          changed: outcome.success.changed,
          migrated: outcome.success.migrated,
        });
      });

    /**
     * The coalesced provider check (plan correction D2): reads the fresh,
     * targeted `auth.status` for one agent, records it, and spawns
     * `mark-oauth` only when it reads `"authenticated"` AND the check was
     * requested (at least in part) by a credential event — presence of the
     * credential file is not proof of a working login, and the env-store
     * path keeps `providerAuth` current without ever spawning `mark-oauth`
     * itself (that flag is what it would be writing). `markedOAuth` keeps a
     * re-check of an already-marked agent from re-spawning; a genuine
     * failure never sets it, so the next coalesced check retries.
     */
    const checkProviderAuth = (agentId: ZeropsAgentId) =>
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis;
        const status = yield* refreshProviderAuth(agentId);
        // S7 follow-up F5: this feed's own verification previously logged
        // nothing at all — every check now leaves one record of what it
        // found, never a credential value.
        yield* Effect.logInfo("zerops agent auth: verification", {
          agentId,
          providerAuth: status,
          elapsedMs: (yield* Clock.currentTimeMillis) - startedAt,
        });
        const before = yield* Ref.get(state);
        const allowMarkOAuth = before.pendingCredentialCheck[agentId];
        const alreadyMarked = before.markedOAuth[agentId];
        yield* Ref.update(state, (current) => ({
          ...current,
          providerAuth: { ...current.providerAuth, [agentId]: status },
          pendingCredentialCheck: { ...current.pendingCredentialCheck, [agentId]: false },
        }));
        if (status === "authenticated" && allowMarkOAuth && !alreadyMarked) {
          yield* markOAuthOnce(agentId);
        }
        yield* publish;
      });

    // One coalescing queue per agent (plan correction D2): a burst of
    // credential events debounces into ONE targeted provider check, and
    // sequential Stream consumption makes that check single-flight — no
    // separate semaphore needed. A queue+debounce+forkScoped pipeline is
    // used here (rather than a bare Effect.retry/Effect.sleep loop) because
    // it is the one pattern in this file already proven not to trip this
    // Effect build's scheduler bug (see the header comment / commit history).
    const providerCheckQueues = new Map<ZeropsAgentId, Queue.Queue<void>>();
    for (const agentId of KNOWN_AGENT_IDS) {
      const queue = yield* Queue.unbounded<void>();
      providerCheckQueues.set(agentId, queue);
      yield* Stream.fromQueue(queue).pipe(
        Stream.debounce(Duration.millis(PROVIDER_CHECK_DEBOUNCE_MS)),
        Stream.mapEffect(() => checkProviderAuth(agentId)),
        Stream.runDrain,
        Effect.catchCause((cause) =>
          Effect.logWarning("zerops agent auth: provider check stopped", { agentId, cause }),
        ),
        Effect.forkScoped,
      );
    }
    /**
     * Requests a coalesced check. `fromCredential: true` marks the check
     * eligible to spawn `mark-oauth` if it reads authenticated — ANY
     * credential event folded into the coalesced batch makes it eligible,
     * so this only ever sets the flag, never clears it (only
     * `checkProviderAuth`, once it has actually consumed the flag, does).
     */
    const requestProviderCheck = (
      agentId: ZeropsAgentId,
      options: { readonly fromCredential: boolean },
    ) =>
      Effect.gen(function* () {
        if (options.fromCredential) {
          yield* Ref.update(state, (current) => ({
            ...current,
            pendingCredentialCheck: { ...current.pendingCredentialCheck, [agentId]: true },
          }));
        }
        const queue = providerCheckQueues.get(agentId);
        if (queue !== undefined) {
          Queue.offerUnsafe(queue, undefined);
        }
      });

    const recomputeCredential = (agentId: ZeropsAgentId) =>
      Effect.gen(function* () {
        const now = yield* probeCredential(agentId);
        yield* Ref.update(state, (current) => ({
          ...current,
          credPresence: { ...current.credPresence, [agentId]: now },
        }));
        // Every credential event requests its own targeted check — in
        // EITHER direction, not just absent->present: Claude stages the
        // credential then atomically renames it, so a stale credential can
        // be REPLACED by a fresh one without ever going through "absent" in
        // between; and a present->absent transition (a logout / GUI revoke)
        // needs its own check too (S7 fix2 F1) — without one, `providerAuth`
        // never flips to "unauthenticated" for the file-absent window, since
        // only `credPresent` itself would change. The verified check is
        // still what actually gates `mark-oauth` (see checkProviderAuth): a
        // check that reads back unauthenticated can never spawn it, removal
        // included.
        yield* requestProviderCheck(agentId, { fromCredential: true });
        yield* publish;
      });

    const recomputeEnvStore = Effect.gen(function* () {
      const before = (yield* Ref.get(state)).env;
      const after = yield* readZembedEnv(fs, envStorePath);
      yield* Ref.update(state, (current) => ({ ...current, env: after }));

      for (const agentId of KNOWN_AGENT_IDS) {
        const suffix = AGENT_OAUTH_SUFFIX[agentId];
        const oauthKey = `ZCP_AGENT_OAUTH_${suffix}`;
        const tokenKey = `ZCP_AGENT_TOKEN_${suffix}`;
        const wasOAuth = before?.[oauthKey] === "true";
        const isOAuth = after?.[oauthKey] === "true";
        const oauthAppeared = !wasOAuth && isOAuth;
        const tokenAppeared = !before?.[tokenKey] && !!after?.[tokenKey];
        if (oauthAppeared || tokenAppeared) {
          yield* requestProviderCheck(agentId, { fromCredential: false });
        }
        // S7 follow-up F2: the platform flag can disappear without this
        // process restarting (a GUI revoke). Reset the latch so the next
        // VERIFIED credential re-marks — otherwise a revoke-then-re-login
        // would leave `mark-oauth` permanently skipped for this agent.
        if (wasOAuth && !isOAuth) {
          yield* Ref.update(state, (current) => ({
            ...current,
            markedOAuth: { ...current.markedOAuth, [agentId]: false },
          }));
        }
      }
      yield* publish;
    });

    // Initial reads, before any watcher starts, so a client that connects
    // immediately gets real state rather than an empty placeholder. An
    // agent whose credential already exists at startup (e.g. a restored
    // volume) also gets an initial coalesced provider check.
    for (const agentId of KNOWN_AGENT_IDS) {
      const present = yield* probeCredential(agentId);
      yield* Ref.update(state, (current) => ({
        ...current,
        credPresence: { ...current.credPresence, [agentId]: present },
      }));
      if (present) {
        yield* requestProviderCheck(agentId, { fromCredential: true });
      }
    }
    const initialEnv = yield* readZembedEnv(fs, envStorePath);
    yield* Ref.update(state, (current) => ({ ...current, env: initialEnv }));
    yield* publish;

    /**
     * Bridges the injected callback-style {@link watch} into Effect: every
     * `onChange()` call offers to a queue, a forked fiber drains it debounced
     * into `onEvent`. The watcher handle is disposed through a scope
     * finalizer — a plain synchronous close, never something the scheduler
     * needs to interrupt mid-flight.
     */
    const runWatcher = (target: string, fallbackDir: string, onEvent: Effect.Effect<void>) =>
      Effect.gen(function* () {
        const trigger = yield* Queue.unbounded<void>();
        const handle = watch(target, fallbackDir, () => {
          Queue.offerUnsafe(trigger, undefined);
        });
        yield* Effect.addFinalizer(() => Effect.sync(() => handle.dispose()));
        yield* Stream.fromQueue(trigger).pipe(
          Stream.debounce(Duration.millis(STATE_PUSH_DEBOUNCE_MS)),
          Stream.mapEffect(() => onEvent),
          Stream.runDrain,
          Effect.catchCause((cause) =>
            Effect.logWarning("zerops agent auth: watcher stopped", { cause }),
          ),
          Effect.forkScoped,
        );
      });

    for (const agentId of KNOWN_AGENT_IDS) {
      yield* runWatcher(
        path.join(homeDir, ...CRED_PROBE_SEGMENTS[agentId]),
        homeDir,
        recomputeCredential(agentId),
      );
    }
    yield* runWatcher(envStorePath, path.dirname(envStorePath), recomputeEnvStore);

    const latest = Ref.get(state).pipe(
      Effect.map((current) =>
        buildSnapshot(current.env, current.credPresence, current.providerAuth),
      ),
    );

    return {
      latest,
      changes: Stream.fromPubSub(changes),
      subscribe: subscribeBeforeSnapshot(changes, latest, subscribeMutex),
      // Mark-oauth-eligible, exactly like a credential-file event — see the
      // Service interface doc comment.
      recheckNow: (agentId) => requestProviderCheck(agentId, { fromCredential: true }),
    } satisfies ZeropsAgentAuth["Service"];
  });

/**
 * The layer's real verification collaborator: each agent's own CLI status
 * probe (`ZeropsAgentAuthVerify.verifyAgentAuth`), nothing else (audit C3 —
 * the provider registry's `refreshInstance` used to run alongside it as a
 * best-effort picker-cache warm; dropped, since the picker's own cache may
 * lag and that lag is accepted as-is, spec-mate.md §8.1). Exported
 * separately from {@link layer} so this composition is directly testable
 * against a fake {@link AgentAuthProbeSpawn} without standing up
 * `ZeropsCli`/`ProcessRunner` layers.
 */
export const layerVerifyAgentAuth =
  (spawn: AgentAuthProbeSpawn) =>
  (agentId: ZeropsAgentId): Effect.Effect<ServerProviderAuthStatus> =>
    verifyAgentAuth(agentId, spawn);

export const layer = Layer.effect(
  ZeropsAgentAuth,
  Effect.gen(function* () {
    const cli = yield* ZeropsCli;
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const config = yield* ServerConfig;
    const spawnProbe = spawnAgentAuthProbe(processRunner, config.cwd);

    return yield* make({
      cli,
      refreshProviderAuth: layerVerifyAgentAuth(spawnProbe),
      homeDir: NodeOS.homedir(),
      envStorePath: ZEMBED_ENV_FILE,
      isZeropsEnvironment: isZeropsEnvironment(config),
      watch: watchWithFallback,
    });
  }),
).pipe(Layer.provide(ZeropsCliModule.layer), Layer.provide(ProcessRunner.layer));
