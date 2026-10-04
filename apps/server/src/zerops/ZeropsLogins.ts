/**
 * ZeropsLogins — the logins beyond the two defaults (crew mode's *Runs on*,
 * PRD §2.3, Δ15).
 *
 * A login is one coding agent signed in to one account in this project. The
 * two defaults are the drivers' default instances and stay exactly what the
 * agent-auth feed (`ZeropsAgentAuth`) says about them — the platform flag,
 * `~/.claude`, `~/.codex`. Every other login is a further provider instance
 * Mate made, with its own home `~/.mate/logins/<id>`:
 *
 * - a second Claude account: `CLAUDE_CONFIG_DIR` is that home, and its
 *   credential is `<home>/.credentials.json`;
 * - a Claude API key: the same, with `ANTHROPIC_API_KEY` stored for that
 *   instance alone (the settings' secret store); either Claude home starts
 *   with zcp's MCP server and a finished onboarding ({@link seedClaudeConfig});
 * - a second Codex account: a shadow home over `~/.codex` (the driver's auth
 *   overlay), so it shares zcp's MCP config and keeps its own `auth.json`.
 *
 * Such a login has no platform flag — the flag is the agent's, and it stays
 * the default's. Its own CLI check, run with its home in the environment,
 * decides whether it is signed in, and its signer is its own — whoever this
 * server saw sign it in, kept under its id (`zeropsSignIns`): a second Claude
 * login never inherits the first one's signer (D6 per login).
 *
 * @module ZeropsLogins
 */
import * as NodeOS from "node:os";

import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ZeropsAgentLoginError,
  type ProviderInstanceConfig,
  type ServerProviderAuthStatus,
  type ServerSettingsError,
  type ZeropsAgentAuthSnapshot,
  type ZeropsAgentId,
  type ZeropsLogin,
  type ZeropsLoginAddInput,
  type ZeropsLoginKind,
  type ZeropsLoginState,
} from "@t3tools/contracts";
import { classifyZeropsAgentAuth, zeropsLoginTitle } from "@t3tools/shared/zeropsAgentAuth";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProviderInstances } from "../spi/providerInstances.ts";
import { subscribeBeforeSnapshot } from "../utils/subscribeBeforeSnapshot.ts";
import { spawnAgentAuthProbe, verifyAgentAuth } from "./ZeropsAgentAuthVerify.ts";
import { watchWithFallback, type WatcherHandle } from "./ZeropsAgentAuthWatcher.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { zeropsUserIdOf } from "./ZeropsMembershipWatch.ts";
import { ZeropsProjectSigners, type ProjectSigners } from "./ZeropsProjectSigners.ts";
import { extraLoginAgent, LOGIN_DRIVER_KIND, makeExtraLoginId } from "./zeropsLoginIds.ts";
import { ZeropsSignIns, type SignInStore } from "./zeropsSignIns.ts";

/** One login beyond the defaults, as the settings hold it. */
export interface MateLogin {
  readonly id: string;
  readonly agent: ZeropsAgentId;
  readonly kind: ZeropsLoginKind;
  readonly label: string;
  /** Absolute: `<home directory>/.mate/logins/<id>`. */
  readonly home: string;
  /** An API key login's key is stored; never true for an account. */
  readonly keyStored: boolean;
}

/** The environment variable that carries an API key login's key. */
export const API_KEY_VARIABLE = "ANTHROPIC_API_KEY";

/** Where every login beyond the defaults keeps its home. */
export const mateLoginHome = (homeDir: string, id: string): string =>
  `${homeDir}/.mate/logins/${id}`;

/** The home a login's instance names: Claude's config dir, or Codex's shadow home. */
const HOME_FIELD: Readonly<Record<ZeropsAgentId, "homePath" | "shadowHomePath">> = {
  "claude-code": "homePath",
  codex: "shadowHomePath",
};

const expandHome = (value: string, homeDir: string): string =>
  value === "~" ? homeDir : value.startsWith("~/") ? `${homeDir}${value.slice(1)}` : value;

const configString = (config: unknown, field: string): string | undefined => {
  if (typeof config !== "object" || config === null) return undefined;
  const value = (config as Record<string, unknown>)[field];
  return typeof value === "string" ? value.trim() : undefined;
};

