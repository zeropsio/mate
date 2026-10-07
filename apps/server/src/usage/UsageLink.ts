/** Capture belongs to the Mate server, independently of browser report demand. */
// @effect-diagnostics nodeBuiltinImport:off -- default provider transcript roots.
import * as NodeOS from "node:os";
import {
  ClaudeSettings,
  CodexSettings,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type UsageOrigin,
  type ProviderRuntimeEvent,
  AGENT_USAGE_CAPTURE_PROTOCOL,
} from "@t3tools/contracts";
import { type MateLinkDown, type MateLinkUp } from "@t3tools/shared/mateLink";
import { usageDigest } from "@t3tools/shared/agentUsage";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { expandHomePath } from "../pathExpansion.ts";
import { codexHomeLayout, providerInstanceEnvironment } from "../spi/driverHomes.ts";
import {
  makeUsageLedger,
  unknownCoverage,
  UsageLedgerError,
  type UsageBinding,
} from "./UsageLedger.ts";
import {
  captureSource,
  watchDirectory,
  type CaptureSource,
  type WatchDirectory,
} from "./usageCapture.ts";
import { makeUsageReplication } from "./usageReplication.ts";
import { DEFAULT_WATCH_RETRY, makeSourceWatches, type WatchRetry } from "./usageWatches.ts";

/**
 * Refusals a new ledger recovers from: HQ restored past this one or holds its origins under another
 * lineage (a lost or restored `usage.sqlite`), or the two disagree on the journal's prefix.
 */
const isLedgerError = Schema.is(UsageLedgerError);
const USAGE_RENEWING_CODES: ReadonlySet<string> = new Set([
  "ledger_rollback_conflict",
  "origin_lineage_conflict",
  "ledger_binding_conflict",
  "origin_binding",
  "prefix_conflict",
  "prefix-conflict",
  "ledger-rollback",
  "unproved-replay-prefix",
]);
export interface UsageLane {
  readonly ping: Effect.Effect<void>;
  readonly state: (message: Extract<MateLinkDown, { type: "state" }>) => Effect.Effect<void>;
  readonly receive: (message: MateLinkDown) => Effect.Effect<void>;
  readonly run: Effect.Effect<never>;
}
export interface UsageLink {
  readonly open: (
    send: (frame: MateLinkUp) => Effect.Effect<void>,
  ) => Effect.Effect<UsageLane, never, Scope.Scope>;
}
const decodeClaudeSettings = Schema.decodeOption(ClaudeSettings);
const decodeCodexSettings = Schema.decodeOption(CodexSettings);

/** What capture reads of a provider runtime event: either conversation engine emits these. */
export type UsageRuntimeEvent = Pick<ProviderRuntimeEvent, "type">;
export interface UsageLinkOptions {
  readonly watch?: WatchDirectory;
  readonly retry?: WatchRetry;
}

