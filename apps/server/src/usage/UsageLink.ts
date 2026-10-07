/** Capture belongs to the Mate server, independently of browser report demand. */
// @effect-diagnostics nodeBuiltinImport:off -- default provider transcript roots.
import * as NodeOS from "node:os";
import {
  ClaudeSettings,
  CodexSettings,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type UsageOrigin,
  type OrchestrationEvent,
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
import { ZeropsOrgRead } from "../zerops/ZeropsOrgRead.ts";
import { makeUsageLedger, unknownCoverage, type UsageBinding } from "./UsageLedger.ts";
import { captureSource, watchCaptureSource, type CaptureSource } from "./usageCapture.ts";
import { makeUsageReplication } from "./usageReplication.ts";

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
const orgBody = Schema.Struct({ clientId: Schema.String });
const decodeOrg = Schema.decodeUnknownOption(orgBody);
const validateOrg = Schema.decodeUnknownEffect(orgBody);
const decodeClaudeSettings = Schema.decodeOption(ClaudeSettings);
const decodeCodexSettings = Schema.decodeOption(CodexSettings);

export const makeUsageLink = Effect.fnUntraced(function* (
  runEvents: Stream.Stream<OrchestrationEvent>,
) {
  const ledger = yield* makeUsageLedger;
  const config = yield* ServerConfig;
  const settings = yield* ServerSettingsService;
  const orgRead = yield* ZeropsOrgRead;
  const path = yield* Path.Path;
  const host = yield* HostProcessEnvironment;
  let binding: UsageBinding | undefined;
  const dirty = yield* Queue.sliding<void>(1);
  let wake: (() => void) | undefined;
  const watchers = new Map<string, () => void>();
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const close of watchers.values()) close();
    }),
  );
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
    for (const source of sources) {
      yield* captureSource(ledger, binding, source).pipe(
        Effect.catchCause(() => Effect.logWarning("Usage source capture unavailable")),
      );
      if (!watchers.has(source.directory)) {
        const watching = yield* Effect.try(() =>
          watchCaptureSource(source, () => Queue.offerUnsafe(dirty, undefined)),
        ).pipe(Effect.option);
        if (Option.isSome(watching)) {
          watchers.set(source.directory, watching.value);
          // Close the scan/watch race by reconciling once after the watcher is attached.
          Queue.offerUnsafe(dirty, undefined);
        }
      }
    }
    wake?.();
  }).pipe(Effect.catchCause(() => Effect.logWarning("Usage ledger capture unavailable")));
  yield* Effect.forkScoped(Effect.forever(Queue.take(dirty).pipe(Effect.andThen(scan))));
  yield* Effect.forkScoped(
    Stream.runForEach(settings.streamChanges, () => Queue.offer(dirty, undefined)),
  );
  yield* Effect.forkScoped(
    Stream.runForEach(runEvents, (event) =>
      event.type === "thread.turn-start-requested" ||
      event.type === "thread.turn-diff-completed" ||
      event.type === "thread.session-set"
        ? Queue.offer(dirty, undefined)
        : Effect.void,
    ),
  );
  const retained = yield* ledger.origins;
  if (retained.length && config.zerops) {
    const read = yield* orgRead.project(config.zerops);
    const body =
      read.kind === "answered" && read.status === 200 ? decodeOrg(read.body) : Option.none();
    const origin = retained[0]!;
    if (
      Option.isSome(body) &&
      origin.orgId === body.value.clientId &&
      origin.projectId === config.zerops.projectId
    ) {
      binding = { orgId: origin.orgId, projectId: origin.projectId, mateId: origin.mateId };
      Queue.offerUnsafe(dirty, undefined);
    }
  }
  let active: ReturnType<typeof makeUsageReplication> | undefined;
  return {
    open: (send) =>
      Effect.gen(function* () {
        const replication = makeUsageReplication(ledger);
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
        let lastState: Extract<MateLinkDown, { type: "state" }> | undefined;
        const safely = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(
            Effect.catchCause(() =>
              Effect.sync(() => {
                halted = true;
                replication.stop();
              }).pipe(
                Effect.andThen(
                  Effect.logWarning(
                    "Usage replication lane stopped; overview and attention remain available",
                  ),
                ),
              ),
            ),
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
              const read = yield* orgRead.project(config.zerops);
              if (read.kind !== "answered" || read.status !== 200) return;
              const body = yield* validateOrg(read.body);
              const nextBinding = {
                orgId: body.clientId,
                projectId: config.zerops.projectId,
                mateId: message.usage.mateId,
              };
              // Frozen home binding refuses clone/transfer before any old-org facts leave this socket.
              for (const origin of yield* ledger.origins) {
                if (
                  origin.orgId !== nextBinding.orgId ||
                  origin.projectId !== nextBinding.projectId ||
                  origin.mateId !== nextBinding.mateId
                ) {
                  halted = true;
                  replication.stop();
                  return;
                }
              }
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
