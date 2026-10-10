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
 * `"authenticated"` does this feed write the platform flag itself (through
 * {@link ZeropsAgentFlag}'s `markSignedIn` — a direct Zerops API call with
 * the Mate's own key, replacing the old `zcp agent mark-oauth <agent-id>`
 * spawn). An OAuth or token flag appearing in the zembed env store triggers
 * the same targeted check (to keep `providerAuth` current) without ever
 * writing the flag itself, and so does a turn that failed because its agent
 * is not signed in (`zeropsTurnAuthFailure.ts`, read off the SPI event bus).
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
 * `providerAuth`; that is what gates the flag write. Nothing else runs
 * alongside that probe (audit C3): the provider driver picker's own cache
 * may lag up to `CAPABILITIES_PROBE_TTL` (~5 min) behind a logout, and that
 * lag is upstream's own concern, accepted as-is — spec-mate.md §8.1.
 *
 * ## What the model picker sees
 *
 * The picker reads the provider registry's snapshot, which re-probes only on
 * its own background interval — minutes, and only while a client is in the
 * foreground (measured 2026-09-22: a Codex sign-in stayed "not authenticated"
 * in the picker for 7 minutes while this feed said Authorized). So whenever
 * the verified status CHANGES, it is handed to `reconcileProviderAuth`
 * (`spi/providerInstances.ts`), which re-probes the agent's provider instance
 * if its snapshot contradicts it. The registry's answer never feeds back into
 * this feed — spec-mate.md §8.1.
 */
import * as NodeOS from "node:os";