/** The label back out of the display name Mate wrote ({@link zeropsLoginTitle}). */
const labelOf = (agent: ZeropsAgentId, kind: ZeropsLoginKind, displayName: string): string => {
  const base = zeropsLoginTitle({ agent, kind, label: "" });
  if (displayName === base) return "";
  return displayName.startsWith(`${base} · `) ? displayName.slice(base.length + 3) : displayName;
};

/**
 * The logins beyond the defaults among the configured provider instances:
 * an instance is one exactly when Mate made it — a login id of its driver
 * (`zeropsLoginIds.ts`) whose home is that id's own under `~/.mate/logins`.
 * Anything else, a second instance configured by hand included, keeps
 * today's rule and is gated as its driver's default login.
 */
export function readMateLogins(
  providerInstances: Readonly<Record<string, ProviderInstanceConfig>>,
  homeDir: string,
): ReadonlyArray<MateLogin> {
  const logins: MateLogin[] = [];
  for (const [id, entry] of Object.entries(providerInstances)) {
    const agent = extraLoginAgent(id);
    if (agent === undefined || entry.driver !== LOGIN_DRIVER_KIND[agent]) continue;
    const home = mateLoginHome(homeDir, id);
    const configured = configString(entry.config, HOME_FIELD[agent]);
    if (configured === undefined || expandHome(configured, homeDir) !== home) continue;
    const key =
      agent === "claude-code"
        ? entry.environment?.findLast((variable) => variable.name === API_KEY_VARIABLE)
        : undefined;
    const kind: ZeropsLoginKind = key === undefined ? "subscription" : "apiKey";
    logins.push({
      id,
      agent,
      kind,
      label: labelOf(agent, kind, entry.displayName ?? ""),
      home,
      keyStored: key !== undefined && key.value.length > 0,
    });
  }
  return logins;
}

/**
 * The provider instance a new login is: its driver, the title every surface
 * shows as its display name, its home, and — for an API key — the key as a
 * sensitive variable, which the settings keep in their secret store.
 */
export function mateLoginInstance(
  login: Pick<MateLogin, "id" | "agent" | "kind" | "label"> & {
    readonly apiKey?: string | undefined;
  },
  homeDir: string,
): ProviderInstanceConfig {
  return {
    driver: ProviderDriverKind.make(LOGIN_DRIVER_KIND[login.agent]),
    displayName: zeropsLoginTitle(login),
    config: { [HOME_FIELD[login.agent]]: mateLoginHome(homeDir, login.id) },
    ...(login.apiKey === undefined
      ? {}
      : { environment: [{ name: API_KEY_VARIABLE, value: login.apiKey, sensitive: true }] }),
  };
}

/**
 * Whether a login beyond the defaults can run a turn. It has no platform
 * flag, so its credential and its own CLI check decide: a credential the
 * check has not answered for yet is `registering`, one the check refused is
 * `needs-reauth`. An API key is signed in the moment it is stored.
 */
export function mateLoginState(facts: {
  readonly kind: ZeropsLoginKind;
  readonly keyStored: boolean;
  readonly credPresent: boolean;
  readonly providerAuth: ServerProviderAuthStatus;
}): ZeropsLoginState {
  if (facts.kind === "apiKey") return facts.keyStored ? "authorized" : "not-authorized";
  if (!facts.credPresent) return "not-authorized";
  switch (facts.providerAuth) {
    case "authenticated":
      return "authorized";
    case "unauthenticated":
      return "needs-reauth";
    case "unknown":
      return "registering";
  }
}

/** What a login's own watcher and check found. */
export interface MateLoginFacts {
  readonly credPresent: boolean;
  readonly providerAuth: ServerProviderAuthStatus;
}

/**
 * A login beyond the defaults as the feed lists it. Its signer travels only
 * with a credential (or a stored key) that exists, as the agents' does: a
 * record left behind by a login since removed names an owner for nothing.
 */
export function mateLoginRow(
  login: MateLogin,
  facts: MateLoginFacts,
  signer: string | undefined,
): ZeropsLogin {
  const held = login.kind === "apiKey" ? login.keyStored : facts.credPresent;
  return {
    id: login.id,
    agent: login.agent,
    label: login.label,
    kind: login.kind,
    default: false,
    state: mateLoginState({ ...facts, kind: login.kind, keyStored: login.keyStored }),
    token: false,
    ...(held && signer !== undefined && signer.length > 0 ? { signedInBy: signer } : {}),
  };
}

