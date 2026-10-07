import {
  DEFAULT_SERVER_SETTINGS,
  type EditorId,
  type ServerConfig,
  type ServerConfigStreamEvent,
  type ServerLifecycleWelcomePayload,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import { mateFeedAsyncAtom, mateActionCommand } from "@t3tools/client-runtime/data";
import type { MateFeedFamily } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { createAtomCommandScheduler } from "@t3tools/client-runtime/state/runtime";
import { workspaceQuery } from "./workspace";
import { createEnvironmentServerConfigsAtom } from "@t3tools/client-runtime/state/shell";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";

const configScheduler = createAtomCommandScheduler();
const serial = {
  mode: "serial" as const,
  key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
};
function feed<F extends MateFeedFamily>(family: F) {
  const atoms = Atom.family((key: string) =>
    mateFeedAsyncAtom(JSON.parse(key) as import("@t3tools/client-runtime/data").MateFeedKey<F>),
  );
  return (target: {
    readonly environmentId: EnvironmentId;
    readonly input: Readonly<Record<string, unknown>>;
  }) => atoms(JSON.stringify({ family, ...target }));
}
const configProjection = feed("mateServerConfig");
const emptyConfig = Atom.make<ServerConfig | null>(null);
const configValueAtom = Atom.family((environmentId: EnvironmentId | null) =>
  environmentId === null
    ? emptyConfig
    : Atom.make((get) => {
        const value = Option.getOrNull(
          AsyncResult.value(get(configProjection({ environmentId, input: {} }))),
        );
        return value?.config ?? null;
      }),
);
export const serverEnvironment = {
  configProjection,
  configValueAtom,
  settingsValueAtom: Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => get(configValueAtom(environmentId))?.settings ?? null),
  ),
  providersValueAtom: Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => get(configValueAtom(environmentId))?.providers ?? null),
  ),
  providerAuthState: feed("mateProviderAuth"),
  providerInstallState: feed("mateProviderInstall"),
  welcome: feed("mateWelcome"),
  resourceTelemetry: feed("mateResourceTelemetry"),
  traceDiagnostics: workspaceQuery("traceDiagnostics"),
  processDiagnostics: workspaceQuery("processDiagnostics"),
  processResourceHistory: workspaceQuery("processResourceHistory"),
  resourceTelemetryHistory: workspaceQuery("resourceTelemetryHistory"),
  startProviderAuth: mateActionCommand(connectionAtomRuntime, "startProviderAuth"),
  respondProviderAuth: mateActionCommand(connectionAtomRuntime, "respondProviderAuth"),
  completeProviderAuth: mateActionCommand(connectionAtomRuntime, "completeProviderAuth"),
  cancelProviderAuth: mateActionCommand(connectionAtomRuntime, "cancelProviderAuth"),
  logoutProviderAuth: mateActionCommand(connectionAtomRuntime, "logoutProviderAuth"),
  startProviderInstall: mateActionCommand(connectionAtomRuntime, "startProviderInstall"),
  cancelProviderInstall: mateActionCommand(connectionAtomRuntime, "cancelProviderInstall"),
  removeProviderInstallation: mateActionCommand(
    connectionAtomRuntime,
    "removeProviderInstallation",
  ),
  consumeResetCredit: mateActionCommand(connectionAtomRuntime, "consumeResetCredit"),
  refreshProviders: mateActionCommand(connectionAtomRuntime, "refreshProviders"),
  updateProvider: mateActionCommand(connectionAtomRuntime, "updateProvider", {
    scheduler: configScheduler,
    concurrency: serial,
  }),
  upsertKeybinding: mateActionCommand(connectionAtomRuntime, "upsertKeybinding", {
    scheduler: configScheduler,
    concurrency: serial,
  }),
  removeKeybinding: mateActionCommand(connectionAtomRuntime, "removeKeybinding", {
    scheduler: configScheduler,
    concurrency: serial,
  }),
  updateSettings: mateActionCommand(connectionAtomRuntime, "updateSettings", {
    scheduler: configScheduler,
    concurrency: serial,
  }),
  signalProcess: mateActionCommand(connectionAtomRuntime, "signalProcess"),
  retryResourceTelemetry: mateActionCommand(connectionAtomRuntime, "retryResourceTelemetry"),
};
export const environmentServerConfigsAtom = createEnvironmentServerConfigsAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});

