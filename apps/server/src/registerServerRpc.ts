import {
  type AuthSessionId,
  RelayClientInstallFailedError,
  type RelayClientInstallProgressEvent,
  RpcClientId,
  ServerSelfUpdateError,
  WS_METHODS,
  type WsRpcGroup,
} from "@t3tools/contracts";
import type { RelayClient } from "@t3tools/shared/relayClient";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as Stream from "effect/Stream";

import type { authAccessStream } from "./auth/accessStream.ts";
import type { BackgroundPolicy } from "./background/BackgroundPolicy.ts";
import type { ServerConfig } from "./config.ts";
import type { ProcessDiagnostics } from "./diagnostics/ProcessDiagnostics.ts";
import type { ProcessResourceMonitor } from "./diagnostics/ProcessResourceMonitor.ts";
import * as TraceDiagnostics from "./diagnostics/TraceDiagnostics.ts";
import type { Keybindings } from "./keybindings.ts";
import type { ExternalLauncher } from "./process/externalLauncher.ts";
import type { ProcessRunner } from "./processRunner.ts";
import type { ResourceTelemetry } from "./resourceTelemetry/ResourceTelemetry.ts";
import type { RpcAdmit } from "./RpcUpdateAdmission.ts";
import type { makeServerConfigFeed } from "./serverConfigFeed.ts";
import type { ServerLifecycleEvents } from "./serverLifecycleEvents.ts";
import * as ServerSettings from "./serverSettings.ts";
import type { SourceControlDiscovery } from "./sourceControl/SourceControlDiscovery.ts";
import { runExecCommand } from "./zerops/ExecService.ts";

type ServerRpcTag =
  | typeof WS_METHODS.execRun
  | typeof WS_METHODS.serverProbe
  | typeof WS_METHODS.serverGetConfig
  | typeof WS_METHODS.serverUpdateServer
  | typeof WS_METHODS.serverUpdateServerWithProgress
  | typeof WS_METHODS.serverUpsertKeybinding
  | typeof WS_METHODS.serverRemoveKeybinding
  | typeof WS_METHODS.serverGetSettings
  | typeof WS_METHODS.serverUpdateSettings
  | typeof WS_METHODS.serverDiscoverSourceControl
  | typeof WS_METHODS.serverGetTraceDiagnostics
  | typeof WS_METHODS.serverGetProcessDiagnostics
  | typeof WS_METHODS.serverGetProcessResourceHistory
  | typeof WS_METHODS.serverGetResourceTelemetryHistory
  | typeof WS_METHODS.serverRetryResourceTelemetry
  | typeof WS_METHODS.serverSignalProcess
  | typeof WS_METHODS.serverReportClientActivity
  | typeof WS_METHODS.serverReportHostPowerState
  | typeof WS_METHODS.serverGetBackgroundPolicy
  | typeof WS_METHODS.cloudGetRelayClientStatus
  | typeof WS_METHODS.cloudInstallRelayClient
  | typeof WS_METHODS.shellOpenInEditor
  | typeof WS_METHODS.subscribeServerConfig
  | typeof WS_METHODS.subscribeServerLifecycle
  | typeof WS_METHODS.subscribeAuthAccess
  | typeof WS_METHODS.subscribeBackgroundPolicy
  | typeof WS_METHODS.subscribeResourceTelemetry;

type ServerRpc = Extract<RpcGroup.Rpcs<typeof WsRpcGroup>, { readonly _tag: ServerRpcTag }>;

type ServerRpcHandlers = {
  readonly [Current in ServerRpc as Rpc.Tag<Current>]: Rpc.ToHandlerFn<
    Current,
    Rpc.Tag<Current> extends typeof WS_METHODS.execRun
      ? ServerConfig | ProcessRunner
      : Rpc.Tag<Current> extends typeof WS_METHODS.serverGetTraceDiagnostics
        ? TraceDiagnostics.TraceDiagnostics
        : never
  >;
};

interface RegisterServerRpcDeps {
  readonly configFeed: ReturnType<typeof makeServerConfigFeed>;
  readonly accessStream: ReturnType<typeof authAccessStream>;
  readonly keybindings: Keybindings["Service"];
  readonly serverSettings: ServerSettings.ServerSettingsService["Service"];
  readonly sourceControlDiscovery: SourceControlDiscovery["Service"];
  readonly config: ServerConfig["Service"];
  readonly processDiagnostics: ProcessDiagnostics["Service"];
  readonly processResourceMonitor: ProcessResourceMonitor["Service"];
  readonly resourceTelemetry: ResourceTelemetry["Service"];
  readonly backgroundPolicy: BackgroundPolicy["Service"];
  readonly rpcClientIds: Ref.Ref<Set<RpcClientId>>;
  readonly currentSessionId: AuthSessionId;
  readonly relayClient: RelayClient["Service"];
  readonly externalLauncher: ExternalLauncher["Service"];
  readonly lifecycleEvents: ServerLifecycleEvents["Service"];
  readonly admit: RpcAdmit;
}