import type {
  ServerProviderAuthStatus,
  ZeropsAuthVerification,
  ZeropsAuthRegistration,
  ZeropsAgentAuth as ZeropsAgentAuthContract,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentAuthState,
  ZeropsAgentId,
} from "@t3tools/contracts";
import { completionReceipt } from "@t3tools/shared/completionReceipt";
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
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { ProviderRuntimeEventBus } from "../spi/ProviderRuntimeEventBus.ts";
import { ProviderInstances } from "../spi/providerInstances.ts";
import { subscribeBeforeSnapshot } from "../utils/subscribeBeforeSnapshot.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsAgentFlagModule from "./ZeropsAgentFlag.ts";
import { ZeropsAgentFlag } from "./ZeropsAgentFlag.ts";
import { watchWithFallback, type WatcherHandle } from "./ZeropsAgentAuthWatcher.ts";
import * as ZeropsProjectSignersModule from "./ZeropsProjectSigners.ts";
import { turnAuthFailureAgent } from "./zeropsTurnAuthFailure.ts";
import {
  spawnAgentAuthProbe,
  verifyAgentAuth,
  type AgentAuthProbeSpawn,
  type AgentAuthVerification,
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
 * Which Zerops user signed an agent in here, as this server saw it
 * (`ZeropsProjectSigners`, `zeropsSignIns`). The subject is the Zerops user
 * id — never anything read out of the credential, whose contents this module
 * still never opens.
 */
export type ZeropsAgentAuthorizer = NonNullable<ZeropsAgentAuthContract["authorizedBy"]>;

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
  authorizers: Readonly<Partial<Record<ZeropsAgentId, ZeropsAgentAuthorizer>>> = {},
  verification: Readonly<Partial<Record<ZeropsAgentId, ZeropsAuthVerification>>> = {},
  registration: Readonly<Partial<Record<ZeropsAgentId, ZeropsAuthRegistration>>> = {},
): ZeropsAgentAuthSnapshot => {
  const agents = KNOWN_AGENT_IDS.map((agentId) => {
    const suffix = AGENT_OAUTH_SUFFIX[agentId];
    const flagOAuth = env?.[`ZCP_AGENT_OAUTH_${suffix}`] === "true";
    const flagToken = !!env?.[`ZCP_AGENT_TOKEN_${suffix}`];
    const credPresent = credPresence[agentId];
    const authorizedBy = authorizers[agentId];
    return {
      agentId,
      credPresent,
      flagOAuth,
      flagToken,
      providerAuth: providerAuth[agentId],
      ...(verification[agentId] === undefined ? {} : { verification: verification[agentId] }),
      ...(registration[agentId] === undefined ? {} : { registration: registration[agentId] }),
      state: computeAgentAuthState({ flagOAuth, flagToken, credPresent }),
      // Provenance only travels with a credential that exists: a stale record
      // for a credential that has since been removed would name an owner for
      // nothing.
      ...(credPresent && authorizedBy ? { authorizedBy } : {}),
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
     * Requests the same coalesced, flag-write-eligible provider check a
     * credential-file event would (S7 follow-up F8: `ZeropsAgentLogin` calls
     * this once its output parser sees the CLI's own success line, so a
     * server-driven login re-uses this feed's existing verification +
     * single-flight + latch machinery instead of duplicating it). A no-op
     * when the feed is off (`isZeropsEnvironment: false`).
     */
    readonly recheckNow: (agentId: ZeropsAgentId) => Effect.Effect<void>;
    /** Completes once this verification generation's model-picker reconciliation has finished. */
    readonly awaitCheck: (agentId: ZeropsAgentId, generation: number) => Effect.Effect<void>;
    /**
     * Called by sign-out BEFORE it clears the platform flag (`ZeropsSignOut.ts`):
     * bumps this agent's epoch and resets `markedOAuth` directly, so a
     * provider probe already in flight when the sign-out started cannot
     * re-mark the flag sign-out is about to clear — `checkProviderAuth`
     * captures the epoch before running `refreshProviderAuth` and skips
     * marking if it changed while the probe was in flight.
     */
    readonly invalidatePendingMark: (agentId: ZeropsAgentId) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsAgentAuth") {}

export interface ZeropsAgentAuthOptions {
  readonly agentFlag: Pick<ZeropsAgentFlag["Service"], "markSignedIn">;
  /**
   * The agent's own verified login status (`ZeropsAgentAuthVerify.verifyAgentAuth`
   * at {@link layer} — see the module header's "How it verifies"), NOT the
   * provider registry's probe. Presence of the credential FILE is not proof
   * of a working login (a stale or unusable credential can exist on disk),
   * so this — not `credPresent` — is what gates the flag write.
   * Coalescing a burst of credential events into one call here is `make`'s
   * own job (see `PROVIDER_CHECK_DEBOUNCE_MS`), not this function's.
   */
  readonly refreshProviderAuth: (agentId: ZeropsAgentId) => Effect.Effect<AgentAuthVerification>;
  /**
   * Told every time an agent's verified status changes, so the model picker's
   * provider snapshot can catch up (`ProviderInstances.reconcileAgentAuth` at
   * {@link layer}). Absent, nothing outside this feed hears of the change.
   */
  readonly reconcileProviderAuth?: (
    agentId: ZeropsAgentId,
    verified: ServerProviderAuthStatus,
  ) => Effect.Effect<void>;
  /**
   * Has the provider registry read the agent's instance again (`ProviderInstances.refreshAgent`):
   * after a credential event that still reads signed in, the account behind it may be another.
   */
  readonly refreshProviderSnapshot?: (agentId: ZeropsAgentId) => Effect.Effect<void>;
  /** Resolved the same way the provider drivers do by default: `os.homedir()`, never `CLAUDE_CONFIG_DIR`. */
  readonly homeDir: string;
  readonly envStorePath: string;
  /**
   * Who this server saw sign each agent in (`ZeropsProjectSigners.signers`), read per publish:
   * the walker keeps a sign-in before it asks for the re-check whose publish names its person.
   * Absent disables provenance entirely — every snapshot then omits `authorizedBy`.
   */
  readonly readSigners?: Effect.Effect<ZeropsProjectSignersModule.ProjectSigners>;
  /**
   * The agents whose turn just failed because they are not signed in
   * (`zeropsTurnAuthFailure.ts` over the provider runtime event bus at
   * {@link layer}). Each one re-asks that agent's own CLI at once, never
   * flag-write-eligible: a failed turn is not a credential event, and the
   * project's flag still decides — the re-probe only refines it. Absent,
   * a turn's failure is not heard here.
   */
  readonly turnAuthFailures?: Stream.Stream<ZeropsAgentId>;
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
  /** Set once the flag write (`ZeropsAgentFlag.markSignedIn`) actually SUCCEEDED for an agent, so a later re-check of an already-authenticated agent does not write it again. Failure ends visibly; another credential revision or operator request may write once. */
  readonly markedOAuth: Readonly<Record<ZeropsAgentId, boolean>>;
  /**
   * Whether the NEXT coalesced provider check for this agent was requested
   * (at least in part) by a credential event, versus only by the env-store
   * flag appearing. The flag write is only ever eligible when this is
   * true: the env-store path keeps `providerAuth` current but never writes
   * the flag itself. Consumed (reset to false) by the first check it gates
   * that answers.
   */
  readonly pendingCredentialCheck: Readonly<Record<ZeropsAgentId, boolean>>;
  readonly verification: Readonly<Partial<Record<ZeropsAgentId, ZeropsAuthVerification>>>;
  readonly registration: Readonly<Partial<Record<ZeropsAgentId, ZeropsAuthRegistration>>>;
  readonly generation: Readonly<Record<ZeropsAgentId, number>>;
  /** Bumped by `invalidatePendingMark` (sign-out); a `checkProviderAuth` in flight when this changes must not mark the flag it captured — see that method's own doc comment. */
  readonly signOutEpoch: Readonly<Record<ZeropsAgentId, number>>;
  readonly env: ZembedEnv | undefined;
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
  a.state === b.state &&
  a.verification?.status === b.verification?.status &&
  a.verification?.reason === b.verification?.reason &&
  a.verification?.checkedAt === b.verification?.checkedAt &&
  a.verification?.generation === b.verification?.generation &&
  a.registration?.status === b.registration?.status &&
  a.registration?.reason === b.registration?.reason &&
  a.registration?.process?.id === b.registration?.process?.id &&
  a.registration?.process?.status === b.registration?.process?.status &&
  a.authorizedBy?.subject === b.authorizedBy?.subject;

/** Field-by-field equality — avoids a JSON round-trip for what is only ever an internal dedup check. */
const snapshotsEqual = (a: ZeropsAgentAuthSnapshot, b: ZeropsAgentAuthSnapshot): boolean =>
  a.available === b.available &&
  a.reason === b.reason &&
  a.agents.length === b.agents.length &&
  a.agents.every((agent, index) => agentAuthEqual(agent, b.agents[index]!));

export const make = (options: ZeropsAgentAuthOptions) =>
  Effect.gen(function* () {
    const {
      agentFlag,
      refreshProviderAuth,
      reconcileProviderAuth,
      refreshProviderSnapshot,
      homeDir,
      envStorePath,
      readSigners,
      turnAuthFailures,
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
        awaitCheck: () => Effect.void,
        invalidatePendingMark: () => Effect.void,
      } satisfies ZeropsAgentAuth["Service"];
    }

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const state = yield* Ref.make<FeedState>({
      credPresence: { "claude-code": false, codex: false },
      providerAuth: { "claude-code": "unknown", codex: "unknown" },
      markedOAuth: { "claude-code": false, codex: false },
      pendingCredentialCheck: { "claude-code": false, codex: false },
      verification: {},
      registration: {},
      generation: { "claude-code": 0, codex: 0 },
      signOutEpoch: { "claude-code": 0, codex: 0 },
      env: undefined,
      lastPublished: undefined,
    });

    const probeCredential = (agentId: ZeropsAgentId): Effect.Effect<boolean> =>
      fs
        .exists(path.join(homeDir, ...CRED_PROBE_SEGMENTS[agentId]))
        .pipe(Effect.orElseSucceed(() => false));

    // One publish at a time: a read and its publish are never overtaken by a newer read's.
    const publishMutex = yield* Semaphore.make(1);
    const publish = Effect.gen(function* () {
      const signers = readSigners === undefined ? {} : yield* readSigners;
      const current = yield* Ref.get(state);
      const authorizers: Partial<Record<ZeropsAgentId, ZeropsAgentAuthorizer>> = {};
      for (const agentId of KNOWN_AGENT_IDS) {
        const subject = signers[agentId];
        if (subject !== undefined && subject.length > 0) authorizers[agentId] = { subject };
      }
      const snapshot = buildSnapshot(
        current.env,
        current.credPresence,
        current.providerAuth,
        authorizers,
        current.verification,
        current.registration,
      );
      if (current.lastPublished !== undefined && snapshotsEqual(snapshot, current.lastPublished)) {
        return;
      }
      yield* Ref.update(state, (previous) => ({ ...previous, lastPublished: snapshot }));
      yield* PubSub.publish(changes, snapshot);
    }).pipe(publishMutex.withPermits(1));

    /** One platform write per credential revision or explicit operator request. */
    const markOAuthOnce = (agentId: ZeropsAgentId, generation: number, epoch: number) =>
      Effect.gen(function* () {
        yield* Ref.update(state, (current) => ({
          ...current,
          registration: { ...current.registration, [agentId]: { status: "pending" } },
        }));
        const outcome = yield* Effect.result(
          agentFlag.markSignedIn(agentId, (process) =>
            Ref.update(state, (current) =>
              current.generation[agentId] !== generation || current.signOutEpoch[agentId] !== epoch
                ? current
                : {
                    ...current,
                    registration: {
                      ...current.registration,
                      [agentId]: { status: "accepted", process },
                    },
                  },
            ).pipe(Effect.andThen(publish)),
          ),
        );
        const current = yield* Ref.get(state);
        if (current.generation[agentId] !== generation || current.signOutEpoch[agentId] !== epoch)
          return;
        yield* Ref.update(state, (latest) => ({
          ...latest,
          markedOAuth: { ...latest.markedOAuth, [agentId]: outcome._tag === "Success" },
          registration: {
            ...latest.registration,
            [agentId]:
              outcome._tag === "Failure"
                ? {
                    status: "failed",
                    reason: outcome.failure.reason,
                    ...(outcome.failure.process === undefined
                      ? {}
                      : { process: outcome.failure.process }),
                  }
                : {
                    status: outcome.success.process === undefined ? "registered" : "accepted",
                    ...(outcome.success.process === undefined
                      ? {}
                      : { process: outcome.success.process }),
                  },
          },
        }));
      });

    /**
     * The coalesced provider check (plan correction D2): reads the fresh,
     * targeted `auth.status` for one agent, records it, and writes the
     * platform flag only when it reads `"authenticated"` AND the check was
     * requested (at least in part) by a credential event — presence of the
     * credential file is not proof of a working login, and the env-store
     * path keeps `providerAuth` current without ever writing the flag
     * itself. `markedOAuth` keeps a re-check of an already-marked agent from
     * writing it again. A failed write ends with a receipt.
     */
    const checks = {
      "claude-code": completionReceipt(),
      codex: completionReceipt(),
    };
    const completedChecks: Record<ZeropsAgentId, number> = { "claude-code": -1, codex: -1 };
    const awaitCheck = (agentId: ZeropsAgentId, generation: number): Effect.Effect<void> =>
      Effect.suspend(() => {
        const next = checks[agentId].next();
        return completedChecks[agentId] >= generation
          ? Effect.void
          : next.pipe(Effect.andThen(() => awaitCheck(agentId, generation)));
      });
    const checkProviderAuth = (agentId: ZeropsAgentId) =>
      Effect.gen(function* () {
        // Captured BEFORE the probe runs: `refreshProviderAuth` is the one
        // real await in this whole check, and a sign-out
        // (`invalidatePendingMark`) can land while it is in flight. If it
        // does, this check's own "authenticated" answer is stale — the
        // agent it was verifying may already be signed out — so it must
        // never re-mark a flag sign-out is (or already has) cleared.
        const atStart = yield* Ref.get(state);
        const epochAtStart = atStart.signOutEpoch[agentId];
        const generation = atStart.generation[agentId];
        const startedAt = yield* Clock.currentTimeMillis;
        const verification = yield* refreshProviderAuth(agentId);
        const status = verification.status;
        // S7 follow-up F5: this feed's own verification previously logged
        // nothing at all — every check now leaves one record of what it
        // found, never a credential value.
        yield* Effect.logInfo("zerops agent auth: verification", {
          agentId,
          providerAuth: status,
          elapsedMs: (yield* Clock.currentTimeMillis) - startedAt,
        });
        const before = yield* Ref.get(state);
        if (
          before.generation[agentId] !== generation ||
          before.signOutEpoch[agentId] !== epochAtStart
        )
          return;
        const allowMarkOAuth = before.pendingCredentialCheck[agentId];
        const alreadyMarked = before.markedOAuth[agentId];
        const signedOutDuringProbe = before.signOutEpoch[agentId] !== epochAtStart;
        yield* Ref.update(state, (current) => ({
          ...current,
          providerAuth: { ...current.providerAuth, [agentId]: status },
          pendingCredentialCheck: { ...current.pendingCredentialCheck, [agentId]: false },
          verification: { ...current.verification, [agentId]: { ...verification, generation } },
          ...(status === "unauthenticated"
            ? {
                registration: { ...current.registration, [agentId]: undefined },
                markedOAuth: { ...current.markedOAuth, [agentId]: false },
              }
            : {}),
        }));
        if (status === "authenticated" && allowMarkOAuth && !alreadyMarked) {
          if (signedOutDuringProbe) {
            yield* Effect.logInfo(
              "zerops agent auth: skipped a stale mark-signed-in — a sign-out ran while the probe was in flight",
              { agentId },
            );
          } else {
            yield* markOAuthOnce(agentId, generation, epochAtStart);
          }
        }
        yield* publish;
        // After the publish: the card flips now, the picker's re-probe (a
        // Claude probe takes seconds) follows on this agent's own queue.
        if (reconcileProviderAuth !== undefined && status !== before.providerAuth[agentId]) {
          yield* reconcileProviderAuth(agentId, status);
        }
        // A credential replaced while signed in may be another account: the provider reads its
        // account (and that account's usage) again, whatever the status said before.
        if (refreshProviderSnapshot !== undefined && allowMarkOAuth && status === "authenticated") {
          yield* refreshProviderSnapshot(agentId);
        }
        completedChecks[agentId] = generation;
        yield* checks[agentId].complete;
      });

    // One coalescing queue per agent (plan correction D2): a burst of
    // credential events debounces into ONE targeted provider check, and
    // sequential Stream consumption makes that check single-flight — no
    // separate semaphore needed. A queue+debounce+forkScoped pipeline is
    // keeps each explicit request single-flight.
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
     * eligible to write the flag if it reads authenticated — ANY
     * credential event folded into the coalesced batch makes it eligible,
     * so this only ever sets the flag, never clears it (only
     * `checkProviderAuth`, once it has actually consumed the flag, does).
     */
    const requestProviderCheck = (
      agentId: ZeropsAgentId,
      options: { readonly fromCredential: boolean },
    ) =>
      Effect.gen(function* () {
        yield* Ref.update(state, (current) => ({
          ...current,
          generation: { ...current.generation, [agentId]: current.generation[agentId] + 1 },
          verification: { ...current.verification, [agentId]: { status: "checking" } },
        }));
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
        // still what actually gates the flag write (see checkProviderAuth): a
        // check that reads back unauthenticated can never write it, removal
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
        if (isOAuth) {
          yield* Ref.update(state, (current) => ({
            ...current,
            registration: {
              ...current.registration,
              [agentId]: { ...current.registration[agentId], status: "registered" },
            },
          }));
        }
        const oauthAppeared = !wasOAuth && isOAuth;
        const tokenAppeared = !before?.[tokenKey] && !!after?.[tokenKey];
        if (oauthAppeared || tokenAppeared) {
          yield* requestProviderCheck(agentId, { fromCredential: false });
        }
        // S7 follow-up F2: the platform flag can disappear without this
        // process restarting (a GUI revoke). Reset the latch so the next
        // VERIFIED credential re-marks — otherwise a revoke-then-re-login
        // would leave the flag write permanently skipped for this agent.
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

    // A turn refused for want of a login is the agent's own answer arriving
    // before any check asked for it: re-ask now, so the card stops saying
    // "Authorized" over a login that no longer works.
    if (turnAuthFailures !== undefined) {
      yield* turnAuthFailures.pipe(
        Stream.runForEach((agentId) => requestProviderCheck(agentId, { fromCredential: false })),
        Effect.catchCause((cause) =>
          Effect.logWarning("zerops agent auth: turn auth failures stopped", { cause }),
        ),
        Effect.forkScoped,
      );
    }

    // What was last published, signers included: a subscriber arriving now
    // (a reload) and every recombine `registerZeropsRpc` does on a change
    // start from the same snapshot the change stream carries. `make` has
    // already published once by here, so the fallback is only for the type.
    const latest = Ref.get(state).pipe(
      Effect.map(
        (current) =>
          current.lastPublished ??
          buildSnapshot(
            current.env,
            current.credPresence,
            current.providerAuth,
            {},
            current.verification,
            current.registration,
          ),
      ),
    );

    return {
      latest,
      changes: Stream.fromPubSub(changes),
      subscribe: subscribeBeforeSnapshot(changes, latest, subscribeMutex),
      // Flag-write-eligible, exactly like a credential-file event — see the
      // Service interface doc comment. What was verified before the login is
      // no longer an answer: until the check says otherwise the agent is
      // being checked, never "signed out" (the row would offer Sign in again
      // over a login that just succeeded).
      awaitCheck,
      recheckNow: (agentId: ZeropsAgentId) =>
        Ref.update(state, (current) => ({
          ...current,
          providerAuth: { ...current.providerAuth, [agentId]: "unknown" },
        })).pipe(
          Effect.andThen(requestProviderCheck(agentId, { fromCredential: true })),
          Effect.andThen(publish),
        ),
      invalidatePendingMark: (agentId) =>
        Ref.update(state, (current) => ({
          ...current,
          signOutEpoch: { ...current.signOutEpoch, [agentId]: current.signOutEpoch[agentId] + 1 },
          pendingCredentialCheck: { ...current.pendingCredentialCheck, [agentId]: false },
          markedOAuth: { ...current.markedOAuth, [agentId]: false },
          registration: { ...current.registration, [agentId]: undefined },
          verification: { ...current.verification, [agentId]: undefined },
        })),
    } satisfies ZeropsAgentAuth["Service"];
  });

/**
 * The layer's real verification collaborator: each agent's own CLI status
 * probe (`ZeropsAgentAuthVerify.verifyAgentAuth`), never the provider
 * registry's probe (see the module header's "How it verifies"). Exported
 * separately from {@link layer} so this composition is directly testable
 * against a fake {@link AgentAuthProbeSpawn} without standing up
 * `ZeropsCli`/`ProcessRunner` layers.
 */
export const layerVerifyAgentAuth =
  (spawn: AgentAuthProbeSpawn) =>
  (agentId: ZeropsAgentId): Effect.Effect<AgentAuthVerification> =>
    verifyAgentAuth(agentId, spawn);

export const layer = Layer.effect(
  ZeropsAgentAuth,
  Effect.gen(function* () {
    const agentFlag = yield* ZeropsAgentFlag;
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const config = yield* ServerConfig;
    const projectSigners = yield* ZeropsProjectSignersModule.ZeropsProjectSigners;
    const providerInstances = yield* ProviderInstances;
    const bus = yield* ProviderRuntimeEventBus;
    const spawnProbe = spawnAgentAuthProbe(processRunner, config.cwd);

    return yield* make({
      agentFlag,
      refreshProviderAuth: layerVerifyAgentAuth(spawnProbe),
      reconcileProviderAuth: providerInstances.reconcileAgentAuth,
      refreshProviderSnapshot: providerInstances.refreshAgent,
      homeDir: NodeOS.homedir(),
      envStorePath: ZEMBED_ENV_FILE,
      readSigners: projectSigners.signers,
      turnAuthFailures: bus.events.pipe(
        Stream.map(turnAuthFailureAgent),
        Stream.filter((agentId) => agentId !== undefined),
      ),
      isZeropsEnvironment: isZeropsEnvironment(config),
      watch: watchWithFallback,
    });
  }),
).pipe(Layer.provide(ZeropsAgentFlagModule.layer), Layer.provide(ProcessRunner.layer));