interface PrimaryServerState {
  readonly config: ServerConfig | null;
  readonly latestEvent: ServerConfigStreamEvent | null;
  readonly welcome: ServerLifecycleWelcomePayload | null;
}

const EMPTY_AVAILABLE_EDITORS: ReadonlyArray<EditorId> = [];
export const EMPTY_SERVER_PROVIDERS: ReadonlyArray<ServerProvider> = [];
const EMPTY_PRIMARY_SERVER_STATE: PrimaryServerState = {
  config: null,
  latestEvent: null,
  welcome: null,
};

const primaryServerStateAtom = Atom.make((get): PrimaryServerState => {
  const environmentId = get(primaryEnvironmentIdAtom);
  if (environmentId === null) {
    return EMPTY_PRIMARY_SERVER_STATE;
  }

  const target = { environmentId, input: {} };
  const configProjection = Option.getOrNull(
    AsyncResult.value(get(serverEnvironment.configProjection(target))),
  );
  const welcome = Option.getOrNull(AsyncResult.value(get(serverEnvironment.welcome(target))));

  return {
    config: get(serverEnvironment.configValueAtom(environmentId)),
    latestEvent: configProjection?.latestEvent ?? null,
    welcome,
  };
}).pipe(Atom.withLabel("web-primary-server-state"));

export const primaryServerConfigAtom = Atom.make(
  (get): ServerConfig | null => get(primaryServerStateAtom).config,
).pipe(Atom.withLabel("web-primary-server-config"));

export const primaryServerConfigEventAtom = Atom.make(
  (get): ServerConfigStreamEvent | null => get(primaryServerStateAtom).latestEvent,
).pipe(Atom.withLabel("web-primary-server-config-event"));

export const primaryServerWelcomeAtom = Atom.make(
  (get): ServerLifecycleWelcomePayload | null => get(primaryServerStateAtom).welcome,
).pipe(Atom.withLabel("web-primary-server-welcome"));

export const primaryServerSettingsAtom = Atom.make(
  (get): ServerSettings => get(primaryServerConfigAtom)?.settings ?? DEFAULT_SERVER_SETTINGS,
).pipe(Atom.withLabel("web-primary-server-settings"));

/**
 * Whether the primary environment is a Zerops container. Read off the server's
 * own descriptor, which carries the project id when it runs under zcp — the
 * one predicate that is the server's word rather than client bookkeeping.
 */
export const primaryEnvironmentIsZeropsAtom = Atom.make(
  (get): boolean => get(primaryServerConfigAtom)?.environment.zerops !== undefined,
).pipe(Atom.withLabel("web-primary-environment-is-zerops"));

export const primaryServerProvidersAtom = Atom.make(
  (get): ReadonlyArray<ServerProvider> =>
    get(primaryServerConfigAtom)?.providers ?? EMPTY_SERVER_PROVIDERS,
).pipe(Atom.withLabel("web-primary-server-providers"));

export const primaryServerKeybindingsAtom = Atom.make((get): ServerConfig["keybindings"] =>
  mergeWithDefaultKeybindings(get(primaryServerConfigAtom)?.keybindings ?? []),
).pipe(Atom.withLabel("web-primary-server-keybindings"));

export const primaryServerAvailableEditorsAtom = Atom.make(
  (get): ReadonlyArray<EditorId> =>
    get(primaryServerConfigAtom)?.availableEditors ?? EMPTY_AVAILABLE_EDITORS,
).pipe(Atom.withLabel("web-primary-server-available-editors"));

export const primaryServerKeybindingsConfigPathAtom = Atom.make(
  (get): string | null => get(primaryServerConfigAtom)?.keybindingsConfigPath ?? null,
).pipe(Atom.withLabel("web-primary-server-keybindings-config-path"));

export const primaryServerObservabilityAtom = Atom.make(
  (get): ServerConfig["observability"] | null =>
    get(primaryServerConfigAtom)?.observability ?? null,
).pipe(Atom.withLabel("web-primary-server-observability"));
