/**
 * The Vault tab fed from the account: the environment's Zerops project's variables as the
 * `vault` projection reads them while this tab holds the three details it needs (the project's
 * variables, its services' variables, and its process history — without which no reader's state
 * is known), each write a `vault-write` operation and each restart a `service-restart`.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import {
  NOT_READ_VAULT,
  vaultAtom,
  vaultImpact,
  type VaultScopeRef,
  type VaultWrite,
} from "@t3tools/client-runtime/data";
import { useAtomValue } from "@effect/atom-react";
import { useCallback, useMemo } from "react";

import { useAccountOperations } from "~/zerops/accountOperations";
import { useDetailDemand } from "~/zerops/ZeropsAccountData";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";

import { VaultPanelBody, type VaultPending, type VaultWriteOutcome } from "./VaultPanel";
import { vaultOutcome } from "./vaultOutcome.logic";

const NO_PENDING: ReadonlyMap<string, VaultPending> = new Map();
const NO_RESTARTS: ReadonlySet<string> = new Set();

export function VaultPanelContainer({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const project = useZeropsEnvironmentProject(environmentId);
  const projectId = project?.projectId ?? null;
  useDetailDemand("projectVariables", undefined, projectId);
  useDetailDemand("serviceVariable", undefined, projectId);
  useDetailDemand("process", "history", projectId);
  const view = useAtomValue(vaultAtom(projectId ?? ""));
  const shown = projectId === null ? NOT_READ_VAULT : view;
  const mate = useKnownMate(environmentId);
  const operations = useAccountOperations();

  const run = useCallback(
    async (
      intent: Parameters<typeof operations.submit>[0] & { readonly orgId: string },
    ): Promise<VaultWriteOutcome> => {
      const { requestId, progress } = await operations.submit(intent);
      return (
        vaultOutcome(progress) ??
        vaultOutcome(await operations.untilEnd(requestId, intent.orgId)) ?? { ok: true }
      );
    },
    [operations],
  );

  const onWrite = useCallback(
    async (scope: VaultScopeRef, write: VaultWrite): Promise<VaultWriteOutcome> => {
      if (project === undefined) {
        return { ok: false, code: null, message: "This environment's project is not known yet." };
      }
      return run({
        kind: "vault-write",
        orgId: project.orgId,
        projectId: project.projectId,
        scope,
        write,
      });
    },
    [project, run],
  );

  const onRestart = useCallback(
    async (serviceId: string): Promise<void> => {
      if (project === undefined) return;
      await run({
        kind: "service-restart",
        orgId: project.orgId,
        projectId: project.projectId,
        serviceId,
      });
    },
    [project, run],
  );

  const who = useMemo(
    () =>
      mate === undefined
        ? ({ kind: "environment", name: "This environment" } as const)
        : ({ kind: "mate", name: mate.name, tint: mate.tint, shape: mate.shape } as const),
    [mate],
  );

  return (
    <VaultPanelBody
      actor={mate === undefined ? "environment" : "mate"}
      impactOf={(scope, write) => vaultImpact(shown, scope, write)}
      onRestart={onRestart}
      onWrite={onWrite}
      pending={NO_PENDING}
      restarting={NO_RESTARTS}
      view={shown}
      who={who}
    />
  );
}