export const makeUsageLink = Effect.fnUntraced(function* (
  runtimeEvents: Stream.Stream<UsageRuntimeEvent>,
  options: UsageLinkOptions = {},
) {
  const ledger = yield* makeUsageLedger;
  const config = yield* ServerConfig;
  const settings = yield* ServerSettingsService;
  const path = yield* Path.Path;
  const host = yield* HostProcessEnvironment;
  let binding: UsageBinding | undefined;
  const dirty = yield* Queue.sliding<void>(1);
  let wake: (() => void) | undefined;
  const watches = yield* makeSourceWatches({
    watch: options.watch ?? watchDirectory,
    nudge: () => Queue.offerUnsafe(dirty, undefined),
    retry: options.retry ?? DEFAULT_WATCH_RETRY,
  });
  const scan = Effect.gen(function* () {
    if (!binding) return;
    const current = yield* settings.getSettings;
    const sources: CaptureSource[] = [];
    const configured: Array<Pick<ProviderInstanceConfig, "driver" | "config" | "environment">> =
      Object.values(current.providerInstances);
    for (const driver of [
      "claudeAgent",
      "codex",
      "grok",
      "cursor",
      "opencode",
      "antigravity",
    ] as const) {
      if (!Object.hasOwn(current.providerInstances, driver))
        configured.push({
          driver: ProviderDriverKind.make(driver),
          config: current.providers[driver],
        });
    }
    const seen = new Set<string>();
    for (const instance of configured) {
      const environment = providerInstanceEnvironment(instance.environment, host);
      let source: CaptureSource | undefined;
      if (instance.driver === "claudeAgent") {
        const decoded = decodeClaudeSettings(instance.config ?? {});
        if (Option.isSome(decoded)) {
          const home = decoded.value.homePath.trim()
            ? expandHomePath(decoded.value.homePath)
            : environment.CLAUDE_CONFIG_DIR?.trim() || path.join(NodeOS.homedir(), ".claude");
          source = { provider: "claude", directory: path.join(home, "projects") };
        }
      } else if (instance.driver === "codex") {
        const decoded = decodeCodexSettings(instance.config ?? {});
        if (Option.isSome(decoded)) {
          const value = decoded.value;
          const layout = yield* codexHomeLayout(
            !value.homePath.trim() && !value.shadowHomePath.trim() && environment.CODEX_HOME?.trim()
              ? { ...value, homePath: environment.CODEX_HOME.trim() }
              : value,
          ).pipe(Effect.provideService(Path.Path, path));
          source = { provider: "codex", directory: path.join(layout.sharedHomePath, "sessions") };
        }
      } else {
        const unsupported: Record<string, UsageOrigin["provider"]> = {
          grok: "grok",
          cursor: "cursor",
          opencode: "opencode",
          antigravity: "antigravity",
        };
        const provider = unsupported[String(instance.driver)];
        if (provider) {
          const origin = yield* ledger.bind(
            usageDigest(["unsupported", instance.driver]),
            binding,
            provider,
          );
          yield* ledger.coverage(origin.originId, {
            ...unknownCoverage("meter-unsupported"),
            state: "unsupported",
          });
        }
      }
      if (!source || seen.has(source.directory)) continue;
      seen.add(source.directory);
      sources.push(source);
    }
    const meta = yield* ledger.metadata;
    const floor = meta.startedAt === undefined ? undefined : Date.parse(meta.startedAt);
    const baseline = meta.baselined === false;
    for (const source of sources) {
      yield* captureSource(ledger, binding, source, {
        ...(floor === undefined ? {} : { floor }),
        baseline,
        ledgerId: meta.ledgerId,
      }).pipe(Effect.catchCause(() => Effect.logWarning("Usage source capture unavailable")));
      yield* watches.ensure(source.directory);
    }
    if (baseline) yield* ledger.markBaselined;
    wake?.();
  }).pipe(Effect.catchCause(() => Effect.logWarning("Usage ledger capture unavailable")));
  yield* Effect.forkScoped(Effect.forever(Queue.take(dirty).pipe(Effect.andThen(scan))));
  yield* Effect.forkScoped(
    Stream.runForEach(settings.streamChanges, () => Queue.offer(dirty, undefined)),
  );
  yield* Effect.forkScoped(
    // A session start attaches watches for directories its first run creates; a finished turn is read.
    Stream.runForEach(runtimeEvents, (event) =>
      event.type === "session.started" || event.type === "turn.completed"
        ? Queue.offer(dirty, undefined)
        : Effect.void,
    ),
  );
  // A home bound in this project resumes capture before HQ answers; HQ refuses another org's origin.
  const bound = (yield* ledger.metadata).binding;
  if (bound && config.zerops && bound.projectId === config.zerops.projectId) {
    binding = bound;
    Queue.offerUnsafe(dirty, undefined);
  }
  let active: ReturnType<typeof makeUsageReplication> | undefined;
  return {
    open: (send) =>
      Effect.gen(function* () {
        let replication = makeUsageReplication(ledger);
        const changed = yield* Queue.sliding<void>(1);
        let manifest = "";
        const advertise = ledger.hello.pipe(
          Effect.flatMap((hello) => {
            manifest = usageDigest(hello.origins.map((origin) => origin.originId));
            return replication.hello.pipe(Effect.flatMap(send));
          }),
        );
        let negotiated = false;
        let halted = false;
        let renewed = false;
        let lastState: Extract<MateLinkDown, { type: "state" }> | undefined;
        const halt = Effect.sync(() => {
          halted = true;
          replication.stop();
        }).pipe(
          Effect.andThen(
            Effect.logWarning(
              "Usage replication lane stopped; overview and attention remain available",
            ),
          ),
        );
        /** A new ledger capturing from now replaces one HQ cannot accept; the gap stays unknown. */
        const renew = (next: UsageBinding, reason: string) =>
          Effect.gen(function* () {
            replication.stop();
            yield* ledger.restart(next);
            binding = next;
            replication = makeUsageReplication(ledger);
            if (negotiated) active = replication;
            Queue.offerUnsafe(dirty, undefined);
            yield* Effect.logInfo("Usage capture started a new ledger").pipe(
              Effect.annotateLogs({ reason }),
            );
          });
        const safely = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(
            Effect.catch((error) => {
              // One renewal per link: a refusal of the new ledger waits for the next link.
              if (
                renewed ||
                !binding ||
                !isLedgerError(error) ||
                !USAGE_RENEWING_CODES.has(error.code)
              )
                return halt;
              renewed = true;
              return renew(binding, error.code).pipe(Effect.andThen(advertise));
            }),
            Effect.catchCause(() => halt),
            Effect.asVoid,
          );
        const transmit = (value: MateLinkUp | undefined) => (value ? send(value) : Effect.void);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            replication.stop();
          }),
        );
        const negotiate = (message: Extract<MateLinkDown, { type: "state" }>) => {
          lastState = message;
          return safely(
            Effect.gen(function* () {
              if (
                halted ||
                negotiated ||
                message.usage?.capture !== AGENT_USAGE_CAPTURE_PROTOCOL ||
                !config.zerops
              )
                return;
              if (message.mate.projectId !== config.zerops.projectId) {
                halted = true;
                replication.stop();
                return;
              }
              // HQ names the org; an older HQ that does not is waited out, never guessed from Zerops.
              const orgId = message.usage.orgId;
              if (orgId === undefined) return;
              const nextBinding = {
                orgId,
                projectId: config.zerops.projectId,
                mateId: message.usage.mateId,
              };
              // Frozen home binding refuses clone/transfer before any old-org facts leave this socket.
              // A Mate registered again (or moved) captures into a new ledger from now on.
              const begun = yield* Effect.result(ledger.begin(nextBinding));
              if (begun._tag === "Failure") yield* renew(nextBinding, "binding-changed");
              binding = nextBinding;
              active?.stop();
              active = replication;
              negotiated = true;
              wake = () => Queue.offerUnsafe(changed, undefined);
              Queue.offerUnsafe(dirty, undefined);
              yield* advertise;
            }),
          );
        };
        return {
          state: negotiate,
          ping: Effect.suspend(() => {
            if (halted) return Effect.void;
            if (!negotiated && lastState) return negotiate(lastState);
            return active === replication && negotiated
              ? safely(replication.next.pipe(Effect.flatMap(transmit)))
              : Effect.void;
          }),
          receive: (message) => {
            if (
              halted ||
              !negotiated ||
              active !== replication ||
              !message.type.startsWith("usage-")
            )
              return Effect.void;
            return safely(
              replication
                .receive(message as Parameters<typeof replication.receive>[0])
                .pipe(Effect.flatMap(transmit)),
            );
          },
          run: Effect.forever(
            Queue.take(changed).pipe(
              Effect.andThen(
                Effect.gen(function* () {
                  if (halted || active !== replication || !negotiated) return;
                  const hello = yield* ledger.hello;
                  yield* safely(
                    usageDigest(hello.origins.map((origin) => origin.originId)) !== manifest
                      ? advertise
                      : replication.next.pipe(Effect.flatMap(transmit)),
                  );
                }).pipe(Effect.catchCause(() => Effect.logWarning("Usage lane wake unavailable"))),
              ),
            ),
          ),
        };
      }),
  } satisfies UsageLink;
});
