/**
 * The Vault tab fed from the account: a Zerops project's variables as the `vault` projection reads
 * them while the panel holds the three details it needs (the project's variables, its services'
 * variables, and its process history — without which no reader's state is known), each write a
 * `vault-write` operation and each restart a `service-restart`.
 *
 * Beside a Mate's conversation it is the Mate's project, and each write the person makes is kept
 * for the Mate's next message (`recordVaultWrite`); on an environment's own page (stage, prod) it
 * is that environment's project, and the person restarts what a change needs.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import {
  NOT_READ_VAULT,
  vaultAtom,
  vaultImpact,
  type VaultChange,
  type VaultScopeRef,
  type VaultView,
  type VaultWrite,
} from "@t3tools/client-runtime/data";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import { FileCodeIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { useActiveProjectTarget, type ActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useRightPanelStore } from "~/rightPanelStore";

import { useProjectFilePickerQuery, useProjectFileQuery } from "../../files/projectFilesQueryState";
import { InlineButton } from "../../ui/button";
import { deployConfigPath, setupLine } from "./vaultGroups.logic";
import { useAccountOperations } from "~/zerops/accountOperations";
import { useDetailDemand } from "~/zerops/ZeropsAccountData";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";
import { recordVaultWrite } from "~/zerops/vaultTurnNotes";
import {
  VaultPanelBody,
  type VaultPanelBodyProps,
  type VaultPending,
  type VaultWriteOutcome,
} from "./VaultPanel";
import { vaultOutcome } from "./vaultOutcome.logic";

const NO_PENDING: ReadonlyMap<string, VaultPending> = new Map();
const NO_RESTARTS: ReadonlySet<string> = new Set();
const UNREAD = Atom.make(NOT_READ_VAULT);

/** Which Zerops project a vault is, with the organization that lists it. */
export interface VaultProject {
  readonly orgId: string;
  readonly projectId: string;
}

const CHANGE_OF: Readonly<Record<VaultWrite["kind"], VaultChange["kind"]>> = {
  add: "added",
  update: "changed",
  remove: "removed",
};

/**
 * Writes to one project's vault as `vault-write` operations, each waited to its end: how it ended,
 * and — when the platform took it — the change as the Mate is told it, read off the vault as it
 * stood (a removed value's readers are gone from the view once it is).
 */
export function useVaultWriter(project: VaultProject | undefined, view: VaultView) {
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
  const write = useCallback(
    async (
      scope: VaultScopeRef,
      write: VaultWrite,
    ): Promise<{ readonly outcome: VaultWriteOutcome; readonly change: VaultChange | null }> => {
      if (project === undefined) {
        return {
          outcome: {
            ok: false,
            code: null,
            message: "This environment's project is not known yet.",
          },
          change: null,
        };
      }
      const impact = vaultImpact(view, scope, write);
      const held = view.scopes.find(
        (each) => each.id === (scope.kind === "shared" ? "shared" : scope.serviceId),
      );
      const outcome = await run({
        kind: "vault-write",
        orgId: project.orgId,
        projectId: project.projectId,
        scope,
        write,
      });
      if (!outcome.ok) return { outcome, change: null };
      return {
        outcome,
        change: {
          scope,
          hostname: held?.hostname ?? null,
          key: write.key,
          kind: CHANGE_OF[write.kind],
          sensitive:
            write.kind === "remove"
              ? (held?.values.find((value) => value.id === write.id)?.sensitive ?? false)
              : write.sensitive,
          at: new Date().toISOString(),
          impact,
        },
      };
    },
    [project, run, view],
  );
  return { run, write };
}

/** One project's vault, fed from the account. `onWritten` hears each write the platform took. */
export function ProjectVaultPanel({
  project,
  who,
  actor,
  onWritten,
  renderDeployConfig,
}: {
  /** `undefined` until known: a write that guessed the project would land on somebody else's. */
  readonly project: VaultProject | undefined;
  readonly who: VaultPanelBodyProps["who"];
  readonly actor: VaultPanelBodyProps["actor"];
  readonly onWritten?: (change: VaultChange) => void;
  readonly renderDeployConfig?: VaultPanelBodyProps["renderDeployConfig"];
}) {
  const projectId = project?.projectId ?? null;
  useDetailDemand("projectVariables", undefined, projectId);
  useDetailDemand("serviceVariable", undefined, projectId);
  useDetailDemand("process", "history", projectId);
  const shown = useAtomValue(projectId === null ? UNREAD : vaultAtom(projectId));
  const { run, write: writeVault } = useVaultWriter(project, shown);
  const onWrite = useCallback(
    async (scope: VaultScopeRef, write: VaultWrite): Promise<VaultWriteOutcome> => {
      const { outcome, change } = await writeVault(scope, write);
      if (change !== null) onWritten?.(change);
      return outcome;
    },
    [onWritten, writeVault],
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
  return (
    <VaultPanelBody
      actor={actor}
      impactOf={(scope, write) => vaultImpact(shown, scope, write)}
      onRestart={onRestart}
      onWrite={onWrite}
      pending={NO_PENDING}
      restarting={NO_RESTARTS}
      view={shown}
      who={who}
      {...(renderDeployConfig === undefined ? {} : { renderDeployConfig })}
    />
  );
}

/** A Mate's conversation's vault: its environment's project; each write is told to the Mate. */
export function VaultPanelContainer({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const project = useZeropsEnvironmentProject(environmentId);
  const mate = useKnownMate(environmentId);
  const who = useMemo(
    () =>
      mate === undefined
        ? ({ kind: "environment", name: "This environment" } as const)
        : ({ kind: "mate", name: mate.name, tint: mate.tint, shape: mate.shape } as const),
    [mate],
  );
  const projectId = project?.projectId;
  const onWritten = useCallback(
    (change: VaultChange) => {
      if (projectId !== undefined) recordVaultWrite(projectId, change);
    },
    [projectId],
  );
  const workspace = useActiveProjectTarget();
  const renderDeployConfig = useCallback(
    (hostname: string) =>
      workspace === null || workspace.environmentId !== environmentId ? null : (
        <DeployConfigLink hostname={hostname} workspace={workspace} />
      ),
    [environmentId, workspace],
  );
  return (
    <ProjectVaultPanel
      actor={mate === undefined ? "environment" : "mate"}
      project={project}
      renderDeployConfig={renderDeployConfig}
      who={who}
      {...(mate === undefined ? {} : { onWritten })}
    />
  );
}

/**
 * An app's deploy config in the Mate's workspace, as a link that opens it in the file browser at
 * the app's `setup:`; nothing while it is looked for or where none is found.
 */
function DeployConfigLink({
  hostname,
  workspace,
}: {
  readonly hostname: string;
  readonly workspace: ActiveProjectTarget;
}) {
  const search = useProjectFilePickerQuery(workspace.environmentId, workspace.cwd, "zerops.y", 50);
  const path = deployConfigPath(
    hostname,
    search.entries.map((entry) => entry.path),
  );
  const file = useProjectFileQuery(workspace.environmentId, workspace.cwd, path, path !== null);
  if (path === null) return null;
  const line = file.data === null ? null : setupLine(file.data.contents, hostname);
  return (
    <span className="inline-flex items-center gap-1">
      <FileCodeIcon aria-hidden="true" className="size-3" />
      <InlineButton
        onClick={() =>
          useRightPanelStore.getState().openFile(workspace.threadRef, path, line ?? undefined)
        }
      >
        {path}
      </InlineButton>
    </span>
  );
}
