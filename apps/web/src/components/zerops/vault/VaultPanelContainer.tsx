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
  type VaultWrite,
} from "@t3tools/client-runtime/data";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";
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

/** One project's vault, fed from the account. `onWritten` hears each write the platform took. */
export function ProjectVaultPanel({
  project,
  who,
  actor,
  onWritten,
}: {
  /** `undefined` until known: a write that guessed the project would land on somebody else's. */
  readonly project: VaultProject | undefined;
  readonly who: VaultPanelBodyProps["who"];
  readonly actor: VaultPanelBodyProps["actor"];
  readonly onWritten?: (change: VaultChange) => void;
}) {
  const projectId = project?.projectId ?? null;
  useDetailDemand("projectVariables", undefined, projectId);
  useDetailDemand("serviceVariable", undefined, projectId);
  useDetailDemand("process", "history", projectId);
  const shown = useAtomValue(projectId === null ? UNREAD : vaultAtom(projectId));
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
      // What the write means is read off the vault as it stood: a removed value's readers are
      // gone from the view once it is.
      const impact = vaultImpact(shown, scope, write);
      const held = shown.scopes.find(
        (each) => each.id === (scope.kind === "shared" ? "shared" : scope.serviceId),
      );
      const outcome = await run({
        kind: "vault-write",
        orgId: project.orgId,
        projectId: project.projectId,
        scope,
        write,
      });
      if (outcome.ok)
        onWritten?.({
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
        });
      return outcome;
    },
    [onWritten, project, run, shown],
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
  return (
    <ProjectVaultPanel
      actor={mate === undefined ? "environment" : "mate"}
      project={project}
      who={who}
      {...(mate === undefined ? {} : { onWritten })}
    />
  );
}
