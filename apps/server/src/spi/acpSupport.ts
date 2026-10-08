/**
 * acpSupport — the owned, typed Cursor/Grok ACP capability surface that
 * `textGeneration/CursorTextGeneration.ts` and `textGeneration/GrokTextGeneration.ts`
 * consume from `provider/acp/CursorAcpSupport.ts` / `provider/acp/GrokAcpSupport.ts`.
 *
 * Split in two groups:
 *
 * - Session construction (`makeCursorAcpRuntime`, `makeGrokAcpRuntime`) and
 *   model-selection application (`applyCursorAcpModelSelection`,
 *   `applyGrokAcpModelSelection`) are thin, typed pass-throughs: the input
 *   shapes are owned (mirroring exactly what the two callers pass — settings
 *   pick, spawner, cwd, client info), but the returned/consumed ACP session
 *   runtime object is the real, rich session API both callers drive directly
 *   (`handleSessionUpdate`, `start`, `setMode`, `prompt`, …) — re-declaring
 *   that whole interface here would just duplicate
 *   `provider/acp/AcpSessionRuntime.ts` without adding a behavior contract,
 *   so its type flows through by inference instead.
 * - `resolveGrokAcpBaseModelId`, `currentGrokModelIdFromSessionSetup`, and
 *   `currentGrokReasoningEffortFromSessionSetup` are pure decision/extraction
 *   functions with real behavior worth pinning — `acpSupport.test.ts`
 *   contract-tests them directly.
 *
 * @module acpSupport
 */
import type { CursorSettings, GrokSettings, ProviderOptionSelection } from "@t3tools/contracts";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  applyCursorAcpModelSelection,
  makeCursorAcpRuntime as driverMakeCursorAcpRuntime,
  type CursorAcpModelSelectionErrorContext,
} from "../provider/acp/CursorAcpSupport.ts";
import {
  applyGrokAcpModelSelection,
  currentGrokModelIdFromSessionSetup as driverCurrentGrokModelIdFromSessionSetup,
  currentGrokReasoningEffortFromSessionSetup as driverCurrentGrokReasoningEffortFromSessionSetup,
  makeGrokAcpRuntime as driverMakeGrokAcpRuntime,
  resolveGrokAcpBaseModelId as driverResolveGrokAcpBaseModelId,
} from "../provider/acp/GrokAcpSupport.ts";

export type { CursorAcpModelSelectionErrorContext };
export { applyCursorAcpModelSelection, applyGrokAcpModelSelection };

/** ACP `clientInfo` identity T3 Code presents to the Cursor/Grok CLIs. */
export interface AcpClientInfo {
  readonly name: string;
  readonly version: string;
}

export interface CursorAcpSessionInput {
  readonly cursorSettings: Pick<CursorSettings, "apiEndpoint" | "binaryPath"> | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly cwd: string;
  readonly clientInfo: AcpClientInfo;
}

/** Spawns the Cursor CLI in ACP mode and returns its session runtime. */
export function makeCursorAcpRuntime(input: CursorAcpSessionInput) {
  return driverMakeCursorAcpRuntime(input);
}

export interface GrokAcpSessionInput {
  readonly grokSettings: Pick<GrokSettings, "binaryPath"> | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly cwd: string;
  readonly clientInfo: AcpClientInfo;
}

/** Spawns the Grok Build CLI in ACP mode and returns its session runtime. */
export function makeGrokAcpRuntime(input: GrokAcpSessionInput) {
  return driverMakeGrokAcpRuntime(input);
}

/** Normalizes a requested Grok model id, defaulting to `grok-build` for an empty/missing selection. */
export function resolveGrokAcpBaseModelId(model: string | null | undefined): string {
  return driverResolveGrokAcpBaseModelId(model);
}

/** Extracts the currently-selected model id from a Grok ACP session's load/new/resume setup result. */
export function currentGrokModelIdFromSessionSetup(
  sessionSetupResult: Parameters<typeof driverCurrentGrokModelIdFromSessionSetup>[0],
): string | undefined {
  return driverCurrentGrokModelIdFromSessionSetup(sessionSetupResult);
}

/** Extracts the currently-selected reasoning effort from a Grok ACP session's setup result, if any. */
export function currentGrokReasoningEffortFromSessionSetup(
  sessionSetupResult: Parameters<typeof driverCurrentGrokReasoningEffortFromSessionSetup>[0],
): string | undefined {
  return driverCurrentGrokReasoningEffortFromSessionSetup(sessionSetupResult);
}

export type { ProviderOptionSelection };
