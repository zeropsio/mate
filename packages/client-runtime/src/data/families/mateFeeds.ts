/** Complete Mate snapshots. Detail identities include the environment and the exact requested scope. */
import type {
  CrewFiles,
  CrewSnapshot,
  TerminalSummary,
  UsageSummary,
  ZeropsAgentAuthSnapshot,
  ZeropsLifecycle,
} from "@t3tools/contracts";
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcStreamValue } from "../../rpc/client.ts";
import type { ServerConfigProjection } from "../../state/serverConfigProjection.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";
export interface MateFeedValues {
  readonly mateServerConfig: ServerConfigProjection;
  readonly mateWelcome: import("@t3tools/contracts").ServerLifecycleWelcomePayload;
  readonly mateProviderAuth: EnvironmentRpcStreamValue<typeof WS_METHODS.providerAuthSubscribe>;
  readonly mateProviderInstall: EnvironmentRpcStreamValue<
    typeof WS_METHODS.providerInstallSubscribe
  >;
  readonly mateResourceTelemetry: EnvironmentRpcStreamValue<
    typeof WS_METHODS.subscribeResourceTelemetry
  >;
  readonly mateProjectClone: EnvironmentRpcStreamValue<typeof WS_METHODS.subscribeProjectClones>;
  readonly mateClientSession: import("@t3tools/contracts").AuthSessionState;
  readonly mateLifecycle: ZeropsLifecycle;
  readonly mateAgentAuth: ZeropsAgentAuthSnapshot;
  readonly mateCrew: CrewSnapshot;
  readonly mateCrewFiles: CrewFiles;
  readonly mateUsage: UsageSummary;
  readonly mateTerminal: ReadonlyArray<TerminalSummary>;
}
export type MateFeedFacts = {
  readonly [F in keyof MateFeedValues]: {
    readonly snapshot: MateFeedValues[F];
    readonly observedAtMs: number;
  };
};
export type MateFeedFamily = keyof MateFeedValues;
export interface MateFeedKey<F extends MateFeedFamily = MateFeedFamily> {
  readonly family: F;
  readonly environmentId: string;
  readonly input: Readonly<Record<string, unknown>> | null;
}
export const mateFeedId = (key: MateFeedKey): string =>
  encodeURIComponent(JSON.stringify([key.environmentId, key.input]));
export const mateFeedLink = (key: MateFeedKey) => `mate:${key.family}-${mateFeedId(key)}` as const;
export const mateFeedScope = (key: MateFeedKey) =>
  scopeOf(MATE_FEED_FAMILIES[key.family], `${key.family}-${mateFeedId(key)}`);
declare module "../model.ts" {
  interface FamilyValues extends MateFeedFacts {}
}
const spec = <F extends MateFeedFamily>(
  family: F,
  mode: "realtime" | "sampled" | "once",
): FamilySpec<F> => ({
  family,
  authority: "mate",
  scope: { source: "mate", suffix: family, leaving: "removed", demand: "detail", mode },
});
export const MATE_FEED_FAMILIES = {
  mateServerConfig: spec("mateServerConfig", "realtime"),
  mateWelcome: spec("mateWelcome", "realtime"),
  mateProviderAuth: spec("mateProviderAuth", "realtime"),
  mateProviderInstall: spec("mateProviderInstall", "realtime"),
  mateResourceTelemetry: spec("mateResourceTelemetry", "realtime"),
  mateProjectClone: spec("mateProjectClone", "realtime"),
  mateClientSession: spec("mateClientSession", "realtime"),
  mateLifecycle: spec("mateLifecycle", "realtime"),
  mateAgentAuth: spec("mateAgentAuth", "realtime"),
  mateCrew: spec("mateCrew", "realtime"),
  mateCrewFiles: spec("mateCrewFiles", "sampled"),
  mateUsage: spec("mateUsage", "once"),
  mateTerminal: spec("mateTerminal", "realtime"),
};