/** A default login, as its agent row says. */
const defaultLoginRow = (agent: ZeropsAgentAuthSnapshot["agents"][number]): ZeropsLogin => ({
  id: defaultInstanceIdForDriver(ProviderDriverKind.make(LOGIN_DRIVER_KIND[agent.agentId])),
  agent: agent.agentId,
  label: "",
  kind: "subscription",
  default: true,
  state: classifyZeropsAgentAuth(agent).kind,
  token: agent.flagToken,
  ...(agent.authorizedBy === undefined ? {} : { signedInBy: agent.authorizedBy.subject }),
  ...(agent.login === undefined ? {} : { login: agent.login }),
});

/**
 * The snapshot with every login listed: the defaults from their agent rows,
 * then `extras`. The agent rows themselves are left exactly as they are —
 * everything that reads them (the band, the picker, the flag) sees today's
 * snapshot.
 */
export function withLogins(
  snapshot: ZeropsAgentAuthSnapshot,
  extras: ReadonlyArray<ZeropsLogin>,
): ZeropsAgentAuthSnapshot {
  if (!snapshot.available) return snapshot;
  return { ...snapshot, logins: [...snapshot.agents.map(defaultLoginRow), ...extras] };
}

/** The per-project flags a finished first run leaves — what spares a project's trust dialog. */
const PROJECT_ONBOARDING_FLAGS = [
  "hasTrustDialogAccepted",
  "hasCompletedProjectOnboarding",
] as const;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The `.claude.json` a new Claude login's home starts with. Claude reads its
 * global config from `$CLAUDE_CONFIG_DIR/.claude.json`, and zcp writes its MCP
 * server and the finished onboarding only into the default's `~/.claude.json`
 * (`../zcp/internal/init/adapters/claude.go`): without this the login would
 * have no zcp tools and would show the first-run screens.
 *
 * Carried: `mcpServers`, `theme`, and each project's trust and onboarding
 * flags; onboarding is always finished. Never carried: the account
 * (`oauthAccount`, `userID`), a key's pre-approval, a project's history —
 * those are the default login's own.
 */
