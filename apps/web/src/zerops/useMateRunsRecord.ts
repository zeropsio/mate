/**
 * The record that a Mate runs on an agent Mate signs nobody in to — Cursor, OpenCode, Grok,
 * Antigravity: `mate:runs:<driverKind>` on its project, the tag every surface reads whose Mate it
 * is from (`mateOwnerRecords`), whether or not this browser is connected to it.
 *
 * Written as the person looking, the first time their client finds such an agent ready on the
 * Mate (`isAgentWithoutSignInReady`, the server's own test): the Mate's own key cannot write
 * tags, so its server cannot. Once per project and agent per session; the TagWriter applies the
 * patch to the list as it is now, so a second client writing it changes nothing. A write that
 * fails (a person who may not write the project's tags) is not tried again this session — the
 * next client to find the agent ready writes it.
 */
import type { RecordProjectRef } from "@t3tools/client-runtime/zerops/environments";
import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import { isAgentWithoutSignInReady } from "@t3tools/shared/zeropsAgentAuth";
import { useContext, useEffect } from "react";

import { zeropsMateAt } from "./mateIdentities";
import { runZeropsCommand, ZeropsDataContext } from "./zeropsDataContext";

/**
 * Whether the Mate in `environmentId` already carries `mate:runs:`; undefined where no Mate lives
 * there, or it is not known yet — nothing is recorded for those.
 */
export function zeropsRunsRecorded(
  directory: Parameters<typeof zeropsMateAt>[0],
  environmentId: EnvironmentId | null,
): boolean | undefined {
  if (environmentId === null) return undefined;
  const at = zeropsMateAt(directory, environmentId);
  return at.kind === "mate" ? at.mate.runsWithoutSignIn === true : undefined;
}

/** The agent to record the Mate as running on: none once its project says one, or none ready. */
export function mateRunsToRecord(input: {
  /** Its project already carries `mate:runs:`. */
  readonly recorded: boolean;
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
}): string | undefined {
  if (input.recorded) return undefined;
  return input.providers?.find(isAgentWithoutSignInReady)?.driver;
}

const attempted = new Set<string>();

export function useMateRunsRecord(input: {
  readonly project: RecordProjectRef | undefined;
  /** Whether the Mate's project already says it runs without a sign-in; undefined for no Mate. */
  readonly recorded: boolean | undefined;
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
}): void {
  const data = useContext(ZeropsDataContext);
  const { project, recorded, providers } = input;
  const driver = recorded === undefined ? undefined : mateRunsToRecord({ recorded, providers });
  const projectId = project?.projectId;
  const orgId = project?.orgId;
  useEffect(() => {
    if (driver === undefined || data === null || projectId === undefined || orgId === undefined) {
      return;
    }
    const key = `${projectId}:${driver}`;
    if (attempted.has(key)) return;
    attempted.add(key);
    void runZeropsCommand(
      data.runtime.commands.updateProjectTags(data.projectRef(orgId, projectId), {
        kind: "agent-runs",
        driver,
      }),
    ).catch(() => undefined);
  }, [data, driver, orgId, projectId]);
}