export const registerServerRpc = ({
  configFeed,
  accessStream,
  keybindings,
  serverSettings,
  sourceControlDiscovery,
  config,
  processDiagnostics,
  processResourceMonitor,
  resourceTelemetry,
  backgroundPolicy,
  rpcClientIds,
  currentSessionId,
  relayClient,
  externalLauncher,
  lifecycleEvents,
  admit,
}: RegisterServerRpcDeps) =>
  ({
    [WS_METHODS.execRun]: (input) =>
      admit(
        WS_METHODS.execRun,
        Effect.map(runExecCommand(input), (run) => run.result),
      ),
    [WS_METHODS.serverProbe]: (_input) => Effect.succeed({}),
    [WS_METHODS.serverGetConfig]: (_input) => configFeed.load({ usageLimitsCommand: false }),
    // Retained only for clients shipped at v0.1.0, before self-update was removed. No
    // capability advertises these methods and no current client path calls them. Remove
    // after one release cycle, once no released client offers the update action.
    [WS_METHODS.serverUpdateServer]: (input) =>
      admit(
        WS_METHODS.serverUpdateServer,
        Effect.fail(
          new ServerSelfUpdateError({
            reason: `Zerops Mate ${input.targetVersion} must be installed outside the running server.`,
          }),
        ),
      ),
    [WS_METHODS.serverUpdateServerWithProgress]: () =>
      Stream.fail(
        new ServerSelfUpdateError({
          reason: "Zerops Mate must be installed outside the running server.",
        }),
      ),
    [WS_METHODS.serverUpsertKeybinding]: (rule) =>
      admit(WS_METHODS.serverUpsertKeybinding, keybindings.upsertKeybindingRule(rule)),
    [WS_METHODS.serverRemoveKeybinding]: (rule) =>
      admit(WS_METHODS.serverRemoveKeybinding, keybindings.removeKeybindingRule(rule)),
    [WS_METHODS.serverGetSettings]: (_input) =>
      serverSettings.getSettings.pipe(Effect.map(ServerSettings.redactServerSettingsForClient)),
    [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
      admit(
        WS_METHODS.serverUpdateSettings,
        serverSettings
          .updateSettings(patch)
          .pipe(Effect.map(ServerSettings.redactServerSettingsForClient)),
      ),
    [WS_METHODS.serverDiscoverSourceControl]: (_input) => sourceControlDiscovery.discover,
    [WS_METHODS.serverGetTraceDiagnostics]: (_input) =>
      TraceDiagnostics.readTraceDiagnostics({
        traceFilePath: config.serverTracePath,
        maxFiles: config.traceMaxFiles,
      }),
    [WS_METHODS.serverGetProcessDiagnostics]: (_input) => processDiagnostics.read,
    [WS_METHODS.serverGetProcessResourceHistory]: (input) =>
      processResourceMonitor.readHistory(input),
    [WS_METHODS.serverGetResourceTelemetryHistory]: (input) => resourceTelemetry.readHistory(input),
    [WS_METHODS.serverRetryResourceTelemetry]: (_input) =>
      admit(WS_METHODS.serverRetryResourceTelemetry, resourceTelemetry.retry),
    [WS_METHODS.serverSignalProcess]: (input) =>
      admit(WS_METHODS.serverSignalProcess, processDiagnostics.signal(input)),
    [WS_METHODS.serverReportClientActivity]: (input, metadata) =>
      Ref.update(rpcClientIds, (clientIds) => {
        const next = new Set(clientIds);
        next.add(RpcClientId.make(metadata.client.id));
        return next;
      }).pipe(
        Effect.andThen(
          backgroundPolicy.reportClientActivity(
            currentSessionId,
            RpcClientId.make(metadata.client.id),
            input,
          ),
        ),
      ),
    [WS_METHODS.serverReportHostPowerState]: (input) =>
      admit(WS_METHODS.serverReportHostPowerState, backgroundPolicy.reportHostPowerState(input)),
    [WS_METHODS.serverGetBackgroundPolicy]: (_input) => backgroundPolicy.snapshot,
    [WS_METHODS.cloudGetRelayClientStatus]: (_input) => relayClient.resolve,
    [WS_METHODS.cloudInstallRelayClient]: (_input) =>
      Stream.callback<RelayClientInstallProgressEvent, RelayClientInstallFailedError>((queue) =>
        relayClient
          .installWithProgress((event) => Queue.offer(queue, event).pipe(Effect.asVoid))
          .pipe(
            Effect.flatMap((status) =>
              Queue.offer(queue, {
                type: "complete",
                status,
              }),
            ),
            Effect.catchTags({
              RelayClientInstallError: (error) =>
                Queue.fail(
                  queue,
                  new RelayClientInstallFailedError({
                    reason: error.reason,
                    message: error.message,
                  }),
                ),
            }),
            Effect.andThen(Queue.end(queue)),
            Effect.forkScoped,
          ),
      ),
    [WS_METHODS.shellOpenInEditor]: (input) =>
      admit(WS_METHODS.shellOpenInEditor, externalLauncher.launchEditor(input)),
    [WS_METHODS.subscribeServerConfig]: (input) => configFeed.subscribe(input),
    [WS_METHODS.subscribeServerLifecycle]: (_input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const snapshot = yield* lifecycleEvents.snapshot;
          const snapshotEvents = Array.from(snapshot.events).toSorted(
            (left, right) => left.sequence - right.sequence,
          );
          const liveEvents = lifecycleEvents.stream.pipe(
            Stream.filter((event) => event.sequence > snapshot.sequence),
          );
          return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
        }),
      ),
    [WS_METHODS.subscribeAuthAccess]: () => accessStream,
    [WS_METHODS.subscribeBackgroundPolicy]: (_input) =>
      Stream.unwrap(
        Effect.map(backgroundPolicy.subscribe, ({ latest, changes }) =>
          Stream.concat(Stream.make(latest), changes),
        ),
      ),
    [WS_METHODS.subscribeResourceTelemetry]: (_input) =>
      Stream.unwrap(
        Effect.map(resourceTelemetry.subscribe, ({ latest, changes }) =>
          Stream.concat(Stream.make(latest), changes),
        ),
      ),
  }) satisfies ServerRpcHandlers;