export function seedClaudeConfig(defaultConfig: unknown): Record<string, unknown> {
  const source = isRecord(defaultConfig) ? defaultConfig : {};
  const projects: Record<string, Record<string, unknown>> = {};
  if (isRecord(source["projects"])) {
    for (const [path, project] of Object.entries(source["projects"])) {
      if (!isRecord(project)) continue;
      const flags = Object.fromEntries(
        PROJECT_ONBOARDING_FLAGS.filter((flag) => project[flag] === true).map((flag) => [
          flag,
          true,
        ]),
      );
      if (Object.keys(flags).length > 0) projects[path] = flags;
    }
  }
  return {
    hasCompletedOnboarding: true,
    ...(typeof source["theme"] === "string" ? { theme: source["theme"] } : {}),
    ...(isRecord(source["mcpServers"]) ? { mcpServers: source["mcpServers"] } : {}),
    ...(Object.keys(projects).length > 0 ? { projects } : {}),
  };
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/** The credential a login's CLI writes into its home: Claude's under `CLAUDE_CONFIG_DIR`, Codex's under `CODEX_HOME`. */
export const mateLoginCredentialPath = (login: Pick<MateLogin, "agent" | "home">): string =>
  `${login.home}/${login.agent === "claude-code" ? ".credentials.json" : "auth.json"}`;

/** The environment a login's CLI runs with — its sign-in, its status check, its logout. */
export const mateLoginEnvironment = (
  login: Pick<MateLogin, "agent" | "home">,
): Readonly<Record<string, string>> =>
  login.agent === "claude-code" ? { CLAUDE_CONFIG_DIR: login.home } : { CODEX_HOME: login.home };

/** How long a burst of credential events waits before the one check it asks for. */
const CHECK_DEBOUNCE = Duration.seconds(1);

/** How often a credential whose check could not answer is asked again. */
export const UNKNOWN_LOGIN_RECHECK_INTERVAL = Duration.minutes(1);

type Instances = Readonly<Record<string, ProviderInstanceConfig>>;

const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export class ZeropsLogins extends Context.Service<
  ZeropsLogins,
  {
    /** Every login beyond the defaults, oldest first, without a walker's `login` (that is `ZeropsAgentLogin`'s). */
    readonly latest: Effect.Effect<ReadonlyArray<ZeropsLogin>>;
    readonly changes: Stream.Stream<ReadonlyArray<ZeropsLogin>>;
    readonly subscribe: Effect.Effect<
      {
        readonly latest: ReadonlyArray<ZeropsLogin>;
        readonly changes: Stream.Stream<ReadonlyArray<ZeropsLogin>>;
      },
      never,
      Scope.Scope
    >;
    /**
     * Whether each login holds a credential, by id, as its own check found it — only once a
     * check has answered, never the "not signed in" a row reads while none has. A login gone
     * from the settings reads as holding none.
     */
    readonly credentials: Stream.Stream<ReadonlyArray<readonly [string, boolean]>>;
    /** The login beyond the defaults configured under `id`, if there is one. */
    readonly resolve: (id: string) => Effect.Effect<MateLogin | undefined>;
    /**
     * Asks the login's own CLI again — a sign-in just succeeded, or a sign-out ran — and
     * publishes what it says, with the login's signer as it stands then.
     */
    readonly recheckNow: (id: string) => Effect.Effect<void>;
    /**
     * *Add another login*: the instance, its home, and for an API key the key
     * — stored for that instance alone, never published. An API key has no
     * sign-in to walk: the session that stores it (`subject`) signs it in.
     */
    readonly add: (
      input: ZeropsLoginAddInput,
      subject: string,
    ) => Effect.Effect<{ readonly id: string }, ZeropsAgentLoginError>;
    /** Drops the login's instance (and with it its key) and its home. Signing it out first is the caller's. */
    readonly forget: (id: string) => Effect.Effect<void, ZeropsAgentLoginError>;
  }
>()("t3/zerops/ZeropsLogins") {}

export interface ZeropsLoginsOptions {
  readonly isZeropsEnvironment: boolean;
  /** Where `~/.mate/logins` lives: `os.homedir()`, as the drivers resolve `~`. */
  readonly homeDir: string;
  /** The configured provider instances, secrets materialized (`ServerSettingsService.getSettings`). */
  readonly readInstances: Effect.Effect<Instances, ServerSettingsError>;
  /** Every later change to them. */
  readonly instanceChanges: Stream.Stream<Instances>;
  /** Replaces the whole map, as a settings patch of `providerInstances` does. */
  readonly writeInstances: (next: Instances) => Effect.Effect<unknown, ServerSettingsError>;
  /** The login's own CLI status, run with its home ({@link mateLoginEnvironment}). */
  readonly verify: (login: MateLogin) => Effect.Effect<ServerProviderAuthStatus>;
  /** Told when a login's verified status changes, so the model picker's snapshot catches up. */
  readonly reconcile?: (id: string, verified: ServerProviderAuthStatus) => Effect.Effect<void>;
  /** Who this server saw sign each login in (`ZeropsProjectSigners.signers`); absent, none names one. */
  readonly readSigners?: Effect.Effect<ProjectSigners>;
  /** Where an API key login's signer is kept (`zeropsSignIns`); absent, nobody signs one in. */
  readonly signIns?: SignInStore;
  readonly watch: (target: string, fallbackDir: string, onChange: () => void) => WatcherHandle;
  /** Defaults to {@link CHECK_DEBOUNCE}; shortened by tests. */
  readonly checkDebounce?: Duration.Duration;
  /** Defaults to {@link UNKNOWN_LOGIN_RECHECK_INTERVAL}. */
  readonly unknownRecheckInterval?: Duration.Duration;
}

const UNKNOWN_FACTS: MateLoginFacts = { credPresent: false, providerAuth: "unknown" };

const rowsEqual = (a: ReadonlyArray<ZeropsLogin>, b: ReadonlyArray<ZeropsLogin>): boolean =>
  a.length === b.length &&
  a.every((row, index) => {
    const other = b[index]!;
    return (
      row.id === other.id &&
      row.label === other.label &&
      row.kind === other.kind &&
      row.state === other.state &&
      row.signedInBy === other.signedInBy
    );
  });

/**
 * The service where there is no Zerops project (a fixture scene, a plain T3
 * server): no logins beyond the defaults, and none to add.
 */
export const unavailable = Effect.gen(function* () {
  const changes = yield* PubSub.sliding<ReadonlyArray<ZeropsLogin>>(1);
  const latest = Effect.succeed<ReadonlyArray<ZeropsLogin>>([]);
  const refused = new ZeropsAgentLoginError({
    reason: "unavailable",
    detail: "This environment keeps no logins beyond the two default ones.",
  });
  return ZeropsLogins.of({
    latest,
    changes: Stream.fromPubSub(changes),
    subscribe: subscribeBeforeSnapshot(changes, latest, yield* Semaphore.make(1)),
    credentials: Stream.empty,
    resolve: () => Effect.succeed(undefined),
    recheckNow: () => Effect.void,
    add: () => Effect.fail(refused),
    forget: () => Effect.fail(refused),
  });
});

export const make = (options: ZeropsLoginsOptions) =>
  Effect.gen(function* () {
    if (!options.isZeropsEnvironment) return yield* unavailable;

    const changes = yield* PubSub.sliding<ReadonlyArray<ZeropsLogin>>(4);
    const subscribeMutex = yield* Semaphore.make(1);
    const credentialAnswers = yield* PubSub.unbounded<ReadonlyArray<readonly [string, boolean]>>();

    const {
      homeDir,
      readInstances,
      instanceChanges,
      writeInstances,
      verify,
      reconcile,
      readSigners,
      signIns,
      watch,
      checkDebounce = CHECK_DEBOUNCE,
      unknownRecheckInterval = UNKNOWN_LOGIN_RECHECK_INTERVAL,
    } = options;
    const fs = yield* FileSystem.FileSystem;

    const logins = yield* Ref.make<ReadonlyArray<MateLogin>>([]);
    const facts = yield* Ref.make<Readonly<Record<string, MateLoginFacts>>>({});
    const published = yield* Ref.make<ReadonlyArray<ZeropsLogin>>([]);
    // Plain maps, as `ZeropsAgentAuth`'s queues: handles, never compared as data.
    const watchers = new Map<string, WatcherHandle>();
    // One check pipeline for every login: a watcher event (or a request) marks
    // its login pending, and the debounced drain checks each pending login
    // once, one at a time — single-flight without a fiber per login, and with
    // nothing to interrupt when a login goes away.
    const pending = new Set<string>();
    const checks = yield* Queue.unbounded<void>();
    // Settings writes are whole-map replacements: one at a time.
    const writeLock = yield* Semaphore.make(1);

    const rows = Effect.gen(function* () {
      const signers = readSigners === undefined ? {} : yield* readSigners;
      const current = yield* Ref.get(logins);
      const known = yield* Ref.get(facts);
      return current.map((login) =>
        mateLoginRow(login, known[login.id] ?? UNKNOWN_FACTS, signers[login.id]),
      );
    });

    // One publish at a time: a read and its publish are never overtaken by a newer read's.
    const publishMutex = yield* Semaphore.make(1);
    const publish = Effect.gen(function* () {
      const next = yield* rows;
      if (rowsEqual(next, yield* Ref.get(published))) return;
      yield* Ref.set(published, next);
      yield* PubSub.publish(changes, next);
    }).pipe(publishMutex.withPermits(1));

    const requestCheck = (id: string) =>
      Effect.sync(() => {
        pending.add(id);
        Queue.offerUnsafe(checks, undefined);
      });

    const probeCredential = (login: MateLogin) =>
      fs.exists(mateLoginCredentialPath(login)).pipe(Effect.orElseSucceed(() => false));

    const check = (id: string) =>
      Effect.gen(function* () {
        const login = (yield* Ref.get(logins)).find((entry) => entry.id === id);
        if (login === undefined) return;
        const credPresent = yield* probeCredential(login);
        const before = (yield* Ref.get(facts))[id] ?? UNKNOWN_FACTS;
        // An API key has nothing for a CLI to confirm; an absent credential
        // is signed out without asking.
        const providerAuth: ServerProviderAuthStatus =
          login.kind === "apiKey"
            ? "unknown"
            : credPresent
              ? yield* verify(login)
              : "unauthenticated";
        yield* Effect.logInfo("zerops logins: verification", { id, credPresent, providerAuth });
        yield* Ref.update(facts, (current) => ({
          ...current,
          [id]: { credPresent, providerAuth },
        }));
        // An API key login's credential is its stored key, not a file it never has.
        yield* PubSub.publish(credentialAnswers, [
          [id, login.kind === "apiKey" ? login.keyStored : credPresent],
        ]);
        yield* publish;
        if (reconcile !== undefined && providerAuth !== before.providerAuth) {
          yield* reconcile(id, providerAuth);
        }
      });

    yield* Stream.fromQueue(checks).pipe(
      Stream.debounce(checkDebounce),
      Stream.mapEffect(() =>
        Effect.forEach(
          [...pending].map((id) => {
            pending.delete(id);
            return id;
          }),
          check,
          { discard: true },
        ),
      ),
      Stream.runDrain,
      Effect.catchCause((cause) => Effect.logWarning("zerops logins: checks stopped", { cause })),
      Effect.forkScoped,
    );

    /**
     * Brings the list, and a watcher per login, in line with the settings: a
     * login that appeared is watched and checked, one that went away stops
     * being watched and forgets what was found.
     */
    const sync = (instances: Instances) =>
      Effect.gen(function* () {
        const next = readMateLogins(instances, homeDir);
        const nextIds = new Set(next.map((login) => login.id));
        for (const [id, handle] of watchers) {
          if (nextIds.has(id)) continue;
          handle.dispose();
          watchers.delete(id);
        }
        yield* Ref.set(logins, next);
        const gone = Object.keys(yield* Ref.get(facts)).filter((id) => !nextIds.has(id));
        yield* Ref.update(facts, (current) =>
          Object.fromEntries(Object.entries(current).filter(([id]) => nextIds.has(id))),
        );
        if (gone.length > 0) {
          yield* PubSub.publish(
            credentialAnswers,
            gone.map((id) => [id, false] as const),
          );
        }
        for (const login of next) {
          if (!watchers.has(login.id)) {
            watchers.set(
              login.id,
              watch(mateLoginCredentialPath(login), login.home, () => {
                pending.add(login.id);
                Queue.offerUnsafe(checks, undefined);
              }),
            );
            yield* requestCheck(login.id);
          }
        }
        yield* publish;
      });

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const handle of watchers.values()) handle.dispose();
        watchers.clear();
      }),
    );

    // Unreadable settings list nothing until their next change; a write
    // never starts from them (see `write`).
    yield* sync(
      yield* readInstances.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("zerops logins: could not read the settings", { cause }).pipe(
            Effect.as<Instances>({}),
          ),
        ),
      ),
    );
    yield* instanceChanges.pipe(
      Stream.runForEach(sync),
      Effect.catchCause((cause) =>
        Effect.logWarning("zerops logins: settings changes stopped", { cause }),
      ),
      Effect.forkScoped,
    );

    // A credential whose check could not answer is asked again.
    yield* Effect.gen(function* () {
      const known = yield* Ref.get(facts);
      for (const login of yield* Ref.get(logins)) {
        const found = known[login.id];
        if (found?.credPresent && found.providerAuth === "unknown" && login.kind !== "apiKey") {
          yield* requestCheck(login.id);
        }
      }
    }).pipe(
      Effect.delay(unknownRecheckInterval),
      Effect.forever,
      Effect.catchCause((cause) =>
        Effect.logWarning("zerops logins: unknown recheck stopped", { cause }),
      ),
      Effect.forkScoped,
    );
    const recheckNow = (id: string) => requestCheck(id);

    const resolve = (id: string) =>
      Ref.get(logins).pipe(Effect.map((current) => current.find((login) => login.id === id)));

    /**
     * Replaces the instance map with `change`'s answer to the current one.
     * A settings file that cannot be written is a defect, not a refusal.
     */
    const write = <A>(change: (current: Instances) => Effect.Effect<readonly [Instances, A]>) =>
      writeLock.withPermits(1)(
        Effect.gen(function* () {
          // Never from an empty map standing in for unreadable settings: the
          // write replaces every instance.
          const [next, result] = yield* change(yield* readInstances.pipe(Effect.orDie));
          yield* writeInstances(next).pipe(Effect.orDie);
          // Listed at once: the sign-in that follows an add resolves the new
          // id before the settings' own change arrives.
          yield* sync(next);
          return result;
        }),
      );

    const add: ZeropsLogins["Service"]["add"] = (input, subject) =>
      Effect.gen(function* () {
        const apiKey = input.apiKey;
        const valid =
          input.kind === "apiKey"
            ? input.agent === "claude-code" && apiKey !== undefined
            : apiKey === undefined;
        if (!valid) {
          return yield* new ZeropsAgentLoginError({
            reason: "invalid-login",
            detail:
              input.kind === "apiKey"
                ? "An API key login is a Claude one, and it needs its key."
                : "An account signs in through its agent's own login, not with a key.",
          });
        }
        return yield* write((current) =>
          Effect.gen(function* () {
            const id = makeExtraLoginId(input, new Set(Object.keys(current)));
            // The home exists before the instance does, so the driver and the
            // login's watcher find it at once.
            const home = mateLoginHome(homeDir, id);
            yield* fs.makeDirectory(home, { recursive: true }).pipe(Effect.orDie);
            if (input.agent === "claude-code") {
              // zcp's MCP server and a finished onboarding, before its first
              // login — see `seedClaudeConfig`. Unreadable defaults seed the
              // onboarding alone.
              const defaults = yield* fs.readFileString(`${homeDir}/.claude.json`).pipe(
                Effect.flatMap(decodeUnknownJson),
                Effect.orElseSucceed(() => undefined),
              );
              yield* fs
                .writeFileString(`${home}/.claude.json`, encodeJson(seedClaudeConfig(defaults)), {
                  mode: 0o600,
                })
                .pipe(Effect.orDie);
            }
            const instance = mateLoginInstance({ ...input, id, apiKey }, homeDir);
            return [{ ...current, [id]: instance }, { id }] as const;
          }),
        ).pipe(
          Effect.tap(({ id }) =>
            input.kind !== "apiKey" || signIns === undefined
              ? Effect.void
              : Clock.currentTimeMillis.pipe(
                  Effect.flatMap((at) => signIns.save(id, { by: zeropsUserIdOf(subject), at })),
                  Effect.andThen(publish),
                  Effect.mapError(
                    (error) =>
                      new ZeropsAgentLoginError({
                        reason: "signer-write-failed",
                        detail: error.detail,
                      }),
                  ),
                ),
          ),
        );
      });

    const forget: ZeropsLogins["Service"]["forget"] = (id) =>
      Effect.gen(function* () {
        const login = yield* resolve(id);
        if (login === undefined) {
          return yield* new ZeropsAgentLoginError({
            reason: "unknown-login",
            detail: "No such login on this project.",
          });
        }
        yield* write((current) =>
          Effect.succeed([
            Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)),
            id,
          ] as const),
        );
        yield* fs
          .remove(login.home, { recursive: true, force: true })
          .pipe(
            Effect.catch((cause) =>
              Effect.logWarning("zerops logins: could not remove a login's home", { id, cause }),
            ),
          );
      });

    const latest = Ref.get(published);

    return ZeropsLogins.of({
      latest,
      changes: Stream.fromPubSub(changes),
      subscribe: subscribeBeforeSnapshot(changes, latest, subscribeMutex),
      credentials: Stream.fromPubSub(credentialAnswers),
      resolve,
      recheckNow,
      add,
      forget,
    });
  });

export const layer = Layer.effect(
  ZeropsLogins,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const settings = yield* ServerSettingsService;
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const projectSigners = yield* ZeropsProjectSigners;
    const signIns = yield* ZeropsSignIns;
    const providerInstances = yield* ProviderInstances;
    return yield* make({
      isZeropsEnvironment: isZeropsEnvironment(config),
      homeDir: NodeOS.homedir(),
      readInstances: settings.getSettings.pipe(Effect.map((current) => current.providerInstances)),
      instanceChanges: settings.streamChanges.pipe(
        Stream.map((current) => current.providerInstances),
      ),
      writeInstances: (next) => settings.updateSettings({ providerInstances: next }),
      verify: (login) =>
        verifyAgentAuth(
          login.agent,
          spawnAgentAuthProbe(processRunner, config.cwd, mateLoginEnvironment(login)),
        ),
      reconcile: providerInstances.reconcileInstanceAuth,
      readSigners: projectSigners.signers,
      signIns,
      watch: watchWithFallback,
    });
  }),
).pipe(Layer.provide(ProcessRunner.layer));
