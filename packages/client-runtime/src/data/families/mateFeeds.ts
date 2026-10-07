/** Complete Mate snapshots. Detail identities include the environment and the exact requested scope. */
import type {
  CrewFiles,
  CrewSnapshot,
  TerminalSummary,
  UsageSummary,
  ZeropsAgentAuthSnapshot,
  ZeropsLifecycle,
} from "@t3tools/contracts";
import { scopeOf, type FamilySpec } from "./spec.ts";
export interface MateFeedValues {
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
  mateLifecycle: spec("mateLifecycle", "realtime"),
  mateAgentAuth: spec("mateAgentAuth", "realtime"),
  mateCrew: spec("mateCrew", "realtime"),
  mateCrewFiles: spec("mateCrewFiles", "sampled"),
  mateUsage: spec("mateUsage", "once"),
  mateTerminal: spec("mateTerminal", "realtime"),
};
